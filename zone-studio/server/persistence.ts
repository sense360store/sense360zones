/*
 * Per-device persistence for the HA provider.
 *
 * Phase 2 persists exactly two things, both calibration rather than device state:
 *   - the mapping override that corrects a misdetected device, and
 *   - the per-device mount (surface, height, origin, boresight).
 *
 * Zone and band configuration persistence is Phase 3 and is intentionally not
 * stored here. The record lives in `${dataDir}/zone-studio.json`; `dataDir` is
 * `/data` inside the add-on and a temporary directory in development and tests,
 * so nothing here assumes the add-on volume exists.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SensorMount } from '../src/domain/types'
import type { DeviceMappingOverride } from './ha/types'
import type { Logger } from './ha/HaWsClient'

/** What we keep for one device. Both fields are optional. */
export interface DeviceRecord {
  mount?: SensorMount
  mapping?: DeviceMappingOverride
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
