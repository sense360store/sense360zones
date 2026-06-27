/*
 * Store contract the UI relies on: a synchronous seed, live target updates from
 * the wired client, and the Phase 1 hydrate() path that swaps the bootstrap seed
 * for backend data.
 */
import { describe, expect, it } from 'vitest'
import { MockZonesClient, type Seed } from '../src/client/MockZonesClient'
import { ZoneStudioStore, isDirty } from '../src/store/store'
import type { DeviceConfig, TargetListener, Unsubscribe, ZonesClient } from '../src/client/ZonesClient'
import type { BandConfig, Device, DeviceCandidate, Room, Sensor } from '../src/domain/types'

const DEFAULT_BAND: BandConfig = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }
const emptySeed: Seed = { rooms: [], activeRoomId: '', activeDeviceId: '', zones: [], band: DEFAULT_BAND }
const mount = { surface: 'wall' as const, height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }

const ldSensor: Sensor = { id: 'ld', name: 'HLK LD2450', kind: 'ld2450', mount, fovHalf: 60, range: 6, zones: [] }
const senSensor: Sensor = { id: 'sen', name: 'DFRobot SEN0609', kind: 'sen0609', mount, band: DEFAULT_BAND }

function candidate(over: Partial<DeviceCandidate> = {}): DeviceCandidate {
  return { kind: null, confidence: 'none', confirmed: false, dismissed: false, sense360: false, roles: [], ...over }
}

function makeRoom(device: Device): Room {
  return { id: 'r', name: 'Room', devices: [device] }
}

/** A controllable client for the discovery-driven store paths. */
class FakeClient implements ZonesClient {
  writes: Array<{ deviceId: string; config: DeviceConfig }> = []
  constructor(public rooms: Room[]) {}
  async discover(): Promise<Room[]> {
    return this.rooms
  }
  async readConfig(): Promise<DeviceConfig> {
    return { zones: [], band: DEFAULT_BAND }
  }
  async writeConfig(deviceId: string, config: DeviceConfig): Promise<void> {
    this.writes.push({ deviceId, config })
  }
  streamTargets(_deviceId: string, onSample: TargetListener): Unsubscribe {
    onSample([])
    return () => {}
  }
}

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

describe('layers and selection derive from the device sensors', () => {
  it('a device with both sensors exposes both kinds', async () => {
    const client = new FakeClient([makeRoom({ id: 'd', name: 'D', sensors: [ldSensor, senSensor], candidate: candidate({ kind: 'ld2450', confidence: 'confident' }) })])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    expect(store.getState().sensors).toEqual(['ld2450', 'sen0609'])
    store.dispose()
  })

  it('a SEN0609-only device selects the band and exposes only sen0609', async () => {
    const client = new FakeClient([makeRoom({ id: 'd', name: 'D', sensors: [senSensor], candidate: candidate({ kind: 'sen0609', confidence: 'confident' }) })])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    const s = store.getState()
    expect(s.sensors).toEqual(['sen0609'])
    expect(s.sel.kind).toBe('sen')
    store.dispose()
  })

  it('a device with no confirmed sensor opens the mapping surface', async () => {
    const client = new FakeClient([makeRoom({ id: 'd', name: 'D', sensors: [], candidate: candidate({ kind: null }) })])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    const s = store.getState()
    expect(s.sensors).toEqual([])
    expect(s.candidate?.kind).toBeNull()
    expect(s.sel.kind).toBe('device')
    store.dispose()
  })
})

describe('mapping confirmation actions', () => {
  it('confirmDevice sends a kind confirmation through the write path', async () => {
    const client = new FakeClient([makeRoom({ id: 'd', name: 'D', sensors: [], candidate: candidate() })])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    await store.confirmDevice('ld2450')
    expect(client.writes.at(-1)).toMatchObject({ deviceId: 'd', config: { mapping: { kind: 'ld2450', confirmed: true } } })
    store.dispose()
  })

  it('dismissDevice sends a dismissal through the write path', async () => {
    const client = new FakeClient([makeRoom({ id: 'd', name: 'D', sensors: [], candidate: candidate() })])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    await store.dismissDevice()
    expect(client.writes.at(-1)).toMatchObject({ deviceId: 'd', config: { mapping: { dismissed: true } } })
    store.dispose()
  })

  it('correctRole reassigns a single role through the write path', async () => {
    const client = new FakeClient([makeRoom({ id: 'd', name: 'D', sensors: [senSensor], candidate: candidate({ kind: 'sen0609' }) })])
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    await store.correctRole('distance', 'sensor.new_distance')
    expect(client.writes.at(-1)).toMatchObject({ deviceId: 'd', config: { mapping: { roles: { distance: 'sensor.new_distance' } } } })
    store.dispose()
  })
})
