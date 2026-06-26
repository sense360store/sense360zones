/*
 * Generated ESPHome config for the polygon profile (Phase 4, the durable export).
 * -------------------------------------------------------------------------
 * The live MQTT path is instant and needs no flash, but it only runs while the
 * add-on is up. For permanence the user can move the same zones onto the device
 * itself via the polygon-capable external component
 * `TillFleisch/ESPHome-HLK-LD2450`, which evaluates convex zone polygons in
 * firmware and exposes an occupancy binary sensor per zone.
 *
 * This module turns a device's room-frame zone set into that YAML. Each room-frame
 * polygon vertex is mapped to the LD2450 sensor frame with `roomToSensor` (the one
 * coordinate convention) and emitted in metres, the unit the component expects. A
 * non-convex zone is split into convex parts first, because the component requires
 * each zone polygon to be simple and convex, and each part becomes its own device
 * zone with its own occupancy binary sensor.
 *
 * The component's `zones`/`zone`/`polygon`/`point`/`occupancy` syntax and the
 * convex-only requirement were taken from its repository (examples/zones.yaml). The
 * `ref` below is pinned to a released tag so a future component change cannot
 * silently alter the generated config.
 */
import { convexDecompose } from './decompose'
import { zonePtsM } from './geometry'
import { roomToSensor } from './native'
import type { Point, SensorMount, Zone } from './types'

/** The component repository and the pinned tag this generator targets. */
export const ESPHOME_COMPONENT_SOURCE = 'github://TillFleisch/ESPHome-HLK-LD2450'
export const ESPHOME_COMPONENT_REF = 'v1.0.6'

/** Default hysteresis margin emitted per zone, metres (the component's example uses 25cm). */
const DEFAULT_MARGIN_M = 0.25

export interface EsphomeGenOptions {
  /** Pinned external-component ref (tag). Defaults to `ESPHOME_COMPONENT_REF`. */
  ref?: string
  /** Per-zone hysteresis margin in metres. Defaults to 0.25. */
  marginM?: number
  /** The `uart_id` the user's board already defines for the LD2450. */
  uartId?: string
}

/** Format a metre value as the component's distance literal, avoiding `-0.000m`. */
function metres(v: number): string {
  const r = Math.abs(v) < 5e-4 ? 0 : v
  return `${r.toFixed(3)}m`
}

/** Double-quote a YAML scalar, escaping backslashes and quotes. */
function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Generate the ESPHome package YAML for a device's polygon zone set. The output is
 * a complete `external_components` + `LD2450` block the user merges into their
 * device config (matching `uart_id` to their board) and flashes; see DOCS.md.
 *
 * Returns a header-only stub when there are no zones, so the action always yields
 * something copyable.
 */
export function generateEsphomePackage(
  device: { id: string; name: string },
  zones: Zone[],
  mount: SensorMount,
  opts: EsphomeGenOptions = {},
): string {
  const ref = opts.ref ?? ESPHOME_COMPONENT_REF
  const margin = opts.marginM ?? DEFAULT_MARGIN_M
  const uartId = opts.uartId ?? 'uart_bus'

  const lines: string[] = []
  lines.push(`# Sense360 Zone Studio — generated ESPHome zones for ${device.name}`)
  lines.push('#')
  lines.push('# The durable alternative to the live MQTT path: these zones run on the device')
  lines.push('# itself. Merge this into the LD2450 device config, set uart_id to your board,')
  lines.push('# and flash. The live path requires the LD2450 to report all targets; on the')
  lines.push('# device the component does the filtering, so no report-all is needed.')
  lines.push('#')
  lines.push('# Exclusion zones are emitted as occupancy zones too; the detection-minus-')
  lines.push('# exclusion presence rule is a live-path feature, compose it in Home Assistant')
  lines.push('# if you need it on-device.')
  lines.push('')
  lines.push('external_components:')
  lines.push(`  - source: ${ESPHOME_COMPONENT_SOURCE}@${ref}`)
  lines.push('')
  lines.push('LD2450:')
  lines.push(`  uart_id: ${uartId}`)

  const zoneBlocks: string[] = []
  for (const zone of zones) {
    const parts = convexDecompose(zonePtsM(zone))
    parts.forEach((part, i) => {
      const suffix = parts.length > 1 ? ` (part ${i + 1})` : ''
      const typeTag = zone.type === 'exclusion' ? ' [exclusion]' : ''
      zoneBlocks.push(`    - zone:`)
      zoneBlocks.push(`        name: ${yamlStr(zone.name + suffix + typeTag)}`)
      zoneBlocks.push(`        margin: ${metres(margin)}`)
      zoneBlocks.push(`        polygon:`)
      for (const vertex of part) {
        const s: Point = roomToSensor(vertex, mount)
        zoneBlocks.push(`          - point:`)
        zoneBlocks.push(`              x: ${metres(s.x)}`)
        zoneBlocks.push(`              y: ${metres(s.y)}`)
      }
      zoneBlocks.push(`        occupancy:`)
      zoneBlocks.push(`          name: ${yamlStr(zone.name + suffix + ' occupancy')}`)
    })
  }

  if (zoneBlocks.length) {
    lines.push('  zones:')
    lines.push(...zoneBlocks)
  } else {
    lines.push('  # No zones drawn yet.')
    lines.push('  zones: []')
  }
  lines.push('')
  return lines.join('\n')
}
