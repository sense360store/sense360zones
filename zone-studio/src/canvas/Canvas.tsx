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
  // strike through the boresight (r is integer → dash is always '3 6'). On a
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

  // LD2450 field of view
  const ldCone = `${sx},${sy} ${sx + Math.sin(-ha) * LD2450_RANGE * M},${sy + Math.cos(-ha) * LD2450_RANGE * M} ${
    sx + Math.sin(ha) * LD2450_RANGE * M
  },${sy + Math.cos(ha) * LD2450_RANGE * M}`
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

  const canvasCursor = s.tool === 'select' ? 'default' : 'crosshair'
  const cur = s.cursor
  const cursorReadout = cur ? `x ${cur.x.toFixed(2)}  y ${cur.y.toFixed(2)} m` : 'x —  y —'

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
        <g opacity="0.9">
          {rings.map((r, i) => (
            <circle key={i} cx={sx} cy={sy} r={r.rPx} fill="none" stroke="var(--ring)" strokeWidth="1" strokeDasharray="3 6"></circle>
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
                fill="var(--faint)"
                fontSize={fs(9.5)}
                strokeWidth={halo}
              >
                {r.label}
              </text>
            ))}
        </g>

        {/* radial spokes */}
        <g opacity="0.5">
          {spokes.map((sp, i) => (
            <line key={i} x1={sx} y1={sy} x2={sp.x} y2={sp.y} stroke="var(--grid)" strokeWidth="1"></line>
          ))}
        </g>

        {/* LD2450 FoV wedge */}
        {showLd && (
          <g>
            {!isCeil && <polygon points={ldCone} fill="var(--greenSoft)" opacity="0.5"></polygon>}
            {isCeil && <circle cx={sx} cy={sy} r={ldDiscR} fill="var(--greenSoft)" opacity="0.45"></circle>}
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
                <circle
                  cx={bandHandleIn.x}
                  cy={bandHandleIn.y}
                  r="6.5"
                  fill="var(--panel)"
                  stroke="var(--bandLine)"
                  strokeWidth="2"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    store.beginRadius('minR')
                  }}
                  style={{ cursor: 'ns-resize' }}
                ></circle>
                <circle
                  cx={bandHandleOut.x}
                  cy={bandHandleOut.y}
                  r="6.5"
                  fill="var(--panel)"
                  stroke="var(--bandLine)"
                  strokeWidth="2"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    store.beginRadius('maxR')
                  }}
                  style={{ cursor: 'ns-resize' }}
                ></circle>
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
              const isExcl = z.type === 'exclusion'
              const cnt = occ[z.id] || 0
              const occupied = occupancy.zones[z.id] ?? false
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
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    store.beginMoveZone(z.id, atM(e))
                  }}
                  style={{ cursor: 'move' }}
                >
                  <polygon points={pts} fill={m.soft} stroke={m.accent} strokeWidth={selected ? 2.4 : 1.8} strokeDasharray={isExcl ? '7 5' : '0'}></polygon>
                  {isExcl && <polygon points={pts} fill="url(#hatch)"></polygon>}
                  {/* Live occupancy: light the zone the moment a target enters it. */}
                  {occupied && (
                    <g style={{ pointerEvents: 'none' }}>
                      <polygon points={pts} fill={m.accent} opacity={isExcl ? '0.16' : '0.24'}></polygon>
                      <polygon points={pts} fill="none" stroke={m.accent} strokeWidth="3.4" opacity="0.45"></polygon>
                    </g>
                  )}
                  <text
                    className="zs-svglabel zs-svglabel--ui"
                    x={minx + fs(8)}
                    y={miny + fs(15)}
                    fill={m.accent}
                    fontSize={fs(11.5)}
                    fontWeight="600"
                    strokeWidth={halo}
                  >
                    {z.name}
                  </text>
                  <text
                    className="zs-svglabel"
                    x={minx + fs(8)}
                    y={miny + fs(27)}
                    fill={m.accent}
                    fontSize={fs(9.5)}
                    opacity="0.85"
                    strokeWidth={halo}
                  >
                    {isExcl ? (occupied ? 'masked · occupied' : 'masked') : occupied ? 'occupied · ' + cnt + ' / 3' : cnt + ' / 3'}
                  </text>
                  {selected && (
                    <g>
                      {ppx.map((p, i) => (
                        <rect
                          key={i}
                          x={p.x - 4}
                          y={p.y - 4}
                          width="8"
                          height="8"
                          fill="var(--panel)"
                          stroke="var(--green)"
                          strokeWidth="1.5"
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            if (z.shape === 'poly') store.beginVertex(z.id, i)
                            else store.beginCornerResize(z.id, i)
                          }}
                          style={{ cursor: z.shape === 'poly' ? 'move' : 'nwse-resize' }}
                        ></rect>
                      ))}
                      {rot && (
                        <g>
                          <line x1={rot.x1} y1={rot.y1} x2={rot.x2} y2={rot.y2} stroke="var(--green)" strokeWidth="1.3"></line>
                          <circle
                            cx={rot.x2}
                            cy={rot.y2}
                            r="6"
                            fill="var(--panel)"
                            stroke="var(--green)"
                            strokeWidth="1.7"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              store.beginRotate(z.id)
                            }}
                            style={{ cursor: 'grab' }}
                          ></circle>
                        </g>
                      )}
                    </g>
                  )}
                </g>
              )
            })}
          </g>
        )}

        {/* draft polygon */}
        {s.draft && s.draft.pts.length > 0 && (
          <g>
            <polyline points={draftLine} fill="var(--greenSoft)" stroke="var(--green)" strokeWidth="1.6" strokeDasharray="5 4"></polyline>
            {draftDots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r="4.5" fill="var(--panel)" stroke="var(--green)" strokeWidth="1.8"></circle>
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
                  <polyline points={trail} fill="none" stroke={t.color} strokeWidth="2.2" strokeLinecap="round" opacity="0.28"></polyline>
                  <circle cx={p.x} cy={p.y} r="11" fill={t.color} opacity="0.14"></circle>
                  <circle cx={p.x} cy={p.y} r="4.5" fill={t.color} stroke="var(--canvas)" strokeWidth="1.4"></circle>
                  <text
                    className="zs-svglabel"
                    x={p.x + fs(8)}
                    y={p.y - fs(8)}
                    fill={t.color}
                    fontSize={fs(9.5)}
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
              <line x1={sx} y1={sy} x2={sx} y2={boreY} stroke="var(--mut)" strokeWidth="1.3" strokeDasharray="4 4" opacity="0.7"></line>
              {/* The boresight label sits right of the line end; the ring labels sit
                  left of the line, so the two never collide. */}
              <text
                className="zs-svglabel"
                x={sx + fs(7)}
                y={boreY - fs(5)}
                fill="var(--faint)"
                fontSize={fs(9.5)}
                strokeWidth={halo}
              >
                0° boresight
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
              <circle cx={sx} cy={sy} r="16" fill="none" stroke="var(--mut)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6"></circle>
              <text className="zs-svglabel" x={sx} y={sy - fs(22)} textAnchor="middle" fill="var(--faint)" fontSize={fs(9.5)} strokeWidth={halo}>
                ↓ nadir
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
            {isCeil ? 'sensor' : 'origin'}
          </text>
        </g>
      </svg>

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
        This device has not been confirmed as an LD2450 or SEN0609. Open Device on the left to review what was detected,
        confirm the sensor, correct a role, or dismiss the device if it is not a radar sensor.
      </div>
    </div>
  )
}
