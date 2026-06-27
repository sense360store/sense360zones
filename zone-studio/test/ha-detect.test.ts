/*
 * Detection heuristics and override resolution. These decide a device's kind and
 * which entity plays which role; a persisted override must win over auto-detection.
 */
import { describe, expect, it } from 'vitest'
import {
  detectKindAndRoles,
  detectSen0609Roles,
  esphomeNode,
  isSense360Device,
  resolveDevice,
  resolveMapping,
} from '../server/ha/detect'
import type { HassState } from '../server/ha/types'

const noState = () => undefined
const stateMap = (entries: Record<string, HassState>) => (id: string) => entries[id]

describe('detectKindAndRoles', () => {
  it('detects an LD2450 from a target coordinate pair', () => {
    const ids = ['sensor.node_target_1_x', 'sensor.node_target_1_y', 'sensor.node_target_1_speed']
    const res = detectKindAndRoles(ids, noState)
    expect(res?.kind).toBe('ld2450')
    expect(res?.roles.targets[0]).toEqual({
      x: 'sensor.node_target_1_x',
      y: 'sensor.node_target_1_y',
      speed: 'sensor.node_target_1_speed',
    })
  })

  it('tolerates separator variations in entity ids', () => {
    const ids = ['sensor.node_target2x', 'sensor.node_target2y']
    const res = detectKindAndRoles(ids, noState)
    expect(res?.kind).toBe('ld2450')
    expect(res?.roles.targets[1]).toEqual({ x: 'sensor.node_target2x', y: 'sensor.node_target2y' })
  })

  it('does not classify a lone x without a matching y as a target', () => {
    const res = detectKindAndRoles(['sensor.node_target_1_x'], noState)
    expect(res).toBeNull()
  })

  it('detects a SEN0609 from a presence binary_sensor with a distance sensor', () => {
    const ids = ['binary_sensor.node_presence', 'sensor.node_distance']
    const res = detectKindAndRoles(
      ids,
      stateMap({
        'binary_sensor.node_presence': { entity_id: 'binary_sensor.node_presence', state: 'off', attributes: { device_class: 'occupancy' } },
        'sensor.node_distance': { entity_id: 'sensor.node_distance', state: '2.0', attributes: { device_class: 'distance' } },
      }),
    )
    expect(res?.kind).toBe('sen0609')
    expect(res?.roles.presence).toBe('binary_sensor.node_presence')
    expect(res?.roles.distance).toBe('sensor.node_distance')
  })

  it('does not classify a device from a lone presence, occupancy or motion sensor', () => {
    for (const deviceClass of ['presence', 'occupancy', 'motion']) {
      const id = 'binary_sensor.node_presence'
      const res = detectKindAndRoles(
        [id],
        stateMap({ [id]: { entity_id: id, state: 'off', attributes: { device_class: deviceClass } } }),
      )
      expect(res, `lone ${deviceClass} must not classify`).toBeNull()
    }
  })

  it('picks the radar entities out of a busy device and ignores unrelated entities', () => {
    const ids = ['binary_sensor.node_presence', 'sensor.node_distance', 'sensor.node_co2', 'fan.node_fan']
    const res = detectKindAndRoles(
      ids,
      stateMap({
        'binary_sensor.node_presence': { entity_id: 'binary_sensor.node_presence', state: 'on', attributes: { device_class: 'presence' } },
        'sensor.node_distance': { entity_id: 'sensor.node_distance', state: '2.0', attributes: { device_class: 'distance' } },
        'sensor.node_co2': { entity_id: 'sensor.node_co2', state: '600', attributes: { device_class: 'carbon_dioxide' } },
      }),
    )
    expect(res?.kind).toBe('sen0609')
    expect(res?.roles.distance).toBe('sensor.node_distance')
  })

  it('prefers LD2450 when both target coordinates and a presence sensor exist', () => {
    const ids = ['sensor.node_target_1_x', 'sensor.node_target_1_y', 'binary_sensor.node_presence']
    const res = detectKindAndRoles(
      ids,
      stateMap({
        'binary_sensor.node_presence': { entity_id: 'binary_sensor.node_presence', state: 'on', attributes: { device_class: 'presence' } },
      }),
    )
    expect(res?.kind).toBe('ld2450')
  })

  it('returns null for a device with no recognisable sensor entities', () => {
    expect(detectKindAndRoles(['sensor.node_temperature', 'switch.node_relay'], noState)).toBeNull()
  })
})

