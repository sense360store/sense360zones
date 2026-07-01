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
 * applies the theme class. The layout is fluid — the root fills the ingress
 * iframe, and below the drawer breakpoint (styles/zonestudio.css) the side
 * panels slide over the canvas behind the two floating toggles held here.
 * All data state flows through the store and the client.
 */
import { useState } from 'react'
import { Canvas } from './canvas/Canvas'
import { CanvasToolbar } from './canvas/CanvasToolbar'
import { ConnectionOverlay } from './panels/ConnectionOverlay'
import { Inspector } from './panels/Inspector'
import { LeftPanel } from './panels/LeftPanel'
import { TopBar } from './panels/TopBar'
import { store, useEditorState } from './store/hooks'

type Drawer = 'layers' | 'inspector' | null

export default function ZoneStudio() {
  const s = useEditorState()
  // Which side panel is open when the panels are drawers (narrow widths only;
  // at comfortable widths CSS keeps both panels in the flow and ignores this).
  const [drawer, setDrawer] = useState<Drawer>(null)
  const toggle = (which: Drawer) => setDrawer((cur) => (cur === which ? null : which))

  return (
    <div className={'zs ' + (s.theme === 'dark' ? 'dark' : '')}>
      <TopBar />
      <div className="zs-main">
        <div className={'zs-side zs-side--left' + (drawer === 'layers' ? ' is-open' : '')}>
          <LeftPanel />
        </div>
        <div className="zs-canvas-col">
          <CanvasToolbar />
          <div className="zs-stagewrap">
            <Canvas />
          </div>
          <button className="zs-drawer-toggle zs-drawer-toggle--left" onClick={() => toggle('layers')}>
            Layers
          </button>
          <button className="zs-drawer-toggle zs-drawer-toggle--right" onClick={() => toggle('inspector')}>
            Inspect
          </button>
        </div>
        <div className={'zs-side zs-side--right' + (drawer === 'inspector' ? ' is-open' : '')}>
          <Inspector />
        </div>
        {drawer && <button className="zs-scrim" aria-label="Close panel" onClick={() => setDrawer(null)} />}
        {/* Honest connection/empty state over the editor; hidden when connected. */}
        <ConnectionOverlay state={s.connection} onRetry={() => store.refresh()} />
      </div>
    </div>
  )
}
