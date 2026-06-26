/*
 * Native LD2450 region geometry and the six constraint violations. These are the
 * heart of Phase 3: they decide what can be written to the device and turn zones
 * into millimetre regions (and back). The right-angle cases the old `rot === 0`
 * check mishandled are asserted explicitly so the defect cannot regress.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_NATIVE_ZONES,
  nativeRegion,
  nativeViolations,
  regionToRect,
  roomToSensor,
  sensorToRoom,
  type NativeRegion,
} from '../src/domain/native'
import type { PolyZone, RectZone, SensorMount } from '../src/domain/types'

const rect = (over: Partial<RectZone> = {}): RectZone => ({
  id: 'z',
  name: 'Zone',
  type: 'detection',
  shape: 'rect',
  cx: 0,
  cy: 2,
  w: 1,
  h: 2,
  rot: 0,
  ...over,
})

const mount = (over: Partial<SensorMount> = {}): SensorMount => ({
  surface: 'wall',
  height: 1.5,
  origin: { x: 0, y: 0 },
  boresight: 0,
  ...over,
})

describe('roomToSensor', () => {
  it('inverts sensorToRoom for several mounts', () => {
    const mounts = [mount(), mount({ boresight: 90 }), mount({ origin: { x: 0.5, y: -0.3 }, boresight: 37 })]
    for (const m of mounts) {
      const p = { x: 1.2, y: 3.4 }
      const round = sensorToRoom(roomToSensor(p, m), m)
      expect(round.x).toBeCloseTo(p.x, 9)
      expect(round.y).toBeCloseTo(p.y, 9)
    }
  })
})

describe('nativeRegion', () => {
  it('maps an axis-aligned rectangle at boresight 0 to its millimetre box', () => {
    // cx 0, cy 2, w 1, h 2 -> x in [-0.5, 0.5] m, y in [1, 3] m.
    expect(nativeRegion(rect(), mount())).toEqual({ x1: -500, y1: 1000, x2: 500, y2: 3000 })
  })

  it('accepts the right-angle rotations the old rot===0 check rejected', () => {
    // A non-square rectangle so the 90/270 width<->depth swap is observable.
    expect(nativeRegion(rect({ rot: 90 }), mount())).toEqual({ x1: -1000, y1: 1500, x2: 1000, y2: 2500 })
    expect(nativeRegion(rect({ rot: 180 }), mount())).toEqual({ x1: -500, y1: 1000, x2: 500, y2: 3000 })
    expect(nativeRegion(rect({ rot: 270 }), mount())).toEqual({ x1: -1000, y1: 1500, x2: 1000, y2: 2500 })
    // Negative normalised rotation behaves the same as its positive equivalent.
    expect(nativeRegion(rect({ rot: -90 }), mount())).toEqual(nativeRegion(rect({ rot: 270 }), mount()))
  })

  it('is axis-aligned when the rotation cancels the boresight', () => {
    // rot 90 under boresight 90 -> orientation 0 in the sensor frame.
    expect(nativeRegion(rect({ rot: 90 }), mount({ boresight: 90 }))).not.toBeNull()
    // rot 30 under boresight 30 -> orientation 0 in the sensor frame.
    expect(nativeRegion(rect({ rot: 30 }), mount({ boresight: 30 }))).not.toBeNull()
  })

  it('returns null for a polygon', () => {
    const poly: PolyZone = {
      id: 'p',
      name: 'Poly',
      type: 'detection',
      shape: 'poly',
      pts: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
    }
    expect(nativeRegion(poly, mount())).toBeNull()
  })

  it('returns null for a 45 degree rectangle', () => {
    expect(nativeRegion(rect({ rot: 45 }), mount())).toBeNull()
  })

  it('returns null for an axis-aligned room rectangle under a non-right-angle boresight', () => {
    expect(nativeRegion(rect({ rot: 0 }), mount({ boresight: 15 }))).toBeNull()
    expect(nativeRegion(rect({ rot: 30 }), mount({ boresight: 0 }))).toBeNull()
  })
})

describe('regionToRect round-trips nativeRegion', () => {
  it('is stable for every right-angle boresight and an offset origin', () => {
    const region: NativeRegion = { x1: -800, y1: 1200, x2: 600, y2: 2400 }
    for (const boresight of [0, 90, 180, 270]) {
      const m = mount({ boresight, origin: { x: 0.4, y: -0.2 } })
      const zone = regionToRect(region, m, { id: 'z', name: 'Z', type: 'detection' })
      expect(nativeRegion(zone, m)).toEqual(region)
    }
  })
})

describe('nativeViolations', () => {
  it('passes a clean native set', () => {
    const zones = [rect({ id: 'a', cx: -1, cy: 1, w: 1, h: 1 }), rect({ id: 'b', cx: 1, cy: 1, w: 1, h: 1 })]
    expect(nativeViolations(zones, mount())).toEqual([])
  })

  it('flags more than three zones', () => {
    const zones = Array.from({ length: MAX_NATIVE_ZONES + 1 }, (_, i) => rect({ id: `z${i}`, cx: i * 1.2 - 2 }))
    expect(nativeViolations(zones, mount()).some((r) => /More than 3 zones \(4\)/.test(r))).toBe(true)
  })

  it('flags a polygon zone', () => {
    const poly: PolyZone = {
      id: 'p',
      name: 'L run',
      type: 'detection',
      shape: 'poly',
      pts: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
    }
    expect(nativeViolations([poly], mount()).some((r) => /"L run" is a polygon/.test(r))).toBe(true)
  })

  it('flags a rotated rectangle', () => {
    expect(nativeViolations([rect({ name: 'Tilt', rot: 45 })], mount()).some((r) => /"Tilt" is rotated/.test(r))).toBe(true)
  })

  it('flags a mix of detection and exclusion', () => {
    const zones = [rect({ id: 'a', type: 'detection', cx: -1 }), rect({ id: 'b', type: 'exclusion', cx: 1 })]
    expect(nativeViolations(zones, mount()).some((r) => /Mixes detection and exclusion/.test(r))).toBe(true)
  })

  it('flags a region beyond the sensor range', () => {
    // cx 2.8, w 1 -> x up to 3.3 m = 3300 mm, past the 3000 mm limit.
    const far = rect({ name: 'Far', cx: 2.8, cy: 2, w: 1, h: 1 })
    expect(nativeViolations([far], mount()).some((r) => /"Far" extends beyond the sensor range/.test(r))).toBe(true)
  })

  it('flags overlapping regions', () => {
    const a = rect({ id: 'a', name: 'A', cx: 0, cy: 2, w: 2, h: 2 })
    const b = rect({ id: 'b', name: 'B', cx: 0.5, cy: 2, w: 2, h: 2 })
    expect(nativeViolations([a, b], mount()).some((r) => /"A" and "B" overlap/.test(r))).toBe(true)
  })

  it('does not flag regions that only share an edge', () => {
    const a = rect({ id: 'a', name: 'A', cx: -0.5, cy: 2, w: 1, h: 2 })
    const b = rect({ id: 'b', name: 'B', cx: 0.5, cy: 2, w: 1, h: 2 })
    expect(nativeViolations([a, b], mount()).some((r) => /overlap/.test(r))).toBe(false)
  })

  it('flags a degenerate (zero-extent) region', () => {
    const sliver = rect({ name: 'Sliver', cx: 0, cy: 2, w: 0.0004, h: 1 })
    expect(nativeViolations([sliver], mount()).some((r) => /"Sliver" is too small/.test(r))).toBe(true)
  })
})
