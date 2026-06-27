/*
 * Home Assistant fixtures for the simulator and the provider tests.
 *
 * One ESPHome LD2450 in the Living Room with target 1..3 x, y and speed, and one
 * ESPHome SEN0609 in the Bedroom with a presence binary_sensor, a distance sensor
 * and unrelated air quality entities (so detection must pick the radar out of a
 * busy device). Targets 1 occupied, 2 empty (0,0), 3 unavailable, so discovery and
 * the first frame already exercise the empty-slot and unavailable cases.
 *
 * Two devices must never be offered as candidates: a non-ESPHome pet tracker named
 * "Silver" with a presence binary_sensor (the cat that used to show up as a
 * SEN0609), and a non-ESPHome Zigbee motion sensor. Both are excluded by the
 * ESPHome scope, not by their device_class.
 */
import type {
  AreaRegistryEntry,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HassState,
} from '../server/ha/types'

export const areas: AreaRegistryEntry[] = [
  { area_id: 'living_room', name: 'Living Room' },
  { area_id: 'bedroom', name: 'Bedroom' },
]

export const devices: DeviceRegistryEntry[] = [
  {
    id: 'dev_ld',
    area_id: 'living_room',
    name: 'Sense360 Living',
    name_by_user: null,
    model: 'LD2450',
    manufacturer: 'HiLink',
    identifiers: [['esphome', 'ld-aabbcc']],
  },
  {
    id: 'dev_sen',
    area_id: 'bedroom',
    name: 'Sense360 Bedroom',
    name_by_user: null,
    model: 'SEN0609',
    manufacturer: 'DFRobot',
    identifiers: [['esphome', 'sen-ddeeff']],
  },
  // Excluded: a non-ESPHome pet tracker with a presence binary_sensor. The old
  // heuristic classified this as a SEN0609; the ESPHome scope must drop it.
  {
    id: 'dev_cat',
    area_id: 'living_room',
    name: 'Silver',
    name_by_user: null,
    model: 'GPS Tracker',
    manufacturer: 'Tractive',
    identifiers: [['tractive', 'silver-7f3a']],
  },
  // Excluded: a non-ESPHome Zigbee motion sensor.
  {
    id: 'dev_motion',
    area_id: 'bedroom',
    name: 'Hallway Motion',
    name_by_user: null,
    model: 'RTCGQ11LM',
    manufacturer: 'Aqara',
    identifiers: [['zigbee', '00:15:8d:00:02:aa:bb:cc']],
  },
]

/** LD2450 coordinate/speed entity ids, grouped for convenience in tests. */
export const LD = {
  t1x: 'sensor.living_target_1_x',
  t1y: 'sensor.living_target_1_y',
  t1speed: 'sensor.living_target_1_speed',
  t2x: 'sensor.living_target_2_x',
  t2y: 'sensor.living_target_2_y',
  t2speed: 'sensor.living_target_2_speed',
  t3x: 'sensor.living_target_3_x',
  t3y: 'sensor.living_target_3_y',
  t3speed: 'sensor.living_target_3_speed',
}

/** LD2450 native zone region numbers and the global zone_type select. */
export const LDZ = {
  z1x1: 'number.living_zone_1_x1',
  z1y1: 'number.living_zone_1_y1',
  z1x2: 'number.living_zone_1_x2',
  z1y2: 'number.living_zone_1_y2',
  z2x1: 'number.living_zone_2_x1',
  z2y1: 'number.living_zone_2_y1',
  z2x2: 'number.living_zone_2_x2',
  z2y2: 'number.living_zone_2_y2',
  z3x1: 'number.living_zone_3_x1',
  z3y1: 'number.living_zone_3_y1',
  z3x2: 'number.living_zone_3_x2',
  z3y2: 'number.living_zone_3_y2',
  zoneType: 'select.living_zone_type',
}

/** The zone_type select's option labels, as the official ld2450 component exposes. */
export const ZONE_TYPE_OPTIONS = ['Disabled', 'Detection', 'Filter']

