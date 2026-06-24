import { Component, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { css } from './lib/css'

/*
 * Sense360 Zone Studio
 * -------------------------------------------------------------------------
 * Faithful React port of the Claude Design prototype `Zone Studio.dc.html`.
 *
 * The prototype was authored in Claude Design's `DCLogic` framework, which is
 * a thin layer over React (its base class is a React component, and the
 * `sc-if` / `sc-for` / `{{ }}` template compiles to React.createElement). So
 * the most faithful recreation is an almost line-for-line port:
 *   - the component state and all geometry math are copied verbatim, which
 *     keeps the SVG canvas pixel-identical to the design;
 *   - `renderVals()` returns the same view-model object the template bound to;
 *   - the template becomes the JSX in `render()`, with inline style strings fed
 *     through the `css()` helper so they stay byte-for-byte the same.
 *
 * Behavioural notes / intentional choices:
 *   - The root frame fills the viewport (the prototype hard-coded 1440x900);
 *     at that resolution the layout is identical, and the flex layout + SVG
 *     viewBox scale gracefully at other sizes.
 *   - Text/number fields commit on blur or Enter (see `Field`) to match the
 *     prototype's native `change` semantics; range sliders update live.
 */

type ZoneType = 'detection' | 'exclusion'
type Shape = 'rect' | 'poly'
type Tool = 'select' | 'rect' | 'rot' | 'poly'
type View = 'wall' | 'ceiling'

interface Pt {
  x: number
  y: number
}

interface Zone {
  id: string
  name: string
  type: ZoneType
  shape: Shape
  cx?: number
  cy?: number
  w?: number
  h?: number
  rot?: number
  pts?: Pt[]
}

interface Sensor {
  minR: number
  maxR: number
  beam: number
  trigSens: number
  sustSens: number
  reducedRange: number
}

interface Target {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  color: string
  trail: number[][]
}

type Sel =
  | { kind: 'zone'; id: string }
  | { kind: 'sen' }
  | { kind: 'ld' }
  | { kind: 'none' }

interface State {
  theme: 'light' | 'dark'
  view: View
  tool: Tool
  layers: { ld: boolean; sen: boolean }
  sel: Sel
  zones: Zone[]
  sen: Sensor
  targets: Target[]
  draft: { pts: Pt[] } | null
  cursor: Pt | null
  saved: string
  _prev?: unknown
}

/**
 * Controlled-on-commit input. Mirrors the prototype's text/number fields,
 * which used the browser's native `change` event (fires on blur / Enter).
 * Local state lets the user type freely; the value resyncs from props whenever
 * the field is not focused (e.g. when a zone is dragged on the canvas).
 */
function Field(props: {
  value: string
  onCommit: (val: string) => void
  type?: string
  step?: string
  style: CSSProperties
}) {
  const { value, onCommit, type = 'text', step, style } = props
  const [local, setLocal] = useState(value)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setLocal(value)
  }, [value, focused])

  return (
    <input
      type={type}
      step={step}
      style={style}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        setFocused(false)
        onCommit(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export default class ZoneStudio extends Component<Record<string, never>, State> {
  M = 80
  SX = 430
  SY = 74
  SC: Record<string, number> = { wall: 80, ceiling: 58 }
  OY: Record<string, number> = { wall: 74, ceiling: 384 }
  LD_FOV = 60 // half-angle (120 total)
  LD_RANGE = 6.0

  // imperative drag handle + animation bookkeeping
  h: any = null
  _raf: number | null = null
  _last = 0
  _trailT = 0

  constructor(props: Record<string, never>) {
    super(props)
    const zones: Zone[] = [
      { id: 'z1', name: 'Desk', type: 'detection', shape: 'rect', cx: -1.5, cy: 1.7, w: 1.9, h: 1.25, rot: 0 },
      { id: 'z2', name: 'Entry', type: 'detection', shape: 'rect', cx: 1.7, cy: 1.05, w: 1.45, h: 1.05, rot: 24 },
      { id: 'z3', name: 'Couch', type: 'exclusion', shape: 'rect', cx: -1.45, cy: 3.95, w: 2.4, h: 1.3, rot: 0 },
      {
        id: 'z4',
        name: 'Kitchen run',
        type: 'detection',
        shape: 'poly',
        pts: [
          { x: 0.5, y: 3.1 },
          { x: 2.5, y: 3.1 },
          { x: 2.5, y: 4.7 },
          { x: 1.7, y: 4.7 },
          { x: 1.7, y: 3.95 },
          { x: 0.5, y: 3.95 },
        ],
      },
    ]
    const sen: Sensor = { minR: 0.8, maxR: 4.4, beam: 50, trigSens: 7, sustSens: 5, reducedRange: 0.0 }
    this.state = {
      theme: 'light',
      view: 'wall',
      tool: 'select',
      layers: { ld: true, sen: true },
      sel: { kind: 'zone', id: 'z1' },
      zones,
      sen,
      targets: [
        { id: 't1', x: -1.5, y: 1.8, vx: 0.16, vy: 0.07, color: 'var(--green)', trail: [] },
        { id: 't2', x: 1.7, y: 1.0, vx: -0.13, vy: 0.17, color: '#2d8fff', trail: [] },
        { id: 't3', x: 0.9, y: 3.6, vx: 0.12, vy: -0.14, color: '#e0922a', trail: [] },
      ],
      draft: null,
      cursor: null,
      saved: JSON.stringify({ zones, sen }),
    }
  }

  componentDidMount() {
    const loop = (ts: number) => {
      if (!this._last) this._last = ts
      const dt = Math.min(0.05, (ts - this._last) / 1000)
      this._last = ts
      this._trailT += dt
      const pushTrail = this._trailT > 0.06
      if (pushTrail) this._trailT = 0
      const rng = this.LD_RANGE,
        ha = (this.LD_FOV * Math.PI) / 180
      this.setState((s) => ({
        targets: s.targets.map((t) => {
          let nx = t.x + t.vx * dt * 1.3,
            ny = t.y + t.vy * dt * 1.3,
            vx = t.vx,
            vy = t.vy
          const r = Math.hypot(nx, ny)
          if (this.state.view === 'ceiling') {
            if (r > rng - 0.4) {
              const k = (rng - 0.4) / r
              nx *= k
              ny *= k
              vx = -vx
              vy = -vy
            }
          } else {
            if (ny < 0.4) {
              ny = 0.4
              vy = Math.abs(vy)
            }
            if (r > rng - 0.4) {
              const k = (rng - 0.4) / r
              nx *= k
              ny *= k
              vy = -Math.abs(vy)
            }
            const ang = Math.atan2(nx, ny)
            if (Math.abs(ang) > ha - 0.06) {
              vx = -vx
              nx = Math.tan(Math.sign(ang) * (ha - 0.08)) * ny
            }
          }
          let trail = t.trail
          if (pushTrail) {
            const pp = this.toPx(nx, ny)
            trail = [...t.trail, [pp.x, pp.y]].slice(-16)
          }
          return { ...t, x: nx, y: ny, vx, vy, trail }
        }),
      }))
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }

  componentWillUnmount() {
    if (this._raf) cancelAnimationFrame(this._raf)
  }

  // ---- geometry -----------------------------------------------------------
  scale() {
    return this.SC[this.state.view] || 80
  }
  originY() {
    return this.OY[this.state.view] || 74
  }
  toPx(xm: number, ym: number) {
    const m = this.scale()
    return { x: this.SX + xm * m, y: this.originY() + ym * m }
  }
  svgPt(e: any) {
    const svg = e.currentTarget.ownerSVGElement || e.currentTarget
    const r = svg.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * 860, y: ((e.clientY - r.top) / r.height) * 760 }
  }
  toM(p: Pt) {
    const m = this.scale()
    return { x: (p.x - this.SX) / m, y: (p.y - this.originY()) / m }
  }
  snap(v: number) {
    return Math.round(v * 2) / 2
  }
  rectCorners(z: Zone): Pt[] {
    const c = Math.cos(((z.rot || 0) * Math.PI) / 180),
      s = Math.sin(((z.rot || 0) * Math.PI) / 180),
      hw = (z.w || 0) / 2,
      hh = (z.h || 0) / 2
    return ([
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const).map(([x, y]) => ({ x: (z.cx || 0) + x * c - y * s, y: (z.cy || 0) + x * s + y * c }))
  }
  zonePtsM(z: Zone): Pt[] {
    return z.shape === 'poly' ? z.pts || [] : this.rectCorners(z)
  }
  pip(pt: Pt, poly: Pt[]) {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x,
        yi = poly[i].y,
        xj = poly[j].x,
        yj = poly[j].y
      if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  meta(t: ZoneType) {
    return t === 'exclusion'
      ? { label: 'Exclusion', accent: 'var(--excl)', soft: 'var(--exclSoft)' }
      : { label: 'Detection', accent: 'var(--green)', soft: 'var(--greenSoft)' }
  }
  isDirty(s: State) {
    return JSON.stringify({ zones: s.zones, sen: s.sen }) !== s.saved
  }

  // ---- actions ------------------------------------------------------------
  toggleTheme() {
    this.setState((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))
  }
  setView(v: View) {
    this.setState({ view: v })
  }
  setTool(t: Tool) {
    this.setState({ tool: t, draft: null })
  }
  selZone(id: string) {
    this.setState({ sel: { kind: 'zone', id } })
  }
  selSensor() {
    this.setState({ sel: { kind: 'sen' } })
  }
  selLd() {
    this.setState({ sel: { kind: 'ld' } })
  }
  toggleLayer(k: 'ld' | 'sen') {
    this.setState((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } }))
  }
  patchZone(id: string, patch: Partial<Zone>) {
    this.setState((s) => ({ zones: s.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }))
  }
  patchSen(patch: Partial<Sensor>) {
    this.setState((s) => ({ sen: { ...s.sen, ...patch } }))
  }
  delZone(id: string) {
    this.setState((s) => {
      const zones = s.zones.filter((z) => z.id !== id)
      return {
        zones,
        sel: zones.length ? { kind: 'zone', id: zones[0].id } : { kind: 'none' },
      } as Pick<State, 'zones' | 'sel'>
    })
  }
  apply() {
    this.setState((s) => ({ saved: JSON.stringify({ zones: s.zones, sen: s.sen }) }))
  }
  revert() {
    this.setState((s) => {
      const r = JSON.parse(s.saved)
      return { zones: r.zones, sen: r.sen }
    })
  }

  // ---- drag dispatch ------------------------------------------------------
  zoneDown(id: string, e: any) {
    e.stopPropagation()
    const m = this.toM(this.svgPt(e))
    const z = this.state.zones.find((z) => z.id === id)
    this.h = { mode: 'move', id, start: m, orig: JSON.parse(JSON.stringify(z)) }
    this.setState({ sel: { kind: 'zone', id } })
  }
  cornerDown(id: string, i: number, e: any) {
    e.stopPropagation()
    this.h = { mode: 'corner', id, i }
    this.setState({ sel: { kind: 'zone', id } })
  }
  rotDown(id: string, e: any) {
    e.stopPropagation()
    this.h = { mode: 'rotate', id }
  }
  vertexDown(id: string, i: number, e: any) {
    e.stopPropagation()
    this.h = { mode: 'vertex', id, i }
    this.setState({ sel: { kind: 'zone', id } })
  }
  radiusDown(which: 'minR' | 'maxR', e: any) {
    e.stopPropagation()
    this.h = { mode: which }
    this.setState({ sel: { kind: 'sen' } })
  }

  canvasDown(e: any) {
    const t = this.state.tool
    if (t === 'poly') {
      const m = this.toM(this.svgPt(e))
      const pts = (this.state.draft && this.state.draft.pts) || []
      this.setState({ draft: { pts: [...pts, { x: this.snap(m.x), y: this.snap(m.y) }] } })
      return
    }
    if (t === 'rect' || t === 'rot') {
      const m = this.toM(this.svgPt(e))
      this.h = { mode: 'create', t, start: m }
      return
    }
    this.setState({ sel: { kind: 'none' } }) // empty click in select mode
  }
  onMove(e: any) {
    const p = this.svgPt(e),
      m = this.toM(p)
    this.setState({ cursor: m })
    if (!this.h) return
    const H = this.h
    if (H.mode === 'move') {
      const dx = m.x - H.start.x,
        dy = m.y - H.start.y
      const o = H.orig
      if (o.shape === 'poly')
        this.patchZone(H.id, { pts: o.pts.map((pt: Pt) => ({ x: this.snap(pt.x + dx), y: this.snap(pt.y + dy) })) })
      else this.patchZone(H.id, { cx: this.snap(o.cx + dx), cy: this.snap(o.cy + dy) })
    } else if (H.mode === 'corner') {
      const z = this.state.zones.find((z) => z.id === H.id)!
      const r = ((z.rot || 0) * Math.PI) / 180
      const lx = (m.x - (z.cx || 0)) * Math.cos(-r) - (m.y - (z.cy || 0)) * Math.sin(-r),
        ly = (m.x - (z.cx || 0)) * Math.sin(-r) + (m.y - (z.cy || 0)) * Math.cos(-r)
      this.patchZone(H.id, { w: Math.max(0.3, Math.abs(lx) * 2), h: Math.max(0.3, Math.abs(ly) * 2) })
    } else if (H.mode === 'rotate') {
      const z = this.state.zones.find((z) => z.id === H.id)!
      const ang = (Math.atan2(m.x - (z.cx || 0), -(m.y - (z.cy || 0))) * 180) / Math.PI
      this.patchZone(H.id, { rot: Math.round(ang) })
    } else if (H.mode === 'vertex') {
      const z = this.state.zones.find((z) => z.id === H.id)!
      const pts = (z.pts || []).map((pt, i) => (i === H.i ? { x: this.snap(m.x), y: this.snap(m.y) } : pt))
      this.patchZone(H.id, { pts })
    } else if (H.mode === 'minR') {
      this.patchSen({
        minR: Math.max(0.2, Math.min(this.state.sen.maxR - 0.3, Math.round(Math.hypot(m.x, m.y) * 10) / 10)),
      })
    } else if (H.mode === 'maxR') {
      this.patchSen({
        maxR: Math.max(this.state.sen.minR + 0.3, Math.min(8, Math.round(Math.hypot(m.x, m.y) * 10) / 10)),
      })
    } else if (H.mode === 'create') {
      this.setState({ _prev: { start: H.start, cur: m } })
    }
  }
  onUp() {
    const H = this.h
    this.h = null
    if (H && H.mode === 'create') {
      const a = H.start,
        b = this.state.cursor || a
      const w = Math.abs(b.x - a.x),
        h = Math.abs(b.y - a.y)
      if (w > 0.3 && h > 0.3) {
        const id = 'z' + Date.now().toString(36)
        const z: Zone = {
          id,
          name: 'New zone',
          type: 'detection',
          shape: 'rect',
          cx: this.snap((a.x + b.x) / 2),
          cy: this.snap((a.y + b.y) / 2),
          w: Math.round(w * 2) / 2,
          h: Math.round(h * 2) / 2,
          rot: 0,
        }
        this.setState((s) => ({ zones: [...s.zones, z], sel: { kind: 'zone', id }, tool: 'select', _prev: null }))
      } else this.setState({ _prev: null, tool: 'select' })
    }
  }
  onDouble() {
    const d = this.state.draft
    if (d && d.pts.length >= 3) {
      const id = 'z' + Date.now().toString(36)
      const z: Zone = { id, name: 'Polygon zone', type: 'detection', shape: 'poly', pts: d.pts }
      this.setState((s) => ({ zones: [...s.zones, z], draft: null, sel: { kind: 'zone', id }, tool: 'select' }))
    }
  }

  // ---- view model ---------------------------------------------------------
  renderVals(): any {
    const s = this.state,
      M = this.scale(),
      SX = this.SX,
      SY = this.originY()
    const isCeil = s.view === 'ceiling'
    const dirty = this.isDirty(s)
    const P = (xm: number, ym: number) => this.toPx(xm, ym)

    // rings + spokes
    const rings: any[] = [],
      ringLabels: any[] = []
    for (let r = 1; r <= 6; r++) {
      rings.push({ r: r * M, dash: r % 1 ? '2 5' : '3 6' })
      ringLabels.push({ x: SX + 5, y: SY + r * M - 4, t: r + 'm' })
    }
    const ha = (this.LD_FOV * Math.PI) / 180
    const spokes = (isCeil ? [0, 45, 90, 135, 180, 225, 270, 315] : [-60, -30, 0, 30, 60]).map((d) => {
      const a = (d * Math.PI) / 180
      return { x: SX + Math.sin(a) * 6.2 * M, y: SY + Math.cos(a) * 6.2 * M }
    })
    const ldCone = `${SX},${SY} ${SX + Math.sin(-ha) * this.LD_RANGE * M},${SY + Math.cos(-ha) * this.LD_RANGE * M} ${
      SX + Math.sin(ha) * this.LD_RANGE * M
    },${SY + Math.cos(ha) * this.LD_RANGE * M}`

    // SEN0609 band (sector minR..maxR over beam)
    const bh = (s.sen.beam * Math.PI) / 180
    const arc = (rad: number, a0: number, a1: number) => {
      const p0 = P(Math.sin(a0) * rad, Math.cos(a0) * rad),
        p1 = P(Math.sin(a1) * rad, Math.cos(a1) * rad)
      const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0
      return { p0, p1, large }
    }
    const oa = arc(s.sen.maxR, -bh, bh),
      ia = arc(s.sen.minR, bh, -bh)
    const bandPath = `M ${oa.p0.x} ${oa.p0.y} A ${s.sen.maxR * M} ${s.sen.maxR * M} 0 0 1 ${oa.p1.x} ${oa.p1.y} L ${
      ia.p0.x
    } ${ia.p0.y} A ${s.sen.minR * M} ${s.sen.minR * M} 0 0 0 ${ia.p1.x} ${ia.p1.y} Z`
    const bandOuterArc = `M ${oa.p0.x} ${oa.p0.y} A ${s.sen.maxR * M} ${s.sen.maxR * M} 0 0 1 ${oa.p1.x} ${oa.p1.y}`
    const bandInnerArc = `M ${P(Math.sin(-bh) * s.sen.minR, Math.cos(-bh) * s.sen.minR).x} ${
      P(Math.sin(-bh) * s.sen.minR, Math.cos(-bh) * s.sen.minR).y
    } A ${s.sen.minR * M} ${s.sen.minR * M} 0 0 1 ${P(Math.sin(bh) * s.sen.minR, Math.cos(bh) * s.sen.minR).x} ${
      P(Math.sin(bh) * s.sen.minR, Math.cos(bh) * s.sen.minR).y
    }`
    const bandLabel = P(0, (s.sen.minR + s.sen.maxR) / 2 + 0.15)
    const bandHandleIn = P(0, s.sen.minR),
      bandHandleOut = P(0, s.sen.maxR)
    const senSelected = s.sel.kind === 'sen'

    // zones
    const selId = s.sel.kind === 'zone' ? s.sel.id : null
    const occCount: Record<string, number> = {}
    s.zones.forEach((z) => {
      const poly = this.zonePtsM(z)
      occCount[z.id] = s.targets.filter((t) => this.pip(t, poly)).length
    })
    const zonesView = s.zones.map((z) => {
      const m = this.meta(z.type),
        poly = this.zonePtsM(z)
      const ppx = poly.map((pt) => P(pt.x, pt.y))
      const pts = ppx.map((p) => `${p.x},${p.y}`).join(' ')
      const minx = Math.min(...ppx.map((p) => p.x)),
        miny = Math.min(...ppx.map((p) => p.y))
      const selected = z.id === selId,
        isExcl = z.type === 'exclusion'
      const cnt = occCount[z.id] || 0
      const cnumActive = isExcl ? false : cnt > 0
      let handles: any[] = []
      if (selected && z.shape !== 'poly') {
        handles = ppx.map((p, i) => ({ x: p.x - 4, y: p.y - 4, cursor: 'nwse-resize', down: (e: any) => this.cornerDown(z.id, i, e) }))
      } else if (selected && z.shape === 'poly') {
        handles = ppx.map((p, i) => ({ x: p.x - 4, y: p.y - 4, cursor: 'move', down: (e: any) => this.vertexDown(z.id, i, e) }))
      }
      const hasRotate = selected && z.shape === 'rect'
      const topMid =
        z.shape === 'rect'
          ? (() => {
              const r = ((z.rot || 0) * Math.PI) / 180
              return {
                x: (z.cx || 0) + 0 * Math.cos(r) - (-(z.h || 0) / 2) * Math.sin(r),
                y: (z.cy || 0) + 0 * Math.sin(r) + (-(z.h || 0) / 2) * Math.cos(r),
              }
            })()
          : { x: 0, y: 0 }
      const tmPx = z.shape === 'rect' ? P(topMid.x, topMid.y) : { x: 0, y: 0 }
      const rotPx =
        z.shape === 'rect'
          ? P(topMid.x - Math.sin(((z.rot || 0) * Math.PI) / 180) * 0.55, topMid.y - Math.cos(((z.rot || 0) * Math.PI) / 180) * 0.55)
          : { x: 0, y: 0 }
      return {
        ...z,
        pts,
        accent: m.accent,
        fill: m.soft,
        soft: m.soft,
        isExcl,
        sw: selected ? 2.4 : 1.8,
        dash: isExcl ? '7 5' : '0',
        labelX: minx + 8,
        labelY: miny + 15,
        countY: miny + 27,
        canvasCount: isExcl ? 'masked' : cnt + ' / 3',
        selected,
        handles,
        hasRotate,
        rotX: rotPx.x,
        rotY: rotPx.y,
        rotLineX1: tmPx.x,
        rotLineY1: tmPx.y,
        rotDown: (e: any) => this.rotDown(z.id, e),
        swatchBg: m.soft,
        typeLabel: m.label,
        shapeLabel: z.shape === 'poly' ? 'polygon' : z.rot ? 'rotated' : 'rect',
        countText: isExcl ? 'excl' : cnt + '/3',
        countStyle:
          `font-size:10px;font-family:'JetBrains Mono';padding:2px 7px;border-radius:5px;flex:none;` +
          (isExcl
            ? 'color:var(--excl);background:var(--exclSoft);'
            : cnumActive
              ? 'color:#fff;background:var(--green);'
              : 'color:var(--faint);background:var(--ins);'),
        rowStyle: `display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;margin-bottom:3px;cursor:pointer;border:1px solid ${
          selected ? 'var(--green)' : 'transparent'
        };background:${selected ? 'var(--greenSoft)' : 'transparent'};`,
        select: () => this.selZone(z.id),
        down: (e: any) => this.zoneDown(z.id, e),
      }
    })

    // targets
    const targetsView = s.targets.map((t, i) => {
      const p = P(t.x, t.y)
      return {
        id: t.id,
        cx: p.x,
        cy: p.y,
        color: t.color,
        halo: t.color,
        lx: p.x + 8,
        ly: p.y - 8,
        label: 'T' + (i + 1),
        trail: t.trail.map((pt) => pt.join(',')).join(' '),
      }
    })

    // draft
    const drafting = !!(s.draft && s.draft.pts.length)
    const draftDots = drafting
      ? s.draft!.pts.map((pt) => {
          const p = P(pt.x, pt.y)
          return { x: p.x, y: p.y }
        })
      : []
    const draftLine = draftDots.map((d) => `${d.x},${d.y}`).join(' ')

    // layers panel
    const layersView = [
      {
        key: 'ld' as const,
        name: 'HLK LD2450 · zones',
        sub: 'Spatial · X/Y · up to 3 targets',
        meta: '120°',
        vis: s.layers.ld,
        accent: 'var(--green)',
        sel: s.sel.kind === 'ld',
        selectFn: () => this.selLd(),
      },
      {
        key: 'sen' as const,
        name: 'DFRobot SEN0609 · range',
        sub: 'Radial distance + presence',
        meta: '100°',
        vis: s.layers.sen,
        accent: 'var(--band)',
        sel: s.sel.kind === 'sen',
        selectFn: () => this.selSensor(),
      },
    ].map((L) => ({
      name: L.name,
      sub: L.sub,
      meta: L.meta,
      swatchStyle: `width:11px;height:11px;border-radius:3px;flex:none;background:${L.accent};opacity:${L.vis ? 1 : 0.3};`,
      rowStyle: `display:flex;align-items:center;gap:10px;padding:9px 9px;border-radius:9px;margin-bottom:3px;border:1px solid ${
        L.sel ? 'var(--bd)' : 'transparent'
      };background:${L.sel ? 'var(--ins)' : 'transparent'};`,
      eye: L.vis ? '👁' : '⦸',
      eyeStyle: `width:26px;height:26px;border-radius:7px;border:1px solid var(--bd);background:var(--ins);color:${
        L.vis ? 'var(--mut)' : 'var(--faint)'
      };cursor:pointer;font-size:12px;flex:none;`,
      toggle: () => this.toggleLayer(L.key),
      select: L.selectFn,
    }))

    const cur = s.cursor,
      cursorReadout = cur ? `x ${cur.x.toFixed(2)}  y ${cur.y.toFixed(2)} m` : 'x —  y —'
    const seg = (on: boolean) =>
      on
        ? 'height:28px;padding:0 12px;border-radius:6px;border:none;background:var(--green);color:#fff;font-family:Murecho;font-size:12.5px;font-weight:600;cursor:pointer;'
        : 'height:28px;padding:0 12px;border-radius:6px;border:none;background:transparent;color:var(--mut);font-family:Murecho;font-size:12.5px;font-weight:500;cursor:pointer;'
    const toolHints: Record<string, string> = {
      select: 'Click a zone to edit · drag to move · handles to resize/rotate',
      rect: 'Drag on the canvas to draw a rectangle zone',
      rot: 'Drag to draw, then use the rotate handle',
      poly: 'Click to drop points · double-click to finish',
    }

    const applyStyle = dirty
      ? 'height:34px;padding:0 18px;border-radius:8px;border:1px solid var(--green);background:var(--green);color:#fff;font-family:Murecho;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 0 16px var(--greenSoft);'
      : 'height:34px;padding:0 18px;border-radius:8px;border:1px solid var(--bd);background:var(--ins);color:var(--faint);font-family:Murecho;font-size:13px;font-weight:600;cursor:default;'

    // right panel
    const numStyle =
      'width:100%;height:34px;background:var(--ins);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-family:"JetBrains Mono";font-size:13px;padding:0 10px;outline:none;'
    const pf = (val: string) => {
      const v = parseFloat(val)
      return isNaN(v) ? 0 : v
    }
    const fv = (e: any) => {
      const v = parseFloat(e.target.value)
      return isNaN(v) ? 0 : v
    }
    const tseg = (on: boolean, col: string) =>
      on
        ? `height:28px;flex:1;border-radius:6px;border:none;background:${col};color:#fff;font-family:Murecho;font-size:12px;font-weight:700;cursor:pointer;`
        : 'height:28px;flex:1;border-radius:6px;border:none;background:transparent;color:var(--mut);font-family:Murecho;font-size:12px;font-weight:500;cursor:pointer;'

    const selZone = selId ? s.zones.find((z) => z.id === selId) || null : null
    let pz: any = null
    if (selZone) {
      const m = this.meta(selZone.type),
        isExcl = selZone.type === 'exclusion'
      const poly = this.zonePtsM(selZone)
      let area = 0
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        area += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
      }
      area = Math.abs(area / 2)
      const cnt = occCount[selZone.id] || 0
      pz = {
        name: selZone.name,
        accent: m.accent,
        soft: m.soft,
        shapeLabel: selZone.shape === 'poly' ? 'polygon' : selZone.rot ? 'rotated rect' : 'rectangle',
        isRect: selZone.shape === 'rect',
        isPoly: selZone.shape === 'poly',
        cx: (selZone.cx || 0).toFixed(1),
        cy: (selZone.cy || 0).toFixed(1),
        w: (selZone.w || 0).toFixed(1),
        h: (selZone.h || 0).toFixed(1),
        rot: Math.round(selZone.rot || 0),
        area: area.toFixed(2),
        polyText: (selZone.pts ? selZone.pts.length : 0) + ' vertices.',
        geomBorder: '',
        typeHint: isExcl
          ? 'Masks out everything inside — fans, pets, reflective surfaces. Targets here are ignored by all detection zones.'
          : 'Reports occupancy whenever a tracked target enters the zone.',
        detStyle: tseg(!isExcl, 'var(--green)'),
        exclStyle: tseg(isExcl, 'var(--excl)'),
        liveText: isExcl ? 'masked' : cnt + ' / 3',
        liveStyle:
          `font-size:12px;font-family:'JetBrains Mono';font-weight:600;padding:3px 9px;border-radius:6px;` +
          (isExcl
            ? 'color:var(--excl);background:var(--exclSoft);'
            : cnt > 0
              ? 'color:#fff;background:var(--green);'
              : 'color:var(--faint);background:var(--panel);'),
        onName: (val: string) => this.patchZone(selZone.id, { name: val || 'Zone' }),
        onCx: (val: string) => this.patchZone(selZone.id, { cx: pf(val) }),
        onCy: (val: string) => this.patchZone(selZone.id, { cy: pf(val) }),
        onW: (val: string) => this.patchZone(selZone.id, { w: Math.max(0.3, pf(val)) }),
        onH: (val: string) => this.patchZone(selZone.id, { h: Math.max(0.3, pf(val)) }),
        onRot: (e: any) => this.patchZone(selZone.id, { rot: parseInt(e.target.value) }),
        setDetection: () => this.patchZone(selZone.id, { type: 'detection' }),
        setExclusion: () => this.patchZone(selZone.id, { type: 'exclusion' }),
        onDelete: () => this.delZone(selZone.id),
      }
    }
    const ps = {
      minR: s.sen.minR.toFixed(1),
      maxR: s.sen.maxR.toFixed(1),
      beam: Math.round(s.sen.beam),
      trig: s.sen.trigSens,
      sust: s.sen.sustSens,
      reduced: s.sen.reducedRange.toFixed(1),
      onMin: (e: any) => this.patchSen({ minR: Math.min(s.sen.maxR - 0.3, fv(e)) }),
      onMax: (e: any) => this.patchSen({ maxR: Math.max(s.sen.minR + 0.3, fv(e)) }),
      onBeam: (e: any) => this.patchSen({ beam: fv(e) }),
      onTrig: (e: any) => this.patchSen({ trigSens: parseInt(e.target.value) }),
      onSust: (e: any) => this.patchSen({ sustSens: parseInt(e.target.value) }),
      onReduced: (e: any) => this.patchSen({ reducedRange: fv(e) }),
    }
    const ldTargets = s.targets.map((t, i) => ({
      label: 'Target ' + (i + 1),
      color: t.color,
      coord: `x ${t.x.toFixed(1)}  y ${t.y.toFixed(1)}`,
    }))

    return {
      numStyle,
      pz,
      ps,
      ldTargets,
      showZone: !!selZone,
      showSen: s.sel.kind === 'sen',
      showLd: s.sel.kind === 'ld',
      showNone: s.sel.kind === 'none',
      themeClass: s.theme === 'dark' ? 'dark' : '',
      themeLabel: s.theme === 'dark' ? 'Dark' : 'Light',
      themeIcon: s.theme === 'dark' ? '☾' : '☀',
      themeKnobStyle: `width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--panel);border:1px solid var(--bd);font-size:12px;`,
      toggleTheme: () => this.toggleTheme(),
      dirty,
      applyStyle,
      apply: () => this.apply(),
      revert: () => this.revert(),
      layersView,
      zonesView,
      targetsView,
      zoneCount: s.zones.length,
      layerLd: s.layers.ld,
      layerSen: s.layers.sen,
      rings,
      ringLabels,
      spokes,
      ldCone,
      bandPath,
      bandOuterArc,
      bandInnerArc,
      bandLabel,
      bandHandleIn,
      bandHandleOut,
      senSelected,
      dragMinR: (e: any) => this.radiusDown('minR', e),
      dragMaxR: (e: any) => this.radiusDown('maxR', e),
      drafting,
      draftDots,
      draftLine,
      sx: SX,
      sy: SY,
      boreY: SY + 6.2 * M,
      boreLabelX: SX + 6,
      boreLabelY: SY + 6.2 * M - 6,
      sensorBoxX: SX - 22,
      sensorBoxY: SY - 30,
      sLabelY: SY + 24,
      nadirLabelY: SY - 22,
      viewCeiling: isCeil,
      viewWall: !isCeil,
      vCeiling: () => this.setView('ceiling'),
      vWall: () => this.setView('wall'),
      vCeilingStyle: seg(isCeil),
      vWallStyle: seg(!isCeil),
      originLabel: isCeil ? 'sensor' : 'origin',
      mountHint: isCeil ? '⊙ Ceiling — footprint looking straight down' : '▤ Wall — coverage fans across the room',
      ldDiscR: this.LD_RANGE * M,
      bandRingR: ((s.sen.minR + s.sen.maxR) / 2) * M,
      bandRingW: (s.sen.maxR - s.sen.minR) * M,
      bandMinR: s.sen.minR * M,
      bandMaxR: s.sen.maxR * M,
      sensorDown: (e: any) => {
        e.stopPropagation()
        this.selLd()
      },
      tSelect: () => this.setTool('select'),
      tRect: () => this.setTool('rect'),
      tRot: () => this.setTool('rot'),
      tPoly: () => this.setTool('poly'),
      tSelectStyle: seg(s.tool === 'select'),
      tRectStyle: seg(s.tool === 'rect'),
      tRotStyle: seg(s.tool === 'rot'),
      tPolyStyle: seg(s.tool === 'poly'),
      toolHint: toolHints[s.tool],
      cursorReadout,
      canvasCursor: s.tool === 'rect' || s.tool === 'rot' || s.tool === 'poly' ? 'crosshair' : 'default',
      onMove: (e: any) => this.onMove(e),
      onUp: (e: any) => this.onUp(),
      canvasDown: (e: any) => this.canvasDown(e),
      onDouble: () => this.onDouble(),
    }
  }

  render() {
    const v = this.renderVals()
    const sx = v.sx,
      sy = v.sy
    return (
      <div
        className={'zs ' + v.themeClass}
        style={css(
          'width:100vw;height:100vh;background:var(--bg);color:var(--tx);font-family:Murecho,sans-serif;display:flex;flex-direction:column;overflow:hidden;position:relative;-webkit-font-smoothing:antialiased;',
        )}
      >
        {/* TOP BAR */}
        <div
          style={css(
            'height:56px;flex:none;display:flex;align-items:center;gap:18px;padding:0 18px;background:var(--panel);border-bottom:1px solid var(--bd);z-index:5;',
          )}
        >
          <div style={css('display:flex;align-items:center;gap:10px;')}>
            <div
              style={css(
                'width:26px;height:26px;border-radius:7px;background:var(--green);display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px var(--greenSoft);',
              )}
            >
              <div style={css('width:9px;height:9px;border-radius:50%;background:#fff;opacity:.92;')}></div>
            </div>
            <div style={css('font-weight:700;font-size:15px;letter-spacing:.2px;')}>
              Sense360 <span style={css('color:var(--green);')}>Zone Studio</span>
            </div>
          </div>
          <div style={css('width:1px;height:24px;background:var(--bd);')}></div>
          <div style={css('display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--mut);')}>
            <span
              style={css(
                'width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulsedot 2.4s infinite;',
              )}
            ></span>
            Living Room · 2 sensors <span style={css('color:var(--faint);')}>· live</span>
          </div>
          <div style={css('flex:1;')}></div>
          <div
            onClick={v.toggleTheme}
            title="Toggle theme"
            style={css(
              'display:flex;align-items:center;gap:7px;height:32px;padding:0 5px 0 12px;border:1px solid var(--bd);border-radius:20px;background:var(--ins);cursor:pointer;margin-right:4px;',
            )}
          >
            <span style={css('font-size:11.5px;color:var(--mut);font-weight:500;')}>{v.themeLabel}</span>
            <span style={css(v.themeKnobStyle)}>{v.themeIcon}</span>
          </div>
          {v.dirty && (
            <span style={css('font-size:11.5px;color:#e0922a;display:flex;align-items:center;gap:6px;')}>
              <span style={css('width:6px;height:6px;border-radius:50%;background:#e0922a;')}></span>Unsaved
            </span>
          )}
          <button
            onClick={v.revert}
            style={css(
              'height:34px;padding:0 16px;border-radius:8px;border:1px solid var(--bd);background:transparent;color:var(--mut);font-family:Murecho;font-size:13px;font-weight:500;cursor:pointer;',
            )}
          >
            Revert
          </button>
          <button onClick={v.apply} style={css(v.applyStyle)}>
            Apply to sensors
          </button>
        </div>

        <div style={css('flex:1;display:flex;min-height:0;')}>
          {/* LEFT PANEL */}
          <div
            style={css(
              'width:288px;flex:none;background:var(--panel);border-right:1px solid var(--bd);display:flex;flex-direction:column;min-height:0;',
            )}
          >
            <div style={css('padding:15px 18px 12px;border-bottom:1px solid var(--bd2);')}>
              <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:10px;')}>
                LAYERS
              </div>
              {v.layersView.map((L: any, i: number) => (
                <div key={i} style={css(L.rowStyle)}>
                  <span style={css(L.swatchStyle)}></span>
                  <div onClick={L.select} style={css('flex:1;min-width:0;cursor:pointer;')}>
                    <div style={css('font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>
                      {L.name}
                    </div>
                    <div style={css('font-size:10.5px;color:var(--faint);')}>{L.sub}</div>
                  </div>
                  <span style={css("font-size:10px;font-family:'JetBrains Mono';color:var(--faint);")}>{L.meta}</span>
                  <button onClick={L.toggle} title="Toggle visibility" style={css(L.eyeStyle)}>
                    {L.eye}
                  </button>
                </div>
              ))}
            </div>

            <div style={css('padding:14px 18px 8px;display:flex;align-items:center;justify-content:space-between;')}>
              <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;')}>
                LD2450 ZONES · {v.zoneCount}
              </div>
            </div>
            <div style={css('flex:1;overflow-y:auto;padding:2px 12px 12px;min-height:0;')}>
              {v.zonesView.map((z: any) => (
                <div key={z.id} onClick={z.select} style={css(z.rowStyle)}>
                  <span
                    style={css(
                      `width:11px;height:11px;border-radius:3px;flex:none;background:${z.swatchBg};border:1.5px solid ${z.accent};`,
                    )}
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
                      {z.typeLabel} · {z.shapeLabel}
                    </div>
                  </div>
                  <span style={css(z.countStyle)}>{z.countText}</span>
                </div>
              ))}
              <div style={css('font-size:11px;color:var(--faint);padding:8px 10px;line-height:1.5;')}>
                Draw tools live on the canvas toolbar. SEN0609 has no drawable zones — only its radial band.
              </div>
            </div>
          </div>

          {/* CENTER CANVAS */}
          <div
            style={css(
              'flex:1;min-width:0;background:var(--canvas);display:flex;flex-direction:column;position:relative;',
            )}
          >
            <div style={css('height:48px;flex:none;display:flex;align-items:center;gap:10px;padding:0 18px;')}>
              <div
                style={css(
                  'display:flex;background:var(--panel);border:1px solid var(--bd);border-radius:9px;padding:3px;gap:2px;box-shadow:var(--shadow);',
                )}
              >
                <button onClick={v.vCeiling} style={css(v.vCeilingStyle)} title="Ceiling mount — looking straight down">
                  ⊙ Ceiling
                </button>
                <button onClick={v.vWall} style={css(v.vWallStyle)} title="Wall mount — looking across the room">
                  ▤ Wall
                </button>
              </div>
              <div style={css('width:1px;height:22px;background:var(--bd);')}></div>
              <div
                style={css(
                  'display:flex;background:var(--panel);border:1px solid var(--bd);border-radius:9px;padding:3px;gap:2px;box-shadow:var(--shadow);',
                )}
              >
                <button onClick={v.tSelect} style={css(v.tSelectStyle)} title="Select & move">
                  ▣ Select
                </button>
                <button onClick={v.tRect} style={css(v.tRectStyle)} title="Rectangle zone">
                  ▭ Rect
                </button>
                <button onClick={v.tRot} style={css(v.tRotStyle)} title="Rotated rectangle">
                  ◇ Rotated
                </button>
                <button onClick={v.tPoly} style={css(v.tPolyStyle)} title="Polygon zone">
                  ⬡ Polygon
                </button>
              </div>
              <span style={css('font-size:11px;color:var(--faint);')}>{v.toolHint}</span>
              <span
                style={css(
                  'font-size:11px;color:var(--mut);background:var(--ins);border:1px solid var(--bd);padding:3px 9px;border-radius:6px;font-weight:600;',
                )}
              >
                {v.mountHint}
              </span>
              <div style={css('flex:1;')}></div>
              <div
                style={css(
                  "font-family:'JetBrains Mono';font-size:11.5px;color:var(--faint);display:flex;align-items:center;gap:13px;",
                )}
              >
                <span>{v.cursorReadout}</span>
                <span style={css('opacity:.5;')}>|</span>
                <span>grid 0.5 m</span>
              </div>
            </div>

            <div style={css('flex:1;display:flex;align-items:center;justify-content:center;min-height:0;padding:0 14px 14px;')}>
              <svg
                viewBox="0 0 860 760"
                style={css(`width:100%;height:100%;max-height:100%;cursor:${v.canvasCursor};touch-action:none;`)}
                onPointerDown={v.canvasDown}
                onPointerMove={v.onMove}
                onPointerUp={v.onUp}
                onPointerLeave={v.onUp}
                onDoubleClick={v.onDouble}
              >
                <defs>
                  <pattern id="hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="7" stroke="var(--excl)" strokeWidth="1.4" opacity="0.5"></line>
                  </pattern>
                  <radialGradient id="bandGrad" cx="50%" cy="0%" r="100%">
                    <stop offset="0%" stopColor="var(--band)" stopOpacity="0"></stop>
                    <stop offset="100%" stopColor="var(--band)" stopOpacity="0.22"></stop>
                  </radialGradient>
                </defs>

                {/* range rings */}
                <g opacity="0.9">
                  {v.rings.map((r: any, i: number) => (
                    <circle key={i} cx={sx} cy={sy} r={r.r} fill="none" stroke="var(--ring)" strokeWidth="1" strokeDasharray={r.dash}></circle>
                  ))}
                  {v.ringLabels.map((rl: any, i: number) => (
                    <text key={i} x={rl.x} y={rl.y} fill="var(--faint)" fontSize="9.5" fontFamily="JetBrains Mono">
                      {rl.t}
                    </text>
                  ))}
                </g>

                {/* radial spokes */}
                <g opacity="0.5">
                  {v.spokes.map((sp: any, i: number) => (
                    <line key={i} x1={sx} y1={sy} x2={sp.x} y2={sp.y} stroke="var(--grid)" strokeWidth="1"></line>
                  ))}
                </g>

                {/* LD2450 FoV wedge */}
                {v.layerLd && (
                  <g>
                    {v.viewWall && <polygon points={v.ldCone} fill="var(--greenSoft)" opacity="0.5"></polygon>}
                    {v.viewCeiling && <circle cx={sx} cy={sy} r={v.ldDiscR} fill="var(--greenSoft)" opacity="0.45"></circle>}
                  </g>
                )}

                {/* SEN0609 radial band layer */}
                {v.layerSen && (
                  <g>
                    {v.viewWall && (
                      <g>
                        <path
                          d={v.bandPath}
                          fill="url(#bandGrad)"
                          stroke="var(--bandLine)"
                          strokeWidth="1.6"
                          strokeDasharray="7 5"
                          opacity="0.95"
                        ></path>
                        <path d={v.bandInnerArc} fill="none" stroke="var(--bandLine)" strokeWidth="2.4"></path>
                        <path d={v.bandOuterArc} fill="none" stroke="var(--bandLine)" strokeWidth="2.4"></path>
                      </g>
                    )}
                    {v.viewCeiling && (
                      <g>
                        <circle cx={sx} cy={sy} r={v.bandRingR} fill="none" stroke="var(--band)" strokeWidth={v.bandRingW} opacity="0.15"></circle>
                        <circle cx={sx} cy={sy} r={v.bandMinR} fill="none" stroke="var(--bandLine)" strokeWidth="2.4" strokeDasharray="7 5"></circle>
                        <circle cx={sx} cy={sy} r={v.bandMaxR} fill="none" stroke="var(--bandLine)" strokeWidth="2.4" strokeDasharray="7 5"></circle>
                      </g>
                    )}
                    <text x={v.bandLabel.x} y={v.bandLabel.y} textAnchor="middle" fill="var(--bandLine)" fontSize="11" fontWeight="600" fontFamily="Murecho">
                      SEN0609 · radial
                    </text>
                    {v.senSelected && (
                      <g>
                        <circle
                          cx={v.bandHandleIn.x}
                          cy={v.bandHandleIn.y}
                          r="6.5"
                          fill="var(--panel)"
                          stroke="var(--bandLine)"
                          strokeWidth="2"
                          onPointerDown={v.dragMinR}
                          style={css('cursor:ns-resize;')}
                        ></circle>
                        <circle
                          cx={v.bandHandleOut.x}
                          cy={v.bandHandleOut.y}
                          r="6.5"
                          fill="var(--panel)"
                          stroke="var(--bandLine)"
                          strokeWidth="2"
                          onPointerDown={v.dragMaxR}
                          style={css('cursor:ns-resize;')}
                        ></circle>
                      </g>
                    )}
                  </g>
                )}

                {/* LD2450 zones */}
                {v.layerLd && (
                  <g>
                    {v.zonesView.map((z: any) => (
                      <g key={z.id} onPointerDown={z.down} style={css('cursor:move;')}>
                        <polygon points={z.pts} fill={z.fill} stroke={z.accent} strokeWidth={z.sw} strokeDasharray={z.dash}></polygon>
                        {z.isExcl && <polygon points={z.pts} fill="url(#hatch)"></polygon>}
                        <text x={z.labelX} y={z.labelY} fill={z.accent} fontSize="11.5" fontWeight="600" fontFamily="Murecho">
                          {z.name}
                        </text>
                        <text x={z.labelX} y={z.countY} fill={z.accent} fontSize="9.5" fontFamily="JetBrains Mono" opacity="0.85">
                          {z.canvasCount}
                        </text>
                        {z.selected && (
                          <g>
                            {z.handles.map((hnd: any, i: number) => (
                              <rect
                                key={i}
                                x={hnd.x}
                                y={hnd.y}
                                width="8"
                                height="8"
                                fill="var(--panel)"
                                stroke="var(--green)"
                                strokeWidth="1.5"
                                onPointerDown={hnd.down}
                                style={css(`cursor:${hnd.cursor};`)}
                              ></rect>
                            ))}
                            {z.hasRotate && (
                              <g>
                                <line x1={z.rotLineX1} y1={z.rotLineY1} x2={z.rotX} y2={z.rotY} stroke="var(--green)" strokeWidth="1.3"></line>
                                <circle
                                  cx={z.rotX}
                                  cy={z.rotY}
                                  r="6"
                                  fill="var(--panel)"
                                  stroke="var(--green)"
                                  strokeWidth="1.7"
                                  onPointerDown={z.rotDown}
                                  style={css('cursor:grab;')}
                                ></circle>
                              </g>
                            )}
                          </g>
                        )}
                      </g>
                    ))}
                  </g>
                )}

                {/* draft polygon */}
                {v.drafting && (
                  <g>
                    <polyline points={v.draftLine} fill="var(--greenSoft)" stroke="var(--green)" strokeWidth="1.6" strokeDasharray="5 4"></polyline>
                    {v.draftDots.map((d: any, i: number) => (
                      <circle key={i} cx={d.x} cy={d.y} r="4.5" fill="var(--panel)" stroke="var(--green)" strokeWidth="1.8"></circle>
                    ))}
                  </g>
                )}

                {/* LD2450 live targets + trails */}
                {v.layerLd && (
                  <g>
                    {v.targetsView.map((t: any) => (
                      <g key={t.id}>
                        <polyline points={t.trail} fill="none" stroke={t.color} strokeWidth="2.2" strokeLinecap="round" opacity="0.28"></polyline>
                        <circle cx={t.cx} cy={t.cy} r="11" fill={t.color} opacity="0.14"></circle>
                        <circle cx={t.cx} cy={t.cy} r="4.5" fill={t.color} stroke="var(--canvas)" strokeWidth="1.4"></circle>
                        <text x={t.lx} y={t.ly} fill={t.color} fontSize="9.5" fontFamily="JetBrains Mono">
                          {t.label}
                        </text>
                      </g>
                    ))}
                  </g>
                )}

                {/* sensor origin + boresight */}
                <g onPointerDown={v.sensorDown} style={css('cursor:pointer;')}>
                  {v.viewWall && (
                    <g>
                      <line x1={sx} y1={sy} x2={sx} y2={v.boreY} stroke="var(--mut)" strokeWidth="1.3" strokeDasharray="4 4" opacity="0.7"></line>
                      <text x={v.boreLabelX} y={v.boreLabelY} fill="var(--faint)" fontSize="9.5" fontFamily="JetBrains Mono">
                        0° boresight
                      </text>
                      <rect x={v.sensorBoxX} y={v.sensorBoxY} width="44" height="20" rx="5" fill="var(--panel)" stroke="var(--bd)" strokeWidth="1"></rect>
                    </g>
                  )}
                  {v.viewCeiling && (
                    <g>
                      <circle cx={sx} cy={sy} r="16" fill="none" stroke="var(--mut)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6"></circle>
                      <text x={sx} y={v.nadirLabelY} textAnchor="middle" fill="var(--faint)" fontSize="9.5" fontFamily="JetBrains Mono">
                        ↓ nadir
                      </text>
                    </g>
                  )}
                  <circle cx={sx} cy={sy} r="9" fill="var(--panel)" stroke="var(--green)" strokeWidth="2"></circle>
                  <circle cx={sx} cy={sy} r="4" fill="var(--green)"></circle>
                  <circle
                    cx={sx}
                    cy={sy}
                    r="9"
                    fill="none"
                    stroke="var(--green)"
                    strokeWidth="1.4"
                    opacity="0.45"
                    style={css('transform-box:fill-box;transform-origin:center;animation:blip 2.6s ease-out infinite;')}
                  ></circle>
                  <text x={sx} y={v.sLabelY} textAnchor="middle" fill="var(--mut)" fontSize="10" fontWeight="600" fontFamily="JetBrains Mono">
                    {v.originLabel}
                  </text>
                </g>
              </svg>
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div
            style={css(
              'width:344px;flex:none;background:var(--panel);border-left:1px solid var(--bd);overflow-y:auto;min-height:0;',
            )}
          >
            {/* ZONE (LD2450) */}
            {v.showZone && (
              <div>
                <div
                  style={css(
                    'padding:17px 20px 14px;border-bottom:1px solid var(--bd2);display:flex;align-items:flex-start;gap:11px;',
                  )}
                >
                  <span
                    style={css(
                      `width:13px;height:13px;border-radius:4px;margin-top:4px;flex:none;background:${v.pz.soft};border:1.5px solid ${v.pz.accent};`,
                    )}
                  ></span>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:5px;')}>
                      LD2450 ZONE · {v.pz.shapeLabel}
                    </div>
                    <Field
                      value={v.pz.name}
                      onCommit={v.pz.onName}
                      style={css(
                        'width:100%;background:transparent;border:none;border-bottom:1px solid var(--bd);color:var(--tx);font-family:Murecho;font-size:17px;font-weight:600;padding:2px 0 5px;outline:none;',
                      )}
                    />
                  </div>
                  <button
                    onClick={v.pz.onDelete}
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
                    <button onClick={v.pz.setDetection} style={css(v.pz.detStyle)}>
                      Detection
                    </button>
                    <button onClick={v.pz.setExclusion} style={css(v.pz.exclStyle)}>
                      Exclusion
                    </button>
                  </div>
                  <div style={css('margin-top:11px;font-size:11.5px;line-height:1.5;color:var(--mut);')}>{v.pz.typeHint}</div>
                  <div
                    style={css(
                      'margin-top:12px;display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:9px;background:var(--ins);',
                    )}
                  >
                    <span style={css('font-size:12px;color:var(--mut);')}>Live targets in zone</span>
                    <span style={css(v.pz.liveStyle)}>{v.pz.liveText}</span>
                  </div>
                </div>

                <div style={css('padding:16px 20px;' + v.pz.geomBorder)}>
                  <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;')}>
                    <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;')}>GEOMETRY</div>
                    <div style={css("font-size:11px;font-family:'JetBrains Mono';color:var(--faint);")}>{v.pz.area} m²</div>
                  </div>
                  {v.pz.isRect && (
                    <div>
                      <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:10px;')}>
                        <div>
                          <div style={css('font-size:10.5px;color:var(--mut);margin-bottom:5px;')}>Center X (m)</div>
                          <Field type="number" step="0.1" value={v.pz.cx} onCommit={v.pz.onCx} style={css(v.numStyle)} />
                        </div>
                        <div>
                          <div style={css('font-size:10.5px;color:var(--mut);margin-bottom:5px;')}>Center Y (m)</div>
                          <Field type="number" step="0.1" value={v.pz.cy} onCommit={v.pz.onCy} style={css(v.numStyle)} />
                        </div>
                        <div>
                          <div style={css('font-size:10.5px;color:var(--mut);margin-bottom:5px;')}>Width (m)</div>
                          <Field type="number" step="0.1" value={v.pz.w} onCommit={v.pz.onW} style={css(v.numStyle)} />
                        </div>
                        <div>
                          <div style={css('font-size:10.5px;color:var(--mut);margin-bottom:5px;')}>Depth (m)</div>
                          <Field type="number" step="0.1" value={v.pz.h} onCommit={v.pz.onH} style={css(v.numStyle)} />
                        </div>
                      </div>
                      <div style={css('margin-top:13px;')}>
                        <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
                          <span style={css('font-size:12px;color:var(--mut);')}>Rotation</span>
                          <span style={css(`font-size:12.5px;font-family:'JetBrains Mono';color:${v.pz.accent};`)}>{v.pz.rot}°</span>
                        </div>
                        <input
                          type="range"
                          min="-90"
                          max="90"
                          step="1"
                          value={v.pz.rot}
                          onChange={v.pz.onRot}
                          style={css(`width:100%;accent-color:${v.pz.accent};`)}
                        />
                      </div>
                    </div>
                  )}
                  {v.pz.isPoly && (
                    <div style={css('font-size:12px;color:var(--mut);line-height:1.6;')}>
                      {v.pz.polyText}
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
            )}

            {/* SEN0609 BAND */}
            {v.showSen && (
              <div>
                <div
                  style={css(
                    'padding:17px 20px 15px;border-bottom:1px solid var(--bd2);display:flex;align-items:flex-start;gap:11px;',
                  )}
                >
                  <span
                    style={css(
                      'width:13px;height:13px;border-radius:50%;margin-top:4px;flex:none;background:var(--bandSoft);border:1.5px solid var(--band);',
                    )}
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
                      <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{v.ps.minR} m</span>
                    </div>
                    <input type="range" min="0.2" max="6" step="0.1" value={v.ps.minR} onChange={v.ps.onMin} style={css('width:100%;accent-color:var(--band);')} />
                  </div>
                  <div style={css('margin-bottom:15px;')}>
                    <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
                      <span style={css('font-size:12px;color:var(--mut);')}>Max radius (outer arc)</span>
                      <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{v.ps.maxR} m</span>
                    </div>
                    <input type="range" min="0.5" max="8" step="0.1" value={v.ps.maxR} onChange={v.ps.onMax} style={css('width:100%;accent-color:var(--band);')} />
                  </div>
                  <div>
                    <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
                      <span style={css('font-size:12px;color:var(--mut);')}>Beam width</span>
                      <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{v.ps.beam}°</span>
                    </div>
                    <input type="range" min="20" max="50" step="1" value={v.ps.beam} onChange={v.ps.onBeam} style={css('width:100%;accent-color:var(--band);')} />
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
                      <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{v.ps.trig} / 9</span>
                    </div>
                    <input type="range" min="0" max="9" step="1" value={v.ps.trig} onChange={v.ps.onTrig} style={css('width:100%;accent-color:var(--band);')} />
                  </div>
                  <div style={css('margin-bottom:15px;')}>
                    <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
                      <span style={css('font-size:12px;color:var(--mut);')}>Sustained sensitivity</span>
                      <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>{v.ps.sust} / 9</span>
                    </div>
                    <input type="range" min="0" max="9" step="1" value={v.ps.sust} onChange={v.ps.onSust} style={css('width:100%;accent-color:var(--band);')} />
                  </div>
                  <div>
                    <div style={css('display:flex;justify-content:space-between;margin-bottom:7px;')}>
                      <span style={css('font-size:12px;color:var(--mut);')}>Reduced trigger range</span>
                      <span style={css("font-size:12.5px;font-family:'JetBrains Mono';color:var(--band);")}>−{v.ps.reduced} m</span>
                    </div>
                    <input type="range" min="0" max="3" step="0.1" value={v.ps.reduced} onChange={v.ps.onReduced} style={css('width:100%;accent-color:var(--band);')} />
                    <div style={css('margin-top:6px;font-size:11px;color:var(--faint);')}>
                      Subtracted from max radius for the trigger threshold only.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* LD2450 SENSOR */}
            {v.showLd && (
              <div>
                <div
                  style={css(
                    'padding:17px 20px 15px;border-bottom:1px solid var(--bd2);display:flex;align-items:flex-start;gap:11px;',
                  )}
                >
                  <span
                    style={css(
                      'width:13px;height:13px;border-radius:50%;margin-top:4px;flex:none;background:var(--greenSoft);border:1.5px solid var(--green);',
                    )}
                  ></span>
                  <div>
                    <div style={css('font-size:10.5px;letter-spacing:1.4px;color:var(--faint);font-weight:700;margin-bottom:5px;')}>
                      HLK LD2450
                    </div>
                    <div style={css('font-size:17px;font-weight:700;')}>Spatial tracking</div>
                    <div style={css("font-size:11px;color:var(--mut);margin-top:3px;font-family:'JetBrains Mono';")}>
                      120° FoV · X/Y · up to 3 targets
                    </div>
                  </div>
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
                  {v.ldTargets.map((t: any, i: number) => (
                    <div key={i} style={css('display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;background:var(--ins);margin-bottom:7px;')}>
                      <span style={css(`width:9px;height:9px;border-radius:50%;flex:none;background:${t.color};box-shadow:0 0 7px ${t.color};`)}></span>
                      <span style={css('font-size:12.5px;font-weight:600;flex:1;')}>{t.label}</span>
                      <span style={css("font-size:11.5px;font-family:'JetBrains Mono';color:var(--mut);")}>{t.coord}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {v.showNone && (
              <div style={css('padding:40px 24px;text-align:center;color:var(--faint);')}>
                <div style={css('font-size:13px;line-height:1.6;')}>
                  Nothing selected.
                  <br />
                  Pick a zone, a layer, or a sensor to edit its properties.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }
}
