/*
 * NATIVE vs POLYGON profile resolution (see DECISIONS.md §3.1).
 *
 * The LD2450 firmware can host at most 3 axis-aligned rectangular zones under a
 * single global filter mode (all detection, or all exclusion). Any zone set that
 * needs more than that — a polygon, a rotated rectangle, a 4th zone, a mix of
 * detection and exclusion, an out-of-range or overlapping region — cannot run on
 * the device natively and must use the POLYGON profile, which evaluates zones in
 * software / generated config instead (Phase 4).
 *
 * Eligibility is judged in the sensor frame, so it depends on the mount: a
 * rectangle drawn axis-aligned in the room is only a native region when its
 * orientation, combined with the mount boresight, lands on a right angle. The
 * shared `nativeViolations` is the single source of truth; this resolver maps an
 * empty violation list to NATIVE and otherwise reports the reasons for the UI.
 */
import { MAX_NATIVE_ZONES, nativeViolations } from './native'
import type { Profile, SensorMount, Zone } from './types'

export { MAX_NATIVE_ZONES }

export interface ProfileResolution {
  profile: Profile
  /** Human-readable reasons the device must use POLYGON (empty when native). */
  reasons: string[]
}

/**
 * Resolve the profile a device must use to represent the given zone set on its
 * LD2450, with the reasons NATIVE is unavailable (for the UI to surface). The
 * mount is required because axis-alignment is judged in the sensor frame.
 */
export function resolveProfile(zones: Zone[], mount: SensorMount): ProfileResolution {
  const reasons = nativeViolations(zones, mount)
  return { profile: reasons.length ? 'polygon' : 'native', reasons }
}
