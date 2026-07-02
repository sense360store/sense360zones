import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { LD2450_FOV_HALF, LD2450_RANGE } from '../domain/constants'
import { occupancyCounts, zoneMeta, zonePtsM } from '../domain/geometry'
import { evaluateOccupancy } from '../domain/occupancy'
import type { EditorState } from '../store/store'
import { store, useEditorState } from '../store/hooks'
import { RING_COUNT, SPOKE_RADIUS_M, VIEWBOX_H, VIEWBOX_W } from './constants'
import { makeProjection, svgPointFromEvent } from './projection'

/**
 * Fit the SVG to its container while keeping the viewbox aspect, and derive a
 * text scale. Labels are drawn in viewbox units, so on a small canvas they
 * would shrink below legibility; scaling their font size by `ts` keeps them at
 * a constant on-screen size. Sizing the element to the exact aspect (rather
 * than letting preserveAspectRatio letterbox it) also keeps the pointer→metre
 * mapping exact at any container shape.
 */
function useStageSize() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const aspect = VIEWBOX_W / VIEWBOX_H
  let w = box.w
  let h = box.h
  if (w > 0 && h > 0) {
    if (w / h > aspect) w = h * aspect
    else h = w / aspect
  }
  const ts = w > 0 ? Math.min(2.4, Math.max(1, VIEWBOX_W / w)) : 1
  return { ref, w, h, ts }
}

export function Canvas() {
  const s = useEditorState()
  const { ref, w, h, ts } = useStageSize()
  const hasLd = s.sensors.includes('ld2450')
  const hasSen = s.sensors.includes('sen0609')
  // The canvas draws only the layers the device actually has. With no confirmed
  // radar sensor there is nothing to draw, so invite the user to the mapping
  // surface rather than render empty scenery.
  return (
    <div ref={ref} className="zs-stage">
      {!hasLd && !hasSen ? <CanvasEmptyState /> : <CanvasScene s={s} w={w} h={h} ts={ts} hasLd={hasLd} hasSen={hasSen} />}
    </div>
  )
}

/** The live readout shown beside the pointer while a drag is in flight. */
function dragReadout(s: EditorState): string | null {
  const d = s.drag
  if (!d) return null
  const sel = s.sel
  const zone = sel.kind === 'zone' ? s.zones.find((z) => z.id === sel.id) : undefined
  const cur = s.cursor
  switch (d.mode) {
    case 'move':
      if (zone?.shape === 'rect') return `x ${zone.cx.toFixed(1)}  y ${zone.cy.toFixed(1)} m`
      return cur ? `x ${cur.x.toFixed(1)}  y ${cur.y.toFixed(1)} m` : null
    case 'corner':
      return zone?.shape === 'rect' ? `${zone.w.toFixed(1)} × ${zone.h.toFixed(1)} m` : null
    case 'rotate':
      return zone?.shape === 'rect' ? `${Math.round(zone.rot)}°` : null
    case 'vertex':
      return cur ? `x ${cur.x.toFixed(1)}  y ${cur.y.toFixed(1)} m` : null
    case 'minR':
      return `inner ${s.band.minR.toFixed(1)} m`
    case 'maxR':
      return `outer ${s.band.maxR.toFixed(1)} m`
    case 'create': {
      if (!d.start || !cur) return null
      const w = Math.round(Math.abs(cur.x - d.start.x) * 2) / 2
      const h = Math.round(Math.abs(cur.y - d.start.y) * 2) / 2
      return `${w.toFixed(1)} × ${h.toFixed(1)} m`
    }
  }
}

