import { css } from '../lib/css'
import { Field } from '../components/Field'
import { polygonArea, zoneMeta, zonePtsM } from '../domain/geometry'
import type { Zone } from '../domain/types'
import { store } from '../store/hooks'

const numStyle =
  'width:100%;height:34px;background:var(--ins);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-family:"JetBrains Mono";font-size:13px;padding:0 10px;outline:none;'

const tseg = (on: boolean, col: string) =>
  on
    ? `height:28px;flex:1;border-radius:6px;border:none;background:${col};color:#fff;font-family:Murecho;font-size:12px;font-weight:700;cursor:pointer;`
    : 'height:28px;flex:1;border-radius:6px;border:none;background:transparent;color:var(--mut);font-family:Murecho;font-size:12px;font-weight:500;cursor:pointer;'

const pf = (val: string) => {
  const v = parseFloat(val)
  return isNaN(v) ? 0 : v
}

export function ZonePanel(props: { zone: Zone; count: number }) {
  const { zone, count } = props
  const m = zoneMeta(zone.type)
  const isExcl = zone.type === 'exclusion'
  const area = polygonArea(zonePtsM(zone))
  const shapeLabel = zone.shape === 'poly' ? 'polygon' : zone.rot ? 'rotated rect' : 'rectangle'
  const liveText = isExcl ? 'masked' : count + ' / 3'
  const liveStyle =
    `font-size:12px;font-family:'JetBrains Mono';font-weight:600;padding:3px 9px;border-radius:6px;` +
    (isExcl
      ? 'color:var(--excl);background:var(--exclSoft);'
      : count > 0
        ? 'color:#fff;background:var(--green);'
        : 'color:var(--faint);background:var(--panel);')

  return (
    <div>
      <div style={css('padding:17px 20px 14px;border-bottom:1px solid var(--bd2);display:flex;align-items:flex-start;gap:11px;')}>
        <span
          style={css(`width:13px;height:13px;border-radius:4px;margin-top:4px;flex:none;background:${m.soft};border:1.5px solid ${m.accent};`)}
        ></span>
        <div style={css('flex:1;min-width:0;')}>
          <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:5px;')}>
            LD2450 ZONE · {shapeLabel}
          </div>
          <Field
            value={zone.name}
            onCommit={(val) => store.renameZone(zone.id, val)}
            style={css(
              'width:100%;background:transparent;border:none;border-bottom:1px solid var(--bd);color:var(--tx);font-family:Murecho;font-size:17px;font-weight:600;padding:2px 0 5px;outline:none;',
            )}
          />
        </div>
        <button
          onClick={() => store.deleteZone(zone.id)}
          title="Delete"
          style={css(
            'width:30px;height:30px;flex:none;border-radius:7px;border:1px solid var(--bd);background:var(--ins);color:var(--excl);cursor:pointer;font-size:13px;',
          )}
        >
          ✕
        </button>
      </div>

      <div style={css('padding:16px 20px;border-bottom:1px solid var(--bd2);')}>
        <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:11px;')}>
          ZONE TYPE
        </div>
        <div style={css('display:flex;background:var(--ins);border:1px solid var(--bd);border-radius:9px;padding:3px;gap:3px;')}>
          <button onClick={() => store.setZoneType(zone.id, 'detection')} style={css(tseg(!isExcl, 'var(--green)'))}>
            Detection
          </button>
          <button onClick={() => store.setZoneType(zone.id, 'exclusion')} style={css(tseg(isExcl, 'var(--excl)'))}>
            Exclusion
          </button>
        </div>
        <div style={css('margin-top:11px;font-size:11.5px;line-height:1.5;color:var(--mut);')}>
          {isExcl
            ? 'Masks out everything inside — fans, pets, reflective surfaces. Targets here are ignored by all detection zones.'
            : 'Reports occupancy whenever a tracked target enters the zone.'}
        </div>
        <div
          style={css(
            'margin-top:12px;display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:9px;background:var(--ins);',
          )}
        >
          <span style={css('font-size:12px;color:var(--mut);')}>Live targets in zone</span>
          <span style={css(liveStyle)}>{liveText}</span>
        </div>
      </div>

      <div style={css('padding:16px 20px;')}>
        <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;')}>
          <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;')}>GEOMETRY</div>
          <div style={css("font-size:11px;font-family:'JetBrains Mono';color:var(--faint);")}>{area.toFixed(2)} m²</div>
        </div>
        {zone.shape === 'rect' && (
          <div>
            <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:10px;')}>
              <div>
                <div style={css('font-size:10.5px;color:var(--mut);margin-bottom:5px;')}>Center X (m)</div>
                <Field type="number" step="0.1" value={zone.cx.toFixed(1)} onCommit={(val) => store.patchRect(zone.id, { cx: pf(val) })} style={css(numStyle)} />
              </div>
              <div>
                <div style={css('font-size:10.5px;color:var(--mut);margin-bottom:5px;')}>Center Y (m)</div>
                <Field type="number" step="0.1" value={zone.cy.toFixed(1)} onCommit={(val) => store.patchRect(zone.id, { cy: pf(val) })} style={css(numStyle)} />
              </div>
              <div>
                <div style={css('font-size:10.5px;color:var(--mut);margin-bottom:5px;')}>Width (m)</div>
                <Field type="number" step="0.1" value={zone.w.toFixed(1)} onCommit={(val) => store.patchRect(zone.id, { w: Math.max(0.3, pf(val)) })} style={css(numStyle)} />
              </div>
              <div>
                <div style={css('font-size:10.5px;color:var(--mut);margin-bottom:5px;')}>Depth (m)</div>
                <Field type="number" step="0.1" value={zone.h.toFixed(1)} onCommit={(val) => store.patchRect(zone.id, { h: Math.max(0.3, pf(val)) })} style={css(numStyle)} />
              </div>
            </div>
            <div style={css('margin-top:13px;')}>
              <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
                <span style={css('font-size:12px;color:var(--mut);')}>Rotation</span>
                <span style={css(`font-size:12.5px;font-family:'JetBrains Mono';color:${m.accent};`)}>{Math.round(zone.rot)}°</span>
              </div>
              <input
                type="range"
                min="-90"
                max="90"
                step="1"
                value={Math.round(zone.rot)}
                onChange={(e) => store.patchRect(zone.id, { rot: parseInt(e.target.value) })}
                style={css(`width:100%;accent-color:${m.accent};`)}
              />
            </div>
          </div>
        )}
        {zone.shape === 'poly' && (
          <div style={css('font-size:12px;color:var(--mut);line-height:1.6;')}>
            {zone.pts.length} vertices.
            <br />
            Drag the vertices on the canvas to reshape, or drag the body to move.
          </div>
        )}
        <div style={css('margin-top:12px;font-size:11px;color:var(--faint);display:flex;align-items:center;gap:7px;')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M5 12l4-4M5 12l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Drag on canvas to reposition · snaps to 0.5 m
        </div>
      </div>
    </div>
  )
}
