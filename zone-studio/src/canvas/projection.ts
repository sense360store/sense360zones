/*
 * Projection between room coordinates (metres) and canvas pixels, for the
 * current mount view. Pure and view-scoped; the geometry math itself stays in
 * `domain/geometry.ts`.
 */
import type { Point } from '../domain/types'
import type { View } from '../store/store'
import { ORIGIN_Y, SCALE, SX, VIEWBOX_H, VIEWBOX_W } from './constants'

export interface Projection {
  scale: number
  originY: number
  sx: number
  /** metres → pixels */
  toPx(xm: number, ym: number): Point
  /** pixels → metres */
  toM(p: Point): Point
}

export function makeProjection(view: View): Projection {
  const scale = SCALE[view]
  const originY = ORIGIN_Y[view]
  return {
    scale,
    originY,
    sx: SX,
    toPx: (xm, ym) => ({ x: SX + xm * scale, y: originY + ym * scale }),
    toM: (p) => ({ x: (p.x - SX) / scale, y: (p.y - originY) / scale }),
  }
}

/** Map a pointer/mouse event to a point in the 860×760 viewbox. */
export function svgPointFromEvent(e: { currentTarget: Element; clientX: number; clientY: number }): Point {
  const el = e.currentTarget as SVGElement
  const svg = (el.ownerSVGElement ?? el) as SVGSVGElement
  const r = svg.getBoundingClientRect()
  return {
    x: ((e.clientX - r.left) / r.width) * VIEWBOX_W,
    y: ((e.clientY - r.top) / r.height) * VIEWBOX_H,
  }
}
