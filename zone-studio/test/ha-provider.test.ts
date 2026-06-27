/*
 * HaDataProvider end to end against the WebSocket simulator: authentication,
 * discovery into the Room/Device/Sensor model, live target streaming in the room
 * frame and metres, empty-slot and unavailable filtering, an applied mapping
 * override, the mount round-trip through DATA_DIR, and reconnect after a drop.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HaDataProvider } from '../server/provider/HaDataProvider'
import { Persistence } from '../server/persistence'
import type { Target } from '../src/domain/types'
import type { SensorMount } from '../src/domain/types'
import { HaSim, startHaSim } from './ha-sim'
import { LD } from './ha-fixtures'
import type { Room } from '../src/domain/types'

const allDevices = (rooms: Room[]) => rooms.flatMap((r) => r.devices)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await sleep(10)
  }
}

const mm = { unit_of_measurement: 'mm' }

let sim: HaSim
const providers: HaDataProvider[] = []
const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zone-studio-ha-'))
  dirs.push(dir)
  return dir
}

function makeProvider(dataDir = tempDir(), token = 'test-token', url = sim.url): HaDataProvider {
  const provider = new HaDataProvider({ wsUrl: url, token, dataDir, reconnectBaseMs: 40, timeoutMs: 2000 })
  providers.push(provider)
  return provider
}

beforeEach(async () => {
  sim = await startHaSim()
})

afterEach(async () => {
  for (const p of providers) p.dispose()
  providers.length = 0
  dirs.length = 0
  await sim.close()
})

describe('HaDataProvider against the simulator', () => {
  it('authenticates and discovers the room, device and sensor model', async () => {
    const provider = makeProvider()
    const rooms = await provider.discover()

    expect(rooms.map((r) => r.name).sort()).toEqual(['Bedroom', 'Living Room'])

    const living = rooms.find((r) => r.name === 'Living Room')!
    expect(living.devices).toHaveLength(1)
    const ld = living.devices[0].sensors[0]
    expect(ld.kind).toBe('ld2450')
    if (ld.kind === 'ld2450') {
      expect(ld.fovHalf).toBe(60)
      expect(ld.range).toBe(6)
    }

    const bedroom = rooms.find((r) => r.name === 'Bedroom')!
    const sen = bedroom.devices[0].sensors[0]
    expect(sen.kind).toBe('sen0609')
    expect(sen.kind === 'sen0609' && sen.band.maxR).toBeTruthy()
  })

  it('emits an immediate frame and only real targets (no phantom at the origin)', async () => {
    const provider = makeProvider()
    await provider.discover()

    const frames: Target[][] = []
    const unsub = provider.subscribeTargets('dev_ld', (t) => frames.push(t))

    // The first frame is synchronous. Target 1 is occupied; target 2 is at (0,0)
    // and target 3 is unavailable, so neither appears.
    expect(frames).toHaveLength(1)
    expect(frames[0]).toHaveLength(1)
    expect(frames[0][0]).toMatchObject({ id: 't1', x: -1.5, y: 1.8 })
    unsub()
  })

  it('streams scripted frames in the room frame and metres', async () => {
    const provider = makeProvider()
    await provider.discover()
    const frames: Target[][] = []
    const unsub = provider.subscribeTargets('dev_ld', (t) => frames.push(t))
    await sleep(40) // let the subscription register on the simulator

    sim.emitState(LD.t1x, '1000', mm)
    sim.emitState(LD.t1y, '2000', mm)
    sim.emitState(LD.t2x, '500', mm)
    sim.emitState(LD.t2y, '1200', mm)

    await waitFor(() => (frames.at(-1)?.length ?? 0) === 2)
    const last = frames.at(-1)!
    expect(last.find((t) => t.id === 't1')).toMatchObject({ x: 1, y: 2 })
    expect(last.find((t) => t.id === 't2')).toMatchObject({ x: 0.5, y: 1.2 })
    unsub()
  })

  it('converts centimetre units on the live path', async () => {
    const provider = makeProvider()
    await provider.discover()
    const frames: Target[][] = []
    const unsub = provider.subscribeTargets('dev_ld', (t) => frames.push(t))
    await sleep(40)

    sim.emitState(LD.t1x, '150', { unit_of_measurement: 'cm' })
    sim.emitState(LD.t1y, '250', { unit_of_measurement: 'cm' })
    await waitFor(() => {
      const t1 = frames.at(-1)?.find((t) => t.id === 't1')
      return !!t1 && Math.abs(t1.x - 1.5) < 1e-9 && Math.abs(t1.y - 2.5) < 1e-9
    })
    unsub()
  })

  it('drops a target when its slot returns to 0,0 or goes unavailable', async () => {
    const provider = makeProvider()
    await provider.discover()
    const frames: Target[][] = []
    const unsub = provider.subscribeTargets('dev_ld', (t) => frames.push(t))
    await sleep(40)

    sim.emitState(LD.t1x, '0', mm)
    sim.emitState(LD.t1y, '0', mm)
    await waitFor(() => (frames.at(-1)?.length ?? -1) === 0)
    unsub()
  })

  it('returns no spatial stream for a SEN0609 device', async () => {
    const provider = makeProvider()
    await provider.discover()
    const frames: Target[][] = []
    const unsub = provider.subscribeTargets('dev_sen', (t) => frames.push(t))
    expect(frames).toEqual([[]])
    unsub()
  })

  it('offers only ESPHome radar devices and excludes trackers and motion sensors', async () => {
    const provider = makeProvider()
    const rooms = await provider.discover()
    const ids = allDevices(rooms).map((d) => d.id)

    // The two ESPHome radar devices are offered.
    expect(ids).toContain('dev_ld')
    expect(ids).toContain('dev_sen')
    // The cat and the Zigbee motion sensor never appear as candidates.
    expect(ids).not.toContain('dev_cat')
    expect(ids).not.toContain('dev_motion')
    expect(allDevices(rooms).some((d) => d.name === 'Silver')).toBe(false)
  })

  it('reports the detected kind and a confidence indicator per candidate', async () => {
    const provider = makeProvider()
    const rooms = await provider.discover()
    const ld = allDevices(rooms).find((d) => d.id === 'dev_ld')!
    const sen = allDevices(rooms).find((d) => d.id === 'dev_sen')!

    expect(ld.candidate).toMatchObject({ kind: 'ld2450', confidence: 'confident', confirmed: false, dismissed: false })
    expect(ld.candidate?.node).toBe('ld-aabbcc')
    expect(ld.candidate?.roles.find((r) => r.key === 'target1x')?.entityId).toBe(LD.t1x)

    expect(sen.candidate).toMatchObject({ kind: 'sen0609', confidence: 'confident' })
    expect(sen.candidate?.roles.find((r) => r.key === 'distance')?.entityId).toBe('sensor.bedroom_distance')
    // Today's fixtures declare no Sense360 identity, so the prefilter does not mark them.
    expect(sen.candidate?.sense360).toBe(false)
  })

  it('persists a confirmation written through the mapping channel', async () => {
    const dir = tempDir()
    const first = makeProvider(dir)
    await first.discover()
    // Correct dev_ld to a SEN0609 through the mapping channel.
    await first.writeConfig('dev_ld', {
      zones: [],
      band: (await first.readConfig('dev_ld')).band,
      mapping: { kind: 'sen0609' },
    })
    first.dispose()

    const second = makeProvider(dir)
    const rooms = await second.discover()
    const ld = allDevices(rooms).find((d) => d.id === 'dev_ld')!
    expect(ld.sensors[0].kind).toBe('sen0609')
    expect(ld.candidate?.confirmed).toBe(true)
  })

  it('keeps a dismissed device hidden across a restart', async () => {
    const dir = tempDir()
    const first = makeProvider(dir)
    await first.discover()
    await first.writeConfig('dev_sen', {
      zones: [],
      band: (await first.readConfig('dev_sen')).band,
      mapping: { dismissed: true },
    })
    first.dispose()

    const second = makeProvider(dir)
    const rooms = await second.discover()
    expect(allDevices(rooms).some((d) => d.id === 'dev_sen')).toBe(false)
  })

  it('applies a persisted mapping override during discovery', async () => {
    const dir = tempDir()
    new Persistence(dir).setMapping('dev_ld', { kind: 'sen0609' })

    const provider = makeProvider(dir)
    const rooms = await provider.discover()
    const dev = rooms.flatMap((r) => r.devices).find((d) => d.id === 'dev_ld')!
    expect(dev.sensors[0].kind).toBe('sen0609')

    // And with the override in force the device has no live spatial stream.
    const frames: Target[][] = []
    provider.subscribeTargets('dev_ld', (t) => frames.push(t))
    expect(frames).toEqual([[]])
  })

  it('round-trips the mount through DATA_DIR and applies it in discover()', async () => {
    const dir = tempDir()
    const mount: SensorMount = { surface: 'ceiling', height: 2.4, origin: { x: 0.5, y: -0.3 }, boresight: 15 }

    const first = makeProvider(dir)
    await first.discover()
    await first.writeConfig('dev_ld', { zones: [], band: (await first.readConfig('dev_ld')).band, mount })
    first.dispose()

    const second = makeProvider(dir)
    expect((await second.readConfig('dev_ld')).mount).toEqual(mount)
    const rooms = await second.discover()
    const ld = rooms.flatMap((r) => r.devices).find((d) => d.id === 'dev_ld')!.sensors[0]
    expect(ld.mount).toEqual(mount)
  })

  it('reconnects, re-authenticates and resumes streaming after the socket drops', async () => {
    const provider = makeProvider()
    await provider.discover()
    const frames: Target[][] = []
    const unsub = provider.subscribeTargets('dev_ld', (t) => frames.push(t))
    await sleep(40)
    const before = frames.length

    sim.dropConnections()
    await waitFor(() => provider.connectionState() === 'connected')

    // Keep nudging the target until the re-established subscription delivers it.
    let resumed = false
    for (let i = 0; i < 40 && !resumed; i++) {
      sim.emitState(LD.t1x, '1234', mm)
      sim.emitState(LD.t1y, '2345', mm)
      await sleep(50)
      const t1 = frames.at(-1)?.find((t) => t.id === 't1')
      resumed = frames.length > before && !!t1 && Math.abs(t1.x - 1.234) < 1e-6
    }
    expect(resumed).toBe(true)
    unsub()
  })

  it('rejects discovery when the token is wrong (fatal auth error)', async () => {
    await sim.close()
    sim = await startHaSim({ token: 'the-right-token' })
    const provider = makeProvider(tempDir(), 'the-wrong-token')
    await expect(provider.discover()).rejects.toThrow()
  })
})
