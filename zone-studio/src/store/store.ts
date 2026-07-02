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
import type {
  BandConfig,
  Device,
  DeviceCandidate,
  MappingUpdate,
  Point,
  PolyZone,
  RectZone,
  Room,
  SensorKind,
  SensorMount,
  Target,
  Zone,
} from '../domain/types'
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
 *
 * Every non-connected state is self-recovering once `startAutoRecovery` runs:
 * offline and no-devices re-discover in the background, and connected is watched
 * with a status heartbeat so a dropped Home Assistant is noticed without a click.
 */
export type ConnectionState = 'connecting' | 'connected' | 'no-devices' | 'offline'

/** Cadence for the self-recovery loop (overridable per call, mainly for tests). */
export interface RecoveryOptions {
  /** Delay between background re-discoveries while offline or no-devices. */
  retryMs?: number
  /** Delay between status polls while connected. */
  heartbeatMs?: number
  /** Consecutive failed polls before the live view yields to the offline state. */
  gracePolls?: number
}

const RECOVERY_RETRY_MS = 5000
const RECOVERY_HEARTBEAT_MS = 5000
const RECOVERY_GRACE_POLLS = 2

/** Maximum undo depth. Older steps fall off the back of the history. */
const HISTORY_LIMIT = 50

export type Selection =
  | { kind: 'zone'; id: string }
  | { kind: 'sen' } // SEN0609 radial band
  | { kind: 'ld' } // LD2450 sensor
  | { kind: 'device' } // the device mapping / confirmation surface
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
  /** The radar sensor kinds the active device actually has; drives the layers and canvas. */
  sensors: SensorKind[]
  /** The active device's discovery metadata; drives the mapping/confirmation surface. */
  candidate: DeviceCandidate | null
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
  /** Zone under the pointer (canvas or list row), for the shared hover highlight. */
  hoverZoneId: string | null
  /**
   * The in-flight canvas drag, mirrored from the imperative handle so the canvas
   * can show live feedback (a size/position readout, the rubber-band rectangle)
   * while the user drags. Presentation only; cleared on release.
   */
  drag: { mode: 'move' | 'corner' | 'rotate' | 'vertex' | 'minR' | 'maxR' | 'create'; start?: Point } | null
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
  /** Whether an undo / redo step is available. Drives the toolbar controls. */
  canUndo: boolean
  canRedo: boolean
}

/**
 * One step of the authored editing session, as it was before an edit. Undo and
 * redo restore exactly this: the working copy (zones, band, mount), the mount
 * view toggle, and the selection — never the device, the connection, or the
 * apply lifecycle. `saved` is deliberately not captured, so stepping through
 * history recomputes dirtiness against the unchanged device baseline.
 */
