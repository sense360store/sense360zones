/*
 * HaDataProvider — the real, read-only data provider.
 *
 * It satisfies the same `DataProvider` contract as `MockDataProvider`, so the
 * routes and the frontend cannot tell which provider is wired. It connects to
 * the Home Assistant WebSocket API, discovers ESPHome devices and entities, maps
 * them onto the Room/Device/Sensor model, and streams live LD2450 targets through
 * the existing `subscribeTargets` contract, in the same room frame and metres
 * that `MockDataProvider` emits.
 *
 * Phase 2 is read-only: nothing here writes to a device. `writeConfig` persists
 * only the mount (calibration) and keeps zones/band in memory for the session.
 * The apply path, zone persistence, and SEN0609 live presence belong to later
 * phases (see ROADMAP.md).
 */
import { LD2450_FOV_HALF, LD2450_RANGE } from '../../src/domain/constants'
import type { BandConfig, Point, Room, Sensor, SensorMount, Target, Zone } from '../../src/domain/types'
import { resolveMapping } from '../ha/detect'
import { sensorToRoom, toMetres } from '../ha/frame'
import { HaWsClient, type ConnectionState, type Logger } from '../ha/HaWsClient'
import {
  UNAVAILABLE_STATES,
  type AreaRegistryEntry,
  type DeviceMapping,
  type DeviceRegistryEntry,
  type EntityRegistryEntry,
  type HassState,
  type StateChangedEvent,
} from '../ha/types'
import { Persistence } from '../persistence'
import type { DataProvider, DeviceConfig, TargetListener, Unsubscribe } from './DataProvider'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }

/** Default mount when none is persisted yet. Matches the Phase 0 convention. */
const DEFAULT_MOUNT: SensorMount = { surface: 'wall', height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }

/** Default band for a freshly discovered SEN0609 (shown as configured, not live). */
const DEFAULT_BAND: BandConfig = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }

/** Target colours, reused from the Phase 0 palette so the canvas looks the same. */
const TARGET_COLORS = ['var(--green)', '#2d8fff', '#e0922a']

/** Trail length, matching the mock so the canvas renders identical motion trails. */
const TRAIL_MAX = 16

export interface HaDataProviderOptions {
  wsUrl: string
  token: string
  dataDir: string
  logger?: Logger
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  timeoutMs?: number
}

/** The in-memory (session) zone/band config for a device. Not persisted in Phase 2. */
interface DeviceWorking {
  zones: Zone[]
  band: BandConfig
}

export class HaDataProvider implements DataProvider {
  private readonly client: HaWsClient
  private readonly persistence: Persistence
  private logger: Logger

  /** Last discovery results, used to seed live streams and answer config reads. */
  private states = new Map<string, HassState>()
  private mappings = new Map<string, DeviceMapping>()
  private rooms: Room[] = []
  /** Session zone/band per device. Phase 3 persists these and writes them to hardware. */
  private working = new Map<string, DeviceWorking>()

  constructor(opts: HaDataProviderOptions) {
    this.logger = opts.logger ?? noopLogger
    this.client = new HaWsClient({
      url: opts.wsUrl,
      token: opts.token,
      logger: this.logger,
      reconnectBaseMs: opts.reconnectBaseMs,
      reconnectMaxMs: opts.reconnectMaxMs,
      timeoutMs: opts.timeoutMs,
    })
    this.persistence = new Persistence(opts.dataDir, this.logger)
    // Connect eagerly so the socket is warm before the first discovery. Failures
    // are logged by the client and surfaced again when discover() awaits connect.
    this.client.connect().catch(() => {})
  }

  /** Swap in the server logger once the Fastify app exists (see index.ts). */
  attachLogger(logger: Logger): void {
    this.logger = logger
    this.client.setLogger(logger)
  }

  /** The live Home Assistant connection state. */
  connectionState(): ConnectionState {
    return this.client.getState()
  }

