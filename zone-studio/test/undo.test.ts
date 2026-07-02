/*
 * Edit history: undo/redo over the authored editing session.
 *
 * Every editing action (create, move, resize, rotate, delete, type, geometry,
 * band, mount view) must undo and redo one step at a time; continuous inputs
 * (canvas drags, sliders) collapse to one step; the depth is bounded; and the
 * history never crosses the device boundary — Apply, Revert, switching device,
 * and reloading the working copy all end the session, while a background
 * reconnect that keeps a dirty edit keeps its history too.
 */
import { describe, expect, it } from 'vitest'
import { MockZonesClient, type Seed } from '../src/client/MockZonesClient'
import { ZoneStudioStore, isDirty } from '../src/store/store'
import type { DeviceConfig, TargetListener, Unsubscribe, ZonesClient } from '../src/client/ZonesClient'
import type { BandConfig, RectZone, Room, Sensor, Zone } from '../src/domain/types'

const DEFAULT_BAND: BandConfig = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }
const emptySeed: Seed = { rooms: [], activeRoomId: '', activeDeviceId: '', zones: [], band: DEFAULT_BAND }
const mount = { surface: 'wall' as const, height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }

function ldSensor(zones: Zone[]): Sensor {
  return { id: 'ld', name: 'HLK LD2450', kind: 'ld2450', mount, fovHalf: 60, range: 6, zones }
}

const deviceZone: RectZone = { id: 'zd', name: 'Device zone', type: 'detection', shape: 'rect', cx: 0, cy: 2, w: 1, h: 1, rot: 0 }

/** A controllable two-device client for the boundary tests. */
class FakeClient implements ZonesClient {
  writes: Array<{ deviceId: string; config: DeviceConfig }> = []
  rooms: Room[] = [
    {
      id: 'r',
      name: 'Room',
      devices: [
        { id: 'd1', name: 'D1', sensors: [ldSensor([deviceZone])] },
        { id: 'd2', name: 'D2', sensors: [ldSensor([])] },
      ],
    },
  ]
  async discover(): Promise<Room[]> {
    return this.rooms
  }
  async readConfig(): Promise<DeviceConfig> {
    return { zones: [JSON.parse(JSON.stringify(deviceZone)) as Zone], band: DEFAULT_BAND }
  }
  async status() {
    return { ha: 'connected' as const, mqtt: null }
  }
  async writeConfig(deviceId: string, config: DeviceConfig): Promise<void> {
    this.writes.push({ deviceId, config })
  }
  streamTargets(_deviceId: string, onSample: TargetListener): Unsubscribe {
    onSample([])
    return () => {}
  }
}

/** A mock-seeded store: 4 zones (Desk, Entry, Couch, Kitchen run), clean baseline. */
function mockStore() {
  const client = new MockZonesClient()
  const store = new ZoneStudioStore(client, client.seed())
  return { client, store }
}

