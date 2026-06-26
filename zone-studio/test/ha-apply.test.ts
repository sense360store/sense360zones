/*
 * The native LD2450 apply and read paths end to end against the WebSocket
 * simulator: writeConfig maps zones to the right millimetre corners and mode,
 * clears unused slots, refuses a non-native or invalid set, and is confirmed by a
 * read back; readConfig reconstructs zones from the device; the author/apply/read
 * round-trip is stable; and Revert reflects the device, not the persisted edit.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HaDataProvider } from '../server/provider/HaDataProvider'
import { Persistence } from '../server/persistence'
import { nativeRegion } from '../src/domain/native'
import type { BandConfig, RectZone, SensorMount } from '../src/domain/types'
import { HaSim, startHaSim } from './ha-sim'
import { LDZ, ZONE_TYPE_OPTIONS } from './ha-fixtures'

const band: BandConfig = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }
const mount: SensorMount = { surface: 'wall', height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }
const mm = { unit_of_measurement: 'mm' }

const rect = (over: Partial<RectZone> = {}): RectZone => ({
  id: 'z',
  name: 'Zone',
  type: 'detection',
  shape: 'rect',
  cx: 0,
  cy: 2,
  w: 1,
  h: 1,
  rot: 0,
  ...over,
})

const num = (sim: HaSim, id: string): number => Number(sim.peek(id))

let sim: HaSim
const providers: HaDataProvider[] = []
const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zone-studio-apply-'))
  dirs.push(dir)
  return dir
}

function makeProvider(dataDir = tempDir()): HaDataProvider {
  const provider = new HaDataProvider({ wsUrl: sim.url, token: 'test-token', dataDir, reconnectBaseMs: 40, timeoutMs: 2000 })
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

describe('writeConfig (native LD2450 apply)', () => {
  it('maps zones to millimetre corners, sets detection mode, and clears unused slots', async () => {
    const provider = makeProvider()
    await provider.discover()

    const zones: RectZone[] = [
      rect({ id: 'a', name: 'A', cx: 0, cy: 2, w: 1, h: 2 }), // x[-0.5,0.5] y[1,3]
      rect({ id: 'b', name: 'B', cx: 1.5, cy: 1, w: 1, h: 1 }), // x[1,2] y[0.5,1.5]
    ]
    await provider.writeConfig('dev_ld', { zones, band, mount })

    expect([num(sim, LDZ.z1x1), num(sim, LDZ.z1y1), num(sim, LDZ.z1x2), num(sim, LDZ.z1y2)]).toEqual([-500, 1000, 500, 3000])
    expect([num(sim, LDZ.z2x1), num(sim, LDZ.z2y1), num(sim, LDZ.z2x2), num(sim, LDZ.z2y2)]).toEqual([1000, 500, 2000, 1500])
    // The third slot is cleared so a removed zone does not linger.
    expect([num(sim, LDZ.z3x1), num(sim, LDZ.z3y1), num(sim, LDZ.z3x2), num(sim, LDZ.z3y2)]).toEqual([0, 0, 0, 0])
    expect(sim.peek(LDZ.zoneType)).toBe('Detection')
  })

  it('selects the exclusion (filter) option for exclusion zones', async () => {
    const provider = makeProvider()
    await provider.discover()
    await provider.writeConfig('dev_ld', { zones: [rect({ type: 'exclusion' })], band, mount })
    expect(sim.peek(LDZ.zoneType)).toBe('Filter')
  })

  it('clears every slot and disables the mode for an empty set', async () => {
    const provider = makeProvider()
    await provider.discover()
    await provider.writeConfig('dev_ld', { zones: [rect({ cx: 0, cy: 2, w: 1, h: 1 })], band, mount })
    await provider.writeConfig('dev_ld', { zones: [], band, mount })
    expect(sim.peek(LDZ.zoneType)).toBe('Disabled')
    expect([num(sim, LDZ.z1x1), num(sim, LDZ.z1y1), num(sim, LDZ.z1x2), num(sim, LDZ.z1y2)]).toEqual([0, 0, 0, 0])
  })

  it('rejects a non-native set without writing', async () => {
    const provider = makeProvider()
    await provider.discover()
    const four = [rect({ id: 'a', cx: -2 }), rect({ id: 'b', cx: -0.7 }), rect({ id: 'c', cx: 0.7 }), rect({ id: 'd', cx: 2 })]
    await expect(provider.writeConfig('dev_ld', { zones: four, band, mount })).rejects.toThrow(/More than 3 zones/)
    // Nothing was written: the mode is still the initial Disabled.
    expect(sim.peek(LDZ.zoneType)).toBe('Disabled')
  })

  it('rejects a rotated, out-of-range, or degenerate region', async () => {
    const provider = makeProvider()
    await provider.discover()
    await expect(provider.writeConfig('dev_ld', { zones: [rect({ rot: 45 })], band, mount })).rejects.toThrow(/rotated/)
    await expect(
      provider.writeConfig('dev_ld', { zones: [rect({ cx: 2.8, cy: 2, w: 1, h: 1 })], band, mount }),
    ).rejects.toThrow(/beyond the sensor range/)
    await expect(provider.writeConfig('dev_ld', { zones: [rect({ w: 0.0004 })], band, mount })).rejects.toThrow(/too small/)
  })

  it('throws when the device does not accept a written value', async () => {
    const provider = makeProvider()
    await provider.discover()
    sim.frozen.add(LDZ.z1x1) // the device acknowledges but ignores this number
    await expect(
      provider.writeConfig('dev_ld', { zones: [rect({ cx: 0, cy: 2, w: 1, h: 1 })], band, mount }),
    ).rejects.toThrow(/did not accept/)
  })
})

describe('readConfig (native LD2450 read)', () => {
  it('reconstructs a zone from the device region entities and mode', async () => {
    const provider = makeProvider()
    await provider.discover()

    sim.emitState(LDZ.z1x1, '-500', mm)
    sim.emitState(LDZ.z1y1, '1000', mm)
    sim.emitState(LDZ.z1x2, '500', mm)
    sim.emitState(LDZ.z1y2, '3000', mm)
    sim.emitState(LDZ.zoneType, 'Detection', { options: ZONE_TYPE_OPTIONS })

    const cfg = await provider.readConfig('dev_ld')
    expect(cfg.zones).toHaveLength(1)
    expect(cfg.zones[0]).toMatchObject({ type: 'detection', shape: 'rect', cx: 0, cy: 2, w: 1, h: 2, rot: 0 })
  })

  it('reports no zones when the mode is disabled, even if regions linger', async () => {
    const provider = makeProvider()
    await provider.discover()
    sim.emitState(LDZ.z1x1, '-500', mm)
    sim.emitState(LDZ.z1x2, '500', mm)
    sim.emitState(LDZ.z1y1, '1000', mm)
    sim.emitState(LDZ.z1y2, '3000', mm)
    sim.emitState(LDZ.zoneType, 'Disabled', { options: ZONE_TYPE_OPTIONS })
    expect((await provider.readConfig('dev_ld')).zones).toEqual([])
  })
})

describe('author/apply/read round-trip', () => {
  for (const type of ['detection', 'exclusion'] as const) {
    it(`is stable for ${type} mode`, async () => {
      const provider = makeProvider()
      await provider.discover()
      const original = rect({ id: 'a', name: 'A', cx: -1, cy: 1.5, w: 1.4, h: 1.2, type })

      await provider.writeConfig('dev_ld', { zones: [original], band, mount })
      const back = await provider.readConfig('dev_ld')

      expect(back.zones).toHaveLength(1)
      expect(back.zones[0].type).toBe(type)
      expect(nativeRegion(back.zones[0] as RectZone, mount)).toEqual(nativeRegion(original, mount))

      // Reading again yields exactly the same reconstruction.
      const again = await provider.readConfig('dev_ld')
      expect(again.zones).toEqual(back.zones)
    })
  }
})

describe('Revert reads the device, not the persisted edit', () => {
  it('readConfig returns the device regions even when a different edit is persisted', async () => {
    const dir = tempDir()
    // A persisted in-progress edit that does not match the hardware.
    new Persistence(dir).setZones('dev_ld', [rect({ id: 'edit', name: 'Edit', cx: 2.5, cy: 2.5, w: 1, h: 1 })])

    const provider = makeProvider(dir)
    await provider.discover()
    // The device itself holds a detection zone centred at the origin.
    sim.emitState(LDZ.z1x1, '-500', mm)
    sim.emitState(LDZ.z1y1, '1000', mm)
    sim.emitState(LDZ.z1x2, '500', mm)
    sim.emitState(LDZ.z1y2, '3000', mm)
    sim.emitState(LDZ.zoneType, 'Detection', { options: ZONE_TYPE_OPTIONS })

    const cfg = await provider.readConfig('dev_ld')
    expect(cfg.zones).toHaveLength(1)
    expect(cfg.zones[0]).toMatchObject({ cx: 0, cy: 2 }) // the device, not the edit at (2.5, 2.5)
  })
})
