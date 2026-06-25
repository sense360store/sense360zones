/*
 * Store contract the UI relies on: a synchronous seed, live target updates from
 * the wired client, and the Phase 1 hydrate() path that swaps the bootstrap seed
 * for backend data.
 */
import { describe, expect, it } from 'vitest'
import { MockZonesClient, type Seed } from '../src/client/MockZonesClient'
import { ZoneStudioStore, isDirty } from '../src/store/store'

describe('ZoneStudioStore', () => {
  it('seeds synchronously from the client', () => {
    const client = new MockZonesClient()
    const store = new ZoneStudioStore(client, client.seed())
    const s = store.getState()
    expect(s.rooms[0].name).toBe('Living Room')
    expect(s.activeDeviceId).toBe('dev-living-1')
    expect(s.zones).toHaveLength(4)
    expect(isDirty(s)).toBe(false)
    store.dispose()
  })

  it('delivers live targets through the wired client', () => {
    const client = new MockZonesClient()
    const store = new ZoneStudioStore(client, client.seed())
    // MockZonesClient delivers the initial frame synchronously on subscribe.
    expect(store.getState().targets).toHaveLength(3)
    store.dispose()
  })

  it('hydrate() replaces the bootstrap state and resets the dirty baseline', () => {
    const client = new MockZonesClient()
    const store = new ZoneStudioStore(client, client.seed())

    const seed: Seed = {
      rooms: [{ id: 'r2', name: 'Studio', devices: [{ id: 'dev-2', name: 'D2', sensors: [] }] }],
      activeRoomId: 'r2',
      activeDeviceId: 'dev-2',
      zones: [{ id: 'zA', name: 'A', type: 'detection', shape: 'rect', cx: 0, cy: 1, w: 1, h: 1, rot: 0 }],
      band: { minR: 0.5, maxR: 3, beam: 40, trigSens: 5, sustSens: 4, reducedRange: 0 },
    }
    store.hydrate(seed)

    const s = store.getState()
    expect(s.activeRoomId).toBe('r2')
    expect(s.activeDeviceId).toBe('dev-2')
    expect(s.zones[0].id).toBe('zA')
    expect(s.band.maxR).toBe(3)
    // The freshly loaded config is the new clean baseline.
    expect(isDirty(s)).toBe(false)
    store.dispose()
  })
})
