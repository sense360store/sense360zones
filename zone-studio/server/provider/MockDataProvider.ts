/*
 * MockDataProvider — the server-side source of today's simulated data.
 *
 * It owns the Living Room device model, the initial zones/band, and the
 * bouncing-target animation. This is the same data and the same motion that the
 * frontend `MockZonesClient` produced in Phase 0; the simulation now lives here
 * so the running app has a single source of truth behind the HTTP/WebSocket API.
 * Phase 2 replaces this with an `HaDataProvider` and the routes do not change.
 *
 * The motion is identical to the Phase 0 client. The only difference is the
 * clock: the browser drove it with requestAnimationFrame, the server drives it
 * with a fixed-interval timer. Movement is scaled by the real elapsed time, so
 * the on-screen speed and trail cadence match regardless of tick rate.
 *
 * Fidelity note (DECISIONS.md): targets bounce within the LD2450's physical
 * field of view (forward cone, range-limited), so both the wall and ceiling
 * views render the same physical positions.
 */
import { LD2450_FOV_HALF, LD2450_RANGE } from '../../src/domain/constants'
import type { BandConfig, Device, Room, Sensor, Target, Zone } from '../../src/domain/types'
import type { DataProvider, DeviceConfig, TargetListener, Unsubscribe } from './DataProvider'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Timer cadence. The motion is time-scaled, so this only sets the frame rate. */
const TICK_MS = 50

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

export class MockDataProvider implements DataProvider {
  private rooms: Room[] = makeRooms()
  private targets: Target[] = makeTargets()

  // animation bookkeeping (was the Phase 0 client's _raf / _last / _trailT)
  private timer: ReturnType<typeof setInterval> | null = null
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

  subscribeTargets(_deviceId: string, onSample: TargetListener): Unsubscribe {
    this.listeners.add(onSample)
    if (this.timer === null) this.start()
    onSample(clone(this.targets))
    return () => {
      this.listeners.delete(onSample)
      if (this.listeners.size === 0) this.stop()
    }
  }

  dispose(): void {
    this.stop()
  }

  private start() {
    this.last = 0
    this.timer = setInterval(this.tick, TICK_MS)
    // Do not keep the event loop alive solely for the animation.
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  private stop() {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  private emit() {
    const snapshot = clone(this.targets)
    for (const l of this.listeners) l(snapshot)
  }

  private tick = () => {
    const ts = Date.now()
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
  }
}
