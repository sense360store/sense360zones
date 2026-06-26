/*
 * Home Assistant MQTT discovery for the polygon-occupancy entities.
 *
 * Pure topic and config builders, so the runtime publisher stays small and the
 * exact discovery payload is unit-testable. Each zone publishes a `binary_sensor`
 * (device_class occupancy); the device also publishes a derived presence
 * binary_sensor. Every entity carries a stable `unique_id` from the zone id, an
 * availability topic (so the last will marks them unavailable when the add-on
 * stops), and a `device` block so they group under one Home Assistant device.
 */

/** Home Assistant's default discovery prefix. */
const DISCOVERY_PREFIX = 'homeassistant'
/** The add-on's own topic namespace for state and availability. */
const STATE_PREFIX = 'sense360zonestudio'

/** The single bridge availability topic. The MQTT last will publishes offline here. */
export const AVAILABILITY_TOPIC = `${STATE_PREFIX}/status`

/** Sanitise an id into the `[A-Za-z0-9_-]` set Home Assistant accepts in topics. */
export function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

/** The HA device node id grouping a device's entities. */
export function deviceNode(deviceId: string): string {
  return `sense360zs_${slug(deviceId)}`
}

/** The object id for a zone's occupancy entity. */
export function zoneObjectId(zoneId: string): string {
  return `zone_${slug(zoneId)}`
}

/** The object id for the derived device presence entity. */
export const PRESENCE_OBJECT_ID = 'presence'

export function uniqueId(deviceId: string, objectId: string): string {
  return `${deviceNode(deviceId)}_${objectId}`
}

export function stateTopic(deviceId: string, objectId: string): string {
  return `${STATE_PREFIX}/${slug(deviceId)}/${objectId}/state`
}

export function configTopic(deviceId: string, objectId: string): string {
  return `${DISCOVERY_PREFIX}/binary_sensor/${deviceNode(deviceId)}/${objectId}/config`
}

/** Payloads for the binary state topic, matching the discovery `payload_on/off`. */
export const STATE_ON = 'ON'
export const STATE_OFF = 'OFF'

/** A logical occupancy entity: one zone, or the derived presence. */
export interface EntitySpec {
  objectId: string
  name: string
}

/** The entity spec for a zone's occupancy binary sensor. */
export function zoneEntity(zone: { id: string; name: string }): EntitySpec {
  return { objectId: zoneObjectId(zone.id), name: `${zone.name} occupancy` }
}

/** The entity spec for the device presence binary sensor. */
export function presenceEntity(deviceName: string): EntitySpec {
  return { objectId: PRESENCE_OBJECT_ID, name: `${deviceName} presence` }
}

/**
 * Build the retained discovery config JSON for one entity. The availability topic
 * is shared across the add-on's entities so a single last will marks them all
 * unavailable on stop.
 */
export function discoveryConfig(
  device: { id: string; name: string },
  entity: EntitySpec,
  availabilityTopic: string,
): string {
  return JSON.stringify({
    name: entity.name,
    unique_id: uniqueId(device.id, entity.objectId),
    state_topic: stateTopic(device.id, entity.objectId),
    device_class: 'occupancy',
    payload_on: STATE_ON,
    payload_off: STATE_OFF,
    availability_topic: availabilityTopic,
    payload_available: 'online',
    payload_not_available: 'offline',
    device: {
      identifiers: [deviceNode(device.id)],
      name: `${device.name} zones`,
      manufacturer: 'Sense360',
      model: 'Zone Studio (polygon)',
    },
  })
}
