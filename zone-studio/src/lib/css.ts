import type { CSSProperties } from 'react'

/**
 * Build a React style object that sets CSS custom properties. The stylesheet
 * (styles/zonestudio.css) owns every static declaration; the components pass
 * only genuinely dynamic values — a zone's accent colour, a target's colour —
 * through custom properties that the classes then consume.
 */
export function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties
}
