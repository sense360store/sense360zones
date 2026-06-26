/*
 * OccupancyRuntime — the live polygon-occupancy evaluator and publisher.
 *
 * For each polygon-profile device it subscribes to the live target stream,
 * evaluates every zone and the derived presence with the shared domain primitive
 * (the same one the canvas preview uses), debounces transitions with a small on/off
 * delay so an edge flicker does not toggle an entity, and publishes the state on
 * change over MQTT. Entities are announced with retained discovery configs and a
 * shared availability topic; when a zone is removed its retained discovery config is
 * cleared so the stale entity disappears.
 *
 * The runtime is transport- and source-agnostic: it takes an `MqttPublisher` and a
 * subscribe function, so the test suite drives scripted target frames through it
 * against the fake publisher with no Home Assistant and no broker.
 */
import { evaluateOccupancy } from '../../src/domain/occupancy'
import type { Point, Zone } from '../../src/domain/types'
import type { Target } from '../../src/domain/types'
import type { Unsubscribe } from '../provider/DataProvider'
import type { Logger } from '../ha/HaWsClient'
import type { MqttPublisher } from './MqttPublisher'
import {
  configTopic,
  discoveryConfig,
  presenceEntity,
  stateTopic,
  zoneEntity,
  type EntitySpec,
  STATE_OFF,
  STATE_ON,
} from './discovery'

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }

/** A device + a way to subscribe to its live targets (room frame). */
export interface DeviceRef {
  id: string
  name: string
}
export type SubscribeTargets = (onSample: (targets: Target[]) => void) => Unsubscribe

export interface OccupancyRuntimeOptions {
  publisher: MqttPublisher
  logger?: Logger
  /** Delay before an off→on transition publishes, milliseconds. */
  onDelayMs?: number
  /** Delay before an on→off transition publishes, milliseconds. */
  offDelayMs?: number
}

interface EntityState {
  spec: EntitySpec
  /** The zone this entity tracks, or null for the derived device presence. */
  zoneId: string | null
  /** The last value actually published (undefined until the first publish). */
  published: boolean | undefined
  /** The value a pending debounce timer is heading toward, if any. */
  pending: boolean | undefined
  timer: ReturnType<typeof setTimeout> | null
}

interface ActiveDevice {
  device: DeviceRef
  zones: Zone[]
  entities: Map<string, EntityState>
  lastTargets: Point[]
  unsubscribe: Unsubscribe
}

export class OccupancyRuntime {
  private readonly publisher: MqttPublisher
  private readonly logger: Logger
  private readonly onDelayMs: number
  private readonly offDelayMs: number
  private readonly devices = new Map<string, ActiveDevice>()

  constructor(opts: OccupancyRuntimeOptions) {
    this.publisher = opts.publisher
    this.logger = opts.logger ?? noopLogger
    this.onDelayMs = opts.onDelayMs ?? 400
    this.offDelayMs = opts.offDelayMs ?? 800
  }

  /** Device ids with an active evaluator. */
  activeDevices(): string[] {
    return [...this.devices.keys()]
  }

  /**
   * Activate (or re-apply) the evaluator for a polygon device: publish discovery
   * for the current zones and presence, clear discovery for any removed zone, and
   * begin (or keep) streaming targets. Safe to call repeatedly as the set changes.
   */
  activate(device: DeviceRef, zones: Zone[], subscribe: SubscribeTargets): void {
    const specs = this.specsFor(device, zones)
    const wanted = new Set(specs.map((s) => s.spec.objectId))

    let active = this.devices.get(device.id)
    if (!active) {
      active = { device, zones, entities: new Map(), lastTargets: [], unsubscribe: () => {} }
      this.devices.set(device.id, active)
      active.unsubscribe = subscribe((targets) => this.onTargets(device.id, targets))
    }
    active.device = device
    active.zones = zones

    // Clear discovery + state for entities that no longer exist (removed zones).
    for (const [objectId, entity] of active.entities) {
      if (!wanted.has(objectId)) {
        this.clearEntity(device.id, entity)
        active.entities.delete(objectId)
      }
    }

    // Publish (or refresh) retained discovery for every current entity.
    for (const { spec, zoneId } of specs) {
      const existing = active.entities.get(spec.objectId)
      if (existing) existing.spec = spec
      else active.entities.set(spec.objectId, { spec, zoneId, published: undefined, pending: undefined, timer: null })
      this.publisher.publish(configTopic(device.id, spec.objectId), discoveryConfig(device, spec, this.publisher.availabilityTopic), {
        retain: true,
        qos: 1,
      })
    }

    // Establish state for any new entities immediately from the last known frame.
    this.evaluateAndPublish(active, active.lastTargets)
    this.logger.info({ deviceId: device.id, zones: zones.length, mqtt: this.publisher.available }, 'activated polygon occupancy')
  }