function CanvasScene(props: { s: EditorState; w: number; h: number; ts: number; hasLd: boolean; hasSen: boolean }) {
  const { s, w, h, ts, hasLd, hasSen } = props
  const showLd = s.layers.ld && hasLd
  const showSen = s.layers.sen && hasSen
  const proj = makeProjection(s.view)
  const M = proj.scale
  const sx = proj.sx
  const sy = proj.originY
  const isCeil = s.view === 'ceiling'
  const toPx = proj.toPx
  const atM = (e: ReactPointerEvent<SVGElement>) => proj.toM(svgPointFromEvent(e))
  const occ = occupancyCounts(s.zones, s.targets)
  // The shared evaluator drives the live "occupied" highlight, so the canvas
  // preview lights a zone the moment a target enters it, from the same primitive
  // the backend uses to publish entities.
  const occupancy = evaluateOccupancy(s.zones, s.targets)
  const selId = s.sel.kind === 'zone' ? s.sel.id : null
  const ha = (LD2450_FOV_HALF * Math.PI) / 180

  // Label font sizes and offsets are in viewbox units; scaling them by `ts`
  // keeps a constant on-screen size as the canvas shrinks.
  const fs = (n: number) => +(n * ts).toFixed(2)
  const halo = fs(3)

  // Range rings, labelled on the left of the centre line so the labels never
  // strike through the boresight (r is integer → dash is always '4 5'). On a
  // small canvas (ts high) only every second ring is labelled to avoid clutter.
  const ringLabelStep = ts > 1.5 ? 2 : 1
  const rings = Array.from({ length: RING_COUNT }, (_, k) => {
    const r = k + 1
    return { rPx: r * M, label: r + 'm', lx: sx - fs(7), ly: sy + r * M - fs(4), labelled: r % ringLabelStep === 0 }
  })

  // radial spokes
  const spokeDirs = isCeil ? [0, 45, 90, 135, 180, 225, 270, 315] : [-60, -30, 0, 30, 60]
  const spokes = spokeDirs.map((d) => {
    const a = (d * Math.PI) / 180
    return { x: sx + Math.sin(a) * SPOKE_RADIUS_M * M, y: sy + Math.cos(a) * SPOKE_RADIUS_M * M }
  })

  // LD2450 field of view; the edge rays give the wedge a readable outline.
  const ldEdgeL = { x: sx + Math.sin(-ha) * LD2450_RANGE * M, y: sy + Math.cos(-ha) * LD2450_RANGE * M }
  const ldEdgeR = { x: sx + Math.sin(ha) * LD2450_RANGE * M, y: sy + Math.cos(ha) * LD2450_RANGE * M }
  const ldCone = `${sx},${sy} ${ldEdgeL.x},${ldEdgeL.y} ${ldEdgeR.x},${ldEdgeR.y}`
  const ldDiscR = LD2450_RANGE * M

  // SEN0609 radial band (sector minR..maxR over beam)
  const band = s.band
  const bh = (band.beam * Math.PI) / 180
  const arc = (rad: number, a0: number, a1: number) => ({
    p0: toPx(Math.sin(a0) * rad, Math.cos(a0) * rad),
    p1: toPx(Math.sin(a1) * rad, Math.cos(a1) * rad),
  })
  const oa = arc(band.maxR, -bh, bh)
  const ia = arc(band.minR, bh, -bh)
  const bandPath = `M ${oa.p0.x} ${oa.p0.y} A ${band.maxR * M} ${band.maxR * M} 0 0 1 ${oa.p1.x} ${oa.p1.y} L ${ia.p0.x} ${
    ia.p0.y
  } A ${band.minR * M} ${band.minR * M} 0 0 0 ${ia.p1.x} ${ia.p1.y} Z`
  const bandOuterArc = `M ${oa.p0.x} ${oa.p0.y} A ${band.maxR * M} ${band.maxR * M} 0 0 1 ${oa.p1.x} ${oa.p1.y}`
  const inA = toPx(Math.sin(-bh) * band.minR, Math.cos(-bh) * band.minR)
  const inB = toPx(Math.sin(bh) * band.minR, Math.cos(bh) * band.minR)
  const bandInnerArc = `M ${inA.x} ${inA.y} A ${band.minR * M} ${band.minR * M} 0 0 1 ${inB.x} ${inB.y}`
  const bandLabel = toPx(0, (band.minR + band.maxR) / 2 + 0.15)
  const bandHandleIn = toPx(0, band.minR)
  const bandHandleOut = toPx(0, band.maxR)
  const bandRingR = ((band.minR + band.maxR) / 2) * M
  const bandRingW = (band.maxR - band.minR) * M
  const bandMinR = band.minR * M
  const bandMaxR = band.maxR * M
  const senSelected = s.sel.kind === 'sen'

  // sensor origin + boresight
  const boreY = sy + SPOKE_RADIUS_M * M

  // draft polygon
  const draftDots = s.draft ? s.draft.pts.map((pt) => toPx(pt.x, pt.y)) : []
  const draftLine = draftDots.map((d) => `${d.x},${d.y}`).join(' ')

  // Handle geometry is sized in on-screen terms (via ts) so the grab targets
  // stay comfortable on a small canvas instead of shrinking with the viewbox.
  const handleSize = fs(11)
  const handleHit = fs(24)
  const bandHandleR = fs(7.5)
  const bandHandleHitR = fs(14)

  // rubber-band preview while dragging out a new rectangle
  const creating = s.drag?.mode === 'create' && s.drag.start && s.cursor ? { a: toPx(s.drag.start.x, s.drag.start.y), b: toPx(s.cursor.x, s.cursor.y) } : null

  // live readout beside the pointer during any drag
  const readout = dragReadout(s)
  const readoutAt = s.cursor ? toPx(s.cursor.x, s.cursor.y) : null

  const canvasCursor = s.tool === 'select' ? 'default' : 'crosshair'
  const cur = s.cursor
  const cursorReadout = cur ? `x ${cur.x.toFixed(2)}  y ${cur.y.toFixed(2)} m` : 'x —  y —'

  // First-run guidance: an LD2450 with no zones yet gets pointed at the draw
  // tools instead of an empty grid. The hint follows the active tool and gets
  // out of the way as soon as drawing starts.
  const firstRunHint =
    showLd && s.zones.length === 0 && !s.draft && !s.drag
      ? s.tool === 'select'
        ? 'No zones yet. Choose Rect in the toolbar, then drag on the canvas to draw your first zone.'
        : s.tool === 'poly'
          ? 'Click to drop points, then double-click to close the shape.'
          : 'Drag on the canvas to draw the zone.'
      : null

  return (
    <>
      <svg
        className="zs-canvas-svg"
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        width={w > 0 ? w : undefined}
        height={h > 0 ? h : undefined}
        style={w > 0 ? { cursor: canvasCursor } : { cursor: canvasCursor, width: '100%', height: '100%' }}
        onPointerDown={(e) => store.beginCanvas(atM(e))}
        onPointerMove={(e) => store.dragMove(atM(e))}
        onPointerUp={() => store.dragEnd()}
        onPointerLeave={() => store.dragEnd()}
        onDoubleClick={() => store.finishPolygon()}
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
        <g>
          {rings.map((r, i) => (
            <circle key={i} cx={sx} cy={sy} r={r.rPx} fill="none" stroke="var(--ring)" strokeWidth="1.2" strokeDasharray="4 5"></circle>
          ))}
          {rings
            .filter((r) => r.labelled)
            .map((r) => (
              <text
                key={r.label}
                className="zs-svglabel"
                x={r.lx}
                y={r.ly}
                textAnchor="end"
                fill="var(--mut)"
                fontSize={fs(10)}
                fontWeight="600"
                strokeWidth={halo}
              >
                {r.label}
              </text>
            ))}
        </g>

        {/* radial spokes */}
        <g opacity="0.7">
          {spokes.map((sp, i) => (
            <line key={i} x1={sx} y1={sy} x2={sp.x} y2={sp.y} stroke="var(--grid)" strokeWidth="1"></line>
          ))}
        </g>

        {/* LD2450 FoV wedge, with edge rays so the coverage boundary reads clearly */}
        {showLd && (
          <g>
            {!isCeil && (
              <g>
                <polygon points={ldCone} fill="var(--greenSoft)" opacity="0.6"></polygon>
                <line x1={sx} y1={sy} x2={ldEdgeL.x} y2={ldEdgeL.y} stroke="var(--green)" strokeWidth="1.2" opacity="0.35"></line>
                <line x1={sx} y1={sy} x2={ldEdgeR.x} y2={ldEdgeR.y} stroke="var(--green)" strokeWidth="1.2" opacity="0.35"></line>
              </g>
            )}
            {isCeil && (
              <g>
                <circle cx={sx} cy={sy} r={ldDiscR} fill="var(--greenSoft)" opacity="0.55"></circle>
                <circle cx={sx} cy={sy} r={ldDiscR} fill="none" stroke="var(--green)" strokeWidth="1.2" opacity="0.3"></circle>
              </g>
            )}
          </g>
        )}

        {/* SEN0609 radial band layer */}
        {showSen && (
          <g>
            {!isCeil && (
              <g>
                <path
                  d={bandPath}
                  fill="url(#bandGrad)"
                  stroke="var(--bandLine)"
                  strokeWidth="1.6"
                  strokeDasharray="7 5"
                  opacity="0.95"
                ></path>
                <path d={bandInnerArc} fill="none" stroke="var(--bandLine)" strokeWidth="2.4"></path>
                <path d={bandOuterArc} fill="none" stroke="var(--bandLine)" strokeWidth="2.4"></path>
              </g>
            )}
            {isCeil && (
              <g>
                <circle cx={sx} cy={sy} r={bandRingR} fill="none" stroke="var(--band)" strokeWidth={bandRingW} opacity="0.15"></circle>
                <circle cx={sx} cy={sy} r={bandMinR} fill="none" stroke="var(--bandLine)" strokeWidth="2.4" strokeDasharray="7 5"></circle>
                <circle cx={sx} cy={sy} r={bandMaxR} fill="none" stroke="var(--bandLine)" strokeWidth="2.4" strokeDasharray="7 5"></circle>
              </g>
            )}
            <text
              className="zs-svglabel zs-svglabel--ui"
              x={bandLabel.x}
              y={bandLabel.y}
              textAnchor="middle"
              fill="var(--bandLine)"
              fontSize={fs(11)}
              fontWeight="600"
              strokeWidth={halo}
            >
              SEN0609 · radial
            </text>
            {senSelected && (
              <g>
                {[
                  { p: bandHandleIn, which: 'minR' as const },
                  { p: bandHandleOut, which: 'maxR' as const },
                ].map(({ p, which }) => (
                  <g
                    key={which}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      store.beginRadius(which)
                    }}
                    style={{ cursor: 'ns-resize' }}
                  >
                    <circle cx={p.x} cy={p.y} r={bandHandleHitR} fill="transparent"></circle>
                    <circle cx={p.x} cy={p.y} r={bandHandleR} fill="var(--panel)" stroke="var(--bandLine)" strokeWidth="2.2"></circle>
                  </g>
                ))}
              </g>
            )}
          </g>
        )}

        {/* LD2450 zones */}
        {showLd && (
          <g>
            {s.zones.map((z) => {
              const m = zoneMeta(z.type)
              const ppx = zonePtsM(z).map((pt) => toPx(pt.x, pt.y))
              const pts = ppx.map((p) => `${p.x},${p.y}`).join(' ')
              const minx = Math.min(...ppx.map((p) => p.x))
              const miny = Math.min(...ppx.map((p) => p.y))
              const selected = z.id === selId
              const hovered = z.id === s.hoverZoneId && !selected
              const isExcl = z.type === 'exclusion'
              const cnt = occ[z.id] || 0
              const occupied = occupancy.zones[z.id] ?? false
              const status = isExcl ? (occupied ? 'masked · target inside' : 'masked') : occupied ? `occupied · ${cnt} of 3` : `${cnt} of 3`
              // The name sits on a small accent chip so it stays readable over
              // the zone fill, the reference layer and the live target trails.
              const chipFont = fs(10.5)
              const chipH = fs(18)
              const chipW = z.name.length * fs(6.4) + fs(13)
              // rotate handle (rect only)
              let rot = null as null | { x1: number; y1: number; x2: number; y2: number }
              if (selected && z.shape === 'rect') {
                const r = (z.rot * Math.PI) / 180
                const tmx = z.cx - (-(z.h / 2)) * Math.sin(r)
                const tmy = z.cy + (-(z.h / 2)) * Math.cos(r)
                const tmPx = toPx(tmx, tmy)
                const rotPx = toPx(tmx - Math.sin(r) * 0.55, tmy - Math.cos(r) * 0.55)
                rot = { x1: tmPx.x, y1: tmPx.y, x2: rotPx.x, y2: rotPx.y }
              }
              return (
                <g
                  key={z.id}
                  // With a draw tool active the zone lets the pointer through, so
                  // "drag on the canvas to draw" holds anywhere; the crosshair
                  // signals it. Select tool: the move cursor invites a drag.
                  onPointerDown={(e) => {
                    if (s.tool !== 'select') return
                    e.stopPropagation()
                    store.beginMoveZone(z.id, atM(e))
                  }}
                  onPointerEnter={() => store.hoverZone(z.id)}
                  onPointerLeave={() => store.hoverZone(null)}
                  style={{ cursor: s.tool === 'select' ? 'move' : 'crosshair' }}
                >
                  {/* selection glow: an unmistakable outer halo under the outline */}
                  {selected && <polygon points={pts} fill="none" stroke={m.accent} strokeWidth="9" opacity="0.22" strokeLinejoin="round"></polygon>}
                  <polygon
                    points={pts}
                    fill={m.soft}
                    stroke={m.accent}
                    strokeWidth={selected ? 3 : hovered ? 2.6 : 1.8}
                    strokeDasharray={isExcl ? '7 5' : '0'}
                  ></polygon>
                  {hovered && <polygon points={pts} fill={m.accent} opacity="0.07" style={{ pointerEvents: 'none' }}></polygon>}
                  {isExcl && <polygon points={pts} fill="url(#hatch)"></polygon>}
                  {/* Live occupancy: light the zone the moment a target enters it. */}
                  {occupied && (
                    <g style={{ pointerEvents: 'none' }}>
                      <polygon points={pts} fill={m.accent} opacity={isExcl ? '0.16' : '0.24'}></polygon>
                      <polygon points={pts} fill="none" stroke={m.accent} strokeWidth="3.4" opacity="0.45"></polygon>
                    </g>
                  )}
                  <g style={{ pointerEvents: 'none' }}>
                    <rect x={minx + fs(6)} y={miny + fs(6)} width={chipW} height={chipH} rx={fs(4)} fill={m.accent}></rect>
                    <text
                      className="zs-svglabel zs-svglabel--ui"
                      x={minx + fs(6) + chipW / 2}
                      y={miny + fs(6) + chipH / 2 + chipFont * 0.36}
                      textAnchor="middle"
                      fill="var(--on-accent)"
                      fontSize={chipFont}
                      fontWeight="700"
                      strokeWidth={0}
                    >
                      {z.name}
                    </text>
                    <text
                      className="zs-svglabel"
                      x={minx + fs(7)}
                      y={miny + fs(6) + chipH + fs(12)}
                      fill={occupied ? m.accent : 'var(--mut)'}
                      fontSize={fs(10)}
                      fontWeight={occupied ? 700 : 500}
                      strokeWidth={halo}
                    >
                      {status}
                    </text>
                  </g>
                  {selected && (
                    <g>
                      {ppx.map((p, i) => (
                        <g
                          key={i}
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            if (z.shape === 'poly') store.beginVertex(z.id, i)
                            else store.beginCornerResize(z.id, i)
                          }}
                          style={{ cursor: z.shape === 'poly' ? 'move' : i % 2 === 0 ? 'nwse-resize' : 'nesw-resize' }}
                        >
                          <rect x={p.x - handleHit / 2} y={p.y - handleHit / 2} width={handleHit} height={handleHit} fill="transparent"></rect>
                          <rect
                            x={p.x - handleSize / 2}
                            y={p.y - handleSize / 2}
                            width={handleSize}
                            height={handleSize}
                            rx={fs(2)}
                            fill="var(--panel)"
                            stroke={m.accent}
                            strokeWidth="2"
                          ></rect>
                        </g>
                      ))}
                      {rot && (
                        <g>
                          <line x1={rot.x1} y1={rot.y1} x2={rot.x2} y2={rot.y2} stroke={m.accent} strokeWidth="1.6"></line>
                          <g
                            className="zs-handle-rotate"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              store.beginRotate(z.id)
                            }}
                          >
                            <circle cx={rot.x2} cy={rot.y2} r={bandHandleHitR} fill="transparent"></circle>
                            <circle cx={rot.x2} cy={rot.y2} r={bandHandleR} fill="var(--panel)" stroke={m.accent} strokeWidth="2"></circle>
                            <circle cx={rot.x2} cy={rot.y2} r={fs(2.2)} fill={m.accent}></circle>
                          </g>
                        </g>
                      )}
                    </g>
                  )}
                </g>
              )
            })}
          </g>
        )}

        {/* rubber band while dragging out a new rectangle */}
        {creating && (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={Math.min(creating.a.x, creating.b.x)}
              y={Math.min(creating.a.y, creating.b.y)}
              width={Math.abs(creating.b.x - creating.a.x)}
              height={Math.abs(creating.b.y - creating.a.y)}
              fill="var(--greenSoft)"
              stroke="var(--green)"
              strokeWidth="1.8"
              strokeDasharray="5 4"
            ></rect>
          </g>
        )}

        {/* draft polygon */}
        {s.draft && s.draft.pts.length > 0 && (
          <g>
            <polyline points={draftLine} fill="var(--greenSoft)" stroke="var(--green)" strokeWidth="1.6" strokeDasharray="5 4"></polyline>
            {draftDots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r={fs(5)} fill="var(--panel)" stroke="var(--green)" strokeWidth="1.8"></circle>
            ))}
          </g>
        )}

        {/* LD2450 live targets + trails */}
        {showLd && (
          <g>
            {s.targets.map((t, i) => {
              const p = toPx(t.x, t.y)
              const trail = t.trail.map((pt) => { const q = toPx(pt.x, pt.y); return `${q.x},${q.y}` }).join(' ')
              return (
                <g key={t.id}>
                  <polyline points={trail} fill="none" stroke={t.color} strokeWidth="2.2" strokeLinecap="round" opacity="0.32"></polyline>
                  <circle cx={p.x} cy={p.y} r="11" fill={t.color} opacity="0.16"></circle>
                  <circle cx={p.x} cy={p.y} r="4.5" fill={t.color} stroke="var(--canvas)" strokeWidth="1.8"></circle>
                  <text
                    className="zs-svglabel"
                    x={p.x + fs(8)}
                    y={p.y - fs(8)}
                    fill={t.color}
                    fontSize={fs(10)}
                    fontWeight="700"
                    strokeWidth={halo}
                  >
                    {'T' + (i + 1)}
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {/* sensor origin + boresight */}
        <g
          onPointerDown={(e) => {
            e.stopPropagation()
            if (hasLd) store.selectLd()
            else store.selectBand()
          }}
          style={{ cursor: 'pointer' }}
        >
          {!isCeil && (
            <g>
              <line x1={sx} y1={sy} x2={sx} y2={boreY} stroke="var(--mut)" strokeWidth="1.3" strokeDasharray="4 4" opacity="0.8"></line>
              {/* The 0° label sits right of the line end; the ring labels sit
                  left of the line, so the two never collide. */}
              <text
                className="zs-svglabel"
                x={sx + fs(7)}
                y={boreY - fs(5)}
                fill="var(--mut)"
                fontSize={fs(10)}
                fontWeight="600"
                strokeWidth={halo}
              >
                0° · straight ahead
              </text>
              <rect
                x={sx - fs(24)}
                y={sy - fs(31)}
                width={fs(48)}
                height={fs(20)}
                rx={fs(5)}
                fill="var(--panel)"
                stroke="var(--bd)"
                strokeWidth="1"
              ></rect>
              <text
                className="zs-svglabel"
                x={sx}
                y={sy - fs(17)}
                textAnchor="middle"
                fill="var(--mut)"
                fontSize={fs(8.5)}
                fontWeight="600"
                strokeWidth={0}
              >
                {hasLd ? 'LD2450' : 'SEN0609'}
              </text>
            </g>
          )}
          {isCeil && (
            <g>
              <circle cx={sx} cy={sy} r="16" fill="none" stroke="var(--mut)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7"></circle>
              <text className="zs-svglabel" x={sx} y={sy - fs(22)} textAnchor="middle" fill="var(--mut)" fontSize={fs(10)} fontWeight="600" strokeWidth={halo}>
                ↓ looking down
              </text>
            </g>
          )}
          <circle cx={sx} cy={sy} r="9" fill="var(--panel)" stroke="var(--green)" strokeWidth="2"></circle>
          <circle cx={sx} cy={sy} r="4" fill="var(--green)"></circle>
          <circle cx={sx} cy={sy} r="9" fill="none" stroke="var(--green)" strokeWidth="1.4" opacity="0.45" className="zs-blip"></circle>
          <text
            className="zs-svglabel"
            x={sx}
            y={sy + fs(24)}
            textAnchor="middle"
            fill="var(--mut)"
            fontSize={fs(10)}
            fontWeight="600"
            strokeWidth={halo}
          >
            sensor
          </text>
        </g>

        {/* live readout beside the pointer during a drag */}
        {readout && readoutAt && (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={Math.min(readoutAt.x + fs(12), VIEWBOX_W - readout.length * fs(6.4) - fs(16))}
              y={Math.max(readoutAt.y - fs(34), fs(4))}
              width={readout.length * fs(6.4) + fs(12)}
              height={fs(20)}
              rx={fs(5)}
              fill="var(--panel)"
              stroke="var(--bd)"
              strokeWidth="1"
            ></rect>
            <text
              className="zs-svglabel"
              x={Math.min(readoutAt.x + fs(12), VIEWBOX_W - readout.length * fs(6.4) - fs(16)) + fs(6)}
              y={Math.max(readoutAt.y - fs(34), fs(4)) + fs(13.5)}
              fill="var(--tx)"
              fontSize={fs(10)}
              fontWeight="600"
              strokeWidth={0}
            >
              {readout}
            </text>
          </g>
        )}
      </svg>

      {/* First-run guidance floats over the empty canvas and never blocks it. */}
      {firstRunHint && <div className="zs-canvas-hint">{firstRunHint}</div>}

      {/* The HUD owns the bottom-left corner: live cursor coordinates and the
          grid pitch, clear of the toolbar, the inspector and every canvas label. */}
      <div className="zs-hud">
        <span className="zs-hud__chip">{cursorReadout}</span>
        <span className="zs-hud__chip">grid 0.5 m</span>
      </div>
    </>
  )
}

/**
 * Shown in place of the canvas when the active device has no confirmed radar
 * sensor: a clear prompt to confirm or correct the mapping rather than an empty
 * grid. Clicking opens the device mapping surface.
 */
function CanvasEmptyState() {
  return (
    <div className="zs-canvas-empty" onClick={() => store.selectDeviceMapping()}>
      <div className="zs-canvas-empty__icon">📡</div>
      <div className="zs-canvas-empty__title">No radar sensor confirmed</div>
      <div className="zs-canvas-empty__body">
        This device has not been confirmed as an LD2450 or SEN0609. Review what was detected, confirm the sensor,
        correct a role, or dismiss the device if it is not a radar sensor.
      </div>
      <span className="zs-btn zs-btn--quiet zs-canvas-empty__cta">Open device mapping</span>
    </div>
  )
}
