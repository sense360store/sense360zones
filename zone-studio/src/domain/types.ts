/*
 * Sense360 Zone Studio — canonical data model.
 * -------------------------------------------------------------------------
 * These TypeScript types are the contract that every later phase reads and
 * writes: the backend persists them to `/data`, the HA connection builds them
 * from real entities, and the apply path turns them into device registers.
 *
 * `domain/schema.json` is the matching JSON Schema for this model — keep the
 * two in sync. The model is intentionally device-first (Room → Device → Sensor)
 * so multi-room support is a UI addition later, not a schema migration
 * (see DECISIONS.md §3.5).
 *
 * Everything here is measured in SI units in *room coordinates*:
 *   - lengths and positions in metres,
 *   - angles in degrees,
 *   - the sensor origin is the coordinate origin, +y points away from the
 *     sensor into the room, +x to its right.
 */

/** A point in room coordinates (metres). */
export interface Point {
  x: number
  y: number
}

// ---- mount ---------------------------------------------------------------

/** How a board is physically mounted. Drives the canvas projection. */
export type MountSurface = 'wall' | 'ceiling'

/**
 * Physical placement of a sensor. In Phase 0 these carry sensible defaults and
 * do not yet alter rendering; Phase 2 reads them from the device (where
 * possible) and wires them into the coordinate transforms.
 */
export interface SensorMount {
  surface: MountSurface
  /** Height of the sensor above the floor, metres. */
  height: number
  /** Sensor origin within the room, metres. */
  origin: Point
  /** Facing direction, degrees. 0 = looking along +y into the room. */
  boresight: number
}

// ---- zones (LD2450 spatial layer) ---------------------------------------

export type ZoneType = 'detection' | 'exclusion'
export type ZoneShape = 'rect' | 'poly'

interface ZoneBase {
  id: string
  name: string
  type: ZoneType
}

/** Axis-aligned-or-rotated rectangle, defined by centre + size + rotation. */
export interface RectZone extends ZoneBase {
  shape: 'rect'
  /** Centre, metres. */
  cx: number
  cy: number
  /** Width (x) and depth (y), metres. */
  w: number
  h: number
  /** Rotation about the centre, degrees. 0 = axis-aligned. */
  rot: number
}

/** Arbitrary polygon, defined by its vertices (metres). */
export interface PolyZone extends ZoneBase {
  shape: 'poly'
  pts: Point[]
}

export type Zone = RectZone | PolyZone

// ---- band (SEN0609 / C4001 radial layer) --------------------------------

/**
 * Radial range band for a SEN0609 (C4001). Note: several of these controls go
 * beyond what the off-the-shelf `dfrobot_sen0395` ESPHome component exposes;
 * Phase 5 backs them with a real component (see DECISIONS.md §3.3).
 */
export interface BandConfig {
  /** Inner radius (closest detected distance), metres. */
  minR: number
  /** Outer radius (furthest detected distance), metres. */
  maxR: number
  /** Beam width, degrees. */
  beam: number
  /** Trigger sensitivity, 0–9. */
  trigSens: number
  /** Sustained sensitivity, 0–9. */
  sustSens: number
  /** Metres subtracted from maxR for the trigger threshold only. */
  reducedRange: number
}

// ---- sensors -------------------------------------------------------------

export type SensorKind = 'ld2450' | 'sen0609'

interface SensorBase {
  id: string
  name: string
  mount: SensorMount
}

/** HLK LD2450 — spatial X/Y tracking; owns the drawable zones. */
export interface Ld2450Sensor extends SensorBase {
  kind: 'ld2450'
  /** Field-of-view half-angle, degrees (e.g. 60 → 120° total). */
  fovHalf: number
  /** Maximum range, metres. */
  range: number
  zones: Zone[]
}

/** DFRobot SEN0609 (C4001) — radial distance + presence; owns a range band. */
export interface Sen0609Sensor extends SensorBase {
  kind: 'sen0609'
  band: BandConfig
}

export type Sensor = Ld2450Sensor | Sen0609Sensor

// ---- device / room -------------------------------------------------------

/** A Sense360 board carrying one or more radar sensors. */
export interface Device {
  id: string
  name: string
  sensors: Sensor[]
  /**
   * Discovery metadata for the mapping and confirmation surface. Present on every
   * device the real provider offers; absent on the in-memory mock model. `sensors`
   * holds only the confirmed or confidently detected radar sensors, so a device
   * awaiting confirmation has an empty `sensors` array and a `candidate` that
   * describes what discovery matched.
   */
  candidate?: DeviceCandidate
}

// ---- discovery / mapping confirmation ------------------------------------

/**
 * How sure discovery is that a device is a radar sensor:
 *   - `confident`  a full radar entity signature was matched (LD2450 target X/Y
 *                  pair, or the SEN0609 presence-with-distance signature),
 *   - `none`       no radar signature; the device is offered for confirmation only.
 */
export type DetectionConfidence = 'confident' | 'none'

/** One matched entity role, surfaced for review and correction. */
export interface CandidateRole {
  /** Stable key used to send a correction (e.g. `target1x`, `presence`, `zoneType`). */
  key: string
  /** Human label, e.g. `Target 1 · X`. */
  label: string
  /** The entity matched to this role, if any. */
  entityId?: string
}

/**
 * What discovery found for a candidate device, and the user's decision about it.
 * Drives the mapping surface: the kind, the confidence indicator, the matched
 * roles, and whether the device is confirmed or dismissed.
 */
export interface DeviceCandidate {
  /** The detected or confirmed kind; null when nothing radar-like matched. */
  kind: SensorKind | null
  confidence: DetectionConfidence
  /** The user confirmed this device as a radar sensor. */
  confirmed: boolean
  /** The user dismissed this device as not a radar sensor. */
  dismissed: boolean
  /** The device declares a recognisable Sense360 identity (known hardware). */
  sense360: boolean
  /** What the device reports to Home Assistant, shown so the operator can see it. */
  manufacturer?: string
  /** The ESPHome node name from the device identifiers. */
  node?: string
  /** The radar entities matched to each role. */
  roles: CandidateRole[]
}

/**
 * A confirmation, correction, or dismissal sent from the mapping surface. It rides
 * on the write payload (see DeviceConfig.mapping) and is persisted as the device's
 * mapping override, so the provider contract does not change. `roles` maps a role
 * key to an entity id; an empty string clears that role.
 */
export interface MappingUpdate {
  /** Confirm the device as this kind. */
  kind?: SensorKind
  /** Mark the device confirmed (kept mapped across restarts). */
  confirmed?: boolean
  /** Hide the device as not a radar sensor, or clear a previous dismissal. */
  dismissed?: boolean
  /** Role corrections as role-key → entity id (empty string clears the role). */
  roles?: Record<string, string>
}

/** A room containing one or more devices. */
export interface Room {
  id: string
  name: string
  devices: Device[]
}

// ---- live data -----------------------------------------------------------

/**
 * A live tracked target from an LD2450. `vx`/`vy` are simulation bookkeeping
 * for the mock client; real samples may leave them at 0. `trail` holds recent
 * positions in metres (projected to pixels at render time).
 */
export interface Target {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  color: string
  trail: Point[]
}

// ---- profiles ------------------------------------------------------------

/**
 * The application profile for a device's zone set (see DECISIONS.md §3.1):
 *   - `native`  → push axis-aligned rectangles straight to LD2450 registers.
 *   - `polygon` → evaluate arbitrary polygons in software / generated config.
 */
export type Profile = 'native' | 'polygon'
