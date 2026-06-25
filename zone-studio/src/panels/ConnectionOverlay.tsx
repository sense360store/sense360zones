import { css } from '../lib/css'
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
    <div
      style={css(
        'position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:var(--canvas);',
      )}
    >
      <div style={css('max-width:400px;text-align:center;padding:28px;')}>
        {view.showSpinner ? (
          <div
            style={css(
              'width:34px;height:34px;margin:0 auto 18px;border-radius:50%;border:3px solid var(--bd);border-top-color:var(--green);animation:zsspin 0.9s linear infinite;',
            )}
          ></div>
        ) : (
          <div
            style={css(
              'width:34px;height:34px;margin:0 auto 18px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--ins);border:1px solid var(--bd);color:var(--faint);font-size:18px;',
            )}
          >
            ⚠
          </div>
        )}
        <div style={css('font-size:17px;font-weight:700;margin-bottom:8px;')}>{view.title}</div>
        <div style={css('font-size:13px;line-height:1.6;color:var(--mut);')}>{view.body}</div>
        {view.showRetry && (
          <button
            onClick={props.onRetry}
            style={css(
              'margin-top:18px;height:34px;padding:0 18px;border-radius:8px;border:1px solid var(--green);background:var(--green);color:#fff;font-family:Murecho;font-size:13px;font-weight:700;cursor:pointer;',
            )}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
