import { css } from '../lib/css'
import { store, useEditorState } from '../store/hooks'
import type { Tool } from '../store/store'

const segOn =
  'height:28px;padding:0 12px;border-radius:6px;border:none;background:var(--green);color:#fff;font-family:Murecho;font-size:12.5px;font-weight:600;cursor:pointer;'
const segOff =
  'height:28px;padding:0 12px;border-radius:6px;border:none;background:transparent;color:var(--mut);font-family:Murecho;font-size:12.5px;font-weight:500;cursor:pointer;'
const seg = (on: boolean) => (on ? segOn : segOff)

const toolHints: Record<Tool, string> = {
  select: 'Click a zone to edit · drag to move · handles to resize/rotate',
  rect: 'Drag on the canvas to draw a rectangle zone',
  rot: 'Drag to draw, then use the rotate handle',
  poly: 'Click to drop points · double-click to finish',
}

export function CanvasToolbar() {
  const s = useEditorState()
  const isCeil = s.view === 'ceiling'
  const cur = s.cursor
  const cursorReadout = cur ? `x ${cur.x.toFixed(2)}  y ${cur.y.toFixed(2)} m` : 'x —  y —'
  const mountHint = isCeil ? '⊙ Ceiling — footprint looking straight down' : '▤ Wall — coverage fans across the room'

  return (
    <div style={css('height:48px;flex:none;display:flex;align-items:center;gap:10px;padding:0 18px;')}>
      <div
        style={css(
          'display:flex;background:var(--panel);border:1px solid var(--bd);border-radius:9px;padding:3px;gap:2px;box-shadow:var(--shadow);',
        )}
      >
        <button onClick={() => store.setView('ceiling')} style={css(seg(isCeil))} title="Ceiling mount — looking straight down">
          ⊙ Ceiling
        </button>
        <button onClick={() => store.setView('wall')} style={css(seg(!isCeil))} title="Wall mount — looking across the room">
          ▤ Wall
        </button>
      </div>
      <div style={css('width:1px;height:22px;background:var(--bd);')}></div>
      <div
        style={css(
          'display:flex;background:var(--panel);border:1px solid var(--bd);border-radius:9px;padding:3px;gap:2px;box-shadow:var(--shadow);',
        )}
      >
        <button onClick={() => store.setTool('select')} style={css(seg(s.tool === 'select'))} title="Select & move">
          ▣ Select
        </button>
        <button onClick={() => store.setTool('rect')} style={css(seg(s.tool === 'rect'))} title="Rectangle zone">
          ▭ Rect
        </button>
        <button onClick={() => store.setTool('rot')} style={css(seg(s.tool === 'rot'))} title="Rotated rectangle">
          ◇ Rotated
        </button>
        <button onClick={() => store.setTool('poly')} style={css(seg(s.tool === 'poly'))} title="Polygon zone">
          ⬡ Polygon
        </button>
      </div>
      <span style={css('font-size:11px;color:var(--faint);')}>{toolHints[s.tool]}</span>
      <span
        style={css(
          'font-size:11px;color:var(--mut);background:var(--ins);border:1px solid var(--bd);padding:3px 9px;border-radius:6px;font-weight:600;',
        )}
      >
        {mountHint}
      </span>
      <div style={css('flex:1;')}></div>
      <div
        style={css(
          "font-family:'JetBrains Mono';font-size:11.5px;color:var(--faint);display:flex;align-items:center;gap:13px;",
        )}
      >
        <span>{cursorReadout}</span>
        <span style={css('opacity:.5;')}>|</span>
        <span>grid 0.5 m</span>
      </div>
    </div>
  )
}