describe('LD2450 zone detection', () => {
  const targets = ['sensor.node_target_1_x', 'sensor.node_target_1_y']
  const typeSelect = (entity_id: string): Record<string, HassState> => ({
    [entity_id]: { entity_id, state: 'Disabled', attributes: { options: ['Disabled', 'Detection', 'Filter'] } },
  })

  it('detects the per-zone region numbers and the zone_type select', () => {
    const ids = [
      ...targets,
      'number.node_zone_1_x1',
      'number.node_zone_1_y1',
      'number.node_zone_1_x2',
      'number.node_zone_1_y2',
      'number.node_zone_2_x1',
      'select.node_zone_type',
    ]
    const res = detectKindAndRoles(ids, stateMap(typeSelect('select.node_zone_type')))
    expect(res?.kind).toBe('ld2450')
    expect(res?.roles.zones?.[0]).toEqual({
      x1: 'number.node_zone_1_x1',
      y1: 'number.node_zone_1_y1',
      x2: 'number.node_zone_1_x2',
      y2: 'number.node_zone_1_y2',
    })
    expect(res?.roles.zones?.[1]).toEqual({ x1: 'number.node_zone_2_x1' })
    expect(res?.roles.zoneType).toBe('select.node_zone_type')
  })

  it('recognises the zone_type select by its option set when the id is generic', () => {
    const ids = [...targets, 'select.node_region_mode']
    const res = detectKindAndRoles(ids, stateMap(typeSelect('select.node_region_mode')))
    expect(res?.roles.zoneType).toBe('select.node_region_mode')
  })

  it('does not mistake an unrelated select for the zone_type', () => {
    const ids = [...targets, 'select.node_fan_preset']
    const res = detectKindAndRoles(
      ids,
      stateMap({
        'select.node_fan_preset': {
          entity_id: 'select.node_fan_preset',
          state: 'Auto',
          attributes: { options: ['Auto', 'Low', 'High'] },
        },
      }),
    )
    expect(res?.roles.zoneType).toBeUndefined()
  })

  it('lets an override set the zone roles where auto-detection is silent', () => {
    const res = resolveMapping('dev', targets, noState, {
      roles: { zoneType: 'select.custom_type', zones: [{ x1: 'number.a' }] },
    })
    expect(res?.roles.zoneType).toBe('select.custom_type')
    expect(res?.roles.zones?.[0]).toEqual({ x1: 'number.a' })
  })
})

describe('resolveMapping with an override', () => {
  const ids = ['sensor.node_target_1_x', 'sensor.node_target_1_y']

  it('forces the kind, overriding auto-detection', () => {
    const res = resolveMapping('dev', ids, noState, { kind: 'sen0609' })
    expect(res?.kind).toBe('sen0609')
  })

  it('replaces a target role assignment', () => {
    const res = resolveMapping('dev', ids, noState, {
      roles: { targets: [{ x: 'sensor.other_x', y: 'sensor.other_y' }] },
    })
    expect(res?.roles.targets[0]).toEqual({ x: 'sensor.other_x', y: 'sensor.other_y' })
  })

  it('creates a mapping for a device auto-detection skips when the kind is forced', () => {
    const res = resolveMapping('dev', ['sensor.node_temperature'], noState, {
      kind: 'ld2450',
      roles: { targets: [{ x: 'sensor.custom_x', y: 'sensor.custom_y' }] },
    })
    expect(res?.kind).toBe('ld2450')
    expect(res?.roles.targets[0]).toEqual({ x: 'sensor.custom_x', y: 'sensor.custom_y' })
  })

  it('falls back to auto-detection where the override is silent', () => {
    const res = resolveMapping('dev', ids, noState, { kind: 'ld2450' })
    expect(res?.roles.targets[0]).toEqual({ x: 'sensor.node_target_1_x', y: 'sensor.node_target_1_y' })
  })
})

