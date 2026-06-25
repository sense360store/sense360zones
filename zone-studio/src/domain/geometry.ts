/*
 * Pure zone geometry, in room coordinates (metres). Ported verbatim from the
 * prototype's geometry math so canvas output stays pixel-identical, but with no
 * dependency on React, the canvas projection, or component state — every
 * function takes plain values and is trivially unit-testable (Phase 6).
 */
import type { Point, RectZone, Zone, ZoneType } from './types'

/** The four corners of a (possibly rotated) rectangle, in room coords. */
export function rectCorners(z: RectZone): Point[] {
  const c = Math.cos((z.rot * Math.PI) / 180)
  const s = Math.sin((z.rot * Math.PI) / 180)
  const hw = z.w / 2
  const hh = z.h / 2
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const
  ).map(([x, y]) => ({ x: z.cx + x * c - y * s, y: z.cy + x * s + y * c }))
}

/** A zone's outline as a list of room-coordinate points. */
export function zonePtsM(z: Zone): Point[] {
  return z.shape === 'poly' ? z.pts : rectCorners(z)
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Shoelace area of a polygon, m². */
export function polygonArea(poly: Point[]): number {
  let area = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
  }
  return Math.abs(area / 2)
}

/** How many of the given points fall inside each zone, keyed by zone id. */
export function occupancyCounts(zones: Zone[], targets: Point[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const z of zones) {
    const poly = zonePtsM(z)
    out[z.id] = targets.filter((t) => pointInPolygon(t, poly)).length
  }
  return out
}

/** Snap a metre value to the 0.5 m editing grid. */
export function snapHalf(v: number): number {
  return Math.round(v * 2) / 2
}

/** Per-zone-type colour tokens + label, matching the design theme. */
export function zoneMeta(t: ZoneType): { label: string; accent: string; soft: string } {
  return t === 'exclusion'
    ? { label: 'Exclusion', accent: 'var(--excl)', soft: 'var(--exclSoft)' }
    : { label: 'Detection', accent: 'var(--green)', soft: 'var(--greenSoft)' }
}
