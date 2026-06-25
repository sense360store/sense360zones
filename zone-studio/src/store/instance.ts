/*
 * Composition root: wire the concrete client to the store, once.
 *
 * Phase 1 runs the app against the Fastify backend. The live client is
 * `HttpZonesClient`: discovery and config over HTTP, the target stream over a
 * WebSocket. The store still needs a synchronous first-paint seed (so there is
 * no load flash), so we construct it from `MockZonesClient.seed()` — structure
 * only — and then replace that state with the backend's data via `hydrate()`
 * once `discover()` and `readConfig()` resolve. The live target animation is the
 * backend's; the frontend no longer simulates on the application path.
 *
 * `MockZonesClient` stays in the tree for tests and offline development. Phase 2
 * changes only the backend's data provider, not this file.
 */
import { HttpZonesClient } from '../client/HttpZonesClient'
import { MockZonesClient } from '../client/MockZonesClient'
import { ZoneStudioStore } from './store'

const client = new HttpZonesClient()

// Synchronous first-paint seed: the device/zone structure only. It is replaced
// by the backend's authoritative config the moment discovery resolves.
const bootstrap = new MockZonesClient().seed()
export const store = new ZoneStudioStore(client, bootstrap)

// Load the real model from the backend over HTTP, then hydrate the store.
void (async () => {
  try {
    const rooms = await client.discover()
    const activeRoomId = rooms[0]?.id ?? bootstrap.activeRoomId
    const activeDeviceId = rooms[0]?.devices[0]?.id ?? bootstrap.activeDeviceId
    const { zones, band } = await client.readConfig(activeDeviceId)
    store.hydrate({ rooms, activeRoomId, activeDeviceId, zones, band })
  } catch (err) {
    // Keep the first-paint seed on the canvas if the backend is unreachable.
    console.error('Zone Studio: backend discovery failed, using bootstrap seed', err)
  }
})()
