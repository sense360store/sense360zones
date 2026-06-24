/*
 * Composition root: wire the concrete client to the store, once.
 *
 * Phase 0 uses the MockZonesClient and its synchronous seed (so the first
 * render already has data — no load flash). To move to a real backend, this is
 * the only file that changes: construct a different ZonesClient and seed the
 * store from `await client.discover()` instead.
 */
import { MockZonesClient } from '../client/MockZonesClient'
import { ZoneStudioStore } from './store'

const client = new MockZonesClient()
export const store = new ZoneStudioStore(client, client.seed())
