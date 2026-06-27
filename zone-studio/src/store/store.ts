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
import type { BandConfig, Point, PolyZone, RectZone, Room, SensorMount, Target, Zone } from '../domain/types'
import type { Seed } from '../client/MockZonesClient'
import type { Unsubscribe, ZonesClient } from '../client/ZonesClient'

// ---- editor/UI types (not part of the persisted contract) ----------------

export type View = 'wall' | 'ceiling'
export type Tool = 'select' | 'rect' | 'rot' | 'poly'

/**
 * The honest connection state, surfaced so the UI never shows simulated data for
 * a real failure:
 *   - connecting    discovery is in flight (first paint, or a retry),
 *   - connected     Home Assistant answered and at least one device was found,
 *   - no-devices    Home Assistant answered but no radar sensors were detected,
 *   - offline       Home Assistant (or the backend) could not be reached.
 */
export type ConnectionState = 'connecting' | 'connected' | 'no-devices' | 'offline'

export type Selection =
  | { kind: 'zone'; id: string }
  | { kind: 'sen' } // SEN0609 radial band
  | { kind: 'ld' } // LD2450 sensor
  | { kind: 'none' }

export interface EditorState {
  // device model (from the client) — drives the room/device picker
  rooms: Room[]
  activeRoomId: string
  activeDeviceId: string
  /** Connection to the data source. Drives the connection/empty state UI. */
  connection: ConnectionState
  // UI
  theme: 'light' | 'dark'
  view: View
  tool: Tool
  layers: { ld: boolean; sen: boolean }
  sel: Selection
  // working copy of the active device's sensor config
  zones: Zone[]
  band: BandConfig
  /** The active device's mount (calibration). Persisted via the config payload. */
  mount: SensorMount | null
  // live + transient
  targets: Target[]
  draft: { pts: Point[] } | null
  cursor: Point | null
  // dirty tracking: JSON snapshot of the last config read from the device
  saved: string
  /** Apply lifecycle: 'applying' while a write+read-back is in flight. */
  applyState: 'idle' | 'applying'
  /** The last apply/revert error, surfaced near the Apply button. */
  applyError: string | null
  /**
   * Whether the MQTT publish path is available for the active polygon device, from
   * the last device read. null when not a polygon device or not yet known; false
   * when polygon and MQTT is unavailable, so the editor can state it is required.
   */
  mqttAvailable: boolean | null
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
const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** True if the working copy differs from the last applied snapshot. */
export function isDirty(s: EditorState): boolean {
  return snapshot(s.zones, s.band) !== s.saved
}

export class ZoneStudioStore {
  private state: EditorState
  private listeners = new Set<Listener>()
  private client: ZonesClient
  private unsub: Unsubscribe = () => {}
  private handle: DragHandle = null
  private idSeq = 0

  constructor(client: ZonesClient, seed: Seed) {
    this.client = client
    this.state = {
      rooms: seed.rooms,
      activeRoomId: seed.activeRoomId,
      activeDeviceId: seed.activeDeviceId,
      // A seed that already carries devices is treated as connected (the mock and
      // the tests); an empty seed starts connecting until refresh() resolves.
      connection: seed.rooms.length ? 'connected' : 'connecting',
      theme: 'light',
      view: 'wall',
      tool: 'select',
      layers: { ld: true, sen: true },
      sel: { kind: 'zone', id: seed.zones[0]?.id ?? '' },
      zones: seed.zones,
      band: seed.band,
      mount: null,
      targets: [],
      draft: null,
      cursor: null,
      saved: snapshot(seed.zones, seed.band),
      applyState: 'idle',
      applyError: null,
      mqttAvailable: null,
    }
    this.resub(seed.activeDeviceId)
  }

  /**
   * Discover the model from the data source and load the active device, setting
   * the connection state honestly. This is the production entry point (called by
   * instance.ts on start and by the offline-state retry). It never falls back to
   * simulated data: a failure becomes the offline state, an empty result becomes
   * the no-devices state.
   */
  async refresh(): Promise<void> {
    this.set({ connection: 'connecting' })
    try {
      const rooms = await this.client.discover()
      const devices = rooms.flatMap((r) => r.devices)
      if (devices.length === 0) {
        this.resub('')
        this.set({ rooms, connection: 'no-devices', targets: [], sel: { kind: 'none' } })
        return
      }
      // Keep the current selection if it still exists, else take the first device.
      const room = rooms.find((r) => r.id === this.state.activeRoomId && r.devices.length) ?? rooms.find((r) => r.devices.length)!
      const device = room.devices.find((d) => d.id === this.state.activeDeviceId) ?? room.devices[0]
      const cfg = await this.client.readConfig(device.id)
      this.resub(device.id)
      this.set({
        rooms,
        activeRoomId: room.id,
        activeDeviceId: device.id,
        zones: cfg.zones,
        band: cfg.band,
        mount: cfg.mount ?? null,
        saved: snapshot(cfg.zones, cfg.band),
        sel: cfg.zones[0] ? { kind: 'zone', id: cfg.zones[0].id } : { kind: 'ld' },
        connection: 'connected',
        applyError: null,
        mqttAvailable: cfg.mqttAvailable ?? null,
      })
    } catch {
      // Real failure: clear any live stream and show the offline state. Do not
      // paper over it with simulated targets.
      this.resub('')
      this.set({ connection: 'offline', targets: [] })
    }
  }

