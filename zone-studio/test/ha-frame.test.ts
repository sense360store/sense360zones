/*
 * Unit conversion and the sensor->room transform. The conversions are the only
 * place units and mount are applied before a frame is emitted, so they are
 * tested in isolation here and end to end in ha-provider.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { sensorToRoom, toMetres } from '../server/ha/frame'
import type { SensorMount } from '../src/domain/types'

describe('toMetres', () => {
  it('converts millimetres to metres', () => {
    expect(toMetres(1500, 'mm')).toBe(1.5)
    expect(toMetres(-2000, 'mm')).toBe(-2)
  })

  it('converts centimetres to metres', () => {
    expect(toMetres(150, 'cm')).toBe(1.5)
    expect(toMetres(40, 'centimeters')).toBe(0.4)
  })

  it('leaves metres unchanged', () => {
    expect(toMetres(2.4, 'm')).toBe(2.4)
    expect(toMetres(0.4, 'metres')).toBe(0.4)
  })

  it('assumes the LD2450 default of millimetres when the unit is absent', () => {
    expect(toMetres(1500, undefined)).toBe(1.5)
    expect(toMetres(1500, '')).toBe(1.5)
  })

  it('assumes millimetres for an unrecognised unit rather than guessing', () => {
    expect(toMetres(1500, 'parsecs')).toBe(1.5)
  })
})

describe('sensorToRoom', () => {
  const defaultMount: SensorMount = { surface: 'wall', height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }

  it('is the identity for the default mount, matching the mock convention', () => {
    expect(sensorToRoom({ x: -1.5, y: 1.8 }, defaultMount)).toEqual({ x: -1.5, y: 1.8 })
  })

  it('translates by the sensor origin', () => {
    const mount: SensorMount = { ...defaultMount, origin: { x: 0.5, y: -0.3 } }
    expect(sensorToRoom({ x: 1, y: 2 }, mount)).toEqual({ x: 1.5, y: 1.7 })
  })

  it('rotates by the boresight (counter-clockwise)', () => {
    const mount: SensorMount = { ...defaultMount, boresight: 90 }
    const r = sensorToRoom({ x: 0, y: 1 }, mount)
    // Standard CCW rotation by 90 degrees maps straight-ahead (0,1) to (-1,0).
    expect(r.x).toBeCloseTo(-1, 6)
    expect(r.y).toBeCloseTo(0, 6)
  })
})
