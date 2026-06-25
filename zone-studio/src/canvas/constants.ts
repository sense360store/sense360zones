/*
 * Canvas display constants — pixel space only. Physical sensor facts (FoV,
 * range) live in `domain/constants.ts`.
 */
export const VIEWBOX_W = 860
export const VIEWBOX_H = 760

/** Sensor origin x within the viewbox (constant across views). */
export const SX = 430

/** Metres-per-pixel scale and origin y, per mount view. */
export const SCALE = { wall: 80, ceiling: 58 } as const
export const ORIGIN_Y = { wall: 74, ceiling: 384 } as const

/** Number of 1 m range rings, and the radius (m) the spokes extend to. */
export const RING_COUNT = 6
export const SPOKE_RADIUS_M = 6.2
