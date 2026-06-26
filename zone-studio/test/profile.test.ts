/*
 * Profile resolution is mount-aware: eligibility is judged in the sensor frame, so
 * the right-angle rotations resolve to NATIVE and a non-right-angle boresight on an
 * otherwise axis-aligned set forces POLYGON. This is where the old right-angle
 * defect would resurface, so it is pinned here.
 */
import { describe, expect, it } from 'vitest'
import { resolveProfile } from '../src/domain/profile'
import type { RectZone, SensorMount } from '../src/domain/types'

const rect = (over: Partial<RectZone> = {}): RectZone => ({
  id: 'z',
  name: 'Zone',
  type: 'detection',
  shape: 'rect',
  cx: 0,
  cy: 2,
  w: 1,
  h: 1,
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

describe('resolveProfile', () => {
  it('is native for an empty set', () => {
    expect(resolveProfile([], mount())).toEqual({ profile: 'native', reasons: [] })
  })

  it('is native for up to three axis-aligned same-mode rectangles', () => {
    const zones = [
      rect({ id: 'a', cx: -1.5, cy: 1 }),
      rect({ id: 'b', cx: 0, cy: 1 }),
      rect({ id: 'c', cx: 1.5, cy: 1 }),
    ]
    expect(resolveProfile(zones, mount()).profile).toBe('native')
  })

  it('is native for the right-angle rotations (the old defect)', () => {
    for (const rot of [90, 180, 270]) {
      const res = resolveProfile([rect({ rot })], mount())
      expect(res.profile, `rot ${rot}`).toBe('native')
      expect(res.reasons).toEqual([])
    }
  })

  it('is native when a rotation cancels the boresight', () => {
    // rot 90 under boresight 90 is axis-aligned in the sensor frame; place it so
    // the region also stays within the sensor's forward range.
    const zone = rect({ rot: 90, cx: -2, cy: 2, w: 1, h: 1 })
    expect(resolveProfile([zone], mount({ boresight: 90 })).profile).toBe('native')
  })

  it('is polygon for an axis-aligned set under a non-right-angle boresight', () => {
    const res = resolveProfile([rect({ rot: 0 })], mount({ boresight: 20 }))
    expect(res.profile).toBe('polygon')
    expect(res.reasons.length).toBeGreaterThan(0)
  })

  it('is polygon for a fourth zone, with a reason', () => {
    const zones = [rect({ id: 'a', cx: -2 }), rect({ id: 'b', cx: -0.7 }), rect({ id: 'c', cx: 0.7 }), rect({ id: 'd', cx: 2 })]
    const res = resolveProfile(zones, mount())
    expect(res.profile).toBe('polygon')
    expect(res.reasons.some((r) => /More than 3 zones/.test(r))).toBe(true)
  })

  it('is polygon for a mixed-mode set', () => {
    const zones = [rect({ id: 'a', type: 'detection', cx: -1 }), rect({ id: 'b', type: 'exclusion', cx: 1 })]
    expect(resolveProfile(zones, mount()).profile).toBe('polygon')
  })
})
