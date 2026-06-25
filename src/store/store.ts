/*
 * ZoneStudioStore — the small typed store behind the UI.
 *
 * It replaces the monolith's component state. It holds the editor/UI state plus
 * the working copy of the active device's zones + band, exposes every action the
 * old class had, and owns the canvas drag interaction (purely in metres — the
 * DOM→metre conversion stays in the canvas component). Live targets and the
 * apply path flow through the injected `ZonesClient`.
 *
 * State changes replace the state object by reference, so any number of React
 * components can subscribe via `useSyncExternalStore` and re-render on change —
 * the same "one update, whole tree re-renders" model the class component had.
 */
import { snapHalf } from '../domain/geometry'
import type { BandConfig, Point, PolyZone, RectZone, Room, Target, Zone } from '../domain/types'
import type { Seed } from '../client/MockZonesClient'
import type { Unsubscribe, ZonesClient } from '../client/ZonesClient'

// ---- editor/UI types (not part of the persisted contract) ----------------

export type View = 'wall' | 'ceiling'
export type Tool = 'select' | 'rect' | 'rot' | 'poly'

export type Selection =
  | { kind: 'zone'; id: string }
  | { kind: 'sen' } // SEN0609 radial band
  | { kind: 'ld' } // LD2450 sensor
  | { kind: 'none' }

export interface EditorState {
  // device model (from the client) — drives header + future room/device picker
  rooms: Room[]
  activeRoomId: string
  activeDeviceId: string
  // UI
  theme: 'light' | 'dark'
  view: View
  tool: Tool
  layers: { ld: boolean; sen: boolean }
  sel: Selection
  // working copy of the active device's sensor config
  zones: Zone[]
  band: BandConfig
  // live + transient
  targets: Target[]
  draft: { pts: Point[] } | null
  cursor: Point | null
  // dirty tracking: JSON snapshot of the last applied { zones, band }
  saved: string
}

/** Imperative drag handle — non-reactive, mirrors the old `this.h`. */
type DragHandle =
  | { mode: 'move'; id: string; start: Point; orig: Zone }
  | { mode: 'corner'; id: string; i: number }
  | { mode: 'rotate'; id: string }
  | { mode: 'vertex'; id: string; i: number }
  | { mode: 'minR' }
  | { mode: 'maxR' }
  | { mode: 'create'; start: Point }
  | null

type Listener = () => void

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const snapshot = (zones: Zone[], band: BandConfig): string => JSON.stringify({ zones, band })

/** True if the working copy differs from the last applied snapshot. */
export function isDirty(s: EditorState): boolean {
  return snapshot(s.zones, s.band) !== s.saved
}

export class ZoneStudioStore {
  private state: EditorState
  private listeners = new Set<Listener>()
  private client: ZonesClient
  private unsub: Unsubscribe
  private handle: DragHandle = null
  private idSeq = 0

  constructor(client: ZonesClient, seed: Seed) {
    this.client = client
    this.state = {
      rooms: seed.rooms,
      activeRoomId: seed.activeRoomId,
      activeDeviceId: seed.activeDeviceId,
      theme: 'light',
      view: 'wall',
      tool: 'select',
      layers: { ld: true, sen: true },
      sel: { kind: 'zone', id: seed.zones[0]?.id ?? '' },
      zones: seed.zones,
      band: seed.band,
      targets: [],
      draft: null,
      cursor: null,
      saved: snapshot(seed.zones, seed.band),
    }
    this.unsub = client.streamTargets(seed.activeDeviceId, (targets) => this.set({ targets }))
  }

