/*
 * MockZonesClient — the Phase 0 stand-in for a real backend.
 *
 * It owns *all* of today's simulated data: the Living Room device model, the
 * initial zones/band, and the bouncing-target animation that used to live in
 * the component's `requestAnimationFrame` loop. Phase 2 replaces it with a
 * client that streams real LD2450 coordinates over a WebSocket bridge — the UI
 * and store do not change, only which `ZonesClient` is wired in.
 *
 * Fidelity note (DECISIONS.md §3.1): the target simulation is view-agnostic —
 * targets bounce within the LD2450's *physical* field of view (forward cone,
 * range-limited), so both the wall and ceiling views render the same physical
 * positions. The prototype let targets roam the full disc in ceiling view; the
 * default wall view is identical, and the cone is the physically correct region.
 */
import { LD2450_FOV_HALF, LD2450_RANGE } from '../domain/constants'
import type { BandConfig, Device, Room, Sensor, Target, Zone } from '../domain/types'
import type { DeviceConfig, TargetListener, Unsubscribe, ZonesClient } from './ZonesClient'

/** Synchronous bootstrap snapshot, used to seed the store without a load flash. */
export interface Seed {
  rooms: Room[]
  activeRoomId: string
  activeDeviceId: string
  zones: Zone[]
  band: BandConfig
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function makeRooms(): Room[] {
  const zones: Zone[] = [
    { id: 'z1', name: 'Desk', type: 'detection', shape: 'rect', cx: -1.5, cy: 1.7, w: 1.9, h: 1.25, rot: 0 },
    { id: 'z2', name: 'Entry', type: 'detection', shape: 'rect', cx: 1.7, cy: 1.05, w: 1.45, h: 1.05, rot: 24 },
    { id: 'z3', name: 'Couch', type: 'exclusion', shape: 'rect', cx: -1.45, cy: 3.95, w: 2.4, h: 1.3, rot: 0 },
    {
      id: 'z4',
      name: 'Kitchen run',
      type: 'detection',
      shape: 'poly',
      pts: [
        { x: 0.5, y: 3.1 },
        { x: 2.5, y: 3.1 },
        { x: 2.5, y: 4.7 },
        { x: 1.7, y: 4.7 },
        { x: 1.7, y: 3.95 },
        { x: 0.5, y: 3.95 },
      ],
    },
  ]
  const band: BandConfig = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0.0 }

  const sensors: Sensor[] = [
    {
      id: 'sen-ld-1',
      name: 'HLK LD2450',
      kind: 'ld2450',
      mount: { surface: 'wall', height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 },
      fovHalf: LD2450_FOV_HALF,
      range: LD2450_RANGE,
      zones,
    },
    {
      id: 'sen-c4001-1',
      name: 'DFRobot SEN0609',
      kind: 'sen0609',
      mount: { surface: 'wall', height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 },
      band,
    },
  ]
  const device: Device = { id: 'dev-living-1', name: 'Sense360 · Living Room', sensors }
  return [{ id: 'room-living', name: 'Living Room', devices: [device] }]
}

function makeTargets(): Target[] {
  return [
    { id: 't1', x: -1.5, y: 1.8, vx: 0.16, vy: 0.07, color: 'var(--green)', trail: [] },
    { id: 't2', x: 1.7, y: 1.0, vx: -0.13, vy: 0.17, color: '#2d8fff', trail: [] },
    { id: 't3', x: 0.9, y: 3.6, vx: 0.12, vy: -0.14, color: '#e0922a', trail: [] },
  ]
}

export class MockZonesClient implements ZonesClient {
  private rooms: Room[] = makeRooms()
  private targets: Target[] = makeTargets()

  // animation bookkeeping (was the component's _raf / _last / _trailT)
  private raf: number | null = null
  private last = 0
  private trailT = 0
  private listeners = new Set<TargetListener>()

  /** Find the LD2450/SEN0609 config for a device in the model. */
  private deviceConfig(deviceId: string): DeviceConfig {
    const device = this.rooms.flatMap((r) => r.devices).find((d) => d.id === deviceId)
    const ld = device?.sensors.find((s): s is Extract<Sensor, { kind: 'ld2450' }> => s.kind === 'ld2450')
    const sen = device?.sensors.find((s): s is Extract<Sensor, { kind: 'sen0609' }> => s.kind === 'sen0609')
    return {
      zones: clone(ld?.zones ?? []),
      band: clone(sen?.band ?? { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0 }),
    }
  }

  /** Synchronous seed for the store (avoids a load flash; Phase 2 goes async). */
  seed(): Seed {
    const activeRoomId = this.rooms[0].id
    const activeDeviceId = this.rooms[0].devices[0].id
    const { zones, band } = this.deviceConfig(activeDeviceId)
    return { rooms: clone(this.rooms), activeRoomId, activeDeviceId, zones, band }
  }

  async discover(): Promise<Room[]> {
    return clone(this.rooms)
  }

  async readConfig(deviceId: string): Promise<DeviceConfig> {
    return this.deviceConfig(deviceId)
  }

  async writeConfig(deviceId: string, config: DeviceConfig): Promise<void> {
    const device = this.rooms.flatMap((r) => r.devices).find((d) => d.id === deviceId)
    if (!device) return
    for (const s of device.sensors) {
      if (s.kind === 'ld2450') s.zones = clone(config.zones)
      if (s.kind === 'sen0609') s.band = clone(config.band)
    }
  }

  streamTargets(_deviceId: string, onSample: TargetListener): Unsubscribe {
    this.listeners.add(onSample)
    if (this.raf === null) this.start()
    onSample(this.targets)
    return () => {
      this.listeners.delete(onSample)
      if (this.listeners.size === 0) this.stop()
    }
  }

  private start() {
    // No-op outside the browser (SSR / tests); the immediate onSample in
    // streamTargets still seeds the initial targets.
    if (typeof requestAnimationFrame === 'undefined') return
    this.last = 0
    this.raf = requestAnimationFrame(this.loop)
  }

  private stop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
  }

  private emit() {
    for (const l of this.listeners) l(this.targets)
  }

  private loop = (ts: number) => {
    if (!this.last) this.last = ts
    const dt = Math.min(0.05, (ts - this.last) / 1000)
    this.last = ts
    this.trailT += dt
    const pushTrail = this.trailT > 0.06
    if (pushTrail) this.trailT = 0

    const rng = LD2450_RANGE
    const ha = (LD2450_FOV_HALF * Math.PI) / 180

    this.targets = this.targets.map((t) => {
      let nx = t.x + t.vx * dt * 1.3
      let ny = t.y + t.vy * dt * 1.3
      let vx = t.vx
      let vy = t.vy
      const r = Math.hypot(nx, ny)
      // Bounce within the LD2450's physical field of view (forward cone).
      if (ny < 0.4) {
        ny = 0.4
        vy = Math.abs(vy)
      }
      if (r > rng - 0.4) {
        const k = (rng - 0.4) / r
        nx *= k
        ny *= k
        vy = -Math.abs(vy)
      }
      const ang = Math.atan2(nx, ny)
      if (Math.abs(ang) > ha - 0.06) {
        vx = -vx
        nx = Math.tan(Math.sign(ang) * (ha - 0.08)) * ny
      }
      let trail = t.trail
      if (pushTrail) trail = [...t.trail, { x: nx, y: ny }].slice(-16)
      return { ...t, x: nx, y: ny, vx, vy, trail }
    })

    this.emit()
    this.raf = requestAnimationFrame(this.loop)
  }
}
