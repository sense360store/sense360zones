import { css } from '../lib/css'
import { isDirty } from '../store/store'
import { store, useEditorState } from '../store/hooks'

const applyStyleOn =
  'height:34px;padding:0 18px;border-radius:8px;border:1px solid var(--green);background:var(--green);color:#fff;font-family:Murecho;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 0 16px var(--greenSoft);'
const applyStyleOff =
  'height:34px;padding:0 18px;border-radius:8px;border:1px solid var(--bd);background:var(--ins);color:var(--faint);font-family:Murecho;font-size:13px;font-weight:600;cursor:default;'

export function TopBar() {
  const s = useEditorState()
  const dirty = isDirty(s)
  const room = s.rooms.find((r) => r.id === s.activeRoomId)
  const sensorCount = room ? room.devices.reduce((n, d) => n + d.sensors.length, 0) : 0
  const themeLabel = s.theme === 'dark' ? 'Dark' : 'Light'
  const themeIcon = s.theme === 'dark' ? '☾' : '☀'

  return (
    <div
      style={css(
        'height:56px;flex:none;display:flex;align-items:center;gap:18px;padding:0 18px;background:var(--panel);border-bottom:1px solid var(--bd);z-index:5;',
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
      <div style={css('display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--mut);')}>
        <span
          style={css(
            'width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulsedot 2.4s infinite;',
          )}
        ></span>
        {room?.name ?? 'Room'} · {sensorCount} sensors <span style={css('color:var(--faint);')}>· live</span>
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
      {dirty && (
        <span style={css('font-size:11.5px;color:#e0922a;display:flex;align-items:center;gap:6px;')}>
          <span style={css('width:6px;height:6px;border-radius:50%;background:#e0922a;')}></span>Unsaved
        </span>
      )}
      <button
        onClick={() => store.revert()}
        style={css(
          'height:34px;padding:0 16px;border-radius:8px;border:1px solid var(--bd);background:transparent;color:var(--mut);font-family:Murecho;font-size:13px;font-weight:500;cursor:pointer;',
        )}
      >
        Revert
      </button>
      <button onClick={() => store.apply()} style={css(dirty ? applyStyleOn : applyStyleOff)}>
        Apply to sensors
      </button>
    </div>
  )
}
