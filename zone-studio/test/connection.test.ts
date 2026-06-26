/*
 * The frontend connection-state model and the room/device picker.
 *
 * These drive the store through a stub client (the same seam HttpZonesClient
 * implements) to prove: discovery sets connected / no-devices / offline honestly,
 * the production path never falls back to mock targets on a failure, the picker
 * switches the active device and re-subscribes, and the overlay copy renders for
 * each state.
 */
import { describe, expect, it, vi } from 'vitest'
import { ZoneStudioStore } from '../src/store/store'
import { connectionView } from '../src/panels/ConnectionOverlay'
import type { DeviceConfig, TargetListener, Unsubscribe, ZonesClient } from '../src/client/ZonesClient'
import type { Seed } from '../src/client/MockZonesClient'
import type { Room, Target } from '../src/domain/types'

const BAND = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }
const emptySeed: Seed = { rooms: [], activeRoomId: '', activeDeviceId: '', zones: [], band: BAND }

function room(id: string, deviceIds: string[]): Room {
  return { id, name: id, devices: deviceIds.map((d) => ({ id: d, name: d, sensors: [] })) }
}

class StubClient implements ZonesClient {
  discover = vi.fn<[], Promise<Room[]>>(async () => [])
  readConfig = vi.fn(async (_id: string): Promise<DeviceConfig> => ({ zones: [], band: BAND }))
  writeConfig = vi.fn(async () => {})
  streamCalls: string[] = []
  lastOnSample: TargetListener | null = null
  streamTargets(deviceId: string, onSample: TargetListener): Unsubscribe {
    this.streamCalls.push(deviceId)
    this.lastOnSample = onSample
    return () => {}
  }
}

describe('connection state via refresh()', () => {
  it('starts connecting with an empty seed and no live subscription', () => {
    const client = new StubClient()
    const store = new ZoneStudioStore(client, emptySeed)
    expect(store.getState().connection).toBe('connecting')
    // No device, so no target stream is opened.
    expect(client.streamCalls).toEqual([])
    store.dispose()
  })

  it('reaches connected and subscribes the active device', async () => {
    const client = new StubClient()
    client.discover.mockResolvedValue([room('r1', ['d1'])])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    const s = store.getState()
    expect(s.connection).toBe('connected')
    expect(s.activeDeviceId).toBe('d1')
    expect(client.streamCalls).toContain('d1')
    store.dispose()
  })

  it('reaches no-devices when Home Assistant has no sensor devices', async () => {
    const client = new StubClient()
    client.discover.mockResolvedValue([room('r1', [])])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    expect(store.getState().connection).toBe('no-devices')
    store.dispose()
  })

  it('reaches offline on a discovery failure and shows no mock targets', async () => {
    const client = new StubClient()
    client.discover.mockRejectedValue(new Error('unreachable'))
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    const s = store.getState()
    expect(s.connection).toBe('offline')
    expect(s.targets).toEqual([])
    expect(s.rooms).toEqual([])
    store.dispose()
  })
})

describe('room/device picker', () => {
  it('switches the active device and re-subscribes the target stream', async () => {
    const client = new StubClient()
    client.discover.mockResolvedValue([room('r1', ['d1', 'd2'])])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    expect(store.getState().activeDeviceId).toBe('d1')

    store.selectDevice('d2')
    expect(store.getState().activeDeviceId).toBe('d2')
    // d1 on connect, then d2 on selection.
    expect(client.streamCalls).toEqual(['d1', 'd2'])

    // Targets from the newly subscribed device flow into state.
    const frame: Target[] = [{ id: 't1', x: 1, y: 2, vx: 0, vy: 0, color: '#fff', trail: [] }]
    client.lastOnSample?.(frame)
    expect(store.getState().targets).toEqual(frame)
    store.dispose()
  })

  it('switches rooms and selects the new room first device', async () => {
    const client = new StubClient()
    client.discover.mockResolvedValue([room('r1', ['d1']), room('r2', ['d2'])])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()

    store.setActiveRoom('r2')
    const s = store.getState()
    expect(s.activeRoomId).toBe('r2')
    expect(s.activeDeviceId).toBe('d2')
    store.dispose()
  })
})

describe('connectionView', () => {
  it('renders nothing when connected', () => {
    expect(connectionView('connected')).toBeNull()
  })

  it('renders a spinner and no retry while connecting', () => {
    const v = connectionView('connecting')!
    expect(v.showSpinner).toBe(true)
    expect(v.showRetry).toBe(false)
  })

  it('offers a retry for offline and no-devices', () => {
    expect(connectionView('offline')!.showRetry).toBe(true)
    expect(connectionView('no-devices')!.showRetry).toBe(true)
  })
})
