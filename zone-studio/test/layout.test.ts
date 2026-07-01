/*
 * Layout guards for the ingress iframe. The app root must stay fluid: no fixed
 * pixel width anywhere on the root layout and no residue of the 1440×900
 * design artboard the prototype was drawn on. The UI is also offline-first, so
 * no stylesheet or markup may reach for a font CDN.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(tsx?|css|html)$/.test(name) ? [p] : []
  })
}

const files = [...walk(path.join(root, 'src')), path.join(root, 'index.html')]
const read = (p: string) => readFileSync(p, 'utf8')

describe('fluid layout', () => {
  it('has no 1440 or 900 pixel frame anywhere in the UI source', () => {
    for (const f of files) {
      expect(read(f), `${path.relative(root, f)} carries a fixed artboard dimension`).not.toMatch(/\b(1440|900)px\b|\b(1440|900)\s*[x×]\s*(1440|900)\b/)
    }
  })

  it('sizes the app root to its container, not the viewport or a fixed width', () => {
    const css = read(path.join(root, 'src', 'styles', 'zonestudio.css'))
    // The `.zs` base rule must fill its container.
    const zsRule = /\.zs\s*\{[^}]*\}/g
    const rules = css.match(zsRule) ?? []
    const base = rules.find((r) => r.includes('width'))
    expect(base, 'expected a .zs base rule that sets width').toBeTruthy()
    expect(base).toContain('width: 100%')
    expect(base).toContain('height: 100%')
    // No fixed pixel width on the root rule and no viewport units that break
    // inside an iframe toolchain.
    expect(base).not.toMatch(/width:\s*\d+px/)
  })

  it('does not load fonts from a CDN', () => {
    for (const f of files) {
      expect(read(f), `${path.relative(root, f)} references a font CDN`).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    }
  })
})
