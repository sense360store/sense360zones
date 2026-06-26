/*
 * The apply guardrail: it surfaces the active profile and, when the zone set
 * cannot go to the device natively, the specific reasons, in the same soft-box
 * style the SEN0609 no-zones note uses. `applyView` is the pure state->view
 * mapping (split out so it is unit-testable without rendering, like
 * `connectionView`); `ApplyGuardrail` renders it.
 */
import { css } from '../lib/css'
import { resolveProfile, type ProfileResolution } from '../domain/profile'
import type { SensorMount } from '../domain/types'
import { isDirty, type EditorState } from '../store/store'

/** Mount used to judge eligibility before a real one is loaded (Phase 0 default). */
const DEFAULT_MOUNT: SensorMount = { surface: 'wall', height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }

export interface ApplyView {
  resolution: ProfileResolution
  /** The editor differs from the last config read from the device. */
  dirty: boolean
  /** Apply is allowed: dirty, native-eligible, not mid-apply, a device selected. */
  canApply: boolean
  applying: boolean
  error: string | null
}

/**
 * Derive the apply state from the editor: the profile and its reasons (judged in
 * the sensor frame, so mount-aware), whether the edit is dirty against the device,
 * and whether Apply should be enabled.
 */
export function applyView(s: EditorState): ApplyView {
  const resolution = resolveProfile(s.zones, s.mount ?? DEFAULT_MOUNT)
  const dirty = isDirty(s)
  const applying = s.applyState === 'applying'
  const canApply = dirty && resolution.reasons.length === 0 && !applying && Boolean(s.activeDeviceId)
  return { resolution, dirty, canApply, applying, error: s.applyError }
}

const okBox = 'margin-top:4px;padding:10px 12px;border-radius:9px;background:var(--greenSoft);border:1px solid var(--green);'
const blockBox = 'margin-top:4px;padding:10px 12px;border-radius:9px;background:var(--exclSoft);border:1px solid var(--excl);'

/** Profile + reasons + apply error, pinned below the zone list. */
export function ApplyGuardrail(props: { view: ApplyView }) {
  const { resolution, error } = props.view
  const blocked = resolution.reasons.length > 0
  return (
    <div style={css('padding:10px 18px 14px;border-top:1px solid var(--bd2);')}>
      <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:8px;')}>
        APPLY PROFILE · {blocked ? 'POLYGON' : 'NATIVE'}
      </div>
      {!blocked ? (
        <div style={css(okBox + 'font-size:11.5px;color:var(--tx);line-height:1.5;')}>
          Up to three axis-aligned rectangles under one mode apply straight to the LD2450.
        </div>
      ) : (
        <div style={css(blockBox)}>
          <div style={css('font-size:11.5px;font-weight:700;color:var(--excl);margin-bottom:6px;')}>
            Cannot apply to the sensor
          </div>
          <ul style={css('margin:0;padding-left:16px;font-size:11.5px;color:var(--tx);line-height:1.6;')}>
            {resolution.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          <div style={css('margin-top:7px;font-size:11px;color:var(--mut);line-height:1.5;')}>
            These need the polygon profile, which arrives in a later release.
          </div>
        </div>
      )}
      {error && (
        <div style={css('margin-top:8px;font-size:11.5px;color:var(--excl);line-height:1.5;')}>{error}</div>
      )}
    </div>
  )
}
