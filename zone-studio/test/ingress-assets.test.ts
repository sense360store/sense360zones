/*
 * The built SPA must reference its assets relatively. This validates the
 * checker logic with fixtures (always) and the real build output when present.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkRelativeAssets } from '../scripts/assert-relative-assets.mjs'

describe('relative asset checker', () => {
  it('accepts relative and external references', () => {
    const html = `<script src="./assets/index.js"></script>
      <link href="./assets/index.css" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2" rel="stylesheet" />`
    expect(checkRelativeAssets(html).ok).toBe(true)
  })

  it('rejects absolute slash-prefixed asset references', () => {
    const html = `<script src="/assets/index.js"></script>`
    const res = checkRelativeAssets(html)
    expect(res.ok).toBe(false)
    expect(res.offenders).toContain('/assets/index.js')
  })
})

describe('built index.html', () => {
  const dist = path.resolve(__dirname, '..', 'dist', 'index.html')
  it.skipIf(!existsSync(dist))('uses only relative asset URLs', () => {
    const res = checkRelativeAssets(readFileSync(dist, 'utf8'))
    expect(res.offenders).toEqual([])
  })
})
