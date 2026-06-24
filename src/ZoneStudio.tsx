/*
 * Sense360 Zone Studio — application shell.
 * -------------------------------------------------------------------------
 * The ~1500-line monolith from PR #4 has been split into layers:
 *   - domain/   canonical data model (types + JSON schema), pure geometry,
 *               NATIVE/POLYGON profile logic
 *   - client/   the ZonesClient seam + a MockZonesClient holding all of
 *               today's simulated data and the live-target animation
 *   - store/    a small typed store (state + actions + drag interaction)
 *   - canvas/   the SVG canvas + view→pixel projection
 *   - panels/   the top bar, layer/zone list, and the context inspector
 *
 * This file is just the layout: it wires the panels around the canvas and
 * applies the theme class. All state flows through the store and the client.
 */
import { Canvas } from './canvas/Canvas'
import { CanvasToolbar } from './canvas/CanvasToolbar'
import { css } from './lib/css'
import { Inspector } from './panels/Inspector'
import { LeftPanel } from './panels/LeftPanel'
import { TopBar } from './panels/TopBar'
import { useEditorState } from './store/hooks'

export default function ZoneStudio() {
  const s = useEditorState()
  return (
    <div
      className={'zs ' + (s.theme === 'dark' ? 'dark' : '')}
      style={css(
        'width:100vw;height:100vh;background:var(--bg);color:var(--tx);font-family:Murecho,sans-serif;display:flex;flex-direction:column;overflow:hidden;position:relative;-webkit-font-smoothing:antialiased;',
      )}
    >
      <TopBar />
      <div style={css('flex:1;display:flex;min-height:0;')}>
        <LeftPanel />
        <div style={css('flex:1;min-width:0;background:var(--canvas);display:flex;flex-direction:column;position:relative;')}>
          <CanvasToolbar />
          <div style={css('flex:1;display:flex;align-items:center;justify-content:center;min-height:0;padding:0 14px 14px;')}>
            <Canvas />
          </div>
        </div>
        <Inspector />
      </div>
    </div>
  )
}
