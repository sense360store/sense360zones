/*
 * Persistence: the mapping override and the per-device mount must round-trip
 * through DATA_DIR. Zone and band config persistence is Phase 3 and is not here.
 */
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Persistence, recordPath } from '../server/persistence'
import type { SensorMount } from '../src/domain/types'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zone-studio-data-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  dirs.length = 0
})

const mount: SensorMount = { surface: 'ceiling', height: 2.4, origin: { x: 0.5, y: -0.3 }, boresight: 15 }

describe('Persistence', () => {
  it('round-trips a mount through a fresh instance on the same directory', () => {
    const dir = tempDir()
    const a = new Persistence(dir)
    a.setMount('dev_ld', mount)

    const b = new Persistence(dir)
    expect(b.getMount('dev_ld')).toEqual(mount)
  })

  it('round-trips a mapping override', () => {
    const dir = tempDir()
    const a = new Persistence(dir)
    a.setMapping('dev_sen', { kind: 'ld2450', roles: { presence: 'binary_sensor.x' } })

    const b = new Persistence(dir)
    expect(b.getMapping('dev_sen')).toEqual({ kind: 'ld2450', roles: { presence: 'binary_sensor.x' } })
    expect(b.getMappings()).toHaveProperty('dev_sen')
  })

  it('keeps mount and mapping independent for the same device', () => {
    const dir = tempDir()
    const a = new Persistence(dir)
    a.setMount('dev_ld', mount)
    a.setMapping('dev_ld', { kind: 'sen0609' })

    const b = new Persistence(dir)
    expect(b.getMount('dev_ld')).toEqual(mount)
    expect(b.getMapping('dev_ld')).toEqual({ kind: 'sen0609' })
  })

  it('creates the data directory on first write and returns empty before any write', () => {
    const dir = path.join(tempDir(), 'nested', 'data')
    expect(existsSync(recordPath(dir))).toBe(false)
    const p = new Persistence(dir)
    expect(p.getMount('dev')).toBeUndefined()
    p.setMount('dev', mount)
    expect(existsSync(recordPath(dir))).toBe(true)
  })

  it('tolerates a missing file as an empty record', () => {
    const dir = tempDir()
    const p = new Persistence(dir)
    expect(p.getRecord('whatever')).toBeUndefined()
    expect(p.getMappings()).toEqual({})
  })
})
