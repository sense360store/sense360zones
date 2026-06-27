/*
 * The apply guardrail: it surfaces the active profile and what Apply will do.
 *
 * Phase 4 makes the polygon profile real, so a non-native set is no longer blocked:
 * Apply puts the LD2450 into report-all mode and the add-on evaluates the zones
 * live and publishes occupancy entities over MQTT. The guardrail explains that in
 * plain language and reuses the resolver reasons (why the set is polygon) already
 * surfaced in Phase 3. `applyView` is the pure state->view mapping (split out so it
 * is unit-testable without rendering); `ApplyGuardrail` renders it.
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
  /** Apply is allowed: dirty, not mid-apply, a device selected. Both profiles apply. */
  canApply: boolean
  applying: boolean
  error: string | null
  /** MQTT availability for the active polygon device (null = native or unknown). */
  mqttAvailable: boolean | null
}

/**
 * Derive the apply state from the editor: the profile and its reasons (judged in
 * the sensor frame, so mount-aware), whether the edit is dirty against the device,
 * and whether Apply is enabled. In Phase 4 both profiles can be applied, so Apply
 * no longer depends on the set being native-eligible.
 */
export function applyView(s: EditorState): ApplyView {
  const resolution = resolveProfile(s.zones, s.mount ?? DEFAULT_MOUNT)
  const dirty = isDirty(s)
  const applying = s.applyState === 'applying'
  const canApply = dirty && !applying && Boolean(s.activeDeviceId)
  return { resolution, dirty, canApply, applying, error: s.applyError, mqttAvailable: s.mqttAvailable }
}

const okBox = 'margin-top:4px;padding:10px 12px;border-radius:9px;background:var(--greenSoft);border:1px solid var(--green);'
const polyBox = 'margin-top:4px;padding:10px 12px;border-radius:9px;background:var(--ins);border:1px solid var(--bd);'
const warnBox = 'margin-top:8px;padding:9px 11px;border-radius:8px;background:var(--exclSoft);border:1px solid var(--excl);'

/** Profile + what Apply does + apply error, pinned below the zone list. */
export function ApplyGuardrail(props: { view: ApplyView }) {
  const { resolution, error, mqttAvailable } = props.view
  const polygon = resolution.profile === 'polygon'
  return (
    <div style={css('padding:10px 18px 14px;border-top:1px solid var(--bd2);')}>
      <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:8px;')}>
        APPLY PROFILE · {polygon ? 'POLYGON' : 'NATIVE'}
      </div>
      {!polygon ? (
        <div style={css(okBox + 'font-size:11.5px;color:var(--tx);line-height:1.5;')}>
          Up to three axis-aligned rectangles under one mode apply straight to the LD2450.
        </div>
      ) : (
        <div style={css(polyBox)}>
          <div style={css('font-size:11.5px;font-weight:700;color:var(--tx);margin-bottom:6px;')}>
            Live occupancy over MQTT
          </div>
          <div style={css('font-size:11.5px;color:var(--tx);line-height:1.5;')}>
            Occupancy is evaluated live by the add-on and published to Home Assistant over MQTT. The sensor is set to
            report all targets. Generate an ESPHome config below for a durable on-device version.
          </div>
          <div style={css('margin-top:8px;font-size:11px;color:var(--mut);line-height:1.55;')}>
            Why polygon, not native:
            <ul style={css('margin:4px 0 0;padding-left:16px;')}>
              {resolution.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
          {mqttAvailable === false && (
            <div style={css(warnBox + 'font-size:11px;color:var(--tx);line-height:1.5;')}>
              The MQTT integration is required to publish these entities. The canvas preview still works without it.
            </div>
          )}
        </div>
      )}
      {error && (
        <div style={css('margin-top:8px;font-size:11.5px;color:var(--excl);line-height:1.5;')}>{error}</div>
      )}
    </div>
  )
}
