import { css } from '../lib/css'
import { occupancyCounts } from '../domain/geometry'
import { evaluateOccupancy } from '../domain/occupancy'
import { useEditorState } from '../store/hooks'
import { BandPanel } from './BandPanel'
import { LdPanel } from './LdPanel'
import { MappingPanel } from './MappingPanel'
import { ZonePanel } from './ZonePanel'

/** Right-hand context panel — routes to the editor for whatever is selected. */
export function Inspector() {
  const s = useEditorState()
  const selId = s.sel.kind === 'zone' ? s.sel.id : null
  const selZone = selId ? s.zones.find((z) => z.id === selId) : undefined

  return (
    <div
      style={css('width:344px;flex:none;background:var(--panel);border-left:1px solid var(--bd);overflow-y:auto;min-height:0;')}
    >
      {selZone && <ZonePanel zone={selZone} count={occupancyCounts([selZone], s.targets)[selZone.id] || 0} />}
      {s.sel.kind === 'sen' && <BandPanel band={s.band} />}
      {s.sel.kind === 'ld' && <LdPanel targets={s.targets} presence={evaluateOccupancy(s.zones, s.targets).presence} />}
      {s.sel.kind === 'device' && <MappingPanel candidate={s.candidate} />}
      {s.sel.kind === 'none' && (
        <div style={css('padding:40px 24px;text-align:center;color:var(--faint);')}>
          <div style={css('font-size:13px;line-height:1.6;')}>
            Nothing selected.
            <br />
            Pick a zone, a layer, or a sensor to edit its properties.
          </div>
        </div>
      )}
    </div>
  )
}
