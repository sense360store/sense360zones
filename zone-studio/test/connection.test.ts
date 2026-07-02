/*
 * The frontend connection-state model and the room/device picker.
 *
 * These drive the store through a stub client (the same seam HttpZonesClient
 * implements) to prove: discovery sets connected / no-devices / offline honestly,
 * the production path never falls back to mock targets on a failure, the picker
 * switches the active device and re-subscribes, and the overlay copy renders for
 * each state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoneStudioStore, isDirty } from '../src/store/store'
import { connectionView } from '../src/panels/ConnectionOverlay'
import type { DeviceConfig, ProviderStatus, TargetListener, Unsubscribe, ZonesClient } from '../src/client/ZonesClient'
import type { Seed } from '../src/client/MockZonesClient'
import type { Room, Sensor, Target } from '../src/domain/types'

const BAND = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }
const emptySeed: Seed = { rooms: [], activeRoomId: '', activeDeviceId: '', zones: [], band: BAND }
const mount = { surface: 'wall' as const, height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }
const ldSensor: Sensor = { id: 'ld', name: 'HLK LD2450', kind: 'ld2450', mount, fovHalf: 60, range: 6, zones: [] }

function room(id: string, deviceIds: string[], sensors: Sensor[] = []): Room {
  return { id, name: id, devices: deviceIds.map((d) => ({ id: d, name: d, sensors })) }
}

class StubClient implements ZonesClient {
  discover = vi.fn<[], Promise<Room[]>>(async () => [])
  readConfig = vi.fn(async (_id: string): Promise<DeviceConfig> => ({ zones: [], band: BAND }))
  writeConfig = vi.fn(async () => {})
  status = vi.fn(async (): Promise<ProviderStatus> => ({ ha: 'connected', mqtt: null }))
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

describe('auto recovery', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns from offline to connected on its own when discovery succeeds again', async () => {
    vi.useFakeTimers()
    const client = new StubClient()
    client.discover.mockRejectedValue(new Error('unreachable'))
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    expect(store.getState().connection).toBe('offline')

    store.startAutoRecovery({ retryMs: 10, heartbeatMs: 10 })
    // Still failing: the retry is silent, so the state never flickers to connecting.
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getState().connection).toBe('offline')

    client.discover.mockResolvedValue([room('r1', ['d1'])])
    await vi.advanceTimersByTimeAsync(10)
    const s = store.getState()
    expect(s.connection).toBe('connected')
    expect(s.activeDeviceId).toBe('d1')
    expect(client.streamCalls).toContain('d1')
    store.dispose()
  })

  it('opens the editor on its own when a device appears after no-devices', async () => {
    vi.useFakeTimers()
    const client = new StubClient()
    client.discover.mockResolvedValue([room('r1', [])])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    expect(store.getState().connection).toBe('no-devices')

    store.startAutoRecovery({ retryMs: 10, heartbeatMs: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getState().connection).toBe('no-devices')

    client.discover.mockResolvedValue([room('r1', ['d1'])])
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getState().connection).toBe('connected')
    store.dispose()
  })

  it('notices a dropped connection via the heartbeat (after the grace) and recovers', async () => {
    vi.useFakeTimers()
    const client = new StubClient()
    client.discover.mockResolvedValue([room('r1', ['d1'])])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    expect(store.getState().connection).toBe('connected')

    store.startAutoRecovery({ retryMs: 10, heartbeatMs: 10, gracePolls: 2 })
    client.status.mockRejectedValue(new Error('backend gone'))
    client.discover.mockRejectedValue(new Error('backend gone'))
    // One bad poll sits inside the grace: no flicker on a reconnect blip.
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getState().connection).toBe('connected')
    // The second consecutive failure is real: offline, live targets cleared.
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getState().connection).toBe('offline')
    expect(store.getState().targets).toEqual([])

    // The condition clears: the loop re-discovers and returns to the live view.
    client.status.mockResolvedValue({ ha: 'connected', mqtt: null })
    client.discover.mockResolvedValue([room('r1', ['d1'])])
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getState().connection).toBe('connected')
    store.dispose()
  })

  it('treats a backend whose Home Assistant link is down as offline', async () => {
    vi.useFakeTimers()
    const client = new StubClient()
    client.discover.mockResolvedValue([room('r1', ['d1'])])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()

    store.startAutoRecovery({ retryMs: 10, heartbeatMs: 10, gracePolls: 1 })
    client.status.mockResolvedValue({ ha: 'connecting', mqtt: null })
    client.discover.mockRejectedValue(new Error('HA restarting'))
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getState().connection).toBe('offline')
    store.dispose()
  })

  it('surfaces MQTT coming online for the active polygon device', async () => {
    vi.useFakeTimers()
    const client = new StubClient()
    client.discover.mockResolvedValue([room('r1', ['d1'])])
    client.readConfig.mockResolvedValue({ zones: [], band: BAND, mqttAvailable: false })
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    expect(store.getState().mqttAvailable).toBe(false)

    store.startAutoRecovery({ retryMs: 10, heartbeatMs: 10 })
    client.status.mockResolvedValue({ ha: 'connected', mqtt: true })
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getState().mqttAvailable).toBe(true)
    store.dispose()
  })

  it('keeps dirty edits and the selection across a background reconnect', async () => {
    vi.useFakeTimers()
    const client = new StubClient()
    client.discover.mockResolvedValue([room('r1', ['d1'], [ldSensor])])
    client.readConfig.mockResolvedValue({
      zones: [{ id: 'z1', name: 'Zone A', type: 'detection', shape: 'rect', cx: 0, cy: 1, w: 1, h: 1, rot: 0 }],
      band: BAND,
    })
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()

    // The user edits a zone and moves the selection off the default.
    store.renameZone('z1', 'My desk')
    store.selectLd()
    expect(isDirty(store.getState())).toBe(true)

    // Home Assistant drops, then comes back.
    store.startAutoRecovery({ retryMs: 10, heartbeatMs: 10, gracePolls: 1 })
    client.status.mockRejectedValue(new Error('gone'))
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getState().connection).toBe('offline')
    client.status.mockResolvedValue({ ha: 'connected', mqtt: null })
    await vi.advanceTimersByTimeAsync(10)

    const s = store.getState()
    expect(s.connection).toBe('connected')
    // The edit survived the reconnect, still dirty against the device baseline.
    expect(s.zones[0].name).toBe('My desk')
    expect(isDirty(s)).toBe(true)
    // The selection was not reset to the default zone selection.
    expect(s.sel).toEqual({ kind: 'ld' })
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

  it('tells the user the offline and no-devices states recover on their own', () => {
    expect(connectionView('offline')!.hint).toMatch(/automatically/i)
    expect(connectionView('no-devices')!.hint).toMatch(/automatically/i)
  })
})
