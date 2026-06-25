/*
 * ZonesClient — the seam every real integration plugs into.
 *
 * Phase 0 ships a single `MockZonesClient` that returns today's simulated data.
 * Later phases swap in a client that talks to the Fastify backend / Home
 * Assistant WebSocket API without the UI changing: discovery, the live target
 * stream, and the read/write config path all flow through this interface.
 */
import type { BandConfig, Room, Target, Zone } from '../domain/types'

/** The authored configuration for one device's sensors. */
export interface DeviceConfig {
  zones: Zone[]
  band: BandConfig
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
