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
