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

/** Profile + what Apply does + apply error, pinned below the zone list. */
export function ApplyGuardrail(props: { view: ApplyView }) {
  const { resolution, error, mqttAvailable } = props.view
  const polygon = resolution.profile === 'polygon'
  return (
    <div className="zs-guardrail">
      <span className="zs-eyebrow">Apply profile · {polygon ? 'POLYGON' : 'NATIVE'}</span>
      {!polygon ? (
        <div className="zs-card zs-card--green">
          Up to three axis-aligned rectangles under one mode apply straight to the LD2450.
        </div>
      ) : (
        <div className="zs-card">
          <div className="zs-guardrail__title">Live occupancy over MQTT</div>
          Occupancy is evaluated live by the add-on and published to Home Assistant over MQTT. The sensor is set to
          report all targets. Generate an ESPHome config below for a durable on-device version.
          <div className="zs-guardrail__why">
            Why polygon, not native:
            <ul>
              {resolution.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
          {mqttAvailable === false && (
            <div className="zs-card zs-card--warn zs-guardrail__warn">
              The MQTT integration is required to publish these entities. The canvas preview still works without it.
            </div>
          )}
        </div>
      )}
      {error && <div className="zs-guardrail__error">{error}</div>}
    </div>
  )
}
