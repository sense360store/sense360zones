import type { ChangeEvent } from 'react'
import { css } from '../lib/css'
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
  return { text: 'No radar signature; confirm to use this device', color: '#e0922a' }
}

function ConfirmButton(props: { kind: SensorKind; current: SensorKind | null }) {
  const active = props.current === props.kind
  return (
    <button
      onClick={() => void store.confirmDevice(props.kind)}
      style={css(
        `flex:1;height:34px;border-radius:8px;font-family:Murecho;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid ${
          active ? 'var(--green)' : 'var(--bd)'
        };background:${active ? 'var(--green)' : 'var(--ins)'};color:${active ? '#fff' : 'var(--mut)'};`,
      )}
    >
      {active ? '✓ ' : ''}
      {kindLabel[props.kind]}
    </button>
  )
}

export function MappingPanel(props: { candidate: DeviceCandidate | null }) {
  const c = props.candidate
  if (!c) {
    return (
      <div style={css('padding:40px 24px;text-align:center;color:var(--faint);font-size:13px;line-height:1.6;')}>
        No device selected.
      </div>
    )
  }
  const status = statusLine(c)

  return (
    <div>
      <div style={css('padding:17px 20px 15px;border-bottom:1px solid var(--bd2);')}>
        <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:5px;')}>
          DEVICE MAPPING
        </div>
        <div style={css('font-size:17px;font-weight:700;')}>{c.kind ? kindLabel[c.kind] : 'Unconfirmed device'}</div>
        <div style={css('display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;')}>
          <span style={css(`font-size:11px;font-weight:700;color:${status.color};`)}>{status.text}</span>
          {c.sense360 && (
            <span style={css('font-size:10px;font-weight:700;color:var(--green);background:var(--greenSoft);padding:2px 7px;border-radius:5px;')}>
              Sense360 hardware
            </span>
          )}
        </div>
        {(c.manufacturer || c.node) && (
          <div style={css("font-size:11px;color:var(--mut);margin-top:8px;font-family:'JetBrains Mono';line-height:1.6;")}>
            {c.manufacturer && <div>manufacturer · {c.manufacturer}</div>}
            {c.node && <div>esphome node · {c.node}</div>}
          </div>
        )}
      </div>

      <div style={css('padding:16px 20px;border-bottom:1px solid var(--bd2);')}>
        <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:11px;')}>
          CONFIRM AS
        </div>
        <div style={css('display:flex;gap:8px;')}>
          <ConfirmButton kind="ld2450" current={c.kind} />
          <ConfirmButton kind="sen0609" current={c.kind} />
        </div>
      </div>

      <div style={css('padding:16px 20px;border-bottom:1px solid var(--bd2);')}>
        <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:11px;')}>
          MATCHED ENTITIES
        </div>
        {c.roles.length === 0 && (
          <div style={css('font-size:11.5px;color:var(--faint);line-height:1.5;')}>
            No radar entities matched yet. Confirm the kind above, then assign the entities for each role.
          </div>
        )}
        {c.roles.map((role) => (
          <div key={role.key} style={css('margin-bottom:11px;')}>
            <div style={css('display:flex;justify-content:space-between;margin-bottom:5px;')}>
              <span style={css('font-size:12px;color:var(--mut);')}>{role.label}</span>
              <span style={css(`font-size:10px;font-weight:700;color:${role.entityId ? 'var(--green)' : 'var(--faint)'};`)}>
                {role.entityId ? 'matched' : 'unset'}
              </span>
            </div>
            <input
              type="text"
              defaultValue={role.entityId ?? ''}
              placeholder="entity id"
              onBlur={(e: ChangeEvent<HTMLInputElement>) => {
                const next = e.target.value.trim()
                if (next !== (role.entityId ?? '')) void store.correctRole(role.key, next)
              }}
              style={css(
                "width:100%;height:30px;padding:0 9px;border-radius:7px;border:1px solid var(--bd);background:var(--ins);color:var(--tx);font-family:'JetBrains Mono';font-size:11.5px;",
              )}
            />
          </div>
        ))}
      </div>

      <div style={css('padding:16px 20px;')}>
        <div style={css('font-size:11.5px;color:var(--faint);line-height:1.5;margin-bottom:11px;')}>
          Not a radar sensor? Dismiss it and discovery will keep it hidden.
        </div>
        <button
          onClick={() => void store.dismissDevice()}
          style={css(
            'width:100%;height:34px;border-radius:8px;border:1px solid var(--bd);background:transparent;color:var(--excl);font-family:Murecho;font-size:12.5px;font-weight:600;cursor:pointer;',
          )}
        >
          Dismiss device
        </button>
      </div>
    </div>
  )
}
