/*
 * Profile-aware apply, end to end against the WebSocket simulator and the fake
 * MQTT publisher:
 *   - a polygon Apply clears the native regions, sets report-all (Disabled), and
 *     activates the published entities; it never writes a native region;
 *   - readConfig returns the persisted active config (the truth for a polygon
 *     device) and surfaces whether MQTT is publishing;
 *   - a scripted target path through an L-shaped detection zone produces the
 *     expected published occupancy transitions;
 *   - switching back to a native set writes registers again, clears the polygon
 *     entities, and makes the hardware the truth once more;
 *   - with MQTT unavailable the device still applies and reads, the canvas preview
 *     still streams, and the state reports MQTT as required;
 *   - a device persisted as polygon re-activates its entities on the next discover.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HaDataProvider } from '../server/provider/HaDataProvider'
import { FakeMqttPublisher, type MqttPublisherFactory } from '../server/mqtt/MqttPublisher'
import { configTopic, stateTopic, zoneObjectId, PRESENCE_OBJECT_ID } from '../server/mqtt/discovery'
import type { BandConfig, PolyZone, RectZone, SensorMount } from '../src/domain/types'
import { HaSim, startHaSim } from './ha-sim'
import { LD, LDZ } from './ha-fixtures'

const band: BandConfig = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }
const mount: SensorMount = { surface: 'wall', height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }
const mm = { unit_of_measurement: 'mm' }
const num = (sim: HaSim, id: string): number => Number(sim.peek(id))
const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** An L-shaped detection zone in room metres: a forward band plus a left column. */
const lZone: PolyZone = {
  id: 'zL',
  name: 'L run',
  type: 'detection',
  shape: 'poly',
  pts: [
    { x: -1, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
    { x: 0, y: 3 },
    { x: -1, y: 3 },
  ],
}

const rect = (over: Partial<RectZone> = {}): RectZone => ({
  id: 'n',
  name: 'Native',
  type: 'detection',
  shape: 'rect',
  cx: 0,
  cy: 2,
  w: 1,
  h: 1,
  rot: 0,
  ...over,
})

let sim: HaSim
const providers: HaDataProvider[] = []

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'zone-studio-poly-'))
}

interface MadeProvider {
  provider: HaDataProvider
  pub: () => FakeMqttPublisher | null
}

function makeProvider(dataDir = tempDir(), factory?: MqttPublisherFactory): MadeProvider {
  const ref: { pub: FakeMqttPublisher | null } = { pub: null }
  const mqttFactory: MqttPublisherFactory =
    factory ??
    (async (topic) => {
      ref.pub = new FakeMqttPublisher(topic)
      return ref.pub
    })
  const provider = new HaDataProvider({
    wsUrl: sim.url,
    token: 'test-token',
    dataDir,
    reconnectBaseMs: 40,
    timeoutMs: 2000,
    mqttFactory,
    occupancyDebounceMs: { on: 0, off: 0 },
  })
  providers.push(provider)
  return { provider, pub: () => ref.pub }
}

/** Move the simulator's target 1 to a room position (metres). */
function moveTarget(xM: number, yM: number): void {
  sim.emitState(LD.t1x, String(Math.round(xM * 1000)), mm)
  sim.emitState(LD.t1y, String(Math.round(yM * 1000)), mm)
}

beforeEach(async () => {
  sim = await startHaSim()
})

afterEach(async () => {
  for (const p of providers) p.dispose()
  providers.length = 0
  await sim.close()
})

