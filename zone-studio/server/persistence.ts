/*
 * Per-device persistence for the HA provider.
 *
 * It persists, per device:
 *   - the mapping override that corrects a misdetected device,
 *   - the per-device mount (surface, height, origin, boresight), and
 *   - the authored zone config (the in-progress edit) plus the SEN0609 band.
 *
 * The authored zones are the editor's cache, not the truth for what is on the
 * hardware: the device is the source of truth for Revert (see HaDataProvider.
 * readConfig). Persisting the edit lets the editor survive a reload, and on the
 * LD2450 it records the last applied set. The record lives in
 * `${dataDir}/zone-studio.json`; `dataDir` is `/data` inside the add-on and a
 * temporary directory in development and tests, so nothing here assumes the
 * add-on volume exists.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BandConfig, Profile, SensorMount, Zone } from '../src/domain/types'
import type { DeviceMappingOverride } from './ha/types'
import type { Logger } from './ha/HaWsClient'

/** What we keep for one device. Every field is optional. */
export interface DeviceRecord {
  mount?: SensorMount
  mapping?: DeviceMappingOverride
  /** The authored zones (in-progress edit cache; not the hardware truth). */
  zones?: Zone[]
  /** The authored SEN0609 band (kept app-side; no registers written in Phase 3). */
  band?: BandConfig
  /**
   * The active profile of the last applied set (Phase 4). For `polygon` the
   * persisted config is the source of truth (the device is in report-all mode and
   * the add-on evaluates the zones); for `native` the hardware remains the truth.
   */
  profile?: Profile
}

interface PersistedStore {
  version: number
  devices: Record<string, DeviceRecord>
}

const STORE_VERSION = 1
const FILE_NAME = 'zone-studio.json'

/** The record path for a data directory. */
export function recordPath(dataDir: string): string {
  return path.join(dataDir, FILE_NAME)
}

export class Persistence {
  private readonly file: string
  private readonly logger?: Logger
  private store: PersistedStore = { version: STORE_VERSION, devices: {} }

  constructor(dataDir: string, logger?: Logger) {
    this.file = recordPath(dataDir)
    this.logger = logger
    this.load()
  }

  /** Read the record from disk, tolerating a missing or malformed file. */
  load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<PersistedStore>
      this.store = {
        version: STORE_VERSION,
        devices: parsed.devices && typeof parsed.devices === 'object' ? parsed.devices : {},
      }
    } catch (err) {
      this.logger?.warn({ err: String(err), file: this.file }, 'ignoring an unreadable persistence file')
      this.store = { version: STORE_VERSION, devices: {} }
    }
  }

  getRecord(deviceId: string): DeviceRecord | undefined {
    return this.store.devices[deviceId]
  }

  getMount(deviceId: string): SensorMount | undefined {
    return this.store.devices[deviceId]?.mount
  }

  getMapping(deviceId: string): DeviceMappingOverride | undefined {
    return this.store.devices[deviceId]?.mapping
  }

  getZones(deviceId: string): Zone[] | undefined {
    return this.store.devices[deviceId]?.zones
  }

  getBand(deviceId: string): BandConfig | undefined {
    return this.store.devices[deviceId]?.band
  }

  getProfile(deviceId: string): Profile | undefined {
    return this.store.devices[deviceId]?.profile
  }

  /** All mapping overrides, keyed by device id. */
  getMappings(): Record<string, DeviceMappingOverride> {
    const out: Record<string, DeviceMappingOverride> = {}
    for (const [id, rec] of Object.entries(this.store.devices)) {
      if (rec.mapping) out[id] = rec.mapping
    }
    return out
  }

  setMount(deviceId: string, mount: SensorMount): void {
    this.upsert(deviceId, (rec) => ({ ...rec, mount }))
  }

  setMapping(deviceId: string, mapping: DeviceMappingOverride): void {
    this.upsert(deviceId, (rec) => ({ ...rec, mapping }))
  }

  setZones(deviceId: string, zones: Zone[]): void {
    this.upsert(deviceId, (rec) => ({ ...rec, zones }))
  }

  setBand(deviceId: string, band: BandConfig): void {
    this.upsert(deviceId, (rec) => ({ ...rec, band }))
  }

  setProfile(deviceId: string, profile: Profile): void {
    this.upsert(deviceId, (rec) => ({ ...rec, profile }))
  }

  private upsert(deviceId: string, fn: (rec: DeviceRecord) => DeviceRecord): void {
    this.store.devices[deviceId] = fn(this.store.devices[deviceId] ?? {})
    this.save()
  }

  /** Write the record atomically, creating the data directory if needed. */
  private save(): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.store, null, 2))
      renameSync(tmp, this.file)
    } catch (err) {
      this.logger?.error({ err: String(err), file: this.file }, 'failed to persist the device record')
    }
  }
}