describe('each editing action undoes and redoes', () => {
  it('rename', () => {
    const { store } = mockStore()
    store.renameZone('z1', 'Reading nook')
    expect(store.getState().canUndo).toBe(true)
    store.undo()
    expect(store.getState().zones[0].name).toBe('Desk')
    expect(store.getState().canRedo).toBe(true)
    store.redo()
    expect(store.getState().zones[0].name).toBe('Reading nook')
    store.dispose()
  })

  it('zone type change', () => {
    const { store } = mockStore()
    store.setZoneType('z1', 'exclusion')
    store.undo()
    expect(store.getState().zones[0].type).toBe('detection')
    store.redo()
    expect(store.getState().zones[0].type).toBe('exclusion')
    store.dispose()
  })

  it('geometry field edits are one step each', () => {
    const { store } = mockStore()
    store.patchRect('z1', { cx: 0.5 })
    store.patchRect('z1', { cx: 1.0 })
    store.undo()
    expect((store.getState().zones[0] as RectZone).cx).toBe(0.5)
    store.undo()
    expect((store.getState().zones[0] as RectZone).cx).toBe(-1.5)
    store.dispose()
  })

  it('delete restores the zone and the selection on undo', () => {
    const { store } = mockStore()
    store.selectZone('z2')
    store.deleteZone('z2')
    expect(store.getState().zones.map((z) => z.id)).toEqual(['z1', 'z3', 'z4'])
    expect(store.getState().sel).toEqual({ kind: 'zone', id: 'z1' })
    store.undo()
    expect(store.getState().zones.map((z) => z.id)).toEqual(['z1', 'z2', 'z3', 'z4'])
    expect(store.getState().sel).toEqual({ kind: 'zone', id: 'z2' })
    store.redo()
    expect(store.getState().zones.map((z) => z.id)).toEqual(['z1', 'z3', 'z4'])
    store.dispose()
  })

  it('creating a rectangle by drag is one step', () => {
    const { store } = mockStore()
    store.setTool('rect')
    store.beginCanvas({ x: 0, y: 0 })
    store.dragMove({ x: 1.6, y: 1.6 })
    store.dragEnd()
    expect(store.getState().zones).toHaveLength(5)
    const created = store.getState().zones[4]
    expect(store.getState().sel).toEqual({ kind: 'zone', id: created.id })
    store.undo()
    expect(store.getState().zones).toHaveLength(4)
    store.redo()
    expect(store.getState().zones).toHaveLength(5)
    expect(store.getState().zones[4]).toEqual(created)
    store.dispose()
  })

  it('finishing a polygon is one step; the draft is not history', () => {
    const { store } = mockStore()
    store.setTool('poly')
    store.beginCanvas({ x: 0, y: 0 })
    store.beginCanvas({ x: 2, y: 0 })
    expect(store.getState().canUndo).toBe(false) // draft points are transient
    store.beginCanvas({ x: 2, y: 2 })
    store.finishPolygon()
    expect(store.getState().zones).toHaveLength(5)
    store.undo()
    expect(store.getState().zones).toHaveLength(4)
    store.redo()
    expect(store.getState().zones).toHaveLength(5)
    store.dispose()
  })

  it('a move drag is one step, however many dragMove ticks it took', () => {
    const { store } = mockStore()
    store.beginMoveZone('z1', { x: 0, y: 0 })
    store.dragMove({ x: 0.5, y: 0.5 })
    store.dragMove({ x: 1, y: 1 })
    store.dragMove({ x: 1.5, y: 2 })
    store.dragEnd()
    expect((store.getState().zones[0] as RectZone).cx).toBe(0)
    expect((store.getState().zones[0] as RectZone).cy).toBe(3.5)
    store.undo()
    expect((store.getState().zones[0] as RectZone).cx).toBe(-1.5)
    expect((store.getState().zones[0] as RectZone).cy).toBe(1.7)
    expect(store.getState().canUndo).toBe(false)
    store.redo()
    expect((store.getState().zones[0] as RectZone).cy).toBe(3.5)
    store.dispose()
  })

  it('a corner-resize drag is one step', () => {
    const { store } = mockStore()
    const before = store.getState().zones[0] as RectZone
    store.beginCornerResize('z1', 0)
    store.dragMove({ x: before.cx + 1.5, y: before.cy + 1 })
    store.dragEnd()
    const after = store.getState().zones[0] as RectZone
    expect(after.w).toBe(3)
    store.undo()
    expect(store.getState().zones[0]).toEqual(before)
    store.redo()
    expect(store.getState().zones[0]).toEqual(after)
    store.dispose()
  })

  it('a rotate drag is one step', () => {
    const { store } = mockStore()
    store.beginRotate('z1')
    store.dragMove({ x: 0, y: 1.7 }) // due right of the centre → 90°
    store.dragEnd()
    expect((store.getState().zones[0] as RectZone).rot).toBe(90)
    store.undo()
    expect((store.getState().zones[0] as RectZone).rot).toBe(0)
    store.redo()
    expect((store.getState().zones[0] as RectZone).rot).toBe(90)
    store.dispose()
  })

  it('a polygon vertex drag is one step', () => {
    const { store } = mockStore()
    store.beginVertex('z4', 0)
    store.dragMove({ x: 0, y: 2.5 })
    store.dragEnd()
    const poly = store.getState().zones[3]
    expect(poly.shape === 'poly' && poly.pts[0]).toEqual({ x: 0, y: 2.5 })
    store.undo()
    const back = store.getState().zones[3]
    expect(back.shape === 'poly' && back.pts[0]).toEqual({ x: 0.5, y: 3.1 })
    store.dispose()
  })

  it('a band radius drag on the canvas is one step', () => {
    const { store } = mockStore()
    store.beginRadius('minR')
    store.dragMove({ x: 0, y: 1.5 })
    store.dragEnd()
    expect(store.getState().band.minR).toBe(1.5)
    store.undo()
    expect(store.getState().band.minR).toBe(0.8)
    store.redo()
    expect(store.getState().band.minR).toBe(1.5)
    store.dispose()
  })

  it('the mount view toggle is undoable; re-selecting the same view is not a step', () => {
    const { store } = mockStore()
    store.setView('ceiling')
    store.setView('ceiling')
    expect(store.getState().view).toBe('ceiling')
    store.undo()
    expect(store.getState().view).toBe('wall')
    expect(store.getState().canUndo).toBe(false)
    store.redo()
    expect(store.getState().view).toBe('ceiling')
    store.dispose()
  })
})

