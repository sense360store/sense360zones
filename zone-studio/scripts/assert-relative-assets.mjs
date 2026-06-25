/*
 * Ingress guard for the build output: the SPA must reference its own assets with
 * relative URLs. An absolute, slash-prefixed asset path (e.g. /assets/index.js)
 * drops the ingress base prefix and 404s under Home Assistant.
 *
 * Used two ways: imported by the test suite (checkRelativeAssets) and run
 * directly in CI after the web build as a hard gate.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Inspect built HTML for local asset references. External (http/https or
 * protocol-relative) and data: URLs are ignored; any remaining local reference
 * must be relative, never starting with a slash.
 */
export function checkRelativeAssets(html) {
  const offenders = []
  const re = /(?:src|href)\s*=\s*"([^"]+)"/g
  let m
  while ((m = re.exec(html)) !== null) {
    const url = m[1]
    if (/^(https?:)?\/\//.test(url) || url.startsWith('data:')) continue
    if (url.startsWith('/')) offenders.push(url)
  }
  return { ok: offenders.length === 0, offenders }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] === thisFile) {
  const dist = path.resolve('dist/index.html')
  if (!existsSync(dist)) {
    console.error(`assert-relative-assets: ${dist} not found. Run "npm run build:web" first.`)
    process.exit(1)
  }
  const { ok, offenders } = checkRelativeAssets(readFileSync(dist, 'utf8'))
  if (!ok) {
    console.error('assert-relative-assets: found absolute asset URLs that break ingress:')
    for (const o of offenders) console.error('  ' + o)
    process.exit(1)
  }
  console.log('assert-relative-assets: OK, all local asset URLs are relative')
}