describe('ESPHome and Sense360 identity', () => {
  it('reads the ESPHome node name from the device identifiers', () => {
    expect(esphomeNode({ identifiers: [['esphome', 'living-aabbcc']] })).toBe('living-aabbcc')
    expect(esphomeNode({ identifiers: [['mac', 'aa:bb'], ['esphome', 'node-2']] })).toBe('node-2')
  })

  it('returns null for a non-ESPHome device', () => {
    expect(esphomeNode({ identifiers: [['tractive', 'silver']] })).toBeNull()
    expect(esphomeNode({ identifiers: [['zigbee', '00:15']] })).toBeNull()
    expect(esphomeNode({})).toBeNull()
  })

  it('recognises a Sense360 identity in the manufacturer or model only when present', () => {
    expect(isSense360Device({ manufacturer: 'Sense360', model: 'LD2450' })).toBe(true)
    expect(isSense360Device({ manufacturer: 'Espressif', model: 'sense360.air' })).toBe(true)
    // Today's firmware: no identity declared, so the prefilter must not match.
    expect(isSense360Device({ manufacturer: 'HiLink', model: 'LD2450' })).toBe(false)
    expect(isSense360Device({ manufacturer: 'DFRobot', model: 'SEN0609' })).toBe(false)
  })

  it('finds the SEN0609 signature only with both presence and distance', () => {
    const presenceOnly = stateMap({
      'binary_sensor.x': { entity_id: 'binary_sensor.x', state: 'off', attributes: { device_class: 'presence' } },
    })
    expect(detectSen0609Roles(['binary_sensor.x'], presenceOnly)).toBeNull()
    const both = stateMap({
      'binary_sensor.x': { entity_id: 'binary_sensor.x', state: 'off', attributes: { device_class: 'presence' } },
      'sensor.d': { entity_id: 'sensor.d', state: '2', attributes: { device_class: 'distance' } },
    })
    expect(detectSen0609Roles(['binary_sensor.x', 'sensor.d'], both)).toEqual({
      presence: 'binary_sensor.x',
      distance: 'sensor.d',
    })
  })
})

describe('resolveDevice gating', () => {
  const targets = ['sensor.node_target_1_x', 'sensor.node_target_1_y']

  it('activates a device with a confident signature', () => {
    const res = resolveDevice('dev', targets, noState)
    expect(res.confidence).toBe('confident')
    expect(res.confirmed).toBe(false)
    expect(res.mapping?.kind).toBe('ld2450')
  })

  it('does not activate a device with no confident signature and no confirmation', () => {
    const id = 'binary_sensor.node_presence'
    const res = resolveDevice('dev', [id], stateMap({ [id]: { entity_id: id, state: 'off', attributes: { device_class: 'presence' } } }))
    expect(res.kind).toBeNull()
    expect(res.confidence).toBe('none')
    expect(res.mapping).toBeNull()
  })

  it('activates a device once it is confirmed, even without a signature', () => {
    const res = resolveDevice('dev', ['sensor.node_temperature'], noState, { kind: 'sen0609', confirmed: true })
    expect(res.confirmed).toBe(true)
    expect(res.mapping?.kind).toBe('sen0609')
  })

  it('keeps a dismissed device inactive even with a confident signature', () => {
    const res = resolveDevice('dev', targets, noState, { dismissed: true })
    expect(res.dismissed).toBe(true)
    expect(res.mapping).toBeNull()
  })
})
