import type { ConnectionState } from '../store/store'
import { css } from '../lib/css'
import { store, useEditorState } from '../store/hooks'
import { applyView } from './ApplyGuardrail'

const applyStyleOn =
  'height:34px;padding:0 18px;border-radius:8px;border:1px solid var(--green);background:var(--green);color:#fff;font-family:Murecho;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 0 16px var(--greenSoft);'
const applyStyleOff =
  'height:34px;padding:0 18px;border-radius:8px;border:1px solid var(--bd);background:var(--ins);color:var(--faint);font-family:Murecho;font-size:13px;font-weight:600;cursor:default;'

const selectStyle =
  'height:30px;max-width:190px;padding:0 8px;border-radius:7px;border:1px solid var(--bd);background:var(--ins);color:var(--tx);font-family:Murecho;font-size:12.5px;cursor:pointer;'

/** Status dot colour and label per connection state. */
function connStatus(state: ConnectionState): { label: string; color: string; pulse: boolean } {
  switch (state) {
    case 'connected':
      return { label: 'live', color: 'var(--green)', pulse: true }
    case 'connecting':
      return { label: 'connecting', color: 'var(--mut)', pulse: true }
    case 'no-devices':
      return { label: 'no sensors', color: '#e0922a', pulse: false }
    case 'offline':
      return { label: 'offline', color: 'var(--excl)', pulse: false }
  }
}

export function TopBar() {
  const s = useEditorState()
  const view = applyView(s)
  const dirty = view.dirty
  const status = connStatus(s.connection)
  const activeRoom = s.rooms.find((r) => r.id === s.activeRoomId)
  const devices = activeRoom?.devices ?? []
  const themeLabel = s.theme === 'dark' ? 'Dark' : 'Light'
  const themeIcon = s.theme === 'dark' ? '☾' : '☀'

  return (
    <div
      style={css(
        'height:56px;flex:none;display:flex;align-items:center;gap:14px;padding:0 18px;background:var(--panel);border-bottom:1px solid var(--bd);z-index:5;',
      )}
    >
      <div style={css('display:flex;align-items:center;gap:10px;')}>
        <div
          style={css(
            'width:26px;height:26px;border-radius:7px;background:var(--green);display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px var(--greenSoft);',
          )}
        >
          <div style={css('width:9px;height:9px;border-radius:50%;background:#fff;opacity:.92;')}></div>
        </div>
        <div style={css('font-weight:700;font-size:15px;letter-spacing:.2px;')}>
          Sense360 <span style={css('color:var(--green);')}>Zone Studio</span>
        </div>
      </div>
      <div style={css('width:1px;height:24px;background:var(--bd);')}></div>

      {/* Connection status + room/device picker, driven by discover(). */}
      <div style={css('display:flex;align-items:center;gap:10px;')}>
        <span
          style={css(
            `width:7px;height:7px;border-radius:50%;flex:none;background:${status.color};box-shadow:0 0 8px ${status.color};` +
              (status.pulse ? 'animation:pulsedot 2.4s infinite;' : ''),
          )}
        ></span>
        {s.rooms.length > 0 ? (
          <div style={css('display:flex;align-items:center;gap:8px;')}>
            {s.rooms.length > 1 && (
              <select
                value={s.activeRoomId}
                onChange={(e) => store.setActiveRoom(e.target.value)}
                title="Room"
                style={css(selectStyle)}
              >
                {s.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={s.activeDeviceId}
              onChange={(e) => store.selectDevice(e.target.value)}
              title="Device"
              style={css(selectStyle)}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <span style={css('font-size:11.5px;color:var(--faint);')}>{status.label}</span>
          </div>
        ) : (
          <span style={css('font-size:12.5px;color:var(--mut);')}>{status.label}</span>
        )}
      </div>

      <div style={css('flex:1;')}></div>
      <div
        onClick={() => store.toggleTheme()}
        title="Toggle theme"
        style={css(
          'display:flex;align-items:center;gap:7px;height:32px;padding:0 5px 0 12px;border:1px solid var(--bd);border-radius:20px;background:var(--ins);cursor:pointer;margin-right:4px;',
        )}
      >
        <span style={css('font-size:11.5px;color:var(--mut);font-weight:500;')}>{themeLabel}</span>
        <span
          style={css(
            'width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--panel);border:1px solid var(--bd);font-size:12px;',
          )}
        >
          {themeIcon}
        </span>
      </div>
      {view.error && (
        <span title={view.error} style={css('font-size:11.5px;color:var(--excl);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>
          {view.error}
        </span>
      )}
      {!view.error && dirty && (
        <span style={css('font-size:11.5px;color:#e0922a;display:flex;align-items:center;gap:6px;')}>
          <span style={css('width:6px;height:6px;border-radius:50%;background:#e0922a;')}></span>Unsaved
        </span>
      )}
      <button
        onClick={() => void store.revert()}
        style={css(
          'height:34px;padding:0 16px;border-radius:8px;border:1px solid var(--bd);background:transparent;color:var(--mut);font-family:Murecho;font-size:13px;font-weight:500;cursor:pointer;',
        )}
      >
        Revert
      </button>
      <button
        onClick={() => void store.apply()}
        disabled={!view.canApply}
        title={view.resolution.reasons.length ? view.resolution.reasons.join('\n') : 'Apply to sensors'}
        style={css(view.canApply ? applyStyleOn : applyStyleOff)}
      >
        {view.applying ? 'Applying…' : 'Apply to sensors'}
      </button>
    </div>
  )
}
