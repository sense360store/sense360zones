import type { ConnectionState } from '../store/store'

/** The message shown for a non-connected state. `null` means render nothing. */
export interface ConnectionView {
  title: string
  body: string
  /** The auto-recovery line ("this fixes itself"), rendered with a pulsing dot. */
  hint: string | null
  showRetry: boolean
  showSpinner: boolean
}

/**
 * Pure mapping from connection state to the overlay content, split out so it can
 * be unit tested without rendering. `connected` returns null: the editor shows.
 * Every non-connected state names what is happening, what (if anything) the user
 * can do, and that the app recovers on its own when the condition clears.
 */
export function connectionView(state: ConnectionState): ConnectionView | null {
  switch (state) {
    case 'connected':
      return null
    case 'connecting':
      return {
        title: 'Connecting to Home Assistant',
        body: 'Discovering rooms, devices and sensors.',
        hint: null,
        showRetry: false,
        showSpinner: true,
      }
    case 'no-devices':
      return {
        title: 'No radar sensors found',
        body: 'Home Assistant is connected, but no LD2450 or SEN0609 devices were detected. Check that the sensors are powered and set up in Home Assistant.',
        hint: 'Watching for devices. The editor opens automatically when one appears.',
        showRetry: true,
        showSpinner: false,
      }
    case 'offline':
      return {
        title: 'Cannot reach Home Assistant',
        body: 'The add-on could not connect to the Home Assistant WebSocket API. This is normal while Home Assistant restarts.',
        hint: 'Reconnecting automatically. The editor returns as soon as the connection is restored.',
        showRetry: true,
        showSpinner: false,
      }
  }
}

/** Full-content overlay for the connecting, no-devices and offline states. */
export function ConnectionOverlay(props: { state: ConnectionState; onRetry: () => void }) {
  const view = connectionView(props.state)
  if (!view) return null
  return (
    <div className="zs-conn-overlay">
      <div className="zs-conn-overlay__box">
        {view.showSpinner ? (
          <div className="zs-conn-overlay__spinner"></div>
        ) : (
          <div className="zs-conn-overlay__icon">⚠</div>
        )}
        <div className="zs-conn-overlay__title">{view.title}</div>
        <div className="zs-conn-overlay__body">{view.body}</div>
        {view.hint && (
          <div className="zs-conn-overlay__hint">
            <span className="zs-conn-overlay__hintdot"></span>
            {view.hint}
          </div>
        )}
        {view.showRetry && (
          <button className="zs-btn zs-btn--primary" onClick={props.onRetry}>
            Retry now
          </button>
        )}
      </div>
    </div>
  )
}