  // ---- store plumbing ----------------------------------------------------
  getState = (): EditorState => this.state
  subscribe = (l: Listener): Unsubscribe => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
  dispose() {
    this.unsub()
  }

  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch }
    this.emit()
  }
  private setFn(fn: (s: EditorState) => Partial<EditorState>) {
    this.state = { ...this.state, ...fn(this.state) }
    this.emit()
  }
  private emit() {
    for (const l of this.listeners) l()
  }
  private find(id: string): Zone | undefined {
    return this.state.zones.find((z) => z.id === id)
  }
  private nextId(): string {
    return 'z' + Date.now().toString(36) + (this.idSeq++).toString(36)
  }

  // ---- simple actions ----------------------------------------------------
  toggleTheme() {
    this.setFn((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))
  }
  setView(view: View) {
    this.set({ view })
  }
  setTool(tool: Tool) {
    this.set({ tool, draft: null })
  }
  selectZone(id: string) {
    this.set({ sel: { kind: 'zone', id } })
  }
  selectBand() {
    this.set({ sel: { kind: 'sen' } })
  }
  selectLd() {
    this.set({ sel: { kind: 'ld' } })
  }
  toggleLayer(k: 'ld' | 'sen') {
    this.setFn((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } }))
  }

  // ---- zone edits (typed, shape-aware) ----------------------------------
  private mutateZone(id: string, fn: (z: Zone) => Zone) {
    this.setFn((s) => ({ zones: s.zones.map((z) => (z.id === id ? fn(z) : z)) }))
  }
  renameZone(id: string, name: string) {
    this.mutateZone(id, (z) => ({ ...z, name: name || 'Zone' }))
  }
  setZoneType(id: string, type: Zone['type']) {
    this.mutateZone(id, (z) => ({ ...z, type }))
  }
  patchRect(id: string, patch: Partial<Pick<RectZone, 'cx' | 'cy' | 'w' | 'h' | 'rot'>>) {
    this.mutateZone(id, (z) => (z.shape === 'rect' ? { ...z, ...patch } : z))
  }
  deleteZone(id: string) {
    this.setFn((s) => {
      const zones = s.zones.filter((z) => z.id !== id)
      return { zones, sel: zones.length ? { kind: 'zone', id: zones[0].id } : { kind: 'none' } }
    })
  }

  // ---- band edits --------------------------------------------------------
  patchBand(patch: Partial<BandConfig>) {
    this.setFn((s) => ({ band: { ...s.band, ...patch } }))
  }

  // ---- apply / revert ----------------------------------------------------
  apply() {
    const { zones, band, activeDeviceId } = this.state
    // Phase 0: the mock no-ops; Phase 3 wires this to the real device.
    void this.client.writeConfig(activeDeviceId, { zones: clone(zones), band: clone(band) })
    this.set({ saved: snapshot(zones, band) })
  }
  revert() {
    this.setFn((s) => {
      const r = JSON.parse(s.saved) as { zones: Zone[]; band: BandConfig }
      return { zones: r.zones, band: r.band }
    })
  }

  // ---- drag interaction (all coordinates in metres) ----------------------
  beginMoveZone(id: string, atM: Point) {
    const z = this.find(id)
    if (!z) return
    this.handle = { mode: 'move', id, start: atM, orig: clone(z) }
    this.set({ sel: { kind: 'zone', id } })
  }
  beginCornerResize(id: string, i: number) {
    this.handle = { mode: 'corner', id, i }
    this.set({ sel: { kind: 'zone', id } })
  }
  beginRotate(id: string) {
    this.handle = { mode: 'rotate', id }
  }
  beginVertex(id: string, i: number) {
    this.handle = { mode: 'vertex', id, i }
    this.set({ sel: { kind: 'zone', id } })
  }
  beginRadius(which: 'minR' | 'maxR') {
    this.handle = { mode: which }
    this.set({ sel: { kind: 'sen' } })
  }
  beginCanvas(atM: Point) {
    const t = this.state.tool
    if (t === 'poly') {
      const pts = this.state.draft?.pts ?? []
      this.set({ draft: { pts: [...pts, { x: snapHalf(atM.x), y: snapHalf(atM.y) }] } })
      return
    }
    if (t === 'rect' || t === 'rot') {
      this.handle = { mode: 'create', start: atM }
      return
    }
    this.set({ sel: { kind: 'none' } })
  }

  dragMove(atM: Point) {
    const h = this.handle
    if (!h) {
      this.set({ cursor: atM })
      return
    }
    this.setFn((s) => {
      const patch: Partial<EditorState> = { cursor: atM }
      switch (h.mode) {
        case 'move': {
          const dx = atM.x - h.start.x
          const dy = atM.y - h.start.y
          const o = h.orig
          patch.zones = s.zones.map((z) => {
            if (z.id !== h.id) return z
            if (o.shape === 'poly' && z.shape === 'poly')
              return { ...z, pts: o.pts.map((pt) => ({ x: snapHalf(pt.x + dx), y: snapHalf(pt.y + dy) })) }
            if (o.shape === 'rect' && z.shape === 'rect')
              return { ...z, cx: snapHalf(o.cx + dx), cy: snapHalf(o.cy + dy) }
            return z
          })
          break
        }
        case 'corner': {
          patch.zones = s.zones.map((z) => {
            if (z.id !== h.id || z.shape !== 'rect') return z
            const r = (z.rot * Math.PI) / 180
            const lx = (atM.x - z.cx) * Math.cos(-r) - (atM.y - z.cy) * Math.sin(-r)
            const ly = (atM.x - z.cx) * Math.sin(-r) + (atM.y - z.cy) * Math.cos(-r)
            return { ...z, w: Math.max(0.3, Math.abs(lx) * 2), h: Math.max(0.3, Math.abs(ly) * 2) }
          })
          break
        }
        case 'rotate': {
          patch.zones = s.zones.map((z) => {
            if (z.id !== h.id || z.shape !== 'rect') return z
            const ang = (Math.atan2(atM.x - z.cx, -(atM.y - z.cy)) * 180) / Math.PI
            return { ...z, rot: Math.round(ang) }
          })
          break
        }
        case 'vertex': {
          patch.zones = s.zones.map((z) => {
            if (z.id !== h.id || z.shape !== 'poly') return z
            return { ...z, pts: z.pts.map((pt, i) => (i === h.i ? { x: snapHalf(atM.x), y: snapHalf(atM.y) } : pt)) }
          })
          break
        }
        case 'minR':
          patch.band = {
            ...s.band,
            minR: Math.max(0.2, Math.min(s.band.maxR - 0.3, Math.round(Math.hypot(atM.x, atM.y) * 10) / 10)),
          }
          break
        case 'maxR':
          patch.band = {
            ...s.band,
            maxR: Math.max(s.band.minR + 0.3, Math.min(8, Math.round(Math.hypot(atM.x, atM.y) * 10) / 10)),
          }
          break
        case 'create':
          break
      }
      return patch
    })
  }

  dragEnd() {
    const h = this.handle
    this.handle = null
    if (!h || h.mode !== 'create') return
    const a = h.start
    const b = this.state.cursor ?? a
    const w = Math.abs(b.x - a.x)
    const hgt = Math.abs(b.y - a.y)
    if (w > 0.3 && hgt > 0.3) {
      const id = this.nextId()
      const z: RectZone = {
        id,
        name: 'New zone',
        type: 'detection',
        shape: 'rect',
        cx: snapHalf((a.x + b.x) / 2),
        cy: snapHalf((a.y + b.y) / 2),
        w: Math.round(w * 2) / 2,
        h: Math.round(hgt * 2) / 2,
        rot: 0,
      }
      this.setFn((s) => ({ zones: [...s.zones, z], sel: { kind: 'zone', id }, tool: 'select' }))
    } else {
      this.set({ tool: 'select' })
    }
  }

  finishPolygon() {
    const d = this.state.draft
    if (!d || d.pts.length < 3) return
    const id = this.nextId()
    const z: PolyZone = { id, name: 'Polygon zone', type: 'detection', shape: 'poly', pts: d.pts }
    this.setFn((s) => ({ zones: [...s.zones, z], draft: null, sel: { kind: 'zone', id }, tool: 'select' }))
  }
}
