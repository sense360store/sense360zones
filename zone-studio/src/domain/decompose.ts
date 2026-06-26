/*
 * Convex decomposition for the generation path only (Phase 4, task C).
 * -------------------------------------------------------------------------
 * The external ESPHome component (TillFleisch/ESPHome-HLK-LD2450) requires each
 * zone polygon to be a *simple convex* polygon. A user can draw an arbitrary
 * non-convex zone (an L-shaped run is the headline case), so before generating
 * the on-device config we split such a polygon into convex parts and emit one
 * device zone per part.
 *
 * The runtime evaluator does NOT need this: `domain/occupancy.ts` tests points
 * against the original polygon with a non-convex-safe ray cast, so the live MQTT
 * path handles any shape directly. Decomposition exists purely so the durable
 * ESPHome export stays within the component's convex-only constraint.
 *
 * The method is ear-clipping triangulation (every triangle is convex) followed
 * by a Hertel-Mehlhorn merge that greedily fuses adjacent parts back together
 * while they stay convex, so an L-shape yields two parts rather than four
 * triangles. All work is in room metres on plain points; mapping to the sensor
 * frame happens later in `esphome.ts`.
 */
import type { Point } from './types'

const EPS = 1e-9

/** Twice the signed area; positive when `poly` winds counter-clockwise. */
function signedArea2(poly: Point[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return a
}

/** Return `poly` wound counter-clockwise (reversing a clockwise input). */
function toCCW(poly: Point[]): Point[] {
  return signedArea2(poly) < 0 ? [...poly].reverse() : [...poly]
}

/** Cross product of o→a and o→b. Positive is a left (CCW) turn. */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
}

/** True when `p` is inside (or on) the CCW triangle `a`,`b`,`c`. */
function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  return cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS
}

/**
 * True when a CCW polygon is convex: every interior turn is a left turn (with a
 * tolerance that also accepts collinear vertices, which stay convex).
 */
export function isConvex(poly: Point[]): boolean {
  const p = toCCW(poly)
  const n = p.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    if (cross(p[(i - 1 + n) % n], p[i], p[(i + 1) % n]) < -EPS) return false
  }
  return true
}

/** Ear-clipping triangulation of a simple CCW polygon. */
function triangulate(ccw: Point[]): Point[][] {
  const n = ccw.length
  if (n < 3) return []
  const idx = ccw.map((_, i) => i)
  const tris: Point[][] = []

  let guard = n * n + 1
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length]
      const i1 = idx[k]
      const i2 = idx[(k + 1) % idx.length]
      const a = ccw[i0]
      const b = ccw[i1]
      const c = ccw[i2]
      if (cross(a, b, c) <= EPS) continue // reflex or collinear tip: not an ear
      let contains = false
      for (const m of idx) {
        if (m === i0 || m === i1 || m === i2) continue
        if (pointInTriangle(ccw[m], a, b, c)) {
          contains = true
          break
        }
      }
      if (contains) continue
      tris.push([a, b, c])
      idx.splice(k, 1)
      clipped = true
      break
    }
    if (!clipped) break // degenerate input: stop rather than spin
  }
  if (idx.length === 3) tris.push([ccw[idx[0]], ccw[idx[1]], ccw[idx[2]]])
  return tris
}

/**
 * Merge two CCW convex pieces across a shared edge into one polygon, or null when
 * they share no edge. The caller checks the result for convexity before keeping
 * it. A shared interior edge is traversed one way in `a` (u→v) and the other in
 * `b` (v→u); the merged ring walks `a` from v back to u, then `b`'s remaining
 * vertices.
 */
function mergeAcrossSharedEdge(a: Point[], b: Point[]): Point[] | null {
  for (let ai = 0; ai < a.length; ai++) {
    const u = a[ai]
    const v = a[(ai + 1) % a.length]
    for (let bi = 0; bi < b.length; bi++) {
      const p = b[bi]
      const q = b[(bi + 1) % b.length]
      if (!samePoint(p, v) || !samePoint(q, u)) continue
      // a as [v, ...rest of a..., u]; then b's vertices after u up to before v,
      // i.e. b without the two shared vertices v (=b[bi]) and u (=b[bi+1]).
      const merged: Point[] = []
      for (let t = 0; t < a.length; t++) merged.push(a[(ai + 1 + t) % a.length])
      for (let t = 0; t < b.length - 2; t++) merged.push(b[(bi + 2 + t) % b.length])
      return merged
    }
  }
  return null
}

/**
 * Split a simple polygon into convex parts whose union is the original. Returns
 * the polygon unchanged (as a single CCW part) when it is already convex.
 */
export function convexDecompose(poly: Point[]): Point[][] {
  const ccw = toCCW(poly)
  if (ccw.length < 3) return ccw.length ? [ccw] : []
  if (isConvex(ccw)) return [ccw]

  let parts = triangulate(ccw)
  if (parts.length === 0) return [ccw]

  // Hertel-Mehlhorn: greedily fuse adjacent parts while the union stays convex.
  let fused = true
  while (fused) {
    fused = false
    outer: for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const merged = mergeAcrossSharedEdge(parts[i], parts[j])
        if (merged && isConvex(merged)) {
          parts = [...parts.slice(0, i), merged, ...parts.slice(i + 1, j), ...parts.slice(j + 1)]
          fused = true
          break outer
        }
      }
    }
  }
  return parts
}
