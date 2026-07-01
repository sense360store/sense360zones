import type { ConnectionState } from '../store/store'

/** The message shown for a non-connected state. `null` means render nothing. */
export interface ConnectionView {
  title: string
  body: string
  showRetry: boolean
  showSpinner: boolean
}

/**
 * Pure mapping from connection state to the overlay content, split out so it can
 * be unit tested without rendering. `connected` returns null: the editor shows.
 */
export function connectionView(state: ConnectionState): ConnectionView | null {
  switch (state) {
    case 'connected':
      return null
    case 'connecting':
      return {
        title: 'Connecting to Home Assistant',
        body: 'Discovering rooms, devices and sensors.',
        showRetry: false,
        showSpinner: true,
      }
    case 'no-devices':
      return {
        title: 'No radar sensors found',
        body: 'Home Assistant is connected, but no LD2450 or SEN0609 devices were detected. Check that the sensors are set up, then try again.',
        showRetry: true,
        showSpinner: false,
      }
    case 'offline':
      return {
        title: 'Cannot reach Home Assistant',
        body: 'The add-on could not connect to the Home Assistant WebSocket API. It keeps retrying in the background.',
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
        {view.showRetry && (
          <button className="zs-btn zs-btn--primary" onClick={props.onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
