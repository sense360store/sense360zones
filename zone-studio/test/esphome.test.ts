/*
 * ESPHome config generation: the YAML carries the pinned external component, a
 * zone with an occupancy binary sensor per drawn zone, vertices mapped from the
 * room frame to the sensor frame with roomToSensor, and a non-convex zone split
 * into more than one device zone.
 */
import { describe, expect, it } from 'vitest'
import {
  ESPHOME_COMPONENT_REF,
  ESPHOME_COMPONENT_SOURCE,
  generateEsphomePackage,
} from '../src/domain/esphome'
import type { PolyZone, RectZone, SensorMount, Zone } from '../src/domain/types'

const device = { id: 'dev_ld', name: 'Living LD2450' }
const mount = (over: Partial<SensorMount> = {}): SensorMount => ({
  surface: 'wall',
  height: 1.5,
  origin: { x: 0, y: 0 },
  boresight: 0,
  ...over,
})

const desk: RectZone = { id: 'z1', name: 'Desk', type: 'detection', shape: 'rect', cx: 0, cy: 2, w: 1, h: 1, rot: 0 }

/** A non-convex L-shaped detection zone. */
const lRun: PolyZone = {
  id: 'z2',
  name: 'L run',
  type: 'detection',
  shape: 'poly',
  pts: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
  ],
}

const countOf = (text: string, needle: string): number => text.split(needle).length - 1

describe('generateEsphomePackage', () => {
  it('pins the external component source and ref', () => {
    const yaml = generateEsphomePackage(device, [desk], mount())
    expect(yaml).toContain('external_components:')
    expect(yaml).toContain(`source: ${ESPHOME_COMPONENT_SOURCE}@${ESPHOME_COMPONENT_REF}`)
    expect(yaml).toContain('LD2450:')
    expect(yaml).toContain('uart_id: uart_bus')
  })

  it('emits a zone with a polygon and an occupancy binary sensor per zone', () => {
    const yaml = generateEsphomePackage(device, [desk], mount())
    expect(yaml).toContain('- zone:')
    expect(yaml).toContain('name: "Desk"')
    expect(yaml).toContain('polygon:')
    expect(yaml).toContain('- point:')
    expect(yaml).toContain('occupancy:')
    expect(yaml).toContain('name: "Desk occupancy"')
  })

  it('maps room-frame vertices to the sensor frame (identity mount)', () => {
    const yaml = generateEsphomePackage(device, [desk], mount())
    // Desk corners in room metres: x in [-0.5, 0.5], y in [1.5, 2.5]. Identity mount.
    expect(yaml).toContain('x: -0.500m')
    expect(yaml).toContain('y: 1.500m')
    expect(yaml).toContain('x: 0.500m')
    expect(yaml).toContain('y: 2.500m')
  })

  it('maps vertices through the mount boresight', () => {
    // boresight 90: roomToSensor maps room (x,y) -> sensor (y, -x).
    const yaml = generateEsphomePackage(device, [desk], mount({ boresight: 90 }))
    // Room corner (0.5, 1.5) -> sensor (1.5, -0.5).
    expect(yaml).toContain('x: 1.500m')
    expect(yaml).toContain('y: -0.500m')
  })

  it('decomposes a non-convex zone into more than one device zone', () => {
    const yaml = generateEsphomePackage(device, [lRun], mount())
    expect(countOf(yaml, '- zone:')).toBeGreaterThanOrEqual(2)
    // Each part carries its own occupancy sensor.
    expect(countOf(yaml, 'occupancy:')).toBeGreaterThanOrEqual(2)
    expect(yaml).toContain('part 1')
  })

  it('tags exclusion zones and still emits occupancy', () => {
    const excl: Zone = { ...desk, id: 'z3', name: 'Couch', type: 'exclusion' }
    const yaml = generateEsphomePackage(device, [excl], mount())
    expect(yaml).toContain('[exclusion]')
    expect(yaml).toContain('name: "Couch occupancy"')
  })

  it('produces a stub when there are no zones', () => {
    const yaml = generateEsphomePackage(device, [], mount())
    expect(yaml).toContain('zones: []')
  })
})
