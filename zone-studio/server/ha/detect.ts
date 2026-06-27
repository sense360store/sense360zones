/*
 * Sensor detection: map a device's entities onto a kind and role assignment.
 *
 * The heuristics are tolerant on purpose, because ESPHome entity ids vary by
 * configuration:
 *   - LD2450: a device whose entities include a target coordinate pair. We match
 *     `target N x` and `target N y` (with optional separators) for targets 1..3,
 *     plus an optional per-target speed. A device that has target N x and y is an
 *     LD2450.
 *   - SEN0609 / C4001: the DFRobot radar signature, a presence binary_sensor
 *     (device_class presence, occupancy or motion) *together with* a distance
 *     sensor, and no target x/y entities. A lone presence, occupancy or motion
 *     binary sensor is never enough: those describe a large fraction of a normal
 *     Home Assistant instance, so matching one would pull in the whole house.
 *
 * Detection runs only on a device's own entities, so an ESP that carries a radar
 * plus unrelated modules (air quality, fans) is classified by its radar entities
 * and the rest is ignored.
 *
 * Auto-detection only seeds a mapping. A persisted override (see ./types) wins
 * field by field, so an operator can correct a device the heuristics misread, and
 * an explicit confirmation keeps a device mapped even without a confident
 * signature.
 */
import type {
  DetectedKind,
  DeviceMapping,
  DeviceMappingOverride,
  DeviceRegistryEntry,
  EntityRoles,
  HassState,
  ZoneNumberRoles,
} from './types'

/** Matches `target_1_x`, `target 2 y`, `target3x`, etc. Captures slot and axis. */
const TARGET_COORD = /target[ _]?([123])[ _]?(x|y)(?![a-z0-9])/i
/** Matches `target_1_speed`, `target2speed`, etc. Captures the slot. */
const TARGET_SPEED = /target[ _]?([123])[ _]?speed(?![a-z0-9])/i
/** Matches `zone_1_x1`, `zone 2 y2`, `zone3x1`, etc. Captures slot and corner. */
const ZONE_NUMBER = /zone[ _]?([123])[ _]?(x1|y1|x2|y2)(?![a-z0-9])/i
/** A `zone_type` / `region_type` select id. */
const ZONE_TYPE_ID = /(zone|region)[ _]?type/i
/** Option labels that mark a select as the LD2450 zone/region mode. */
const ZONE_MODE_OPTION = /(disabled|detection|filter|exclude|outside|inside|off|none)/i

const PRESENCE_CLASSES = new Set(['presence', 'occupancy', 'motion'])

/** A detected (or overridden) kind plus its role assignment. */
export interface ResolvedMapping {
  kind: DetectedKind
  roles: EntityRoles
}

function emptyRoles(): EntityRoles {
  return { targets: [{}, {}, {}] }
}

/**
 * Auto-detect a device's kind and roles from its entity ids and current states.
 * Returns null when nothing recognisable is present.
 */
export function detectKindAndRoles(
  entityIds: string[],
  stateOf: (entityId: string) => HassState | undefined,
): ResolvedMapping | null {
  const roles = emptyRoles()
  let hasCoord = false

  for (const id of entityIds) {
    const coord = TARGET_COORD.exec(id)
    if (coord) {
      const slot = Number(coord[1]) - 1
      const axis = coord[2].toLowerCase() as 'x' | 'y'
      roles.targets[slot][axis] = id
      hasCoord = true
      continue
    }
    const speed = TARGET_SPEED.exec(id)
    if (speed) {
      const slot = Number(speed[1]) - 1
      roles.targets[slot].speed = id
    }
  }

  // An LD2450 is any device with at least one full target coordinate pair. Its
  // drawable zones live in the per-zone region numbers and the zone_type select.
  const hasPair = roles.targets.some((t) => t.x && t.y)
  if (hasCoord && hasPair) {
    detectZones(entityIds, stateOf, roles)
    return { kind: 'ld2450', roles }
  }

  // Otherwise look for the DFRobot SEN0609 / C4001 signature on this device.
  const sen = detectSen0609Roles(entityIds, stateOf)
  if (sen) {
    return { kind: 'sen0609', roles: { targets: [{}, {}, {}], presence: sen.presence, distance: sen.distance } }
  }

  return null
}

/**
 * Find the SEN0609 / C4001 signature on a device's own entities: a presence
 * binary_sensor (device_class presence, occupancy or motion) *together with* a
 * distance sensor. Both are required — a lone presence/occupancy/motion sensor is
 * never enough. Returns null when the signature is absent. Exposed so the provider
 * can detect a SEN0609 that shares an ESP with an LD2450 and render both.
 */
export function detectSen0609Roles(
  entityIds: string[],
  stateOf: (entityId: string) => HassState | undefined,
): { presence: string; distance: string } | null {
  let presence: string | undefined
  let distance: string | undefined
  for (const id of entityIds) {
    const st = stateOf(id)
    const deviceClass = String(st?.attributes?.device_class ?? '').toLowerCase()
    if (!presence && id.startsWith('binary_sensor.') && PRESENCE_CLASSES.has(deviceClass)) {
      presence = id
    }
    if (!distance && id.startsWith('sensor.') && deviceClass === 'distance') {
      distance = id
    }
  }
  return presence && distance ? { presence, distance } : null
}

/**
 * The ESPHome node name from a device's identifiers (`['esphome', node]`), or
 * null when the device is not an ESPHome device. Discovery uses this to restrict
 * candidates to ESPHome devices, which on its own removes phones, person and pet
 * trackers, and Zigbee or Z-Wave motion sensors.
 */
