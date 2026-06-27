/*
 * Convex decomposition for the ESPHome generation path. An L-shape splits into
 * convex parts whose union covers the original and whose combined occupancy
 * matches the single-polygon evaluator; a convex polygon is returned unchanged.
 */
import { describe, expect, it } from 'vitest'
import { convexDecompose, isConvex } from '../src/domain/decompose'
import { pointInPolygon } from '../src/domain/geometry'
import { evaluateOccupancy } from '../src/domain/occupancy'
import type { Point, PolyZone } from '../src/domain/types'

/** The L-shape from the occupancy tests: a 2x2 square missing its top-right quadrant. */
const L: Point[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 0, y: 2 },
]

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
]

/** A grid of sample points spanning and surrounding the shapes. */
function grid(min: number, max: number, step: number): Point[] {
  const pts: Point[] = []
  for (let x = min; x <= max; x += step) {
    for (let y = min; y <= max; y += step) pts.push({ x, y })
  }
  return pts
}

describe('convexDecompose', () => {
  it('returns a convex polygon unchanged as a single part', () => {
    const parts = convexDecompose(square)
    expect(parts).toHaveLength(1)
    expect(isConvex(parts[0])).toBe(true)
  })

  it('splits an L-shape into multiple convex parts', () => {
    const parts = convexDecompose(L)
    expect(parts.length).toBeGreaterThanOrEqual(2)
    for (const part of parts) {
      expect(part.length).toBeGreaterThanOrEqual(3)
      expect(isConvex(part)).toBe(true)
    }
  })

  it('the union of the parts covers exactly the original polygon', () => {
    const parts = convexDecompose(L)
    // Offset the grid off the integer lines so samples avoid shared edges, where
    // both the original and a part boundary count as inside.
    for (const p of grid(-0.4, 2.6, 0.3)) {
      const inOriginal = pointInPolygon(p, L)
      const inAnyPart = parts.some((part) => pointInPolygon(p, part))
      expect(inAnyPart, `point (${p.x},${p.y})`).toBe(inOriginal)
    }
  })

  it('combined occupancy of the parts matches the single-polygon evaluator', () => {
    const parts = convexDecompose(L)
    const whole: PolyZone = { id: 'L', name: 'L', type: 'detection', shape: 'poly', pts: L }
    for (const p of grid(-0.4, 2.6, 0.3)) {
      const single = evaluateOccupancy([whole], [p]).zones.L
      const decomposed = parts.some((part) => pointInPolygon(p, part))
      expect(decomposed, `point (${p.x},${p.y})`).toBe(single)
    }
  })
})
