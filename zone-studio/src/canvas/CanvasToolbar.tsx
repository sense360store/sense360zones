import { store, useEditorState } from '../store/hooks'
import type { Tool } from '../store/store'

const toolHints: Record<Tool, string> = {
  select: 'Click a zone to edit · drag to move · handles to resize/rotate',
  rect: 'Drag on the canvas to draw a rectangle zone',
  rot: 'Drag to draw, then use the rotate handle',
  poly: 'Click to drop points · double-click to finish',
}

export function CanvasToolbar() {
  const s = useEditorState()
  const isCeil = s.view === 'ceiling'
  const mountHint = isCeil ? 'Ceiling: footprint looking straight down' : 'Wall: coverage fans across the room'

  return (
    <div className="zs-toolbar">
      <div className="zs-seg">
        <button
          className={'zs-seg__btn' + (isCeil ? ' is-on' : '')}
          onClick={() => store.setView('ceiling')}
          title="Ceiling mount: looking straight down"
        >
          ⊙ Ceiling
        </button>
        <button
          className={'zs-seg__btn' + (!isCeil ? ' is-on' : '')}
          onClick={() => store.setView('wall')}
          title="Wall mount: looking across the room"
        >
          ▤ Wall
        </button>
      </div>
      <div className="zs-vdivider"></div>
      <div className="zs-seg">
        <button
          className={'zs-seg__btn' + (s.tool === 'select' ? ' is-on' : '')}
          onClick={() => store.setTool('select')}
          title="Select & move"
        >
          ▣ Select
        </button>
        <button
          className={'zs-seg__btn' + (s.tool === 'rect' ? ' is-on' : '')}
          onClick={() => store.setTool('rect')}
          title="Rectangle zone"
        >
          ▭ Rect
        </button>
        <button
          className={'zs-seg__btn' + (s.tool === 'rot' ? ' is-on' : '')}
          onClick={() => store.setTool('rot')}
          title="Rotated rectangle"
        >
          ◇ Rotated
        </button>
        <button
          className={'zs-seg__btn' + (s.tool === 'poly' ? ' is-on' : '')}
          onClick={() => store.setTool('poly')}
          title="Polygon zone"
        >
          ⬡ Polygon
        </button>
      </div>
      <span className="zs-legend">{mountHint}</span>
      <span className="zs-toolbar__hint">{toolHints[s.tool]}</span>
    </div>
  )
}
