/*
 * Physical sensor facts. These describe the hardware, not the rendering, so
 * they live in the domain layer; the canvas and the mock client both read
 * them. Display-only constants (viewbox, scales, ring count) live in
 * `canvas/constants.ts` instead.
 */

/** LD2450 field-of-view half-angle, degrees (120° total). */
export const LD2450_FOV_HALF = 60

/** LD2450 maximum range, metres. */
export const LD2450_RANGE = 6.0
