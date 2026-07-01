import type { ChangeEvent } from 'react'
import type { DeviceCandidate, SensorKind } from '../domain/types'
import { store } from '../store/hooks'

/**
 * The device mapping and confirmation surface. It exposes what discovery matched
 * for the active device, so the operator can confirm the device as an LD2450 or a
 * SEN0609, correct the entity matched to any role, or dismiss the device as not a
 * radar sensor. Every action persists through the device mapping override, so a
 * confirmed device stays mapped and a dismissed device stays hidden across
 * restarts.
 */

const kindLabel: Record<SensorKind, string> = {
  ld2450: 'HLK LD2450',
  sen0609: 'DFRobot SEN0609',
}

/** A short, honest description of how sure discovery is about this device. */
function statusLine(c: DeviceCandidate): { text: string; color: string } {
  if (c.confirmed) return { text: 'Confirmed by you', color: 'var(--green)' }
  if (c.confidence === 'confident') return { text: 'Confident radar signature detected', color: 'var(--green)' }
  return { text: 'No radar signature; confirm to use this device', color: 'var(--warn)' }
}

function ConfirmButton(props: { kind: SensorKind; current: SensorKind | null }) {
  const active = props.current === props.kind
  return (
    <button className={'zs-choice' + (active ? ' is-on' : '')} onClick={() => void store.confirmDevice(props.kind)}>
      {active ? '✓ ' : ''}
      {kindLabel[props.kind]}
    </button>
  )
}

export function MappingPanel(props: { candidate: DeviceCandidate | null }) {
  const c = props.candidate
  if (!c) {
    return <div className="zs-empty">No device selected.</div>
  }
  const status = statusLine(c)

  return (
    <div>
      <div className="zs-section">
        <span className="zs-eyebrow">Device mapping</span>
        <div className="zs-insp-title" style={{ marginTop: 5 }}>
          {c.kind ? kindLabel[c.kind] : 'Unconfirmed device'}
        </div>
        <div className="zs-tagline">
          <span className="zs-status" style={{ color: status.color }}>
            {status.text}
          </span>
          {c.sense360 && <span className="zs-tag">Sense360 hardware</span>}
        </div>
        {(c.manufacturer || c.node) && (
          <div className="zs-meta-lines">
            {c.manufacturer && <div>manufacturer · {c.manufacturer}</div>}
            {c.node && <div>esphome node · {c.node}</div>}
          </div>
        )}
      </div>

      <div className="zs-section">
        <div className="zs-section__head" style={{ marginBottom: 11 }}>
          <span className="zs-eyebrow">Confirm as</span>
        </div>
        <div className="zs-choice-row">
          <ConfirmButton kind="ld2450" current={c.kind} />
          <ConfirmButton kind="sen0609" current={c.kind} />
        </div>
      </div>

      <div className="zs-section">
        <div className="zs-section__head" style={{ marginBottom: 11 }}>
          <span className="zs-eyebrow">Matched entities</span>
        </div>
        {c.roles.length === 0 && (
          <div className="zs-note">
            No radar entities matched yet. Confirm the kind above, then assign the entities for each role.
          </div>
        )}
        {c.roles.map((role) => (
          <div key={role.key} className="zs-role">
            <div className="zs-kv" style={{ marginBottom: 5 }}>
              <span className="zs-kv__label">{role.label}</span>
              <span className={'zs-role__state' + (role.entityId ? ' is-matched' : '')}>
                {role.entityId ? 'matched' : 'unset'}
              </span>
            </div>
            <input
              className="zs-input zs-input--sm"
              type="text"
              defaultValue={role.entityId ?? ''}
              placeholder="entity id"
              onBlur={(e: ChangeEvent<HTMLInputElement>) => {
                const next = e.target.value.trim()
                if (next !== (role.entityId ?? '')) void store.correctRole(role.key, next)
              }}
            />
          </div>
        ))}
      </div>

      <div className="zs-section zs-section--last">
        <div className="zs-note" style={{ marginBottom: 11 }}>
          Not a radar sensor? Dismiss it and discovery will keep it hidden.
        </div>
        <button className="zs-btn zs-btn--danger zs-btn--block" onClick={() => void store.dismissDevice()}>
          Dismiss device
        </button>
      </div>
    </div>
  )
}
