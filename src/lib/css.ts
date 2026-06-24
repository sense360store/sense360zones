import type { CSSProperties } from 'react'

/**
 * Convert a CSS declaration string — the kind used inline throughout the
 * original `Zone Studio.dc.html` prototype, e.g.
 *   "height:56px;display:flex;background:var(--panel)"
 * — into a React style object. This lets us port the design's inline styles
 * (and the dynamic style strings computed in the view model) verbatim, instead
 * of hand-translating hundreds of declarations and risking drift.
 *
 * Standard kebab-case properties are camelCased (`stroke-width` -> `strokeWidth`).
 * CSS custom properties (`--foo`) are preserved as-is. Values pass through
 * untouched, so `var(--green)`, `rgba(...)`, `0 0 14px ...` all work.
 */
export function css(decls: string): CSSProperties {
  const out: Record<string, string> = {}
  if (!decls) return out as CSSProperties

  for (const part of decls.split(';')) {
    const seg = part.trim()
    if (!seg) continue

    // Split on the first colon only — values may contain `:` is rare here,
    // but data URLs / pseudo-values stay intact this way.
    const idx = seg.indexOf(':')
    if (idx === -1) continue

    const rawProp = seg.slice(0, idx).trim()
    const value = seg.slice(idx + 1).trim()
    if (!rawProp) continue

    const prop = rawProp.startsWith('--')
      ? rawProp
      : rawProp.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())

    out[prop] = value
  }

  return out as CSSProperties
}
