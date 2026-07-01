/*
 * Generate ESPHome config — the durable export action (Phase 4, task C/D).
 *
 * The live MQTT path needs no flash but only runs while the add-on is up. This
 * action turns the active device's polygon zones into the ESPHome package for the
 * external component and shows it for copy or download, the durable on-device
 * alternative. Generation is pure and client-side (the shared domain generator),
 * so it needs no round trip; the user adds the YAML to their device and flashes it
 * (a documented manual step, see DOCS.md).
 */
import { useState } from 'react'
import { generateEsphomePackage } from '../domain/esphome'
import type { SensorMount } from '../domain/types'
import { useEditorState } from '../store/hooks'

const DEFAULT_MOUNT: SensorMount = { surface: 'wall', height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }

export function EsphomeExport() {
  const s = useEditorState()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!s.activeDeviceId) return null

  const device = s.rooms.flatMap((r) => r.devices).find((d) => d.id === s.activeDeviceId)
  const deviceName = device?.name ?? 'LD2450'
  const yaml = generateEsphomePackage({ id: s.activeDeviceId, name: deviceName }, s.zones, s.mount ?? DEFAULT_MOUNT)

  const copy = () => {
    void navigator.clipboard?.writeText(yaml).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {
        // Clipboard may be blocked under ingress; the textarea still allows manual copy.
      },
    )
  }

  const download = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sense360-zones-${s.activeDeviceId}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="zs-export">
      <button className="zs-export__open" onClick={() => setOpen(true)} title="Generate an ESPHome package for these zones">
        Generate ESPHome config
      </button>

      {open && (
        <div className="zs-modal" onClick={() => setOpen(false)}>
          <div className="zs-modal__box" onClick={(e) => e.stopPropagation()}>
            <div className="zs-modal__head">
              <div style={{ flex: 1 }}>
                <div className="zs-modal__title">ESPHome config</div>
                <div className="zs-modal__sub">
                  The durable on-device version of these zones. Add it to {deviceName} and flash. See DOCS.md.
                </div>
              </div>
              <button className="zs-btn zs-btn--icon" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <textarea className="zs-modal__code" readOnly value={yaml} spellCheck={false} />
            <div className="zs-modal__actions">
              <button className="zs-btn zs-btn--quiet" onClick={download}>
                Download .yaml
              </button>
              <button className="zs-btn zs-btn--primary zs-btn--sm" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