  /** Tear down a device's evaluator and clear all its retained discovery configs. */
  deactivate(deviceId: string): void {
    const active = this.devices.get(deviceId)
    if (!active) return
    active.unsubscribe()
    for (const [, entity] of active.entities) this.clearEntity(deviceId, entity)
    this.devices.delete(deviceId)
    this.logger.info({ deviceId }, 'deactivated polygon occupancy')
  }

  /** Tear down every device (server shutdown). The publisher's last will follows. */
  dispose(): void {
    for (const id of [...this.devices.keys()]) {
      const active = this.devices.get(id)!
      active.unsubscribe()
      for (const [, entity] of active.entities) {
        if (entity.timer) clearTimeout(entity.timer)
      }
    }
    this.devices.clear()
  }

  // ---- internals ---------------------------------------------------------

  private specsFor(device: DeviceRef, zones: Zone[]): { spec: EntitySpec; zoneId: string | null }[] {
    return [
      ...zones.map((z) => ({ spec: zoneEntity(z), zoneId: z.id })),
      { spec: presenceEntity(device.name), zoneId: null },
    ]
  }

  private onTargets(deviceId: string, targets: Target[]): void {
    const active = this.devices.get(deviceId)
    if (!active) return
    active.lastTargets = targets.map((t) => ({ x: t.x, y: t.y }))
    this.evaluateAndPublish(active, active.lastTargets)
  }

  private evaluateAndPublish(active: ActiveDevice, targets: Point[]): void {
    const result = evaluateOccupancy(active.zones, targets)
    for (const [, entity] of active.entities) {
      const raw = entity.zoneId === null ? result.presence : result.zones[entity.zoneId] ?? false
      this.applyDebounced(active.device.id, entity, raw)
    }
  }

  /** Debounce a raw value toward a publish, cancelling on a flicker back. */
  private applyDebounced(deviceId: string, entity: EntityState, raw: boolean): void {
    // First value establishes the initial state immediately, no debounce.
    if (entity.published === undefined) {
      this.commit(deviceId, entity, raw)
      return
    }
    if (raw === entity.published) {
      // Back to the published state: cancel any in-flight transition.
      if (entity.timer) clearTimeout(entity.timer)
      entity.timer = null
      entity.pending = undefined
      return
    }
    if (entity.pending === raw && entity.timer) return // already heading there
    if (entity.timer) clearTimeout(entity.timer)
    entity.pending = raw
    const delay = raw ? this.onDelayMs : this.offDelayMs
    entity.timer = setTimeout(() => this.commit(deviceId, entity, raw), delay)
    if (typeof entity.timer.unref === 'function') entity.timer.unref()
  }

  /** Publish a state change and record it as published. */
  private commit(deviceId: string, entity: EntityState, value: boolean): void {
    if (entity.timer) clearTimeout(entity.timer)
    entity.timer = null
    entity.pending = undefined
    if (entity.published === value) return // no change to publish
    entity.published = value
    this.publisher.publish(stateTopic(deviceId, entity.spec.objectId), value ? STATE_ON : STATE_OFF, {
      retain: true,
      qos: 1,
    })
  }

  /** Clear a removed entity: cancel its timer and clear its retained discovery config. */
  private clearEntity(deviceId: string, entity: EntityState): void {
    if (entity.timer) clearTimeout(entity.timer)
    entity.timer = null
    this.publisher.publish(configTopic(deviceId, entity.spec.objectId), '', { retain: true, qos: 1 })
  }
}
