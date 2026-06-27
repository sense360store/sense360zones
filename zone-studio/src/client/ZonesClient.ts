/*
 * ZonesClient — the seam every real integration plugs into.
 *
 * Phase 0 ships a single `MockZonesClient` that returns today's simulated data.
 * Later phases swap in a client that talks to the Fastify backend / Home
 * Assistant WebSocket API without the UI changing: discovery, the live target
 * stream, and the read/write config path all flow through this interface.
 */
import type { BandConfig, MappingUpdate, Room, SensorMount, Target, Zone } from '../domain/types'

/**
 * The authored configuration for one device's sensors. Mirrors the server's
 * `DeviceConfig` (see server/provider/DataProvider.ts), so a value serialised on
 * either side deserialises cleanly on the other.
 *
 * `mount` is calibration persisted app-side (Phase 2): the LD2450 cannot report
 * its own placement, so it rides on this payload to round-trip through the
 * existing read/write path. It is optional so the mock client can omit it.
 */
export interface DeviceConfig {
  zones: Zone[]
  band: BandConfig
  mount?: SensorMount
  /**
   * Whether the MQTT publish path is available for this device's polygon zones
   * (Phase 4). Set by the backend on a polygon-profile device, undefined otherwise.
   * The editor surfaces it so the user knows the live entities require the Home
   * Assistant MQTT integration. It rides on the read payload, so the client
   * contract is unchanged.
   */
  mqttAvailable?: boolean
  /**
   * A mapping confirmation, correction, or dismissal. When present on a write the
   * backend persists it as the device's mapping override and ignores the
   * zones/band, so confirmation rides on the existing write path. Mirrors the
   * server's `DeviceConfig.mapping`.
   */
  mapping?: MappingUpdate
}

export type TargetListener = (targets: Target[]) => void
export type Unsubscribe = () => void

export interface ZonesClient {
  /** Discover rooms, devices and sensors. (Phase 2: real HA discovery.) */
  discover(): Promise<Room[]>

  /** Read the live device config (zones + band) for a device. (Phase 2/3.) */
  readConfig(deviceId: string): Promise<DeviceConfig>

  /** Write zone/band config to the device. (Phase 3: real apply path.) */
  writeConfig(deviceId: string, config: DeviceConfig): Promise<void>

  /**
   * Subscribe to the live LD2450 target stream for a device. Calls `onSample`
   * with the current targets immediately and on every update; the returned
   * function unsubscribes.
   */
  streamTargets(deviceId: string, onSample: TargetListener): Unsubscribe
}