  async discover(): Promise<Room[]> {
    await this.client.connect()
    const [areas, devices, entities, states] = await Promise.all([
      this.client.command<AreaRegistryEntry[]>({ type: 'config/area_registry/list' }),
      this.client.command<DeviceRegistryEntry[]>({ type: 'config/device_registry/list' }),
      this.client.command<EntityRegistryEntry[]>({ type: 'config/entity_registry/list' }),
      this.client.command<HassState[]>({ type: 'get_states' }),
    ])

    this.states = new Map(states.map((s) => [s.entity_id, s]))
    const stateOf = (id: string) => this.states.get(id)

    // Group enabled entity ids by device.
    const entitiesByDevice = new Map<string, string[]>()
    for (const e of entities) {
      if (!e.device_id || e.disabled_by) continue
      const list = entitiesByDevice.get(e.device_id) ?? []
      list.push(e.entity_id)
      entitiesByDevice.set(e.device_id, list)
    }

    // Resolve a mapping per device (auto-detect, then persisted override).
    this.mappings = new Map()
    for (const dev of devices) {
      const ids = entitiesByDevice.get(dev.id) ?? []
      const mapping = resolveMapping(dev.id, ids, stateOf, this.persistence.getMapping(dev.id))
      if (mapping) this.mappings.set(dev.id, mapping)
    }

    // Build the room model from areas and the mapped devices. Areas with no
    // detected sensor device are omitted rather than shown as empty rooms.
    const areaName = new Map(areas.map((a) => [a.area_id, a.name]))
    const roomsById = new Map<string, Room>()
    for (const dev of devices) {
      const mapping = this.mappings.get(dev.id)
      if (!mapping) continue

      const roomId = dev.area_id ? `area:${dev.area_id}` : 'area:unassigned'
      let room = roomsById.get(roomId)
      if (!room) {
        const name = dev.area_id ? (areaName.get(dev.area_id) ?? dev.area_id) : 'Unassigned'
        room = { id: roomId, name, devices: [] }
        roomsById.set(roomId, room)
      }

      if (!this.working.has(dev.id)) this.working.set(dev.id, { zones: [], band: clone(DEFAULT_BAND) })
      const mount = this.persistence.getMount(dev.id) ?? clone(DEFAULT_MOUNT)
      room.devices.push({ id: dev.id, name: deviceName(dev), sensors: [this.buildSensor(dev.id, mapping, mount)] })
    }

    this.rooms = [...roomsById.values()]
    this.logDetection(devices.length)
    return clone(this.rooms)
  }

  async readConfig(deviceId: string): Promise<DeviceConfig> {
    const work = this.working.get(deviceId) ?? { zones: [], band: clone(DEFAULT_BAND) }
    const mount = this.persistence.getMount(deviceId) ?? clone(DEFAULT_MOUNT)
    return { zones: clone(work.zones), band: clone(work.band), mount }
  }

  async writeConfig(deviceId: string, config: DeviceConfig): Promise<void> {
    // Read-only with respect to hardware. Keep the authored zones/band in memory
    // so the session is consistent, but do not write them to the device or disk
    // (the apply path and zone persistence are Phase 3). Persist the mount only.
    this.working.set(deviceId, { zones: clone(config.zones), band: clone(config.band) })
    if (config.mount) this.persistence.setMount(deviceId, config.mount)
  }

  subscribeTargets(deviceId: string, onSample: TargetListener): Unsubscribe {
    const mapping = this.mappings.get(deviceId)
    if (!mapping || mapping.kind !== 'ld2450') {
      // No live spatial stream: an unknown device, or a SEN0609 (its live
      // presence is deferred to Phase 5). Clear the canvas and do nothing more.
      onSample([])
      return () => {}
    }

    const mount = this.persistence.getMount(deviceId) ?? clone(DEFAULT_MOUNT)
    const entityIds = new Set<string>()
    for (const slot of mapping.roles.targets) {
      if (slot.x) entityIds.add(slot.x)
      if (slot.y) entityIds.add(slot.y)
      if (slot.speed) entityIds.add(slot.speed)
    }

    // Latest value per mapped entity, seeded from the discovery snapshot.
    const latest = new Map<string, HassState>()
    for (const id of entityIds) {
      const s = this.states.get(id)
      if (s) latest.set(id, s)
    }
    const trails = new Map<string, Point[]>()
    const emit = () => onSample(this.buildTargets(mapping, mount, latest, trails))

    emit() // immediate frame, matching the contract

    const sub = this.client.subscribe({ type: 'subscribe_events', event_type: 'state_changed' }, (event) => {
      const ev = event as StateChangedEvent
      if (!ev || ev.event_type !== 'state_changed' || !ev.data) return
      if (!entityIds.has(ev.data.entity_id)) return
      if (ev.data.new_state) latest.set(ev.data.entity_id, ev.data.new_state)
      else latest.delete(ev.data.entity_id)
      emit()
    })

    return () => sub.unsubscribe()
  }

