import type { Target } from '../domain/types'
import { cssVars } from '../lib/css'

export function LdPanel(props: { targets: Target[]; presence: boolean }) {
  const { presence } = props
  return (
    <div>
      <div className="zs-insp-head">
        <span
          className="zs-insp-head__dot"
          style={cssVars({ '--dot-soft': 'var(--greenSoft)', '--dot-accent': 'var(--green)' })}
        ></span>
        <div className="zs-insp-head__body">
          <span className="zs-eyebrow">HLK LD2450</span>
          <div className="zs-insp-title">Spatial tracking</div>
          <div className="zs-insp-head__meta">120° field of view · X/Y · up to 3 targets</div>
        </div>
        {/* Derived device presence: detection minus exclusion, from the shared evaluator. */}
        <span
          className={'zs-presence' + (presence ? ' is-on' : '')}
          title="Device presence: a counted target is in a detection zone (or anywhere when there are none) and not in an exclusion zone"
        >
          {presence ? 'PRESENT' : 'CLEAR'}
        </span>
      </div>
      <div className="zs-callout">
        <div className="zs-card zs-card--green">
          This is the spatial layer. It reports each target's X/Y, so it owns the drawable detection and exclusion
          zones. Use the canvas toolbar to draw.
        </div>
      </div>
      <div className="zs-section zs-section--last">
        <div className="zs-section__head">
          <span className="zs-eyebrow">Live targets</span>
        </div>
        {props.targets.map((t, i) => (
          <div key={t.id} className="zs-target-row" style={cssVars({ '--target-color': t.color })}>
            <span className="zs-target-row__dot"></span>
            <span className="zs-target-row__name">{'Target ' + (i + 1)}</span>
            <span className="zs-target-row__pos">{`x ${t.x.toFixed(1)}  y ${t.y.toFixed(1)}`}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
