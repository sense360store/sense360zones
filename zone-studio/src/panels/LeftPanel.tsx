import { css } from '../lib/css'
import { occupancyCounts, zoneMeta } from '../domain/geometry'
import { store, useEditorState } from '../store/hooks'
import { ApplyGuardrail, applyView } from './ApplyGuardrail'
import { EsphomeExport } from './EsphomeExport'

interface LayerRow {
  key: 'ld' | 'sen'
  name: string
  sub: string
  meta: string
  vis: boolean
  accent: string
  selected: boolean
  select: () => void
}

export function LeftPanel() {
  const s = useEditorState()
  const occ = occupancyCounts(s.zones, s.targets)

  const layers: LayerRow[] = [
    {
      key: 'ld',
      name: 'HLK LD2450 · zones',
      sub: 'Spatial · X/Y · up to 3 targets',
      meta: '120°',
      vis: s.layers.ld,
      accent: 'var(--green)',
      selected: s.sel.kind === 'ld',
      select: () => store.selectLd(),
    },
    {
      key: 'sen',
      name: 'DFRobot SEN0609 · range',
      sub: 'Radial distance + presence',
      meta: '100°',
      vis: s.layers.sen,
      accent: 'var(--band)',
      selected: s.sel.kind === 'sen',
      select: () => store.selectBand(),
    },
  ]

  return (
    <div
      style={css(
        'width:288px;flex:none;background:var(--panel);border-right:1px solid var(--bd);display:flex;flex-direction:column;min-height:0;',
      )}
    >
      <div style={css('padding:15px 18px 12px;border-bottom:1px solid var(--bd2);')}>
        <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:10px;')}>
          LAYERS
        </div>
        {layers.map((L) => (
          <div
            key={L.key}
            style={css(
              `display:flex;align-items:center;gap:10px;padding:9px 9px;border-radius:9px;margin-bottom:3px;border:1px solid ${
                L.selected ? 'var(--bd)' : 'transparent'
              };background:${L.selected ? 'var(--ins)' : 'transparent'};`,
            )}
          >
            <span
              style={css(`width:11px;height:11px;border-radius:3px;flex:none;background:${L.accent};opacity:${L.vis ? 1 : 0.3};`)}
            ></span>
            <div onClick={L.select} style={css('flex:1;min-width:0;cursor:pointer;')}>
              <div style={css('font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>
                {L.name}
              </div>
              <div style={css('font-size:10.5px;color:var(--faint);')}>{L.sub}</div>
            </div>
            <span style={css("font-size:10px;font-family:'JetBrains Mono';color:var(--faint);")}>{L.meta}</span>
            <button
              onClick={() => store.toggleLayer(L.key)}
              title="Toggle visibility"
              style={css(
                `width:26px;height:26px;border-radius:7px;border:1px solid var(--bd);background:var(--ins);color:${
                  L.vis ? 'var(--mut)' : 'var(--faint)'
                };cursor:pointer;font-size:12px;flex:none;`,
              )}
            >
              {L.vis ? '👁' : '⦸'}
            </button>
          </div>
        ))}
      </div>

      <div style={css('padding:14px 18px 8px;display:flex;align-items:center;justify-content:space-between;')}>
        <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;')}>
          LD2450 ZONES · {s.zones.length}
        </div>
      </div>
      <div style={css('flex:1;overflow-y:auto;padding:2px 12px 12px;min-height:0;')}>
        {s.zones.map((z) => {
          const m = zoneMeta(z.type)
          const isExcl = z.type === 'exclusion'
          const cnt = occ[z.id] || 0
          const cnumActive = isExcl ? false : cnt > 0
          const selected = s.sel.kind === 'zone' && s.sel.id === z.id
          const shapeLabel = z.shape === 'poly' ? 'polygon' : z.rot ? 'rotated' : 'rect'
          return (
            <div
              key={z.id}
              onClick={() => store.selectZone(z.id)}
              style={css(
                `display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;margin-bottom:3px;cursor:pointer;border:1px solid ${
                  selected ? 'var(--green)' : 'transparent'
                };background:${selected ? 'var(--greenSoft)' : 'transparent'};`,
              )}
            >
              <span
                style={css(`width:11px;height:11px;border-radius:3px;flex:none;background:${m.soft};border:1.5px solid ${m.accent};`)}
              ></span>
              <div style={css('flex:1;min-width:0;')}>
                <div
                  style={css(
                    'font-size:13px;font-weight:500;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
                  )}
                >
                  {z.name}
                </div>
                <div style={css('font-size:10.5px;color:var(--faint);')}>
                  {m.label} · {shapeLabel}
                </div>
              </div>
              <span
                style={css(
                  `font-size:10px;font-family:'JetBrains Mono';padding:2px 7px;border-radius:5px;flex:none;` +
                    (isExcl
                      ? 'color:var(--excl);background:var(--exclSoft);'
                      : cnumActive
                        ? 'color:#fff;background:var(--green);'
                        : 'color:var(--faint);background:var(--ins);'),
                )}
              >
                {isExcl ? 'excl' : cnt + '/3'}
              </span>
            </div>
          )
        })}
        <div style={css('font-size:11px;color:var(--faint);padding:8px 10px;line-height:1.5;')}>
          Draw tools live on the canvas toolbar. SEN0609 has no drawable zones — only its radial band.
        </div>
      </div>

      {/* Active profile and what Apply does, pinned below the list. */}
      <ApplyGuardrail view={applyView(s)} />
      {/* The durable ESPHome export for the drawn zones. */}
      <EsphomeExport />
    </div>
  )
}
