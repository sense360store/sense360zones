import type { ChangeEvent } from 'react'
import type { BandConfig } from '../domain/types'
import { cssVars } from '../lib/css'
import { store } from '../store/hooks'

const fv = (e: ChangeEvent<HTMLInputElement>) => {
  const v = parseFloat(e.target.value)
  return isNaN(v) ? 0 : v
}

const bandAccent = cssVars({ '--kv-accent': 'var(--band)', '--slider-accent': 'var(--band)' })

function BandSlider(props: {
  label: string
  value: string
  min: number
  max: number
  step: number
  raw: number
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="zs-field" style={bandAccent}>
      <div className="zs-kv">
        <span className="zs-kv__label">{props.label}</span>
        <span className="zs-kv__value">{props.value}</span>
      </div>
      <input
        className="zs-slider"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.raw}
        onChange={props.onChange}
      />
    </div>
  )
}

export function BandPanel(props: { band: BandConfig }) {
  const band = props.band
  return (
    <div>
      <div className="zs-insp-head">
        <span
          className="zs-insp-head__dot"
          style={cssVars({ '--dot-soft': 'var(--bandSoft)', '--dot-accent': 'var(--band)' })}
        ></span>
        <div className="zs-insp-head__body">
          <span className="zs-eyebrow">SEN0609 · C4001</span>
          <div className="zs-insp-title">Radial range band</div>
          <div className="zs-insp-head__meta">100° beam · single distance + presence</div>
        </div>
      </div>

      <div className="zs-callout">
        <div className="zs-card zs-card--band">
          No X/Y position: this sensor reports one radial distance. It has <b>no drawable 2D zones</b>; tune the band
          radii instead.
        </div>
      </div>

      <div className="zs-section">
        <div className="zs-section__head">
          <span className="zs-eyebrow">Range band</span>
        </div>
        <BandSlider
          label="Min radius (inner arc)"
          value={band.minR.toFixed(1) + ' m'}
          min={0.2}
          max={6}
          step={0.1}
          raw={band.minR}
          onChange={(e) => store.patchBand({ minR: Math.min(band.maxR - 0.3, fv(e)) })}
        />
        <BandSlider
          label="Max radius (outer arc)"
          value={band.maxR.toFixed(1) + ' m'}
          min={0.5}
          max={8}
          step={0.1}
          raw={band.maxR}
          onChange={(e) => store.patchBand({ maxR: Math.max(band.minR + 0.3, fv(e)) })}
        />
        <BandSlider
          label="Beam width"
          value={Math.round(band.beam) + '°'}
          min={20}
          max={50}
          step={1}
          raw={band.beam}
          onChange={(e) => store.patchBand({ beam: fv(e) })}
        />
        <div className="zs-note" style={{ marginTop: 11 }}>
          Drag the dots on the boresight to shape the inner and outer arc directly.
        </div>
      </div>

      <div className="zs-section zs-section--last">
        <div className="zs-section__head">
          <span className="zs-eyebrow">Sensitivity &amp; trigger</span>
        </div>
        <BandSlider
          label="Trigger sensitivity"
          value={band.trigSens + ' / 9'}
          min={0}
          max={9}
          step={1}
          raw={band.trigSens}
          onChange={(e) => store.patchBand({ trigSens: parseInt(e.target.value) })}
        />
        <BandSlider
          label="Sustained sensitivity"
          value={band.sustSens + ' / 9'}
          min={0}
          max={9}
          step={1}
          raw={band.sustSens}
          onChange={(e) => store.patchBand({ sustSens: parseInt(e.target.value) })}
        />
        <BandSlider
          label="Reduced trigger range"
          value={'−' + band.reducedRange.toFixed(1) + ' m'}
          min={0}
          max={3}
          step={0.1}
          raw={band.reducedRange}
          onChange={(e) => store.patchBand({ reducedRange: fv(e) })}
        />
        <div className="zs-note" style={{ marginTop: 6 }}>
          Subtracted from max radius for the trigger threshold only.
        </div>
      </div>
    </div>
  )
}