describe('continuous inputs collapse to one step', () => {
  it('a rotation slider run coalesces; releasing the slider ends the run', () => {
    const { store } = mockStore()
    store.patchRect('z1', { rot: 10 })
    store.patchRect('z1', { rot: 20 })
    store.patchRect('z1', { rot: 30 })
    store.endSliderEdit()
    store.patchRect('z1', { rot: 45 })
    store.undo()
    expect((store.getState().zones[0] as RectZone).rot).toBe(30)
    store.undo()
    expect((store.getState().zones[0] as RectZone).rot).toBe(0)
    expect(store.getState().canUndo).toBe(false)
    store.dispose()
  })

  it('band slider runs coalesce per property', () => {
    const { store } = mockStore()
    store.patchBand({ minR: 1.0 })
    store.patchBand({ minR: 1.2 })
    store.patchBand({ maxR: 5 }) // different slider → new step
    store.undo()
    expect(store.getState().band).toMatchObject({ minR: 1.2, maxR: 4.4 })
    store.undo()
    expect(store.getState().band).toMatchObject({ minR: 0.8, maxR: 4.4 })
    expect(store.getState().canUndo).toBe(false)
    store.dispose()
  })
})

describe('history hygiene', () => {
  it('a gesture that changes nothing records nothing', () => {
    const { store } = mockStore()
    store.beginMoveZone('z1', { x: 0, y: 0 })
    store.dragEnd()
    expect(store.getState().canUndo).toBe(false)
    store.dispose()
  })

  it('a no-op action records nothing', () => {
    const { store } = mockStore()
    store.renameZone('z1', 'Desk')
    store.setZoneType('z1', 'detection')
    expect(store.getState().canUndo).toBe(false)
    store.dispose()
  })

  it('undo and redo are ignored during an active drag', () => {
    const { store } = mockStore()
    store.renameZone('z1', 'A')
    store.beginMoveZone('z1', { x: 0, y: 0 })
    store.undo()
    expect(store.getState().zones[0].name).toBe('A')
    store.dragEnd()
    store.undo()
    expect(store.getState().zones[0].name).toBe('Desk')
    store.dispose()
  })

  it('a new edit clears the redo stack', () => {
    const { store } = mockStore()
    store.renameZone('z1', 'A')
    store.undo()
    expect(store.getState().canRedo).toBe(true)
    store.renameZone('z1', 'B')
    expect(store.getState().canRedo).toBe(false)
    store.dispose()
  })

  it('the depth is bounded: the oldest steps fall off', () => {
    const { store } = mockStore()
    for (let i = 0; i < 60; i++) store.renameZone('z1', 'name' + i)
    let undos = 0
    while (store.getState().canUndo) {
      store.undo()
      undos++
    }
    expect(undos).toBe(50)
    // The 10 oldest steps are gone: undo bottoms out at the state before rename #10.
    expect(store.getState().zones[0].name).toBe('name9')
    store.dispose()
  })

  it('undo and redo never write to the device', async () => {
    const client = new FakeClient()
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    store.renameZone('zd', 'A')
    store.undo()
    store.redo()
    expect(client.writes).toHaveLength(0)
    store.dispose()
  })
})