interface HistoryEntry {
  zones: Zone[]
  band: BandConfig
  mount: SensorMount | null
  view: View
  sel: Selection
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

/** Find a device across rooms by id. */
function findDevice(rooms: Room[], deviceId: string): Device | undefined {
  for (const r of rooms) {
    const d = r.devices.find((d) => d.id === deviceId)
    if (d) return d
  }
  return undefined
}

/** The radar sensor kinds a device actually carries (empty for a candidate). */
function deviceSensorKinds(device: Device | undefined): SensorKind[] {
  return device ? device.sensors.map((s) => s.kind) : []
}

/**
 * The default selection for a device: a zone (or the LD2450) when it has spatial
 * tracking, the band when it is a SEN0609, and the mapping surface when it has no
 * confirmed radar sensor, so the user is invited to confirm rather than shown an
 * empty canvas.
 */
function defaultSelection(sensors: SensorKind[], zones: Zone[]): Selection {
  if (sensors.includes('ld2450')) return zones[0] ? { kind: 'zone', id: zones[0].id } : { kind: 'ld' }
  if (sensors.includes('sen0609')) return { kind: 'sen' }
  return { kind: 'device' }
}

/** Whether a selection still points at something the refreshed device carries. */
function selectionValid(sel: Selection, sensors: SensorKind[], zones: Zone[]): boolean {
  switch (sel.kind) {
    case 'zone':
      return zones.some((z) => z.id === sel.id)
    case 'ld':
      return sensors.includes('ld2450')
    case 'sen':
      return sensors.includes('sen0609')
    case 'device':
      return true
    case 'none':
      return false
  }
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
    const seedDevice = findDevice(seed.rooms, seed.activeDeviceId)
    const seedSensors = deviceSensorKinds(seedDevice)
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
      sensors: seedSensors,
      candidate: seedDevice?.candidate ?? null,
      sel: { kind: 'zone', id: seed.zones[0]?.id ?? '' },
      zones: seed.zones,
      band: seed.band,
      mount: null,
      targets: [],
      draft: null,
      cursor: null,
      hoverZoneId: null,
      drag: null,
      saved: snapshot(seed.zones, seed.band),
      applyState: 'idle',
      applyError: null,
      mqttAvailable: null,
      canUndo: false,
      canRedo: false,
    }
    this.resub(seed.activeDeviceId)
  }

  /**
   * Discover the model from the data source and load the active device, setting
   * the connection state honestly. This is the production entry point (called by
   * instance.ts on start, by the offline-state retry, and by the auto-recovery
   * loop). It never falls back to simulated data: a failure becomes the offline
   * state, an empty result becomes the no-devices state.
   *
   * `background` marks an automatic retry: the current state stays on screen
   * until the outcome (no connecting flicker every few seconds), and a selection
   * that still exists is kept rather than reset.
   */
  async refresh(opts: { background?: boolean } = {}): Promise<void> {
    if (!opts.background) this.set({ connection: 'connecting' })
    try {
      const rooms = await this.client.discover()
      const devices = rooms.flatMap((r) => r.devices)
      if (devices.length === 0) {
        this.resub('')
        this.set({ rooms, connection: 'no-devices', targets: [], sensors: [], candidate: null, sel: { kind: 'none' } })
        return
      }
      // Keep the current selection if it still exists, else take the first device.
      const room = rooms.find((r) => r.id === this.state.activeRoomId && r.devices.length) ?? rooms.find((r) => r.devices.length)!
      const device = room.devices.find((d) => d.id === this.state.activeDeviceId) ?? room.devices[0]
      const sensors = deviceSensorKinds(device)
      const cfg = await this.client.readConfig(device.id)
      // Reconnecting must not cost the user their work: on the same device a
      // dirty working copy is kept, rebased onto the fresh device baseline.
      const sameDevice = device.id === this.state.activeDeviceId
      const keepEdit = sameDevice && isDirty(this.state)
      const zones = keepEdit ? this.state.zones : cfg.zones
      const band = keepEdit ? this.state.band : cfg.band
      const keepSel = Boolean(opts.background) && sameDevice && selectionValid(this.state.sel, sensors, zones)
      // A kept edit keeps its undo history; a working copy reloaded from the
      // device starts a fresh editing session.
      if (!keepEdit) this.clearHistory()
      this.resub(device.id)
      this.set({
        rooms,
        activeRoomId: room.id,
        activeDeviceId: device.id,
        sensors,
        candidate: device.candidate ?? null,
        zones,
        band,
        mount: cfg.mount ?? null,
        saved: snapshot(cfg.zones, cfg.band),
        sel: keepSel ? this.state.sel : defaultSelection(sensors, zones),
        connection: 'connected',
        applyError: null,
        mqttAvailable: cfg.mqttAvailable ?? null,
      })
    } catch {
      // Real failure: clear any live stream and show the offline state. Do not
      // paper over it with simulated targets.
      this.resub('')
      this.set({ connection: 'offline', targets: [] })
    } finally {
      // Re-pace the recovery loop for the state we landed in (no-op when the
      // loop is not running). A manual retry resets the cadence the same way.
      this.scheduleRecoveryTick()
    }
  }

  // ---- self-recovery -------------------------------------------------------
  private recovery: Required<RecoveryOptions> | null = null
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private recoveryBusy = false
  private badPolls = 0

  /**
   * Start the self-recovery loop (production entry: instance.ts). While offline
   * or no-devices it re-discovers in the background until the condition clears;
   * while connected it polls the backend status so a dropped Home Assistant is
   * noticed (after a short grace, so a reconnect blip does not flicker the UI)
   * and an MQTT flip is surfaced. Manual Retry stays available but is no longer
   * needed for any of these transitions.
   */
  startAutoRecovery(opts: RecoveryOptions = {}): void {
    this.recovery = {
      retryMs: opts.retryMs ?? RECOVERY_RETRY_MS,
      heartbeatMs: opts.heartbeatMs ?? RECOVERY_HEARTBEAT_MS,
      gracePolls: opts.gracePolls ?? RECOVERY_GRACE_POLLS,
    }
    this.scheduleRecoveryTick()
  }

  private scheduleRecoveryTick(): void {
    if (!this.recovery) return
    if (this.recoveryTimer !== null) clearTimeout(this.recoveryTimer)
    const delay = this.state.connection === 'connected' ? this.recovery.heartbeatMs : this.recovery.retryMs
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      void this.recoveryTick()
    }, delay)
  }

  private async recoveryTick(): Promise<void> {
    if (!this.recovery || this.recoveryBusy) return
    this.recoveryBusy = true
    try {
      if (this.state.connection === 'connected') {
        await this.heartbeat()
      } else if (this.state.connection !== 'connecting') {
        // offline / no-devices: try again quietly. refresh() reschedules.
        await this.refresh({ background: true })
        return
      }
    } finally {
      this.recoveryBusy = false
    }
    this.scheduleRecoveryTick()
  }

  /** One status poll while connected. */
  private async heartbeat(): Promise<void> {
    try {
      const status = await this.client.status()
      if (status.ha === 'connected') {
        this.badPolls = 0
        // Surface an MQTT flip for the active polygon device without touching
        // the working copy (null means MQTT is not relevant to this device).
        if (this.state.mqttAvailable !== null && status.mqtt !== null && status.mqtt !== this.state.mqttAvailable) {
          this.set({ mqttAvailable: status.mqtt })
        }
        return
      }
      this.onHeartbeatFailure()
    } catch {
      this.onHeartbeatFailure()
    }
  }

  private onHeartbeatFailure(): void {
    this.badPolls += 1
    if (this.badPolls < (this.recovery?.gracePolls ?? RECOVERY_GRACE_POLLS)) return
    this.badPolls = 0
    // The live view is no longer true: clear the stream and show the offline
    // state. The recovery loop then re-discovers until the connection returns.
    this.resub('')
    this.set({ connection: 'offline', targets: [] })
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
    const device = findDevice(seed.rooms, seed.activeDeviceId)
    this.clearHistory()
    this.set({
      rooms: seed.rooms,
      activeRoomId: seed.activeRoomId,
      activeDeviceId: seed.activeDeviceId,
      sensors: deviceSensorKinds(device),
      candidate: device?.candidate ?? null,
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
    this.recovery = null
    if (this.recoveryTimer !== null) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
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

  // ---- edit history (undo / redo) ----------------------------------------
  //
  // The history covers the authored editing session only. Every editing action
  // pushes the pre-edit state; Apply, Revert, switching device, and any reload
  // of the working copy from the device end the session and clear the history,
  // so undo can never reach across the Apply boundary or reanimate another
  // device's zones. Continuous inputs are collapsed to one step each: a canvas
  // drag records once per gesture, a slider once per run of changes.
  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  /** Coalescing key of the last recorded edit; a matching next edit merges. */
  private editRunKey: string | null = null
  /** Pre-gesture state, pushed at gesture end if the gesture changed anything. */
  private gesturePre: HistoryEntry | null = null

  private historyEntry(): HistoryEntry {
    const s = this.state
    return { zones: clone(s.zones), band: clone(s.band), mount: s.mount ? clone(s.mount) : null, view: s.view, sel: s.sel }
  }

  /** The authored (undoable) part of an entry, for change detection. */
  private static authored(e: HistoryEntry): string {
    return JSON.stringify({ zones: e.zones, band: e.band, mount: e.mount, view: e.view })
  }

  private pushPast(entry: HistoryEntry) {
    this.past.push(entry)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
    this.set({ canUndo: true, canRedo: false })
  }

  /**
   * Run a mutation as one undoable step. The pre-edit state is pushed only if
   * the mutation actually changed the authored state, so a no-op action never
   * creates an empty step. `runKey` coalesces consecutive changes from the same
   * continuous control (a slider emits one change per tick) into a single step;
   * the run breaks on any other action, a gesture, undo/redo, or endSliderEdit().
   */
  private recordEdit(fn: () => void, runKey?: string) {
    const pre = this.historyEntry()
    fn()
    if (ZoneStudioStore.authored(pre) === ZoneStudioStore.authored(this.historyEntry())) return
    if (!(runKey && runKey === this.editRunKey)) this.pushPast(pre)
    this.editRunKey = runKey ?? null
  }

  /** Start a canvas drag gesture: the whole gesture becomes one undo step. */
  private beginGesture() {
    if (this.gesturePre) this.endGesture()
    this.gesturePre = this.historyEntry()
    this.editRunKey = null
  }

  /** End a canvas drag gesture; records it only if something actually changed. */
  private endGesture() {
    const pre = this.gesturePre
    this.gesturePre = null
    if (!pre) return
    if (ZoneStudioStore.authored(pre) !== ZoneStudioStore.authored(this.historyEntry())) this.pushPast(pre)
  }

  /**
   * End a slider run (pointer released or focus left), so the next adjustment
   * of the same slider becomes its own undo step.
   */
  endSliderEdit() {
    this.editRunKey = null
  }

  /** Forget the session's history. Called wherever the working copy is replaced from the device. */
  private clearHistory() {
    this.past = []
    this.future = []
    this.editRunKey = null
    this.gesturePre = null
    if (this.state.canUndo || this.state.canRedo) this.set({ canUndo: false, canRedo: false })
  }

  /** Step the editing session back one edit. Ignored during an active drag. */
  undo() {
    if (this.handle || this.past.length === 0) return
    const entry = this.past.pop()!
    this.future.push(this.historyEntry())
    this.restore(entry)
  }

  /** Reapply the last undone edit. Ignored during an active drag. */
  redo() {
    if (this.handle || this.future.length === 0) return
    const entry = this.future.pop()!
    this.past.push(this.historyEntry())
    this.restore(entry)
  }

  private restore(e: HistoryEntry) {
    this.editRunKey = null
    const sel = selectionValid(e.sel, this.state.sensors, e.zones) ? e.sel : defaultSelection(this.state.sensors, e.zones)
    this.set({
      zones: clone(e.zones),
      band: clone(e.band),
      mount: e.mount ? clone(e.mount) : null,
      view: e.view,
      sel,
      draft: null,
      hoverZoneId: null,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    })
  }

  // ---- simple actions ----------------------------------------------------
  toggleTheme() {
    this.setFn((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))
  }
  /** The mount view toggle (wall/ceiling) is authored state, so it is undoable. */
  setView(view: View) {
    this.recordEdit(() => this.set({ view }))
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
  /** Open the device mapping / confirmation surface. */
  selectDeviceMapping() {
    this.set({ sel: { kind: 'device' } })
  }
  toggleLayer(k: 'ld' | 'sen') {
    this.setFn((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } }))
  }
  /** Hover highlight, shared between the canvas and the zone list. */
  hoverZone(id: string | null) {
    if (this.state.hoverZoneId !== id) this.set({ hoverZoneId: id })
  }

  // ---- device mapping / confirmation ------------------------------------
  /**
   * Send a mapping confirmation/correction/dismissal for the active device, then
   * re-discover so the room model and the sensor layers reflect the new decision.
   * The write rides on the config payload; the backend ignores the zones/band.
   */
  private async writeMapping(update: MappingUpdate): Promise<void> {
    const deviceId = this.state.activeDeviceId
    if (!deviceId) return
    try {
      await this.client.writeConfig(deviceId, { zones: clone(this.state.zones), band: clone(this.state.band), mapping: update })
      await this.refresh()
    } catch (err) {
      this.set({ applyError: errorMessage(err) })
    }
  }
  /** Confirm the active device as the given radar kind. */
  confirmDevice(kind: SensorKind): Promise<void> {
    return this.writeMapping({ kind, confirmed: true })
  }
  /** Hide the active device as not a radar sensor. */
  dismissDevice(): Promise<void> {
    return this.writeMapping({ dismissed: true })
  }
  /** Reassign one role (e.g. presence, distance, a target axis) to an entity. */
  correctRole(key: string, entityId: string): Promise<void> {
    return this.writeMapping({ roles: { [key]: entityId } })
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
    const device = findDevice(this.state.rooms, deviceId)
    const sensors = deviceSensorKinds(device)
    // Switching device ends the editing session; its history dies with it.
    this.clearHistory()
    this.resub(deviceId)
    this.set({
      activeDeviceId: deviceId,
      activeRoomId: room?.id ?? this.state.activeRoomId,
      sensors,
      candidate: device?.candidate ?? null,
      targets: [],
      applyError: null,
    })
    void this.client
      .readConfig(deviceId)
      .then((cfg) => {
        if (this.state.activeDeviceId !== deviceId) return
        this.set({
          zones: cfg.zones,
          band: cfg.band,
          mount: cfg.mount ?? null,
          saved: snapshot(cfg.zones, cfg.band),
          sel: defaultSelection(sensors, cfg.zones),
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
    this.recordEdit(() => this.mutateZone(id, (z) => ({ ...z, name: name || 'Zone' })))
  }
  setZoneType(id: string, type: Zone['type']) {
    this.recordEdit(() => this.mutateZone(id, (z) => ({ ...z, type })))
  }
  patchRect(id: string, patch: Partial<Pick<RectZone, 'cx' | 'cy' | 'w' | 'h' | 'rot'>>) {
    // Only the rotation comes from a continuous control (the inspector slider),
    // so only rotation runs coalesce; the numeric fields commit one step each.
    const isRotRun = Object.keys(patch).join() === 'rot'
    this.recordEdit(
      () => this.mutateZone(id, (z) => (z.shape === 'rect' ? { ...z, ...patch } : z)),
      isRotRun ? `rect:${id}:rot` : undefined,
    )
  }
  deleteZone(id: string) {
    this.recordEdit(() =>
      this.setFn((s) => {
        const zones = s.zones.filter((z) => z.id !== id)
        return { zones, hoverZoneId: null, sel: zones.length ? { kind: 'zone', id: zones[0].id } : { kind: 'none' } }
      }),
    )
  }

  // ---- band edits --------------------------------------------------------
  patchBand(patch: Partial<BandConfig>) {
    // Band edits come from the inspector sliders; one run is one undo step.
    this.recordEdit(
      () => this.setFn((s) => ({ band: { ...s.band, ...patch } })),
      'band:' + Object.keys(patch).sort().join(','),
    )
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
      // The write is committed to hardware: the editing session is complete, so
      // the history is cleared — undo never reaches back across an Apply.
      this.clearHistory()
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
      // Revert resets the session to the device state; the discarded session's
      // history goes with it (undo is editing, Revert is the device).
      this.clearHistory()
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
    this.beginGesture()
    this.handle = { mode: 'move', id, start: atM, orig: clone(z) }
    this.set({ sel: { kind: 'zone', id }, drag: { mode: 'move' } })
  }
  beginCornerResize(id: string, i: number) {
    this.beginGesture()
    this.handle = { mode: 'corner', id, i }
    this.set({ sel: { kind: 'zone', id }, drag: { mode: 'corner' } })
  }
  beginRotate(id: string) {
    this.beginGesture()
    this.handle = { mode: 'rotate', id }
    this.set({ drag: { mode: 'rotate' } })
  }
  beginVertex(id: string, i: number) {
    this.beginGesture()
    this.handle = { mode: 'vertex', id, i }
    this.set({ sel: { kind: 'zone', id }, drag: { mode: 'vertex' } })
  }
  beginRadius(which: 'minR' | 'maxR') {
    this.beginGesture()
    this.handle = { mode: which }
    this.set({ sel: { kind: 'sen' }, drag: { mode: which } })
  }
  beginCanvas(atM: Point) {
    const t = this.state.tool
    if (t === 'poly') {
      const pts = this.state.draft?.pts ?? []
      this.set({ draft: { pts: [...pts, { x: snapHalf(atM.x), y: snapHalf(atM.y) }] } })
      return
    }
    if (t === 'rect' || t === 'rot') {
      this.beginGesture()
      this.handle = { mode: 'create', start: atM }
      this.set({ drag: { mode: 'create', start: atM }, cursor: atM })
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
    if (this.state.drag) this.set({ drag: null })
    if (h && h.mode === 'create') {
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
    // One gesture, one undo step — recorded only if the drag changed anything.
    this.endGesture()
  }

  finishPolygon() {
    const d = this.state.draft
    if (!d || d.pts.length < 3) return
    const id = this.nextId()
    const z: PolyZone = { id, name: 'Polygon zone', type: 'detection', shape: 'poly', pts: d.pts }
    this.recordEdit(() =>
      this.setFn((s) => ({ zones: [...s.zones, z], draft: null, sel: { kind: 'zone', id }, tool: 'select' })),
    )
  }
}
