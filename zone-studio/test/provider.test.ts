/*
 * MockDataProvider: the config roundtrip and the live target animation that the
 * running app depends on.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { MockDataProvider } from '../server/provider/MockDataProvider'
import type { Target } from '../src/domain/types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('MockDataProvider', () => {
  let provider: MockDataProvider | null = null
  afterEach(() => provider?.dispose())

  it('discovers the Living Room model', async () => {
    provider = new MockDataProvider()
    const rooms = await provider.discover()
    expect(rooms[0].name).toBe('Living Room')
    expect(rooms[0].devices[0].sensors.map((s) => s.kind)).toEqual(['ld2450', 'sen0609'])
  })

  it('persists a config write in memory', async () => {
    provider = new MockDataProvider()
    const cfg = await provider.readConfig('dev-living-1')
    cfg.band.maxR = 5.5
    cfg.zones = cfg.zones.slice(0, 1)
    await provider.writeConfig('dev-living-1', cfg)
    const after = await provider.readConfig('dev-living-1')
    expect(after.band.maxR).toBe(5.5)
    expect(after.zones).toHaveLength(1)
  })

  it('emits an immediate frame then animates the targets', async () => {
    provider = new MockDataProvider()
    const frames: Target[][] = []
    const unsubscribe = provider.subscribeTargets('dev-living-1', (t) => frames.push(t))

    // The first frame is delivered synchronously on subscribe.
    expect(frames).toHaveLength(1)
    expect(frames[0]).toHaveLength(3)
    const startX = frames[0][0].x

    await sleep(220)
    unsubscribe()
    const seen = frames.length

    // Several frames arrived and at least one target moved.
    expect(frames.length).toBeGreaterThanOrEqual(3)
    expect(frames[frames.length - 1][0].x).not.toBe(startX)

    // After unsubscribe the stream stops.
    await sleep(120)
    expect(frames.length).toBe(seen)
  })

  it('keeps targets inside the LD2450 field of view', async () => {
    provider = new MockDataProvider()
    let last: Target[] = []
    const unsubscribe = provider.subscribeTargets('dev-living-1', (t) => (last = t))
    await sleep(300)
    unsubscribe()
    for (const t of last) {
      const r = Math.hypot(t.x, t.y)
      const angle = (Math.atan2(t.x, t.y) * 180) / Math.PI
      expect(r).toBeLessThanOrEqual(6.0)
      expect(t.y).toBeGreaterThanOrEqual(0.3)
      expect(Math.abs(angle)).toBeLessThanOrEqual(60)
    }
  })
})
