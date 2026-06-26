/*
 * HaDataProvider — the real Home Assistant data provider.
 *
 * It satisfies the same `DataProvider` contract as `MockDataProvider`, so the
 * routes and the frontend cannot tell which provider is wired. It connects to the
 * Home Assistant WebSocket API, discovers ESPHome devices and entities, maps them
 * onto the Room/Device/Sensor model, streams live LD2450 targets, and — new in
 * Phase 3 — reads and writes the LD2450's native zone regions.
 *
 * The device is the source of truth. `readConfig` reconstructs zones from the live
 * region entities and the zone_type select; `writeConfig` validates a set against
 * the native constraints, writes the region numbers and the mode, then reads back
 * to confirm the device accepted them. The persisted record holds the authored
 * edit, the mount, and the SEN0609 band, but never overrides what the hardware
 * reports on a read. SEN0609 registers are not written in this phase (see ROADMAP).
 */
import {
  MAX_NATIVE_ZONES,
  nativeRegion,
  nativeViolations,
  regionToRect,
  type NativeRegion,
} from '../../src/domain/native'
import { resolveProfile } from '../../src/domain/profile'
import { LD2450_FOV_HALF, LD2450_RANGE } from '../../src/domain/constants'
import type { BandConfig, Point, Room, Sensor, SensorMount, Target, Zone, ZoneType } from '../../src/domain/types'
import { resolveMapping } from '../ha/detect'
import { sensorToRoom, toMetres } from '../ha/frame'
import { HaWsClient, type ConnectionState, type Logger } from '../ha/HaWsClient'
import { AVAILABILITY_TOPIC } from '../mqtt/discovery'
import { OccupancyRuntime } from '../mqtt/OccupancyRuntime'
import { supervisorMqttFactory, type MqttPublisher, type MqttPublisherFactory } from '../mqtt/MqttPublisher'
import {
  UNAVAILABLE_STATES,
  type AreaRegistryEntry,
  type DeviceMapping,
  type DeviceRegistryEntry,
  type EntityRegistryEntry,
  type HassState,
  type StateChangedEvent,
  type ZoneNumberRoles,
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

/** The global filter mode an LD2450 applies to all of its regions at once. */
type ZoneMode = ZoneType | 'none'

export interface HaDataProviderOptions {
  wsUrl: string
  token: string
  dataDir: string
  logger?: Logger
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  timeoutMs?: number
  /**
   * How the live polygon-occupancy path obtains an MQTT publisher. Defaults to the
   * Supervisor MQTT service; the test suite injects a factory returning a fake.
   */
  mqttFactory?: MqttPublisherFactory
  /** Debounce for occupancy transitions (milliseconds). Tests use 0 for immediacy. */
  occupancyDebounceMs?: { on: number; off: number }
}

export class HaDataProvider implements DataProvider {
  private readonly client: HaWsClient
  private readonly persistence: Persistence
  private logger: Logger

  /** Last discovery results, used to seed live streams and answer config reads. */
  private states = new Map<string, HassState>()
  private mappings = new Map<string, DeviceMapping>()
  private rooms: Room[] = []
  /** Display names per device, used for the published MQTT device block. */
  private deviceNames = new Map<string, string>()

  // ---- live polygon occupancy (Phase 4) ----------------------------------
  private readonly mqttFactory: MqttPublisherFactory
  private readonly occupancyDebounceMs?: { on: number; off: number }
  private publisher: MqttPublisher | null = null
  private publisherPending: Promise<MqttPublisher | null> | null = null
  private occupancy: OccupancyRuntime | null = null
  /** Tri-state: undefined until a polygon device first needs MQTT, then the outcome. */
  private mqttAvailable: boolean | undefined

  constructor(opts: HaDataProviderOptions) {
    this.logger = opts.logger ?? noopLogger
    this.mqttFactory = opts.mqttFactory ?? supervisorMqttFactory
    this.occupancyDebounceMs = opts.occupancyDebounceMs
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

      const mount = this.persistence.getMount(dev.id) ?? clone(DEFAULT_MOUNT)
      room.devices.push({ id: dev.id, name: deviceName(dev), sensors: [this.buildSensor(dev.id, mapping, mount)] })
    }

    this.rooms = [...roomsById.values()]
    this.deviceNames = new Map(this.rooms.flatMap((r) => r.devices).map((d) => [d.id, d.name]))
    this.logDetection(devices.length)

    // Re-activate the live evaluator for any device persisted as polygon, so its
    // entities reappear and tracking resumes after an add-on restart.
    await this.reactivatePolygonDevices()
    return clone(this.rooms)
  }

  async readConfig(deviceId: string): Promise<DeviceConfig> {
    const mount = this.persistence.getMount(deviceId) ?? clone(DEFAULT_MOUNT)
    const mapping = this.mappings.get(deviceId)

    // Polygon profile: the device is in report-all mode and the add-on evaluates
    // the zones, so the persisted active config is the truth, not the hardware
    // (which now reconstructs to nothing). Surface whether MQTT is publishing.
    if (this.persistence.getProfile(deviceId) === 'polygon') {
      return {
        zones: clone(this.persistence.getZones(deviceId) ?? []),
        band: clone(this.persistence.getBand(deviceId) ?? DEFAULT_BAND),
        mount,
        mqttAvailable: this.mqttAvailable ?? false,
      }
    }

    // Native LD2450 with region entities: the device is the truth. Re-read live
    // state and reconstruct the zones, so Revert reflects the hardware, not the
    // edit cache.
    if (mapping && mapping.kind === 'ld2450' && mapping.roles.zones && mapping.roles.zoneType) {
      const states = await this.refreshStates()
      return {
        zones: this.reconstructZones(deviceId, mapping, mount, states),
        band: clone(this.persistence.getBand(deviceId) ?? DEFAULT_BAND),
        mount,
      }
    }

    // SEN0609, or an LD2450 without region entities: nothing to read from hardware
    // in this phase, so fall back to the persisted edit and band.
    return {
      zones: clone(this.persistence.getZones(deviceId) ?? []),
      band: clone(this.persistence.getBand(deviceId) ?? DEFAULT_BAND),
      mount,
    }
  }

  async writeConfig(deviceId: string, config: DeviceConfig): Promise<void> {
    if (config.mount) this.persistence.setMount(deviceId, config.mount)
    const mount = config.mount ?? this.persistence.getMount(deviceId) ?? clone(DEFAULT_MOUNT)
    const mapping = this.mappings.get(deviceId)
    const isLd2450 = mapping?.kind === 'ld2450'
    const nativeCapable = Boolean(isLd2450 && mapping!.roles.zones && mapping!.roles.zoneType)

    // SEN0609, or an unmapped device: keep the authored config app-side, exactly as
    // in Phase 3. Polygon zones are an LD2450 capability.
    if (!isLd2450) {
      this.persistence.setZones(deviceId, clone(config.zones))
      this.persistence.setBand(deviceId, clone(config.band))
      return
    }

    // The resolved profile decides the apply path and the source of truth. The
    // resolver and the native write share `nativeViolations`, so eligibility is
    // judged in exactly one place.
    const profile = resolveProfile(config.zones, mount).profile
    if (profile === 'native') {
      await this.applyNative(deviceId, config, mount, mapping!, nativeCapable)
    } else {
      await this.applyPolygon(deviceId, config, mount, mapping!, nativeCapable)
    }
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
    this.occupancy?.dispose()
    // Closing the publisher publishes the offline availability before the socket
    // drops, so the entities show unavailable rather than disappearing.
    void this.publisher?.close()
    this.client.close()
  }

  // ---- internals ---------------------------------------------------------

  /** The native LD2450 apply path (Phase 3): validate, write registers, read back. */
  private async applyNative(
    deviceId: string,
    config: DeviceConfig,
    mount: SensorMount,
    mapping: DeviceMapping,
    nativeCapable: boolean,
  ): Promise<void> {
    if (!nativeCapable) {
      // A native-eligible set on an LD2450 without region entities: nothing to
      // write to hardware, so keep it app-side like a SEN0609.
      this.persistence.setZones(deviceId, clone(config.zones))
      this.persistence.setBand(deviceId, clone(config.band))
      this.persistence.setProfile(deviceId, 'native')
      return
    }

    // Validate before touching hardware. A bad write changes detection in a real
    // room, so refuse the whole set rather than write a partial result.
    const violations = nativeViolations(config.zones, mount)
    if (violations.length) {
      throw new Error(`Cannot apply zones natively: ${violations.join('; ')}`)
    }

    await this.client.connect()
    const zoneRoles = mapping.roles.zones!
    const selectId = mapping.roles.zoneType!

    // Match the model's mode to one of the select's own options, case-insensitively
    // (option strings vary by component build, so they are not hardcoded).
    const states = await this.refreshStates()
    const options = (states.get(selectId)?.attributes?.options as string[] | undefined) ?? []
    const mode: ZoneMode = config.zones.length ? config.zones[0].type : 'none'
    const option = optionForMode(options, mode)
    if (!option) {
      throw new Error(`The zone_type select has no option for "${mode}" (options: ${options.join(', ') || 'none'})`)
    }

    // Write each used slot; clear the rest so a removed zone does not linger.
    const regions = config.zones.map((z) => nativeRegion(z, mount)!)
    for (let slot = 0; slot < MAX_NATIVE_ZONES; slot++) {
      const roles = zoneRoles[slot]
      if (!roles) continue
      const region = regions[slot] ?? CLEARED_REGION
      await this.setNumber(roles.x1, region.x1)
      await this.setNumber(roles.y1, region.y1)
      await this.setNumber(roles.x2, region.x2)
      await this.setNumber(roles.y2, region.y2)
    }
    await this.client.callService('select', 'select_option', { option }, { entity_id: selectId })

    // Read back and confirm the device reflects exactly what was sent.
    await this.confirmWrite(zoneRoles, regions, selectId, option)

    // The hardware is the truth again: tear down any live polygon evaluation and
    // persist the applied set as the new baseline record.
    this.occupancy?.deactivate(deviceId)
    this.persistence.setZones(deviceId, clone(config.zones))
    this.persistence.setBand(deviceId, clone(config.band))
    this.persistence.setProfile(deviceId, 'native')
    this.logger.info({ deviceId, zones: config.zones.length, mode }, 'applied native LD2450 zones')
  }

  /**
   * The polygon apply path (Phase 4): put the LD2450 into report-all mode so the
   * evaluator sees every target, persist the set as the active baseline (the truth
   * for a polygon device), and activate the live evaluator and the published
   * entities. Never writes a native region for a non-eligible set.
   */
  private async applyPolygon(
    deviceId: string,
    config: DeviceConfig,
    mount: SensorMount,
    mapping: DeviceMapping,
    nativeCapable: boolean,
  ): Promise<void> {
    if (nativeCapable) {
      await this.client.connect()
      await this.setReportAll(mapping)
    }

    this.persistence.setZones(deviceId, clone(config.zones))
    this.persistence.setBand(deviceId, clone(config.band))
    this.persistence.setProfile(deviceId, 'polygon')

    await this.activatePolygon(deviceId)
    this.logger.info(
      { deviceId, zones: config.zones.length, mqtt: this.mqttAvailable ?? false },
      'applied polygon zones (report-all + live occupancy)',
    )
  }

  /**
   * Put a native-capable LD2450 into report-all mode: clear every region slot and
   * disable the zone_type select, so the device filters nothing and the evaluator
   * sees all targets.
   */
  private async setReportAll(mapping: DeviceMapping): Promise<void> {
    const zoneRoles = mapping.roles.zones!
    const selectId = mapping.roles.zoneType!
    for (let slot = 0; slot < MAX_NATIVE_ZONES; slot++) {
      const roles = zoneRoles[slot]
      if (!roles) continue
      await this.setNumber(roles.x1, CLEARED_REGION.x1)
      await this.setNumber(roles.y1, CLEARED_REGION.y1)
      await this.setNumber(roles.x2, CLEARED_REGION.x2)
      await this.setNumber(roles.y2, CLEARED_REGION.y2)
    }
    const states = await this.refreshStates()
    const options = (states.get(selectId)?.attributes?.options as string[] | undefined) ?? []
    const option = optionForMode(options, 'none')
    if (option) {
      await this.client.callService('select', 'select_option', { option }, { entity_id: selectId })
    }
  }

  /** Re-activate the live evaluator for every device persisted as polygon. */
  private async reactivatePolygonDevices(): Promise<void> {
    for (const deviceId of this.deviceNames.keys()) {
      if (this.persistence.getProfile(deviceId) === 'polygon') {
        await this.activatePolygon(deviceId)
      }
    }
  }

  /**
   * Activate (or refresh) the live occupancy evaluator and published entities for a
   * polygon device. Degrades cleanly when MQTT is unavailable: it records the
   * outcome (surfaced through readConfig) and leaves the canvas preview working,
   * rather than failing the device.
   */
  private async activatePolygon(deviceId: string): Promise<void> {
    const runtime = await this.ensureRuntime()
    if (!runtime) return // MQTT unavailable: preview-only, mqttAvailable already false
    const zones = clone(this.persistence.getZones(deviceId) ?? [])
    const name = this.deviceNames.get(deviceId) ?? deviceId
    runtime.activate({ id: deviceId, name }, zones, (cb) => this.subscribeTargets(deviceId, cb))
  }

  /** Lazily build the MQTT publisher and the runtime, once, on first polygon need. */
  private async ensureRuntime(): Promise<OccupancyRuntime | null> {
    if (this.occupancy) return this.occupancy
    if (!this.publisherPending) {
      this.publisherPending = this.mqttFactory(AVAILABILITY_TOPIC, this.logger).catch((err) => {
        this.logger.warn(
          { err: String(err) },
          'MQTT publisher unavailable; the MQTT integration is required to publish polygon zone entities',
        )
        return null
      })
    }
    const publisher = await this.publisherPending
    if (!publisher) {
      this.mqttAvailable = false
      return null
    }
    this.publisher = publisher
    this.mqttAvailable = true
    this.occupancy = new OccupancyRuntime({
      publisher,
      logger: this.logger,
      onDelayMs: this.occupancyDebounceMs?.on,
      offDelayMs: this.occupancyDebounceMs?.off,
    })
    return this.occupancy
  }

  private buildSensor(deviceId: string, mapping: DeviceMapping, mount: SensorMount): Sensor {
    if (mapping.kind === 'ld2450') {
      return {
        id: `${deviceId}:ld2450`,
        name: 'HLK LD2450',
        kind: 'ld2450',
        mount: clone(mount),
        fovHalf: LD2450_FOV_HALF,
        range: LD2450_RANGE,
        zones: this.reconstructZones(deviceId, mapping, mount, this.states),
      }
    }
    return {
      id: `${deviceId}:sen0609`,
      name: 'DFRobot SEN0609',
      kind: 'sen0609',
      mount: clone(mount),
      band: clone(this.persistence.getBand(deviceId) ?? DEFAULT_BAND),
    }
  }

  /** Pull a fresh snapshot of all entity states and cache it. */
  private async refreshStates(): Promise<Map<string, HassState>> {
    await this.client.connect()
    const states = await this.client.command<HassState[]>({ type: 'get_states' })
    this.states = new Map(states.map((s) => [s.entity_id, s]))
    return this.states
  }

  /**
   * Reconstruct an LD2450's zones from its region numbers and the zone_type select.
   * The mode names the type of every zone; each non-degenerate region becomes a
   * RectZone (the inverse of the write path). A disabled mode means no active zones.
   */
  private reconstructZones(
    deviceId: string,
    mapping: DeviceMapping,
    mount: SensorMount,
    states: Map<string, HassState>,
  ): Zone[] {
    if (mapping.kind !== 'ld2450' || !mapping.roles.zones || !mapping.roles.zoneType) {
      return clone(this.persistence.getZones(deviceId) ?? [])
    }
    const select = states.get(mapping.roles.zoneType)
    const mode = select ? modeFromOption(select.state) : 'none'
    if (mode === 'none') return []

    const zones: Zone[] = []
    mapping.roles.zones.forEach((roles, i) => {
      const region = readRegion(roles, states)
      if (!region) return
      if (region.x1 === region.x2 || region.y1 === region.y2) return // a cleared slot
      zones.push(regionToRect(region, mount, { id: `${deviceId}:zone${i + 1}`, name: `Zone ${i + 1}`, type: mode }))
    })
    return zones
  }

  private async setNumber(entityId: string | undefined, valueMm: number): Promise<void> {
    if (!entityId) return
    await this.client.callService('number', 'set_value', { value: valueMm }, { entity_id: entityId })
  }

  /** Read the device back after a write and throw if any value did not take. */
  private async confirmWrite(
    zoneRoles: ZoneNumberRoles[],
    regions: NativeRegion[],
    selectId: string,
    option: string,
  ): Promise<void> {
    const states = await this.refreshStates()

    const sel = states.get(selectId)
    if (!sel || sel.state.toLowerCase() !== option.toLowerCase()) {
      throw new Error(`The device did not accept the zone mode (wanted "${option}", got "${sel?.state ?? 'none'}")`)
    }

    zoneRoles.forEach((roles, slot) => {
      const region = regions[slot] ?? CLEARED_REGION
      this.confirmNumber(states, roles.x1, region.x1)
      this.confirmNumber(states, roles.y1, region.y1)
      this.confirmNumber(states, roles.x2, region.x2)
      this.confirmNumber(states, roles.y2, region.y2)
    })
  }

  private confirmNumber(states: Map<string, HassState>, entityId: string | undefined, expectedMm: number): void {
    if (!entityId) return
    const st = states.get(entityId)
    const got = st ? Math.round(toMetres(Number(st.state), st.attributes.unit_of_measurement) * 1000) : NaN
    if (got !== expectedMm) {
      throw new Error(`The device did not accept ${entityId} (wanted ${expectedMm}, got ${st?.state ?? 'none'})`)
    }
  }

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

/** The all-zero region written to an unused zone slot to clear it. */
const CLEARED_REGION: NativeRegion = { x1: 0, y1: 0, x2: 0, y2: 0 }

function deviceName(dev: DeviceRegistryEntry): string {
  return dev.name_by_user || dev.name || dev.id
}

/** Read one zone slot's four region numbers (any unit) into a normalised region. */
function readRegion(roles: ZoneNumberRoles, states: Map<string, HassState>): NativeRegion | null {
  const read = (id?: string): number | null => {
    if (!id) return null
    const st = states.get(id)
    if (!st || UNAVAILABLE_STATES.has(st.state.toLowerCase())) return null
    const v = Number(st.state)
    if (!Number.isFinite(v)) return null
    return Math.round(toMetres(v, st.attributes.unit_of_measurement) * 1000)
  }
  const x1 = read(roles.x1)
  const y1 = read(roles.y1)
  const x2 = read(roles.x2)
  const y2 = read(roles.y2)
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null
  return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) }
}

/** Map a zone_type select option to a mode (unknown labels read as no zones). */
function modeFromOption(option: string): ZoneMode {
  const o = option.toLowerCase()
  if (/inside|detection/.test(o)) return 'detection'
  if (/filter|exclude|outside/.test(o)) return 'exclusion'
  return 'none'
}

/** Find the select option that expresses a mode, case-insensitively. */
function optionForMode(options: string[], mode: ZoneMode): string | undefined {
  const pattern =
    mode === 'detection'
      ? /inside|detection/i
      : mode === 'exclusion'
        ? /filter|exclude|outside/i
        : /disabled|off|none/i
  return options.find((o) => pattern.test(String(o)))
}
