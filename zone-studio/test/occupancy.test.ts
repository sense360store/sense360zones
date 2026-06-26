/*
 * The shared occupancy primitive: the point-in-polygon test, per-zone occupancy
 * for convex, non-convex (L-shaped), and rotated-rect zones, the on-edge and
 * outside cases, and the device presence semantics (detection counts, exclusion
 * subtracts, no detection zones means any target counts, and mixtures).
 *
 * This is the one evaluator the canvas preview and the MQTT publish path both
 * use, so these cases pin the behaviour both sides depend on.
 */
import { describe, expect, it } from 'vitest'
import { evaluateOccupancy, pointInZone, zoneOccupied } from '../src/domain/occupancy'
import { pointInPolygon } from '../src/domain/geometry'
import type { Point, PolyZone, RectZone, Zone, ZoneType } from '../src/domain/types'

const rect = (over: Partial<RectZone> = {}): RectZone => ({
  id: 'r',
  name: 'Rect',
  type: 'detection',
  shape: 'rect',
  cx: 0,
  cy: 2,
  w: 1,
  h: 1,
  rot: 0,
  ...over,
})

const poly = (id: string, pts: Point[], type: ZoneType = 'detection'): PolyZone => ({
  id,
  name: id,
  type,
  shape: 'poly',
  pts,
})

/** An L-shape: the unit 2x2 square with its top-right quadrant removed. */
const L = poly('L', [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 0, y: 2 },
])

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ]
  it('is true strictly inside and false strictly outside', () => {
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true)
    expect(pointInPolygon({ x: 3, y: 1 }, square)).toBe(false)
  })
  it('counts a point on an edge or vertex as inside', () => {
    expect(pointInPolygon({ x: 2, y: 1 }, square)).toBe(true) // on the right edge
    expect(pointInPolygon({ x: 0, y: 0 }, square)).toBe(true) // on a vertex
  })
})

describe('zone occupancy for a non-convex L-shape', () => {
  it('is occupied for a target in either arm and empty in the notch', () => {
    expect(zoneOccupied(L, [{ x: 0.5, y: 1.5 }])).toBe(true) // left arm
    expect(zoneOccupied(L, [{ x: 1.5, y: 0.5 }])).toBe(true) // bottom arm
    expect(zoneOccupied(L, [{ x: 1.5, y: 1.5 }])).toBe(false) // the removed quadrant
  })
  it('is occupied when a target sits exactly on the boundary', () => {
    expect(pointInZone(L, { x: 1, y: 1 })).toBe(true) // the reflex corner
    expect(pointInZone(L, { x: 2, y: 0.5 })).toBe(true) // an outer edge
  })
  it('is empty for a target outside the shape', () => {
    expect(zoneOccupied(L, [{ x: 3, y: 3 }])).toBe(false)
  })
})

describe('zone occupancy for a rotated rectangle', () => {
  // 2x1 rectangle centred at (0,2), turned 45 degrees.
  const tilted = rect({ w: 2, h: 1, rot: 45 })
  it('is occupied at the centre and on the tilted edge, empty just past a former corner', () => {
    expect(zoneOccupied(tilted, [{ x: 0, y: 2 }])).toBe(true)
    // The axis-aligned corner (1, 2.5) is outside once the rectangle is rotated.
    expect(zoneOccupied(tilted, [{ x: 1, y: 2.5 }])).toBe(false)
  })
})

describe('device presence semantics', () => {
  const detA = rect({ id: 'a', type: 'detection', cx: -1, cy: 2, w: 1, h: 1 }) // x[-1.5,-0.5] y[1.5,2.5]
  const detB = rect({ id: 'b', type: 'detection', cx: 1, cy: 2, w: 1, h: 1 }) // x[0.5,1.5] y[1.5,2.5]
  const excl = rect({ id: 'e', type: 'exclusion', cx: 1, cy: 2, w: 1, h: 1 }) // overlaps detB

  const inA: Point = { x: -1, y: 2 }
  const inB: Point = { x: 1, y: 2 }
  const outside: Point = { x: 3, y: 5 }

  it('detection only: present when a target is inside a detection zone', () => {
    expect(evaluateOccupancy([detA, detB], [inA]).presence).toBe(true)
    expect(evaluateOccupancy([detA, detB], [outside]).presence).toBe(false)
  })

  it('reports each zone independently of presence', () => {
    const r = evaluateOccupancy([detA, detB], [inB])
    expect(r.zones).toEqual({ a: false, b: true })
    expect(r.presence).toBe(true)
  })

  it('exclusion subtracts: a target only inside an exclusion zone is not counted', () => {
    // detA is the only detection zone; the target sits in detB's spot, which here
    // is exclusion, so it is excluded and there is no presence.
    const r = evaluateOccupancy([detA, excl], [inB])
    expect(r.zones).toEqual({ a: false, e: true }) // the exclusion zone still reports occupied
    expect(r.presence).toBe(false)
  })

  it('exclusion overrides detection when zones overlap', () => {
    // A target inside both a detection and an overlapping exclusion zone is excluded.
    const r = evaluateOccupancy([detB, excl], [inB])
    expect(r.zones).toEqual({ b: true, e: true })
    expect(r.presence).toBe(false)
  })

  it('no detection zones: any target in range counts unless excluded', () => {
    expect(evaluateOccupancy([excl], [inA]).presence).toBe(true) // not in the exclusion zone
    expect(evaluateOccupancy([excl], [inB]).presence).toBe(false) // inside the exclusion zone
    expect(evaluateOccupancy([], [inA]).presence).toBe(true) // no zones at all
  })

  it('mixtures: present when any counted target survives exclusion', () => {
    const zones: Zone[] = [detA, detB, excl]
    // One target excluded (inB), one counted (inA) -> present.
    expect(evaluateOccupancy(zones, [inA, inB]).presence).toBe(true)
    // Only the excluded target -> not present.
    expect(evaluateOccupancy(zones, [inB]).presence).toBe(false)
  })
})

describe('a scripted target path through an L-shaped detection zone', () => {
  it('produces enter, stay, and leave transitions', () => {
    // Walk left to right along y = 0.5, crossing the bottom arm of the L.
    const path: Point[] = [
      { x: -0.5, y: 0.5 }, // outside (left)
      { x: 0.5, y: 0.5 }, // inside the arm
      { x: 1.5, y: 0.5 }, // still inside the arm
      { x: 2.5, y: 0.5 }, // outside (right)
    ]
    const states = path.map((p) => evaluateOccupancy([L], [p]).zones.L)
    expect(states).toEqual([false, true, true, false])
  })
})
