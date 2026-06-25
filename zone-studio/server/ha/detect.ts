/*
 * Sensor detection: map a device's entities onto a kind and role assignment.
 *
 * The heuristics are tolerant on purpose, because ESPHome entity ids vary by
 * configuration:
 *   - LD2450: a device whose entities include a target coordinate pair. We match
 *     `target N x` and `target N y` (with optional separators) for targets 1..3,
 *     plus an optional per-target speed. A device that has target N x and y is an
 *     LD2450.
 *   - SEN0609 / C4001: a device with a presence or occupancy binary_sensor
 *     (device_class presence, occupancy or motion) and no target x/y entities,
 *     optionally with a distance sensor.
 *
 * Auto-detection only seeds a mapping. A persisted override (see ./types) wins
 * field by field, so an operator can correct a device the heuristics misread.
 */
import type { DetectedKind, DeviceMapping, DeviceMappingOverride, EntityRoles, HassState } from './types'

/** Matches `target_1_x`, `target 2 y`, `target3x`, etc. Captures slot and axis. */
const TARGET_COORD = /target[ _]?([123])[ _]?(x|y)(?![a-z0-9])/i
/** Matches `target_1_speed`, `target2speed`, etc. Captures the slot. */
const TARGET_SPEED = /target[ _]?([123])[ _]?speed(?![a-z0-9])/i

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

  // An LD2450 is any device with at least one full target coordinate pair.
  const hasPair = roles.targets.some((t) => t.x && t.y)
  if (hasCoord && hasPair) {
    return { kind: 'ld2450', roles }
  }

  // Otherwise look for a presence sensor, which marks a SEN0609 / C4001.
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
  if (presence) {
    return { kind: 'sen0609', roles: { targets: [{}, {}, {}], presence, distance } }
  }

  return null
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
  const auto = detectKindAndRoles(entityIds, stateOf)
  if (!auto && !override?.kind) return null

  const kind: DetectedKind = override?.kind ?? auto!.kind
  const base = auto?.roles ?? emptyRoles()
  const roles: EntityRoles = {
    targets: override?.roles?.targets ?? base.targets,
    presence: override?.roles?.presence ?? base.presence,
    distance: override?.roles?.distance ?? base.distance,
  }
  return { deviceId, kind, roles }
}
