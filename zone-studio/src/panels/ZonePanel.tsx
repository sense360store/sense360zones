import { Field } from '../components/Field'
import { polygonArea, zoneMeta, zonePtsM } from '../domain/geometry'
import type { Zone } from '../domain/types'
import { cssVars } from '../lib/css'
import { store } from '../store/hooks'

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

  return (
    <div>
      <div className="zs-insp-head">
        <span
          className="zs-insp-head__dot zs-insp-head__dot--square"
          style={cssVars({ '--dot-soft': m.soft, '--dot-accent': m.accent })}
        ></span>
        <div className="zs-insp-head__body">
          <span className="zs-eyebrow">LD2450 zone · {shapeLabel}</span>
          <Field className="zs-name-input" value={zone.name} onCommit={(val) => store.renameZone(zone.id, val)} />
        </div>
        <button className="zs-btn zs-btn--icon zs-btn--danger" onClick={() => store.deleteZone(zone.id)} title="Delete">
          ✕
        </button>
      </div>

      <div className="zs-section">
        <div className="zs-section__head" style={{ marginBottom: 11 }}>
          <span className="zs-eyebrow">Zone type</span>
        </div>
        <div className="zs-seg zs-seg--fill">
          <button
            className={'zs-seg__btn' + (!isExcl ? ' is-on' : '')}
            onClick={() => store.setZoneType(zone.id, 'detection')}
          >
            Detection
          </button>
          <button
            className={'zs-seg__btn' + (isExcl ? ' is-on' : '')}
            style={cssVars({ '--seg-accent': 'var(--excl)' })}
            onClick={() => store.setZoneType(zone.id, 'exclusion')}
          >
            Exclusion
          </button>
        </div>
        <div className="zs-typenote">
          {isExcl
            ? 'Masks out everything inside: fans, pets, reflective surfaces. Targets here are ignored by all detection zones.'
            : 'Reports occupancy whenever a tracked target enters the zone.'}
        </div>
        <div className="zs-stat" style={{ marginTop: 12 }}>
          <span className="zs-stat__label">Live targets in zone</span>
          <span className={'zs-stat__value' + (isExcl ? ' is-excl' : count > 0 ? ' is-on' : '')}>{liveText}</span>
        </div>
      </div>

      <div className="zs-section zs-section--last">
        <div className="zs-section__head">
          <span className="zs-eyebrow">Geometry</span>
          <span className="zs-row__meta">{area.toFixed(2)} m²</span>
        </div>
        {zone.shape === 'rect' && (
          <div>
            <div className="zs-grid2">
              <div>
                <div className="zs-input-label">Center X (m)</div>
                <Field
                  className="zs-input"
                  type="number"
                  step="0.1"
                  value={zone.cx.toFixed(1)}
                  onCommit={(val) => store.patchRect(zone.id, { cx: pf(val) })}
                />
              </div>
              <div>
                <div className="zs-input-label">Center Y (m)</div>
                <Field
                  className="zs-input"
                  type="number"
                  step="0.1"
                  value={zone.cy.toFixed(1)}
                  onCommit={(val) => store.patchRect(zone.id, { cy: pf(val) })}
                />
              </div>
              <div>
                <div className="zs-input-label">Width (m)</div>
                <Field
                  className="zs-input"
                  type="number"
                  step="0.1"
                  value={zone.w.toFixed(1)}
                  onCommit={(val) => store.patchRect(zone.id, { w: Math.max(0.3, pf(val)) })}
                />
              </div>
              <div>
                <div className="zs-input-label">Depth (m)</div>
                <Field
                  className="zs-input"
                  type="number"
                  step="0.1"
                  value={zone.h.toFixed(1)}
                  onCommit={(val) => store.patchRect(zone.id, { h: Math.max(0.3, pf(val)) })}
                />
              </div>
            </div>
            <div className="zs-field" style={{ marginTop: 13, ...cssVars({ '--kv-accent': m.accent, '--slider-accent': m.accent }) }}>
              <div className="zs-kv">
                <span className="zs-kv__label">Rotation</span>
                <span className="zs-kv__value">{Math.round(zone.rot)}°</span>
              </div>
              <input
                className="zs-slider"
                type="range"
                min="-90"
                max="90"
                step="1"
                value={Math.round(zone.rot)}
                onChange={(e) => store.patchRect(zone.id, { rot: parseInt(e.target.value) })}
              />
            </div>
          </div>
        )}
        {zone.shape === 'poly' && (
          <div className="zs-typenote" style={{ marginTop: 0 }}>
            {zone.pts.length} vertices.
            <br />
            Drag the vertices on the canvas to reshape, or drag the body to move.
          </div>
        )}
        <div className="zs-hintline" style={{ marginTop: 12 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M5 12l4-4M5 12l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Drag on canvas to reposition · snaps to 0.5 m
        </div>
      </div>
    </div>
  )
}
