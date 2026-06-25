/*
 * NATIVE vs POLYGON profile resolution (see DECISIONS.md §3.1).
 *
 * The LD2450 firmware can host at most 3 axis-aligned rectangular zones under a
 * single global filter mode (all detection, or all exclusion). Any zone set
 * that needs more than that — a polygon, a rotated rectangle, a 4th zone, or a
 * mix of detection and exclusion — must run on the POLYGON profile, which
 * evaluates zones in software / generated config instead.
 *
 * This logic is defined now so it is the single source of truth for every later
 * phase. It is not yet surfaced in the UI (Phase 0 makes no user-visible
 * change); Phase 3 enforces the native constraints and Phase 4 drives the
 * profile switch UX.
 */
import type { Profile, Zone } from './types'

/** Maximum number of hardware zones the LD2450 can host natively. */
export const MAX_NATIVE_ZONES = 3

function normalizeRot(rot: number): number {
  return ((rot % 360) + 360) % 360
}

/** True if the zone is an axis-aligned rectangle (the only natively-pushable shape). */
export function isAxisAlignedRect(z: Zone): boolean {
  return z.shape === 'rect' && normalizeRot(z.rot) === 0
}

/** True if this single zone could be represented in a NATIVE region register. */
export function isZoneNativeEligible(z: Zone): boolean {
  return isAxisAlignedRect(z)
}

export interface ProfileResolution {
  profile: Profile
  /** Human-readable reasons the device must use POLYGON (empty when native). */
  reasons: string[]
}

/**
 * Resolve the profile a device must use to represent the given zone set, with
 * the reasons NATIVE is unavailable (for the UI to surface).
 */
export function resolveProfile(zones: Zone[]): ProfileResolution {
  const reasons: string[] = []
  if (zones.length > MAX_NATIVE_ZONES) {
    reasons.push(`More than ${MAX_NATIVE_ZONES} zones (${zones.length})`)
  }
  if (zones.some((z) => z.shape === 'poly')) {
    reasons.push('Contains a polygon zone')
  }
  if (zones.some((z) => z.shape === 'rect' && normalizeRot(z.rot) !== 0)) {
    reasons.push('Contains a rotated rectangle')
  }
  if (new Set(zones.map((z) => z.type)).size > 1) {
    reasons.push('Mixes detection and exclusion zones')
  }
  return { profile: reasons.length ? 'polygon' : 'native', reasons }
}
