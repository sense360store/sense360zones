/*
 * Native LD2450 region geometry and constraint validation.
 *
 * The LD2450 firmware hosts at most three axis-aligned rectangular regions in its
 * sensor frame, under one global filter mode. This module is the single place that
 * decides whether a zone set fits that shape and turns zones into the millimetre
 * regions the device registers expect (and back again).
 *
 * It lives in the shared `domain` layer, not in `server/`, because both sides need
 * it: the backend write/read path turns zones into regions and reconstructs them,
 * and the frontend profile resolver judges native eligibility live as the user
 * draws. `server/ha/frame.ts` re-exports the transform pair so the backend keeps a
 * single import surface and there is exactly one coordinate convention (the Phase 0
 * room frame: metres, sensor at the origin, +y into the room, +x to its right).
 */
import { rectCorners } from './geometry'
import type { Point, RectZone, SensorMount, Zone, ZoneType } from './types'

/** A native region in the sensor frame, integer millimetres, x1<x2 and y1<y2. */
export interface NativeRegion {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Maximum number of hardware regions the LD2450 can host natively. */
export const MAX_NATIVE_ZONES = 3

/** LD2450 region register limits, millimetres (official ESPHome `ld2450`). */
export const NATIVE_X_MIN = -3000
export const NATIVE_X_MAX = 3000
export const NATIVE_Y_MIN = 0
export const NATIVE_Y_MAX = 6000

/** Axis-alignment tolerance, metres. Floating-point noise is far below this; a
 *  real rectangle's distinct corner coordinates differ by the zone size. */
const AXIS_EPS_M = 1e-6

/**
 * Transform a point from the sensor frame to the room frame: rotate by the
 * boresight, then translate by the sensor origin. With the default mount (origin
 * 0,0, boresight 0) this returns the point unchanged, the convention the canvas
 * and `MockDataProvider` already use.
 */
export function sensorToRoom(p: Point, mount: SensorMount): Point {
  const a = (mount.boresight * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return {
    x: mount.origin.x + p.x * cos - p.y * sin,
    y: mount.origin.y + p.x * sin + p.y * cos,
  }
}

/**
 * The exact inverse of `sensorToRoom`: translate by minus the origin, then rotate
 * by minus the boresight. Maps a room-frame point back into the sensor frame, the
 * direction the apply path needs to compute device regions.
 */
export function roomToSensor(p: Point, mount: SensorMount): Point {
  const a = (mount.boresight * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = p.x - mount.origin.x
  const dy = p.y - mount.origin.y
  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  }
}

/** Number of distinct values in the list, treating values within `eps` as equal. */
function distinctCount(values: number[], eps: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  let count = 0
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i] - sorted[i - 1] > eps) count++
  }
  return count
}

/**
 * The millimetre region a zone occupies in the sensor frame, or null when the zone
 * cannot be a native region.
 *
 * It maps the rectangle's four room-frame corners through `roomToSensor` and checks
 * the result is axis-aligned in the sensor frame: exactly two distinct x values and
 * two distinct y values (within an epsilon). When it is, the millimetre bounding box
 * is the region. This naturally accepts the 0/90/180/270 rotations under any
 * boresight and rejects polygons, a 45 degree rectangle, and an axis-aligned room
 * rectangle viewed under a non-right-angle boresight. It replaces the old
 * `rot === 0` test, which both rejected the right-angle cases and ignored the mount.
 */
export function nativeRegion(zone: Zone, mount: SensorMount): NativeRegion | null {
  if (zone.shape !== 'rect') return null
  const corners = rectCorners(zone).map((c) => roomToSensor(c, mount))
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  if (distinctCount(xs, AXIS_EPS_M) !== 2 || distinctCount(ys, AXIS_EPS_M) !== 2) return null
  return {
    x1: Math.round(Math.min(...xs) * 1000),
    y1: Math.round(Math.min(...ys) * 1000),
    x2: Math.round(Math.max(...xs) * 1000),
    y2: Math.round(Math.max(...ys) * 1000),
  }
}

/**
 * Reconstruct a `RectZone` from a sensor-frame millimetre region: the inverse of
 * `nativeRegion`. The region's midpoint maps back to the room frame for the centre,
 * the extents give the width and depth, and the rotation is the mount boresight (the
 * region is axis-aligned in the sensor frame, so in the room frame it sits at the
 * boresight angle). Round-trips with `nativeRegion` for the right-angle cases.
 */
export function regionToRect(
  region: NativeRegion,
  mount: SensorMount,
  meta: { id: string; name: string; type: ZoneType },
): RectZone {
  const midSensor: Point = { x: (region.x1 + region.x2) / 2000, y: (region.y1 + region.y2) / 2000 }
  const centre = sensorToRoom(midSensor, mount)
  return {
    id: meta.id,
    name: meta.name,
    type: meta.type,
    shape: 'rect',
    cx: centre.x,
    cy: centre.y,
    w: (region.x2 - region.x1) / 1000,
    h: (region.y2 - region.y1) / 1000,
    rot: mount.boresight,
  }
}

/** True when two normalised regions share positive area (a shared edge does not). */
function regionsOverlap(a: NativeRegion, b: NativeRegion): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2
}

/**
 * Every reason a zone set cannot be applied natively, human-readable and specific
 * for the UI. An empty list means the set is native-eligible. Shared by the profile
 * resolver and the write path so eligibility is judged in exactly one place.
 *
 * The six constraints: at most three zones; every zone is an axis-aligned rectangle
 * in the sensor frame; a single global mode (all detection or all exclusion); every
 * region within range; no two regions overlap; no degenerate (zero-extent) region.
 */
export function nativeViolations(zones: Zone[], mount: SensorMount): string[] {
  const reasons: string[] = []

  if (zones.length > MAX_NATIVE_ZONES) {
    reasons.push(`More than ${MAX_NATIVE_ZONES} zones (${zones.length})`)
  }
  if (new Set(zones.map((z) => z.type)).size > 1) {
    reasons.push('Mixes detection and exclusion zones')
  }

  // Map each zone to its region, recording the shape problems as we go.
  const regions: { zone: Zone; region: NativeRegion }[] = []
  for (const zone of zones) {
    if (zone.shape === 'poly') {
      reasons.push(`Zone "${zone.name}" is a polygon`)
      continue
    }
    const region = nativeRegion(zone, mount)
    if (!region) {
      reasons.push(`Zone "${zone.name}" is rotated relative to the sensor`)
      continue
    }
    regions.push({ zone, region })
  }

  for (const { zone, region } of regions) {
    if (region.x1 === region.x2 || region.y1 === region.y2) {
      reasons.push(`Zone "${zone.name}" is too small to apply`)
    }
    if (
      region.x1 < NATIVE_X_MIN ||
      region.x2 > NATIVE_X_MAX ||
      region.y1 < NATIVE_Y_MIN ||
      region.y2 > NATIVE_Y_MAX
    ) {
      reasons.push(`Zone "${zone.name}" extends beyond the sensor range`)
    }
  }

  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      if (regionsOverlap(regions[i].region, regions[j].region)) {
        reasons.push(`Zones "${regions[i].zone.name}" and "${regions[j].zone.name}" overlap`)
      }
    }
  }

  return reasons
}