describe('dirty state, Revert, Apply, and the device boundary', () => {
  it('undoing back to the baseline makes the editor clean again', () => {
    const { store } = mockStore()
    expect(isDirty(store.getState())).toBe(false)
    store.renameZone('z1', 'A')
    expect(isDirty(store.getState())).toBe(true)
    store.undo()
    expect(isDirty(store.getState())).toBe(false)
    store.redo()
    expect(isDirty(store.getState())).toBe(true)
    store.dispose()
  })

  it('Apply commits the session: the history is cleared and undo cannot un-write', async () => {
    const { store } = mockStore()
    store.renameZone('z1', 'Applied name')
    await store.apply()
    const s = store.getState()
    expect(s.canUndo).toBe(false)
    expect(s.canRedo).toBe(false)
    expect(isDirty(s)).toBe(false)
    store.undo()
    expect(store.getState().zones[0].name).toBe('Applied name')
    expect(isDirty(store.getState())).toBe(false)
    store.dispose()
  })

  it('a failed Apply keeps the edit and its history', async () => {
    const client = new FakeClient()
    client.writeConfig = async () => {
      throw new Error('device refused')
    }
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    store.renameZone('zd', 'A')
    await store.apply()
    expect(store.getState().applyError).toBe('device refused')
    expect(store.getState().canUndo).toBe(true)
    store.undo()
    expect(store.getState().zones[0].name).toBe('Device zone')
    store.dispose()
  })

  it('Revert resets to the device and clears the history', async () => {
    const { store } = mockStore()
    store.renameZone('z1', 'A')
    store.deleteZone('z2')
    await store.revert()
    const s = store.getState()
    expect(s.zones.map((z) => z.id)).toEqual(['z1', 'z2', 'z3', 'z4'])
    expect(s.zones[0].name).toBe('Desk')
    expect(s.canUndo).toBe(false)
    expect(s.canRedo).toBe(false)
    store.dispose()
  })

  it('a background reconnect that keeps a dirty edit keeps its history', async () => {
    const { store } = mockStore()
    store.renameZone('z1', 'Kept edit')
    await store.refresh({ background: true })
    expect(store.getState().zones[0].name).toBe('Kept edit')
    expect(store.getState().canUndo).toBe(true)
    store.undo()
    expect(store.getState().zones[0].name).toBe('Desk')
    expect(isDirty(store.getState())).toBe(false)
    store.dispose()
  })

  it('a refresh that reloads the working copy starts a fresh session', async () => {
    const { store } = mockStore()
    store.renameZone('z1', 'A')
    store.undo() // clean again, so refresh reloads from the device
    expect(store.getState().canRedo).toBe(true)
    await store.refresh()
    expect(store.getState().canUndo).toBe(false)
    expect(store.getState().canRedo).toBe(false)
    store.dispose()
  })

  it('switching device ends the session', async () => {
    const client = new FakeClient()
    const store = new ZoneStudioStore(client, emptySeed)
    await store.refresh()
    store.renameZone('zd', 'A')
    expect(store.getState().canUndo).toBe(true)
    store.selectDevice('d2')
    expect(store.getState().canUndo).toBe(false)
    expect(store.getState().canRedo).toBe(false)
    store.dispose()
  })

  it('hydrate replaces the session and clears the history', () => {
    const { store } = mockStore()
    store.renameZone('z1', 'A')
    const seed: Seed = {
      rooms: [{ id: 'r2', name: 'Studio', devices: [{ id: 'dev-2', name: 'D2', sensors: [] }] }],
      activeRoomId: 'r2',
      activeDeviceId: 'dev-2',
      zones: [],
      band: DEFAULT_BAND,
    }
    store.hydrate(seed)
    expect(store.getState().canUndo).toBe(false)
    expect(store.getState().canRedo).toBe(false)
    store.dispose()
  })
})
