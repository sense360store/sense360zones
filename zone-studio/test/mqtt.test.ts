/*
 * The live polygon-occupancy publish path against the fake MQTT publisher: the
 * retained discovery config per zone and for the derived presence, the availability
 * topic and last will, state published on change only, the on/off debounce, the
 * discovery cleared when a zone is removed, and a scripted target path through an
 * L-shaped detection zone producing the expected published transitions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeMqttPublisher } from '../server/mqtt/MqttPublisher'
import { OccupancyRuntime, type SubscribeTargets } from '../server/mqtt/OccupancyRuntime'
import { configTopic, stateTopic, zoneObjectId, PRESENCE_OBJECT_ID } from '../server/mqtt/discovery'
import type { PolyZone, RectZone, Target } from '../src/domain/types'

const DEV = { id: 'dev_ld', name: 'Living LD2450' }

const detA: RectZone = { id: 'zA', name: 'Desk', type: 'detection', shape: 'rect', cx: 0, cy: 2, w: 1, h: 1, rot: 0 }
const detB: RectZone = { id: 'zB', name: 'Entry', type: 'detection', shape: 'rect', cx: 2, cy: 2, w: 1, h: 1, rot: 0 }

const target = (x: number, y: number, id = 't1'): Target => ({ id, x, y, vx: 0, vy: 0, color: '', trail: [] })

/** A subscribe function that emits an immediate empty frame and lets tests push more. */
function makeStream() {
  const holder = { cb: (_t: Target[]) => {} }
  const subscribe: SubscribeTargets = (cb) => {
    holder.cb = cb
    cb([]) // the contract's immediate frame
    return () => {}
  }
  return { subscribe, push: (t: Target[]) => holder.cb(t) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('discovery and availability', () => {
  it('publishes a retained occupancy discovery config per zone and for presence', () => {
    const pub = new FakeMqttPublisher()
    const runtime = new OccupancyRuntime({ publisher: pub })
    const { subscribe } = makeStream()
    runtime.activate(DEV, [detA], subscribe)

    const zoneCfg = pub.last(configTopic(DEV.id, zoneObjectId('zA')))
    expect(zoneCfg?.retain).toBe(true)
    const zoneJson = JSON.parse(zoneCfg!.payload)
    expect(zoneJson.device_class).toBe('occupancy')
    expect(zoneJson.unique_id).toContain('zone_zA')
    expect(zoneJson.name).toBe('Desk occupancy')
    expect(zoneJson.state_topic).toBe(stateTopic(DEV.id, zoneObjectId('zA')))
    expect(zoneJson.availability_topic).toBe(pub.availabilityTopic)
    expect(zoneJson.device.identifiers).toContain('sense360zs_dev_ld')

    const presenceCfg = pub.last(configTopic(DEV.id, PRESENCE_OBJECT_ID))
    expect(presenceCfg?.retain).toBe(true)
    const presenceJson = JSON.parse(presenceCfg!.payload)
    expect(presenceJson.name).toBe('Living LD2450 presence')
    expect(presenceJson.device_class).toBe('occupancy')

    runtime.dispose()
  })

  it('announces availability online with a retained last will of offline', () => {
    const pub = new FakeMqttPublisher()
    const online = pub.last(pub.availabilityTopic)
    expect(online?.payload).toBe('online')
    expect(online?.retain).toBe(true)
    expect(pub.lastWill).toEqual({ topic: pub.availabilityTopic, payload: 'offline', retain: true })
  })

  it('clears a removed zone’s retained discovery config', () => {
    const pub = new FakeMqttPublisher()
    const runtime = new OccupancyRuntime({ publisher: pub })
    const { subscribe } = makeStream()
    runtime.activate(DEV, [detA, detB], subscribe)
    expect(JSON.parse(pub.last(configTopic(DEV.id, zoneObjectId('zB')))!.payload).name).toBe('Entry occupancy')

    runtime.activate(DEV, [detA], subscribe) // zB removed
    const cleared = pub.last(configTopic(DEV.id, zoneObjectId('zB')))
    expect(cleared?.payload).toBe('') // empty retained payload removes the entity
    expect(cleared?.retain).toBe(true)
    runtime.dispose()
  })
})

describe('state publishing and debounce', () => {
  it('establishes an initial state then publishes only on change', () => {
    const pub = new FakeMqttPublisher()
    const runtime = new OccupancyRuntime({ publisher: pub, onDelayMs: 400, offDelayMs: 800 })
    const { subscribe, push } = makeStream()
    runtime.activate(DEV, [detA], subscribe)

    const topic = stateTopic(DEV.id, zoneObjectId('zA'))
    expect(pub.payloads(topic)).toEqual(['OFF']) // initial state from the empty frame

    push([target(0, 2)]) // inside zone A
    vi.advanceTimersByTime(400)
    expect(pub.payloads(topic)).toEqual(['OFF', 'ON'])

    // Identical frames do not republish.
    push([target(0, 2)])
    push([target(0, 2)])
    vi.advanceTimersByTime(1000)
    expect(pub.payloads(topic)).toEqual(['OFF', 'ON'])
    runtime.dispose()
  })

  it('honours the debounce: a brief flicker does not toggle the entity', () => {
    const pub = new FakeMqttPublisher()
    const runtime = new OccupancyRuntime({ publisher: pub, onDelayMs: 400, offDelayMs: 800 })
    const { subscribe, push } = makeStream()
    runtime.activate(DEV, [detA], subscribe)
    const topic = stateTopic(DEV.id, zoneObjectId('zA'))

    push([target(0, 2)]) // enters
    vi.advanceTimersByTime(400)
    expect(pub.payloads(topic)).toEqual(['OFF', 'ON'])

    push([]) // leaves
    vi.advanceTimersByTime(300) // less than the 800ms off delay
    push([target(0, 2)]) // re-enters before the off delay elapses
    vi.advanceTimersByTime(1000)
    // The off transition was cancelled by the flicker: still ON, no extra publish.
    expect(pub.payloads(topic)).toEqual(['OFF', 'ON'])
    runtime.dispose()
  })

  it('subtracts an exclusion zone from the published presence', () => {
    const pub = new FakeMqttPublisher()
    const runtime = new OccupancyRuntime({ publisher: pub, onDelayMs: 0, offDelayMs: 0 })
    const { subscribe, push } = makeStream()
    const excl: RectZone = { ...detB, id: 'zE', name: 'Couch', type: 'exclusion' }
    runtime.activate(DEV, [detA, excl], subscribe)
    const presence = stateTopic(DEV.id, PRESENCE_OBJECT_ID)

    push([target(2, 2)]) // only inside the exclusion zone
    vi.advanceTimersByTime(1)
    expect(pub.last(presence)?.payload).toBe('OFF')

    push([target(0, 2)]) // inside the detection zone
    vi.advanceTimersByTime(1)
    expect(pub.last(presence)?.payload).toBe('ON')
    runtime.dispose()
  })
})

describe('a scripted target path through an L-shaped detection zone', () => {
  const L: PolyZone = {
    id: 'zL',
    name: 'L run',
    type: 'detection',
    shape: 'poly',
    pts: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ],
  }

  it('publishes ON entering an arm and OFF in the notch', () => {
    const pub = new FakeMqttPublisher()
    const runtime = new OccupancyRuntime({ publisher: pub, onDelayMs: 0, offDelayMs: 0 })
    const { subscribe, push } = makeStream()
    runtime.activate(DEV, [L], subscribe)
    const topic = stateTopic(DEV.id, zoneObjectId('zL'))

    const path = [
      { x: -0.5, y: 0.5 }, // outside
      { x: 0.5, y: 0.5 }, // in the bottom arm
      { x: 1.5, y: 1.5 }, // in the removed notch (outside the L)
      { x: 0.5, y: 1.5 }, // in the left arm
    ]
    for (const p of path) {
      push([target(p.x, p.y)])
      vi.advanceTimersByTime(1)
    }
    expect(pub.payloads(topic)).toEqual(['OFF', 'ON', 'OFF', 'ON'])
    runtime.dispose()
  })
})