describe('polygon Apply (report-all + live occupancy)', () => {
  it('clears native regions, disables the mode, and publishes discovery for each zone and presence', async () => {
    const { provider, pub } = makeProvider()
    await provider.discover()
    // Seed a native region + mode first, so report-all has something to clear.
    await provider.writeConfig('dev_ld', { zones: [rect()], band, mount })
    expect(sim.peek(LDZ.zoneType)).toBe('Detection')

    await provider.writeConfig('dev_ld', { zones: [lZone], band, mount })

    // Report-all: the mode is Disabled and every region slot is cleared.
    expect(sim.peek(LDZ.zoneType)).toBe('Disabled')
    expect([num(sim, LDZ.z1x1), num(sim, LDZ.z1y1), num(sim, LDZ.z1x2), num(sim, LDZ.z1y2)]).toEqual([0, 0, 0, 0])

    // Entities activated: retained discovery for the zone and the presence.
    const publisher = pub()!
    expect(publisher).not.toBeNull()
    const zoneCfg = publisher.last(configTopic('dev_ld', zoneObjectId('zL')))
    expect(zoneCfg?.retain).toBe(true)
    expect(JSON.parse(zoneCfg!.payload).name).toBe('L run occupancy')
    expect(publisher.last(configTopic('dev_ld', PRESENCE_OBJECT_ID))).toBeDefined()
  })

  it('readConfig returns the persisted polygon set and reports MQTT available', async () => {
    const { provider } = makeProvider()
    await provider.discover()
    await provider.writeConfig('dev_ld', { zones: [lZone], band, mount })

    const cfg = await provider.readConfig('dev_ld')
    expect(cfg.zones).toHaveLength(1)
    expect(cfg.zones[0]).toMatchObject({ id: 'zL', shape: 'poly' })
    expect(cfg.mqttAvailable).toBe(true)
  })

  it('publishes the expected occupancy transitions for a target path through the L', async () => {
    const { provider, pub } = makeProvider()
    await provider.discover()
    await provider.writeConfig('dev_ld', { zones: [lZone], band, mount })
    const publisher = pub()!
    const topic = stateTopic('dev_ld', zoneObjectId('zL'))
    await tick() // let the live target subscription register at the simulator

    moveTarget(0.5, 1.5) // inside the forward band
    await tick()
    expect(publisher.last(topic)?.payload).toBe('ON')

    moveTarget(0.5, 2.5) // into the removed notch
    await tick()
    expect(publisher.last(topic)?.payload).toBe('OFF')

    moveTarget(-0.5, 2.5) // into the left column
    await tick()
    expect(publisher.last(topic)?.payload).toBe('ON')

    moveTarget(2.5, 2.5) // out of the shape entirely
    await tick()
    expect(publisher.last(topic)?.payload).toBe('OFF')
  })
})

describe('switching a polygon device back to native', () => {
  it('writes registers again, clears the polygon entities, and reads the hardware truth', async () => {
    const { provider, pub } = makeProvider()
    await provider.discover()
    await provider.writeConfig('dev_ld', { zones: [lZone], band, mount })
    const publisher = pub()!

    // Re-apply a native-eligible single rectangle.
    await provider.writeConfig('dev_ld', { zones: [rect({ id: 'a', cx: 0, cy: 2, w: 1, h: 2 })], band, mount })
    expect(sim.peek(LDZ.zoneType)).toBe('Detection')
    expect([num(sim, LDZ.z1x1), num(sim, LDZ.z1y1), num(sim, LDZ.z1x2), num(sim, LDZ.z1y2)]).toEqual([-500, 1000, 500, 3000])

    // The polygon zone's retained discovery config was cleared (empty payload).
    expect(publisher.last(configTopic('dev_ld', zoneObjectId('zL')))?.payload).toBe('')

    // readConfig now reconstructs from the hardware (native truth), no mqtt flag.
    const cfg = await provider.readConfig('dev_ld')
    expect(cfg.zones[0]).toMatchObject({ shape: 'rect', cx: 0, cy: 2 })
    expect(cfg.mqttAvailable).toBeUndefined()
  })
})

describe('degradation when MQTT is unavailable', () => {
  it('still applies and reads, still streams the preview, and reports MQTT as required', async () => {
    const failing: MqttPublisherFactory = async () => {
      throw new Error('MQTT integration not installed')
    }
    const { provider } = makeProvider(tempDir(), failing)
    await provider.discover()

    // The polygon apply does not fail the device even though MQTT is down.
    await provider.writeConfig('dev_ld', { zones: [lZone], band, mount })
    expect(sim.peek(LDZ.zoneType)).toBe('Disabled')

    const cfg = await provider.readConfig('dev_ld')
    expect(cfg.zones).toHaveLength(1)
    expect(cfg.mqttAvailable).toBe(false) // the editor surfaces "MQTT required"

    // The canvas preview still works: the live target stream delivers frames
    // (the fixture seeds target 1, so the immediate frame is non-empty).
    let unsub: () => void = () => {}
    const frame = await new Promise<unknown>((resolve) => {
      unsub = provider.subscribeTargets('dev_ld', (targets) => {
        if (targets.length) resolve(targets)
      })
    })
    unsub()
    expect(Array.isArray(frame)).toBe(true)
  })
})

describe('re-activation after a restart', () => {
  it('re-publishes the polygon entities for a persisted-polygon device on discover', async () => {
    const dir = tempDir()
    const first = makeProvider(dir)
    await first.provider.discover()
    await first.provider.writeConfig('dev_ld', { zones: [lZone], band, mount })

    // A fresh provider over the same data dir: discovery re-activates the device.
    const second = makeProvider(dir)
    await second.provider.discover()
    const publisher = second.pub()!
    expect(publisher).not.toBeNull()
    const zoneCfg = publisher.last(configTopic('dev_ld', zoneObjectId('zL')))
    expect(JSON.parse(zoneCfg!.payload).name).toBe('L run occupancy')
  })
})