export const SEN = {
  presence: 'binary_sensor.bedroom_presence',
  distance: 'sensor.bedroom_distance',
}

/** Unrelated entities the SEN0609 device also carries; detection must ignore them. */
export const SEN_EXTRA = {
  co2: 'sensor.bedroom_co2',
  pm25: 'sensor.bedroom_pm25',
  fan: 'fan.bedroom_fan',
}

/** The excluded devices' entities, kept out of the candidate set by the ESPHome scope. */
export const EXCLUDED = {
  catPresence: 'binary_sensor.silver_presence',
  motion: 'binary_sensor.hallway_motion',
}

function esphome(entity_id: string, device_id: string): EntityRegistryEntry {
  return { entity_id, device_id, platform: 'esphome' }
}

function foreign(entity_id: string, device_id: string, platform: string): EntityRegistryEntry {
  return { entity_id, device_id, platform }
}

export const entities: EntityRegistryEntry[] = [
  esphome(LD.t1x, 'dev_ld'),
  esphome(LD.t1y, 'dev_ld'),
  esphome(LD.t1speed, 'dev_ld'),
  esphome(LD.t2x, 'dev_ld'),
  esphome(LD.t2y, 'dev_ld'),
  esphome(LD.t2speed, 'dev_ld'),
  esphome(LD.t3x, 'dev_ld'),
  esphome(LD.t3y, 'dev_ld'),
  esphome(LD.t3speed, 'dev_ld'),
  ...Object.values(LDZ).map((id) => esphome(id, 'dev_ld')),
  esphome(SEN.presence, 'dev_sen'),
  esphome(SEN.distance, 'dev_sen'),
  esphome(SEN_EXTRA.co2, 'dev_sen'),
  esphome(SEN_EXTRA.pm25, 'dev_sen'),
  esphome(SEN_EXTRA.fan, 'dev_sen'),
  foreign(EXCLUDED.catPresence, 'dev_cat', 'tractive'),
  foreign(EXCLUDED.motion, 'dev_motion', 'mqtt'),
]

function state(entity_id: string, value: string, attributes: HassState['attributes'] = {}): HassState {
  return { entity_id, state: value, attributes }
}

const mm = { unit_of_measurement: 'mm' }
const mmps = { unit_of_measurement: 'mm/s' }

/**
 * Initial states: target 1 occupied at (-1500, 1800) mm, 2 empty, 3 unavailable.
 * The native zones start cleared (all corners 0) with the zone_type select
 * Disabled, so a freshly discovered device reports no active zones.
 */
export function initialStates(): HassState[] {
  return [
    state(LD.t1x, '-1500', mm),
    state(LD.t1y, '1800', mm),
    state(LD.t1speed, '12', mmps),
    state(LD.t2x, '0', mm),
    state(LD.t2y, '0', mm),
    state(LD.t2speed, '0', mmps),
    state(LD.t3x, 'unavailable', mm),
    state(LD.t3y, 'unavailable', mm),
    state(LD.t3speed, 'unavailable', mmps),
    ...Object.values(LDZ)
      .filter((id) => id !== LDZ.zoneType)
      .map((id) => state(id, '0', mm)),
    state(LDZ.zoneType, 'Disabled', { options: ZONE_TYPE_OPTIONS }),
    state(SEN.presence, 'off', { device_class: 'presence' }),
    state(SEN.distance, '2.4', { device_class: 'distance', unit_of_measurement: 'm' }),
    state(SEN_EXTRA.co2, '600', { device_class: 'carbon_dioxide', unit_of_measurement: 'ppm' }),
    state(SEN_EXTRA.pm25, '8', { device_class: 'pm25', unit_of_measurement: 'µg/m³' }),
    state(SEN_EXTRA.fan, 'on', {}),
    state(EXCLUDED.catPresence, 'off', { device_class: 'presence' }),
    state(EXCLUDED.motion, 'off', { device_class: 'motion' }),
  ]
}
