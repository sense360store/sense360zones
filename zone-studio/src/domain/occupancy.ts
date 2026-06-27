/*
 * The shared occupancy primitive (Phase 4, the differentiator).
 * -------------------------------------------------------------------------
 * One pure evaluator, used two ways from a single implementation:
 *   - the frontend highlights occupied zones on the canvas the moment a target
 *     enters one, so the preview is instant and independent of the round trip
 *     through Home Assistant, and
 *   - the backend evaluates the same zones against the live target stream and
 *     publishes occupancy entities over MQTT.
 *
 * It works entirely in the Phase 0 room frame: a zone's room-frame polygon (a
 * poly's vertices, or a rect's four corners, both already in room metres via
 * `zonePtsM`) is tested against the live targets, which the providers also emit
 * in the room frame. There is no second coordinate convention; any sensor-frame
 * mapping reuses `roomToSensor`. The point-in-polygon test is the robust,
 * non-convex-safe one in `geometry.ts`, so an L-shaped zone evaluates correctly.
 */
import { pointInPolygon, zonePtsM } from './geometry'
import type { Point, Zone } from './types'

/** True when the room-frame point lies inside (or on the boundary of) the zone. */
export function pointInZone(zone: Zone, p: Point): boolean {
  return pointInPolygon(p, zonePtsM(zone))
}

/**
 * True when at least one target lies inside the zone. Works for both `poly` and
 * rotated `rect` zones, because it tests against the zone's room-frame vertex or
 * corner polygon.
 */
export function zoneOccupied(zone: Zone, targets: Point[]): boolean {
  const poly = zonePtsM(zone)
  return targets.some((t) => pointInPolygon(t, poly))
}

/** The result of evaluating a device's whole zone set against the live targets. */
export interface OccupancyResult {
  /** Per-zone occupancy by zone id: on when a target is inside it (any type). */
  zones: Record<string, boolean>
  /** Derived device presence: on when at least one target is counted. */
  presence: boolean
}

/**
 * Evaluate every zone and the derived device presence against the live targets,
 * the device-level semantics Phase 4 publishes:
 *
 *   - Each zone yields one occupancy result, on when a target is inside it, for
 *     both detection and exclusion zones.
 *   - A target is counted for presence when it lies inside any detection zone,
 *     or, when the device has no detection zones, anywhere in range (the targets
 *     a provider emits are already range-limited, so any target counts). A target
 *     inside any exclusion zone is never counted, so exclusion zones subtract
 *     from presence.
 *   - Device presence is on when at least one target is counted.
 */
export function evaluateOccupancy(zones: Zone[], targets: Point[]): OccupancyResult {
  const polys = zones.map((zone) => ({ zone, poly: zonePtsM(zone) }))

  const zoneStates: Record<string, boolean> = {}
  for (const { zone, poly } of polys) {
    zoneStates[zone.id] = targets.some((t) => pointInPolygon(t, poly))
  }

  const detection = polys.filter((p) => p.zone.type === 'detection')
  const exclusion = polys.filter((p) => p.zone.type === 'exclusion')
  const counted = (t: Point): boolean => {
    if (exclusion.some((e) => pointInPolygon(t, e.poly))) return false
    if (detection.length === 0) return true
    return detection.some((d) => pointInPolygon(t, d.poly))
  }

  return { zones: zoneStates, presence: targets.some(counted) }
}
