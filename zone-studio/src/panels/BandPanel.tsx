import type { ChangeEvent } from 'react'
import { css } from '../lib/css'
import type { BandConfig } from '../domain/types'
import { store } from '../store/hooks'

const fv = (e: ChangeEvent<HTMLInputElement>) => {
  const v = parseFloat(e.target.value)
  return isNaN(v) ? 0 : v
}

export function BandPanel(props: { band: BandConfig }) {
  const band = props.band
  return (
    <div>
      <div style={css('padding:17px 20px 15px;border-bottom:1px solid var(--bd2);display:flex;align-items:flex-start;gap:11px;')}>
        <span
          style={css('width:13px;height:13px;border-radius:50%;margin-top:4px;flex:none;background:var(--bandSoft);border:1.5px solid var(--band);')}
        ></span>
        <div>
          <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:5px;')}>
            SEN0609 · C4001
          </div>
          <div style={css('font-size:17px;font-weight:700;')}>Radial range band</div>
          <div style={css("font-size:11px;color:var(--mut);margin-top:3px;font-family:'JetBrains Mono';")}>
            100° beam · single distance + presence
          </div>
        </div>
      </div>

      <div style={css('margin:14px 20px;padding:11px 13px;border-radius:9px;background:var(--bandSoft);border:1px solid var(--band);')}>
        <div style={css('font-size:11.5px;color:var(--tx);line-height:1.55;')}>
          No X/Y position — this sensor reports one radial distance. It has <b>no drawable 2D zones</b>; tune the band radii instead.
        </div>
      </div>

      <div style={css('padding:8px 20px 16px;border-bottom:1px solid var(--bd2);')}>
        <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:12px;')}>
          RANGE BAND
        </div>
        <div style={css('margin-bottom:15px;')}>
          <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
            <span style={css('font-size:12px;color:var(--mut);')}>Min radius (inner arc)</span>
            <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{band.minR.toFixed(1)} m</span>
          </div>
          <input
            type="range"
            min="0.2"
            max="6"
            step="0.1"
            value={band.minR}
            onChange={(e) => store.patchBand({ minR: Math.min(band.maxR - 0.3, fv(e)) })}
            style={css('width:100%;accent-color:var(--band);')}
          />
        </div>
        <div style={css('margin-bottom:15px;')}>
          <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
            <span style={css('font-size:12px;color:var(--mut);')}>Max radius (outer arc)</span>
            <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{band.maxR.toFixed(1)} m</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="8"
            step="0.1"
            value={band.maxR}
            onChange={(e) => store.patchBand({ maxR: Math.max(band.minR + 0.3, fv(e)) })}
            style={css('width:100%;accent-color:var(--band);')}
          />
        </div>
        <div>
          <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
            <span style={css('font-size:12px;color:var(--mut);')}>Beam width</span>
            <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{Math.round(band.beam)}°</span>
          </div>
          <input
            type="range"
            min="20"
            max="50"
            step="1"
            value={band.beam}
            onChange={(e) => store.patchBand({ beam: fv(e) })}
            style={css('width:100%;accent-color:var(--band);')}
          />
        </div>
        <div style={css('margin-top:11px;font-size:11px;color:var(--faint);')}>
          Drag the dots on the boresight to shape the inner and outer arc directly.
        </div>
      </div>

      <div style={css('padding:16px 20px;')}>
        <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:12px;')}>
          SENSITIVITY &amp; TRIGGER
        </div>
        <div style={css('margin-bottom:15px;')}>
          <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
            <span style={css('font-size:12px;color:var(--mut);')}>Trigger sensitivity</span>
            <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{band.trigSens} / 9</span>
          </div>
          <input
            type="range"
            min="0"
            max="9"
            step="1"
            value={band.trigSens}
            onChange={(e) => store.patchBand({ trigSens: parseInt(e.target.value) })}
            style={css('width:100%;accent-color:var(--band);')}
          />
        </div>
        <div style={css('margin-bottom:15px;')}>
          <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
            <span style={css('font-size:12px;color:var(--mut);')}>Sustained sensitivity</span>
            <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{band.sustSens} / 9</span>
          </div>
          <input
            type="range"
            min="0"
            max="9"
            step="1"
            value={band.sustSens}
            onChange={(e) => store.patchBand({ sustSens: parseInt(e.target.value) })}
            style={css('width:100%;accent-color:var(--band);')}
          />
        </div>
        <div>
          <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
            <span style={css('font-size:12px;color:var(--mut);')}>Reduced trigger range</span>
            <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>−{band.reducedRange.toFixed(1)} m</span>
          </div>
          <input
            type="range"
            min="0"
            max="3"
            step="0.1"
            value={band.reducedRange}
            onChange={(e) => store.patchBand({ reducedRange: fv(e) })}
            style={css('width:100%;accent-color:var(--band);')}
          />
          <div style={css('margin-top:6px;font-size:11px;color:var(--faint);')}>
            Subtracted from max radius for the trigger threshold only.
          </div>
        </div>
      </div>
    </div>
  )
}
