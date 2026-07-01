import { occupancyCounts, zoneMeta } from '../domain/geometry'
import { cssVars } from '../lib/css'
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
  const hasLd = s.sensors.includes('ld2450')
  const hasSen = s.sensors.includes('sen0609')

  // The layers follow the device's real sensors: a device shows only the layers it
  // actually has. A device with no confirmed radar sensor shows none, and the
  // panel invites the user to confirm the mapping instead.
  const allLayers: LayerRow[] = [
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
  const layers = allLayers.filter((L) => (L.key === 'ld' ? hasLd : hasSen))

  return (
    <>
      <div className="zs-section zs-layers">
        <div className="zs-section__head">
          <span className="zs-eyebrow">Layers</span>
          <button
            className={'zs-devbtn' + (s.sel.kind === 'device' ? ' is-on' : '')}
            onClick={() => store.selectDeviceMapping()}
            title="Device mapping and confirmation"
          >
            Device
          </button>
        </div>
        {layers.length === 0 && (
          <div className="zs-note zs-layers__empty">
            No confirmed radar sensor on this device. Open Device to confirm or correct the mapping.
          </div>
        )}
        {layers.map((L) => (
          <div key={L.key} className={'zs-row' + (L.selected ? ' is-selected' : '')}>
            <span
              className={'zs-swatch' + (L.vis ? '' : ' is-off')}
              style={cssVars({ '--swatch-bg': L.accent })}
            ></span>
            <div className="zs-row__body is-clickable" onClick={L.select}>
              <div className="zs-row__title">{L.name}</div>
              <div className="zs-row__sub">{L.sub}</div>
            </div>
            <span className="zs-row__meta">{L.meta}</span>
            <button
              className={'zs-iconbtn' + (L.vis ? '' : ' is-off')}
              onClick={() => store.toggleLayer(L.key)}
              title="Toggle visibility"
            >
              {L.vis ? '👁' : '⦸'}
            </button>
          </div>
        ))}
      </div>

      {hasLd && (
        <div className="zs-zonelist__head">
          <span className="zs-eyebrow">LD2450 zones · {s.zones.length}</span>
        </div>
      )}
      <div className="zs-zonelist">
        {hasLd &&
          s.zones.map((z) => {
            const m = zoneMeta(z.type)
            const isExcl = z.type === 'exclusion'
            const cnt = occ[z.id] || 0
            const cnumActive = isExcl ? false : cnt > 0
            const selected = s.sel.kind === 'zone' && s.sel.id === z.id
            const hovered = s.hoverZoneId === z.id && !selected
            const shapeLabel = z.shape === 'poly' ? 'polygon' : z.rot ? 'rotated' : 'rect'
            return (
              <div
                key={z.id}
                className={'zs-row is-clickable' + (selected ? ' is-selected--green' : hovered ? ' is-hover' : '')}
                onClick={() => store.selectZone(z.id)}
                onMouseEnter={() => store.hoverZone(z.id)}
                onMouseLeave={() => store.hoverZone(null)}
              >
                <span
                  className="zs-swatch zs-swatch--outline"
                  style={cssVars({ '--swatch-bg': m.soft, '--swatch-bd': m.accent })}
                ></span>
                <div className="zs-row__body">
                  <div className="zs-row__title zs-row__title--regular">{z.name}</div>
                  <div className="zs-row__sub">
                    {m.label} · {shapeLabel}
                  </div>
                </div>
                <span
                  className={'zs-badge' + (isExcl ? ' is-excl' : cnumActive ? ' is-on' : '')}
                  title={isExcl ? 'Exclusion zone: targets inside are ignored' : cnt + ' of 3 tracked targets inside'}
                >
                  {isExcl ? 'mask' : cnt + '/3'}
                </span>
              </div>
            )
          })}
        {hasLd && s.zones.length === 0 && (
          <div className="zs-note zs-zonelist__note">
            No zones yet. Choose <b>Rect</b> in the canvas toolbar, then drag on the canvas to draw your first zone.
          </div>
        )}
        {hasLd && s.zones.length > 0 && (
          <div className="zs-note zs-zonelist__note">
            Draw new zones with the canvas toolbar.{hasSen ? ' SEN0609 has no drawable zones, only its radial band.' : ''}
          </div>
        )}
      </div>

      {/* Active profile and what Apply does, pinned below the list. Only the LD2450
          owns drawable zones, so the guardrail and export are LD2450-only. */}
      {hasLd && (
        <>
          <ApplyGuardrail view={applyView(s)} />
          <EsphomeExport />
        </>
      )}
    </>
  )
}
