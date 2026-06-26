/*
 * Home Assistant WebSocket wire shapes and the device mapping model.
 *
 * Only the fields Zone Studio actually reads are typed; everything else on a
 * Home Assistant message is left untyped on purpose, so a Home Assistant version
 * bump that adds fields does not break discovery. The registry and state shapes
 * follow the documented WebSocket API (`config/*_registry/list`, `get_states`,
 * `state_changed`).
 */

// ---- WebSocket protocol messages ----------------------------------------

export interface AuthRequiredMessage {
  type: 'auth_required'
  ha_version?: string
}

export interface AuthOkMessage {
  type: 'auth_ok'
  ha_version?: string
}

export interface AuthInvalidMessage {
  type: 'auth_invalid'
  message: string
}

export interface ResultMessage {
  id: number
  type: 'result'
  success: boolean
  result?: unknown
  error?: { code: string; message: string }
}

export interface EventMessage {
  id: number
  type: 'event'
  event: unknown
}

export type IncomingMessage =
  | AuthRequiredMessage
  | AuthOkMessage
  | AuthInvalidMessage
  | ResultMessage
  | EventMessage
  | { type: string; [key: string]: unknown }

// ---- registry + state shapes --------------------------------------------

export interface AreaRegistryEntry {
  area_id: string
  name: string
}

export interface DeviceRegistryEntry {
  id: string
  area_id: string | null
  name: string | null
  name_by_user?: string | null
  model?: string | null
  manufacturer?: string | null
  identifiers?: Array<[string, string]>
}

export interface EntityRegistryEntry {
  entity_id: string
  device_id: string | null
  area_id?: string | null
  platform: string
  /** Present on entities the user disabled; such entities have no live state. */
  disabled_by?: string | null
}

export interface HassState {
  entity_id: string
  state: string
  attributes: {
    unit_of_measurement?: string
    device_class?: string
    friendly_name?: string
    [key: string]: unknown
  }
}

export interface StateChangedEvent {
  event_type: 'state_changed'
  data: {
    entity_id: string
    new_state: HassState | null
    old_state: HassState | null
  }
}

/** States that mean "no reading", per Home Assistant conventions. */
export const UNAVAILABLE_STATES = new Set(['unavailable', 'unknown', '', 'none'])

// ---- device mapping model -----------------------------------------------

/** The sensor kinds Zone Studio detects. Matches the domain `SensorKind`. */
export type DetectedKind = 'ld2450' | 'sen0609'

/** Entity ids that fill one LD2450 target slot. */
export interface TargetSlotRoles {
  x?: string
  y?: string
  speed?: string
}

/** The four region-corner `number` entities for one LD2450 zone slot. */
export interface ZoneNumberRoles {
  x1?: string
  y1?: string
  x2?: string
  y2?: string
}

/**
 * Which entity plays which role for a device. For an LD2450 this is the per
 * target x/y/speed entity ids, the per-zone region `number` entities, and the
 * global `zone_type` select; for a SEN0609 it is the presence and optional
 * distance entity ids.
 */
export interface EntityRoles {
  /** LD2450 target slots, index 0..2 for targets 1..3. */
  targets: TargetSlotRoles[]
  presence?: string
  distance?: string
  /** LD2450 zone region slots, index 0..2 for zones 1..3 (the apply path). */
  zones?: ZoneNumberRoles[]
  /** The LD2450 `zone_type` select that sets the global filter mode. */
  zoneType?: string
}

/** A fully resolved mapping for one device. */
export interface DeviceMapping {
  deviceId: string
  kind: DetectedKind
  roles: EntityRoles
}

/**
 * A persisted override the operator can use to correct a misdetected device.
 * Any field present replaces the auto-detected value; absent fields fall back to
 * auto-detection. This is how a device that does not match the heuristics is
 * fixed without code changes.
 */
export interface DeviceMappingOverride {
  kind?: DetectedKind
  roles?: Partial<EntityRoles>
}
