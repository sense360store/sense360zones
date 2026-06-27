import { css } from '../lib/css'
import type { Target } from '../domain/types'

export function LdPanel(props: { targets: Target[]; presence: boolean }) {
  const { presence } = props
  return (
    <div>
      <div style={css('padding:17px 20px 15px;border-bottom:1px solid var(--bd2);display:flex;align-items:flex-start;gap:11px;')}>
        <span
          style={css('width:13px;height:13px;border-radius:50%;margin-top:4px;flex:none;background:var(--greenSoft);border:1.5px solid var(--green);')}
        ></span>
        <div style={css('flex:1;')}>
          <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:5px;')}>
            HLK LD2450
          </div>
          <div style={css('font-size:17px;font-weight:700;')}>Spatial tracking</div>
          <div style={css("font-size:11px;color:var(--mut);margin-top:3px;font-family:'JetBrains Mono';")}>
            120° FoV · X/Y · up to 3 targets
          </div>
        </div>
        {/* Derived device presence: detection minus exclusion, from the shared evaluator. */}
        <span
          title="Device presence: a counted target is in a detection zone (or anywhere when there are none) and not in an exclusion zone"
          style={css(
            'flex:none;margin-top:2px;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:6px;' +
              (presence ? 'color:#fff;background:var(--green);' : 'color:var(--faint);background:var(--ins);'),
          )}
        >
          {presence ? 'PRESENT' : 'CLEAR'}
        </span>
      </div>
      <div style={css('margin:14px 20px;padding:11px 13px;border-radius:9px;background:var(--greenSoft);border:1px solid var(--green);')}>
        <div style={css('font-size:11.5px;color:var(--tx);line-height:1.55;')}>
          This is the spatial layer — it reports each target's X/Y, so it owns the drawable detection and exclusion zones. Use the canvas toolbar to draw.
        </div>
      </div>
      <div style={css('padding:6px 20px 16px;')}>
        <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin:8px 0 12px;')}>
          LIVE TARGETS
        </div>
        {props.targets.map((t, i) => (
          <div
            key={t.id}
            style={css('display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;background:var(--ins);margin-bottom:7px;')}
          >
            <span style={css(`width:9px;height:9px;border-radius:50%;flex:none;background:${t.color};box-shadow:0 0 7px ${t.color};`)}></span>
            <span style={css('font-size:12.5px;font-weight:600;flex:1;')}>{'Target ' + (i + 1)}</span>
            <span style={css("font-size:11.5px;font-family:'JetBrains Mono';color:var(--mut);")}>
              {`x ${t.x.toFixed(1)}  y ${t.y.toFixed(1)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