  /** Re-point the live target stream at a device (empty id tears it down). */
  private resub(deviceId: string) {
    this.unsub()
    this.unsub = deviceId ? this.client.streamTargets(deviceId, (targets) => this.set({ targets })) : () => {}
  }

  /**
   * Replace the bootstrap state with data loaded from the backend.
   *
   * The HTTP client cannot seed synchronously the way the mock did, so
   * `instance.ts` constructs the store with a first-paint seed and then calls
   * this once `discover()` + `readConfig()` resolve. It only re-subscribes the
   * target stream when the active device actually changes, so the common case
   * (same device) does not drop the live WebSocket.
   */
  hydrate(seed: Seed) {
    const sameDevice = seed.activeDeviceId === this.state.activeDeviceId
    if (!sameDevice) this.unsub()
    this.set({
      rooms: seed.rooms,
      activeRoomId: seed.activeRoomId,
      activeDeviceId: seed.activeDeviceId,
      zones: seed.zones,
      band: seed.band,
      saved: snapshot(seed.zones, seed.band),
    })
    if (!sameDevice) {
      this.unsub = this.client.streamTargets(seed.activeDeviceId, (targets) => this.set({ targets }))
    }
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

  // ---- room / device picker ---------------------------------------------
  /** Select a room and switch to its first device. */
  setActiveRoom(roomId: string) {
    const room = this.state.rooms.find((r) => r.id === roomId)
    this.set({ activeRoomId: roomId })
    if (room && room.devices.length) this.selectDevice(room.devices[0].id)
  }

  /**
   * Switch the active device: re-subscribe its target stream and load its config.
   * The config read is async; a newer selection supersedes a slower read.
   */
  selectDevice(deviceId: string) {
    if (!deviceId || deviceId === this.state.activeDeviceId) return
    const room = this.state.rooms.find((r) => r.devices.some((d) => d.id === deviceId))
    this.resub(deviceId)
    this.set({ activeDeviceId: deviceId, activeRoomId: room?.id ?? this.state.activeRoomId, targets: [], applyError: null })
    void this.client
      .readConfig(deviceId)
      .then((cfg) => {
        if (this.state.activeDeviceId !== deviceId) return
        this.set({
          zones: cfg.zones,
          band: cfg.band,
          mount: cfg.mount ?? null,
          saved: snapshot(cfg.zones, cfg.band),
          sel: cfg.zones[0] ? { kind: 'zone', id: cfg.zones[0].id } : { kind: 'ld' },
          mqttAvailable: cfg.mqttAvailable ?? null,
        })
      })
      .catch(() => {
        /* a failed read leaves the previous config in place */
      })
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
  /**
   * Write the authored config to the device, then re-read so the editor and the
   * dirty baseline reflect exactly what the hardware now holds. A rejected write
   * (a non-native set, or a value the device refused) leaves the edit untouched
   * and surfaces the error.
   */
  async apply(): Promise<void> {
    const { zones, band, mount, activeDeviceId } = this.state
    if (!activeDeviceId) return
    this.set({ applyState: 'applying', applyError: null })
    try {
      await this.client.writeConfig(activeDeviceId, {
        zones: clone(zones),
        band: clone(band),
        ...(mount ? { mount } : {}),
      })
      const cfg = await this.client.readConfig(activeDeviceId)
      if (this.state.activeDeviceId !== activeDeviceId) return
      this.set({
        zones: cfg.zones,
        band: cfg.band,
        mount: cfg.mount ?? this.state.mount,
        saved: snapshot(cfg.zones, cfg.band),
        applyState: 'idle',
        applyError: null,
        mqttAvailable: cfg.mqttAvailable ?? null,
      })
    } catch (err) {
      if (this.state.activeDeviceId !== activeDeviceId) return
      this.set({ applyState: 'idle', applyError: errorMessage(err) })
    }
  }

  /** Discard edits by reading the device's current config back into the editor. */
  async revert(): Promise<void> {
    const deviceId = this.state.activeDeviceId
    if (!deviceId) return
    try {
      const cfg = await this.client.readConfig(deviceId)
      if (this.state.activeDeviceId !== deviceId) return
      this.set({
        zones: cfg.zones,
        band: cfg.band,
        mount: cfg.mount ?? this.state.mount,
        saved: snapshot(cfg.zones, cfg.band),
        applyError: null,
        mqttAvailable: cfg.mqttAvailable ?? null,
      })
    } catch (err) {
      if (this.state.activeDeviceId !== deviceId) return
      this.set({ applyError: errorMessage(err) })
    }
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
