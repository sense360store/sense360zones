/*
 * Coordinate and unit conversions for live LD2450 samples.
 *
 * The LD2450 reports a target as an (x, y) pair in its own sensor frame, in
 * millimetres by default. The canvas works in the Phase 0 room frame: metres,
 * sensor origin at the coordinate origin, +y pointing away from the sensor into
 * the room, +x to its right. `MockDataProvider` emits targets in exactly that
 * frame with the default mount (origin 0,0, boresight 0), so with that mount
 * these conversions are the identity and the canvas behaves identically.
 *
 * This is the only place units and the sensor->room transform are applied; the
 * provider feeds raw entity values straight through here before emitting a frame.
 */
import type { Point, SensorMount } from '../../src/domain/types'

/**
 * Convert a raw entity value to metres using its Home Assistant
 * `unit_of_measurement`. Millimetres and centimetres are scaled; metres pass
 * through. An absent or unrecognised unit is treated as the LD2450 default of
 * millimetres.
 */
export function toMetres(value: number, unit: string | undefined): number {
  switch ((unit ?? '').trim().toLowerCase()) {
    case 'm':
    case 'meter':
    case 'meters':
    case 'metre':
    case 'metres':
      return value
    case 'cm':
    case 'centimeter':
    case 'centimeters':
    case 'centimetre':
    case 'centimetres':
      return value / 100
    case 'mm':
    case 'millimeter':
    case 'millimeters':
    case 'millimetre':
    case 'millimetres':
    case '':
      return value / 1000
    default:
      // Unknown unit: assume the LD2450 default rather than guess wrongly.
      return value / 1000
  }
}

/**
 * Transform a point from the sensor frame to the room frame using the device
 * mount: rotate by the boresight, then translate by the sensor origin. With the
 * default mount (origin 0,0, boresight 0) this returns the point unchanged, which
 * is the convention `MockDataProvider` and the canvas already use.
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
