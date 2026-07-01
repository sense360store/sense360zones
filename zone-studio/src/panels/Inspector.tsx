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
    <>
      {selZone && <ZonePanel zone={selZone} count={occupancyCounts([selZone], s.targets)[selZone.id] || 0} />}
      {s.sel.kind === 'sen' && <BandPanel band={s.band} />}
      {s.sel.kind === 'ld' && <LdPanel targets={s.targets} presence={evaluateOccupancy(s.zones, s.targets).presence} />}
      {s.sel.kind === 'device' && <MappingPanel candidate={s.candidate} />}
      {s.sel.kind === 'none' && (
        <div className="zs-empty">
          Nothing selected.
          <br />
          Pick a zone, a layer, or a sensor to edit its properties.
        </div>
      )}
    </>
  )
}
