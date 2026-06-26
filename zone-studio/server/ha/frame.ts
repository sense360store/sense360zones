/*
 * Coordinate and unit conversions for the LD2450 path.
 *
 * The LD2450 reports a target as an (x, y) pair in its own sensor frame, in
 * millimetres by default. The canvas works in the Phase 0 room frame: metres,
 * sensor origin at the coordinate origin, +y pointing away from the sensor into
 * the room, +x to its right. `MockDataProvider` emits targets in exactly that
 * frame with the default mount (origin 0,0, boresight 0), so with that mount the
 * transform is the identity and the canvas behaves identically.
 *
 * `toMetres` (raw entity value -> metres) is an HA-units concern and lives here,
 * the only place units are applied on the read path. The sensor<->room transform
 * itself lives in `src/domain/native.ts` because the frontend profile resolver
 * needs it too (the frontend cannot import from `server/`); this module re-exports
 * it so the backend keeps one import surface and there is one coordinate
 * convention, not two. The inverse (room to sensor) and the metres-to-millimetre
 * region mapping live alongside it there.
 */
export { roomToSensor, sensorToRoom } from '../../src/domain/native'

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
 * Convert a metre value to integer millimetres for a device region register,
 * the inverse of `toMetres` for the default millimetre unit.
 */
export function toMillimetres(value: number): number {
  return Math.round(value * 1000)
}
