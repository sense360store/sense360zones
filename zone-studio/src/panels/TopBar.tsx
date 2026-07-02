import type { ConnectionState } from '../store/store'
import { cssVars } from '../lib/css'
import { store, useEditorState } from '../store/hooks'
import { applyView } from './ApplyGuardrail'

/** Status dot colour and label per connection state. */
function connStatus(state: ConnectionState): { label: string; color: string; pulse: boolean } {
  switch (state) {
    case 'connected':
      return { label: 'live', color: 'var(--green)', pulse: true }
    case 'connecting':
      return { label: 'connecting', color: 'var(--mut)', pulse: true }
    case 'no-devices':
      return { label: 'no sensors', color: 'var(--warn)', pulse: false }
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
    <div className="zs-topbar">
      <div className="zs-brand">
        <div className="zs-brand__mark">
          <div className="zs-brand__dot"></div>
        </div>
        <div className="zs-brand__name">
          Sense360 <em>Zone Studio</em>
        </div>
      </div>
      <div className="zs-vdivider"></div>

      {/* Connection status + room/device picker, driven by discover(). */}
      <div className="zs-conn">
        <span
          className={'zs-conn__dot' + (status.pulse ? ' is-pulsing' : '')}
          style={cssVars({ '--conn-color': status.color })}
        ></span>
        {s.rooms.length > 0 ? (
          <>
            {s.rooms.length > 1 && (
              <select
                className="zs-select"
                value={s.activeRoomId}
                onChange={(e) => store.setActiveRoom(e.target.value)}
                title="Room"
              >
                {s.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            <select
              className="zs-select"
              value={s.activeDeviceId}
              onChange={(e) => store.selectDevice(e.target.value)}
              title="Device"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <span className="zs-conn__label">{status.label}</span>
          </>
        ) : (
          <span className="zs-conn__label">{status.label}</span>
        )}
      </div>

      <div className="zs-topbar__spacer"></div>
      <div className="zs-topbar__actions">
        <div className="zs-theme" onClick={() => store.toggleTheme()} title="Toggle theme">
          <span className="zs-theme__label">{themeLabel}</span>
          <span className="zs-theme__knob">{themeIcon}</span>
        </div>
        {view.error && (
          <span className="zs-topbar__error" title={view.error}>
            {view.error}
          </span>
        )}
        {!view.error && dirty && (
          <span className="zs-topbar__dirty" title="The editor has edits the sensor does not have yet">
            Unsaved changes
          </span>
        )}
        <button className="zs-btn" onClick={() => void store.revert()} title="Discard edits and reload the sensor's current config">
          Revert
        </button>
        <button
          className="zs-btn zs-btn--primary"
          onClick={() => void store.apply()}
          disabled={!view.canApply}
          title={
            view.resolution.profile === 'polygon'
              ? 'Apply: live occupancy evaluated by the add-on and published to Home Assistant over MQTT'
              : 'Apply to sensors'
          }
        >
          {view.applying ? 'Applying…' : 'Apply to sensors'}
        </button>
      </div>
    </div>
  )
}