  dispose(): void {
    this.client.close()
  }

  // ---- internals ---------------------------------------------------------

  private buildSensor(deviceId: string, mapping: DeviceMapping, mount: SensorMount): Sensor {
    const work = this.working.get(deviceId) ?? { zones: [], band: clone(DEFAULT_BAND) }
    if (mapping.kind === 'ld2450') {
      return {
        id: `${deviceId}:ld2450`,
        name: 'HLK LD2450',
        kind: 'ld2450',
        mount: clone(mount),
        fovHalf: LD2450_FOV_HALF,
        range: LD2450_RANGE,
        zones: clone(work.zones),
      }
    }
    return {
      id: `${deviceId}:sen0609`,
      name: 'DFRobot SEN0609',
      kind: 'sen0609',
      mount: clone(mount),
      band: clone(work.band),
    }
  }

  /** Recompute the target list for a device from the latest mapped entity values. */
  private buildTargets(
    mapping: DeviceMapping,
    mount: SensorMount,
    latest: Map<string, HassState>,
    trails: Map<string, Point[]>,
  ): Target[] {
    const out: Target[] = []
    mapping.roles.targets.forEach((slot, i) => {
      if (!slot.x || !slot.y) return
      const sx = latest.get(slot.x)
      const sy = latest.get(slot.y)
      if (!sx || !sy) return
      if (UNAVAILABLE_STATES.has(sx.state.toLowerCase()) || UNAVAILABLE_STATES.has(sy.state.toLowerCase())) return
      const rawX = Number(sx.state)
      const rawY = Number(sy.state)
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return
      // The LD2450 reports 0,0 for an unoccupied target slot: not a real target.
      if (rawX === 0 && rawY === 0) return

      const room = sensorToRoom(
        { x: toMetres(rawX, sx.attributes.unit_of_measurement), y: toMetres(rawY, sy.attributes.unit_of_measurement) },
        mount,
      )
      const id = `t${i + 1}`
      const trail = [...(trails.get(id) ?? []), { x: room.x, y: room.y }].slice(-TRAIL_MAX)
      trails.set(id, trail)
      out.push({ id, x: room.x, y: room.y, vx: 0, vy: 0, color: TARGET_COLORS[i] ?? '#2d8fff', trail: clone(trail) })
    })

    // Drop trails for slots that are no longer present, so a target that leaves
    // and returns starts a fresh trail rather than teleporting across the room.
    for (const id of [...trails.keys()]) {
      if (!out.some((t) => t.id === id)) trails.delete(id)
    }
    return out
  }

  private logDetection(deviceCount: number): void {
    const detected = [...this.mappings.values()].map((m) => ({ deviceId: m.deviceId, kind: m.kind }))
    this.logger.info(
      { detected, rooms: this.rooms.length, scanned: deviceCount },
      `discovered ${detected.length} sensor device(s) across ${this.rooms.length} room(s)`,
    )
    for (const m of this.mappings.values()) {
      this.logger.debug({ deviceId: m.deviceId, kind: m.kind, roles: m.roles }, 'resolved device mapping')
    }
  }
}

function deviceName(dev: DeviceRegistryEntry): string {
  return dev.name_by_user || dev.name || dev.id
}
