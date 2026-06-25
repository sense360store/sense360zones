/*
 * Home Assistant fixtures for the simulator and the provider tests.
 *
 * One ESPHome LD2450 in the Living Room with target 1..3 x, y and speed, and one
 * ESPHome SEN0609 in the Bedroom with a presence binary_sensor and a distance
 * sensor. Targets 1 occupied, 2 empty (0,0), 3 unavailable, so discovery and the
 * first frame already exercise the empty-slot and unavailable cases.
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

export const SEN = {
  presence: 'binary_sensor.bedroom_presence',
  distance: 'sensor.bedroom_distance',
}

function esphome(entity_id: string, device_id: string): EntityRegistryEntry {
  return { entity_id, device_id, platform: 'esphome' }
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
  esphome(SEN.presence, 'dev_sen'),
  esphome(SEN.distance, 'dev_sen'),
]

function state(entity_id: string, value: string, attributes: HassState['attributes'] = {}): HassState {
  return { entity_id, state: value, attributes }
}

const mm = { unit_of_measurement: 'mm' }
const mmps = { unit_of_measurement: 'mm/s' }

/** Initial states: target 1 occupied at (-1500, 1800) mm, 2 empty, 3 unavailable. */
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
    state(SEN.presence, 'off', { device_class: 'presence' }),
    state(SEN.distance, '2.4', { device_class: 'distance', unit_of_measurement: 'm' }),
  ]
}
