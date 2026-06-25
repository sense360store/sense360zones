/*
 * DataProvider — the server-side seam, mirroring the frontend `ZonesClient`.
 *
 * The HTTP/WebSocket routes are thin: they translate requests into calls on a
 * DataProvider and serialise the results. Phase 1 ships only `MockDataProvider`,
 * which owns the simulated rooms and the bouncing-target animation. Phase 2 adds
 * an `HaDataProvider` that talks to Home Assistant, and changes only the provider
 * selection in `index.ts` — the routes and the frontend do not change.
 *
 * The shapes here are the wire contract. They are structurally identical to the
 * frontend's `DeviceConfig` (both reference the same domain `Zone`/`BandConfig`),
 * so a value serialised on either side deserialises cleanly on the other.
 */
import type { BandConfig, Room, Target, Zone } from '../../src/domain/types'

/** The authored configuration for one device's sensors. */
export interface DeviceConfig {
  zones: Zone[]
  band: BandConfig
}

export type TargetListener = (targets: Target[]) => void
export type Unsubscribe = () => void

export interface DataProvider {
  /** Discover rooms, devices and sensors. */
  discover(): Promise<Room[]>

  /** Read the device config (zones + band) for a device. */
  readConfig(deviceId: string): Promise<DeviceConfig>

  /** Persist zone/band config for a device. Phase 1 keeps it in memory. */
  writeConfig(deviceId: string, config: DeviceConfig): Promise<void>

  /**
   * Subscribe to the live LD2450 target stream for a device. Calls `onSample`
   * with the current targets immediately and on every update; the returned
   * function unsubscribes.
   */
  subscribeTargets(deviceId: string, onSample: TargetListener): Unsubscribe

  /** Release timers and connections. Called on server shutdown. */
  dispose?(): void
}