export function esphomeNode(dev: Pick<DeviceRegistryEntry, 'identifiers'>): string | null {
  for (const id of dev.identifiers ?? []) {
    if (Array.isArray(id) && id[0] === 'esphome' && typeof id[1] === 'string') return id[1]
  }
  return null
}

/** The default pattern that recognises a Sense360 identity. */
export const DEFAULT_SENSE360_PATTERN = /sense360/i

/**
 * Whether a device declares a recognisable Sense360 identity, matched against its
 * `manufacturer` and `model` (where the ESPHome project name surfaces). This is an
 * optional refinement: Sense360 firmware does not declare one today, so when no
 * device matches, discovery falls back to the full ESPHome candidate list. Once
 * the firmware declares a manufacturer or `esphome: project: name`, those devices
 * are recognised automatically.
 */
export function isSense360Device(
  dev: Pick<DeviceRegistryEntry, 'manufacturer' | 'model'>,
  pattern: RegExp = DEFAULT_SENSE360_PATTERN,
): boolean {
  return [dev.manufacturer, dev.model].some((v) => v != null && pattern.test(String(v)))
}

/**
 * The resolution of one device: its effective kind and roles, the explicit user
 * decision, the detection confidence, and the active mapping (non-null only when
 * the device should be treated as a radar sensor).
 *
 * A device is active — mapped, streamed and drawn — only when the user confirmed
 * it or a confident entity signature was detected. An ESPHome candidate with no
 * confident signature and no confirmation resolves with a null mapping: it is
 * offered for confirmation but never silently treated as a radar sensor.
 */
export interface DeviceResolution {
  /** The detected or forced kind; null when nothing radar-like matched. */
  kind: DetectedKind | null
  /** The user confirmed this device (or forced its kind) through the mapping surface. */
  confirmed: boolean
  /** The user dismissed this device as not a radar sensor. */
  dismissed: boolean
  /** 'confident' when a full radar entity signature was detected, else 'none'. */
  confidence: 'confident' | 'none'
  /** The merged roles (override over auto-detection), for review and corrections. */
  roles: EntityRoles
  /** The active mapping, or null when the device is not (yet) a radar sensor. */
  mapping: DeviceMapping | null
}

/**
 * Resolve a device for discovery: auto-detect, layer the persisted override, and
 * decide whether it is an active radar sensor. The override's role corrections win
 * field by field; `confirmed`/`kind` make it active without a signature;
 * `dismissed` keeps the mapping null so the device stays hidden.
 */
export function resolveDevice(
  deviceId: string,
  entityIds: string[],
  stateOf: (entityId: string) => HassState | undefined,
  override?: DeviceMappingOverride,
): DeviceResolution {
  const auto = detectKindAndRoles(entityIds, stateOf)
  const dismissed = Boolean(override?.dismissed)
  const confirmed = Boolean(override?.confirmed || override?.kind)
  const kind: DetectedKind | null = override?.kind ?? auto?.kind ?? null
  const confidence: 'confident' | 'none' = auto ? 'confident' : 'none'

  const base = auto?.roles ?? emptyRoles()
  const roles: EntityRoles = {
    targets: override?.roles?.targets ?? base.targets,
    presence: override?.roles?.presence ?? base.presence,
    distance: override?.roles?.distance ?? base.distance,
    zones: override?.roles?.zones ?? base.zones,
    zoneType: override?.roles?.zoneType ?? base.zoneType,
  }

  const active = !dismissed && kind !== null && (confirmed || confidence === 'confident')
  const mapping = active ? { deviceId, kind: kind!, roles } : null
  return { kind, confirmed, dismissed, confidence, roles, mapping }
}

/**
 * Fill an LD2450's zone region roles in place: the per-zone `number` entities and
 * the `zone_type` select. A select is the zone-type select when its id matches
 * `zone_type`/`region_type`, or when its options read like the mode labels
 * (Disabled / Detection / Filter and friends). Tolerant and overridable, exactly
 * like the target detection.
 */
function detectZones(
  entityIds: string[],
  stateOf: (entityId: string) => HassState | undefined,
  roles: EntityRoles,
): void {
  const zones: ZoneNumberRoles[] = [{}, {}, {}]
  let hasZoneNumber = false
  let zoneType: string | undefined

  for (const id of entityIds) {
    if (id.startsWith('number.')) {
      const m = ZONE_NUMBER.exec(id)
      if (m) {
        const slot = Number(m[1]) - 1
        const corner = m[2].toLowerCase() as keyof ZoneNumberRoles
        zones[slot][corner] = id
        hasZoneNumber = true
        continue
      }
    }
    if (!zoneType && id.startsWith('select.')) {
      const options = (stateOf(id)?.attributes?.options as string[] | undefined) ?? []
      const optionHits = options.filter((o) => ZONE_MODE_OPTION.test(String(o))).length
      if (ZONE_TYPE_ID.test(id) || optionHits >= 2) zoneType = id
    }
  }

  if (hasZoneNumber) roles.zones = zones
  if (zoneType) roles.zoneType = zoneType
}

/**
 * Resolve the final mapping for a device: auto-detect, then layer a persisted
 * override on top. The override can force the kind and replace any role
 * assignment, which is how a misdetected device is fixed without code changes.
 * Returns null when neither detection nor an override yields a usable mapping.
 */
export function resolveMapping(
  deviceId: string,
  entityIds: string[],
  stateOf: (entityId: string) => HassState | undefined,
  override?: DeviceMappingOverride,
): DeviceMapping | null {
  return resolveDevice(deviceId, entityIds, stateOf, override).mapping
}
