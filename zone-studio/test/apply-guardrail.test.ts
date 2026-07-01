/*
 * The frontend apply path: the pure `applyView` mapping (profile, reasons, whether
 * Apply is allowed), the rendered guardrail, and the store's apply/revert. Apply is
 * blocked with reasons for a non-native set, dirty tracks the delta against the last
 * device read, Apply re-reads to reset the baseline, and Revert reads the device.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ApplyGuardrail, applyView } from '../src/panels/ApplyGuardrail'
import { ZoneStudioStore, isDirty, type EditorState } from '../src/store/store'
import type { DeviceConfig, TargetListener, Unsubscribe, ZonesClient } from '../src/client/ZonesClient'
import type { Seed } from '../src/client/MockZonesClient'
import type { BandConfig, RectZone, Room } from '../src/domain/types'

const BAND: BandConfig = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const snap = (zones: RectZone[]): string => JSON.stringify({ zones, band: BAND })

const Z0: RectZone = { id: 'z1', name: 'Desk', type: 'detection', shape: 'rect', cx: -1, cy: 1.5, w: 1, h: 1, rot: 0 }

const fourZones: RectZone[] = [-2, -0.7, 0.6, 1.9].map((cx, i) => ({
  id: `z${i}`,
  name: `Zone ${i}`,
  type: 'detection',
  shape: 'rect',
  cx,
  cy: 1.5,
  w: 1,
  h: 1,
  rot: 0,
}))

const DEFAULTS: EditorState = {
  rooms: [],
  activeRoomId: '',
  activeDeviceId: 'd1',
  connection: 'connected',
  theme: 'light',
  view: 'wall',
  tool: 'select',
  layers: { ld: true, sen: true },
  sel: { kind: 'none' },
  zones: [],
  band: BAND,
  mount: null,
  targets: [],
  draft: null,
  cursor: null,
  saved: JSON.stringify({ zones: [], band: BAND }),
  applyState: 'idle',
  applyError: null,
  mqttAvailable: null,
}

const state = (over: Partial<EditorState> = {}): EditorState => ({ ...DEFAULTS, ...over })

describe('applyView', () => {
  it('allows Apply for a dirty, native-eligible set', () => {
    const v = applyView(state({ zones: [Z0] }))
    expect(v.resolution.profile).toBe('native')
    expect(v.dirty).toBe(true)
    expect(v.canApply).toBe(true)
  })

  it('allows Apply for a polygon set and surfaces why it is polygon', () => {
    // Phase 4: a non-native set is no longer blocked; Apply uses the live path.
    const v = applyView(state({ zones: fourZones }))
    expect(v.resolution.profile).toBe('polygon')
    expect(v.canApply).toBe(true)
    expect(v.resolution.reasons.some((r) => /More than 3 zones/.test(r))).toBe(true)
  })

  it('does not allow Apply when there is nothing to apply', () => {
    const v = applyView(state({ zones: [Z0], saved: snap([Z0]) }))
    expect(v.dirty).toBe(false)
    expect(v.canApply).toBe(false)
  })

  it('does not allow Apply mid-apply', () => {
    expect(applyView(state({ zones: [Z0], applyState: 'applying' })).canApply).toBe(false)
  })

  it('surfaces an apply error', () => {
    expect(applyView(state({ applyError: 'boom' })).error).toBe('boom')
  })
})

describe('ApplyGuardrail rendering', () => {
  it('renders the live-MQTT explanation and the reasons for a polygon set', () => {
    const html = renderToStaticMarkup(createElement(ApplyGuardrail, { view: applyView(state({ zones: fourZones })) }))
    expect(html).toContain('POLYGON')
    expect(html).toContain('MQTT')
    expect(html).toMatch(/More than 3 zones/)
  })

  it('warns that MQTT is required when it is unavailable for a polygon set', () => {
    const view = applyView(state({ zones: fourZones, mqttAvailable: false }))
    const html = renderToStaticMarkup(createElement(ApplyGuardrail, { view }))
    expect(html).toContain('MQTT integration is required')
  })

  it('renders the native profile when eligible', () => {
    const html = renderToStaticMarkup(createElement(ApplyGuardrail, { view: applyView(state({ zones: [Z0] })) }))
    expect(html).toContain('NATIVE')
    expect(html).toContain('writes them directly into the sensor')
  })
})

// ---- store apply/revert against a stub client --------------------------------

function seed(zones: RectZone[]): Seed {
  const rooms: Room[] = [{ id: 'r1', name: 'R1', devices: [{ id: 'd1', name: 'D1', sensors: [] }] }]
  return { rooms, activeRoomId: 'r1', activeDeviceId: 'd1', zones: clone(zones), band: BAND }
}

class StubClient implements ZonesClient {
  device: DeviceConfig
  writes: DeviceConfig[] = []
  writeError: string | null = null
  readConfig = vi.fn(async (): Promise<DeviceConfig> => clone(this.device))
  constructor(device: DeviceConfig) {
    this.device = device
  }
  async discover(): Promise<Room[]> {
    return seed([]).rooms
  }
  async writeConfig(_id: string, cfg: DeviceConfig): Promise<void> {
    if (this.writeError) throw new Error(this.writeError)
    this.writes.push(clone(cfg))
    // The device now holds what was written; a subsequent read returns it.
    this.device = { zones: clone(cfg.zones), band: clone(cfg.band), mount: cfg.mount }
  }
  streamTargets(_id: string, _onSample: TargetListener): Unsubscribe {
    return () => {}
  }
}

describe('store apply/revert', () => {
  it('dirty reflects the delta against the last device read', () => {
    const client = new StubClient({ zones: [Z0], band: BAND })
    const store = new ZoneStudioStore(client, seed([Z0]))
    expect(isDirty(store.getState())).toBe(false)
    store.patchRect('z1', { cx: 0 })
    expect(isDirty(store.getState())).toBe(true)
    store.dispose()
  })

  it('apply writes the edit, then re-reads to reset the baseline', async () => {
    const client = new StubClient({ zones: [Z0], band: BAND })
    const store = new ZoneStudioStore(client, seed([Z0]))
    store.patchRect('z1', { cx: -0.5 })
    expect(isDirty(store.getState())).toBe(true)

    await store.apply()
    const s = store.getState()
    expect(client.writes).toHaveLength(1)
    expect(client.writes[0].zones[0]).toMatchObject({ cx: -0.5 })
    // Baseline reset from the read-back, so the editor is no longer dirty.
    expect(isDirty(s)).toBe(false)
    expect(s.zones[0]).toMatchObject({ cx: -0.5 })
    expect(s.applyError).toBeNull()
    store.dispose()
  })

  it('apply keeps the edit and surfaces the error when the write is rejected', async () => {
    const client = new StubClient({ zones: [Z0], band: BAND })
    client.writeError = 'Cannot apply zones natively: Zone "Desk" is rotated relative to the sensor'
    const store = new ZoneStudioStore(client, seed([Z0]))
    store.patchRect('z1', { rot: 45 })

    await store.apply()
    const s = store.getState()
    expect(s.applyState).toBe('idle')
    expect(s.applyError).toMatch(/rotated/)
    // The edit is preserved so the user can fix it.
    expect(isDirty(s)).toBe(true)
    expect(s.zones[0]).toMatchObject({ rot: 45 })
    store.dispose()
  })

  it('revert reads the device config and discards edits', async () => {
    const client = new StubClient({ zones: [Z0], band: BAND })
    const store = new ZoneStudioStore(client, seed([Z0]))
    store.patchRect('z1', { cx: 2.5 })
    expect(isDirty(store.getState())).toBe(true)

    await store.revert()
    const s = store.getState()
    expect(client.readConfig).toHaveBeenCalled()
    expect(s.zones[0]).toMatchObject({ cx: -1 }) // the device value, edit discarded
    expect(isDirty(s)).toBe(false)
    store.dispose()
  })
})
