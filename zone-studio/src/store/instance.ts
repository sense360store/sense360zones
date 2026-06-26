/*
 * Composition root: wire the concrete client to the store, once.
 *
 * The app runs against the Fastify backend through `HttpZonesClient`. Unlike
 * Phase 1, the store is no longer seeded with simulated data: the first paint is
 * an honest "connecting" state with no model, and `refresh()` then loads the real
 * model and sets the connection state (connected, no-devices, or offline). The
 * production path never falls back to mock targets to hide a Home Assistant
 * failure.
 *
 * Development against the mock provider uses the same path: run the backend with
 * PROVIDER=mock (the default for `npm run dev`) and the mock data arrives over the
 * real HTTP and WebSocket transport, not from a frontend stand-in.
 */
import { HttpZonesClient } from '../client/HttpZonesClient'
import type { Seed } from '../client/MockZonesClient'
import type { BandConfig } from '../domain/types'
import { ZoneStudioStore } from './store'

const client = new HttpZonesClient()

/** A neutral band so the canvas has valid values to draw before discovery. */
const DEFAULT_BAND: BandConfig = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }

// Empty first-paint seed: no rooms, no zones. The store starts in the connecting
// state and renders the connection overlay until refresh() resolves.
const emptySeed: Seed = { rooms: [], activeRoomId: '', activeDeviceId: '', zones: [], band: DEFAULT_BAND }
export const store = new ZoneStudioStore(client, emptySeed)

void store.refresh()
