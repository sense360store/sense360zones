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
import { css } from '../lib/css'
import { generateEsphomePackage } from '../domain/esphome'
import type { SensorMount } from '../domain/types'
import { useEditorState } from '../store/hooks'

const DEFAULT_MOUNT: SensorMount = { surface: 'wall', height: 1.5, origin: { x: 0, y: 0 }, boresight: 0 }

const buttonStyle =
  'width:100%;height:32px;border-radius:8px;border:1px solid var(--bd);background:var(--ins);color:var(--tx);font-family:Murecho;font-size:12px;font-weight:600;cursor:pointer;'

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
    <div style={css('padding:0 18px 14px;')}>
      <button onClick={() => setOpen(true)} style={css(buttonStyle)} title="Generate an ESPHome package for these zones">
        Generate ESPHome config
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={css(
            'position:fixed;inset:0;z-index:50;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:24px;',
          )}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={css(
              'width:min(720px,100%);max-height:84vh;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--bd);border-radius:12px;box-shadow:var(--shadow);overflow:hidden;',
            )}
          >
            <div style={css('padding:16px 20px;border-bottom:1px solid var(--bd2);display:flex;align-items:center;gap:12px;')}>
              <div style={css('flex:1;')}>
                <div style={css('font-size:14px;font-weight:700;color:var(--tx);')}>ESPHome config</div>
                <div style={css('font-size:11.5px;color:var(--mut);margin-top:2px;')}>
                  The durable on-device version of these zones. Add it to {deviceName} and flash. See DOCS.md.
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={css(
                  'width:30px;height:30px;flex:none;border-radius:7px;border:1px solid var(--bd);background:var(--ins);color:var(--mut);cursor:pointer;font-size:13px;',
                )}
              >
                ✕
              </button>
            </div>
            <textarea
              readOnly
              value={yaml}
              spellCheck={false}
              style={css(
                "flex:1;min-height:300px;resize:none;border:none;outline:none;background:var(--canvas);color:var(--tx);font-family:'JetBrains Mono';font-size:12px;line-height:1.5;padding:16px 20px;white-space:pre;overflow:auto;",
              )}
            />
            <div style={css('padding:12px 20px;border-top:1px solid var(--bd2);display:flex;gap:10px;justify-content:flex-end;')}>
              <button onClick={download} style={css(buttonStyle + 'width:auto;padding:0 16px;')}>
                Download .yaml
              </button>
              <button
                onClick={copy}
                style={css(
                  'height:32px;padding:0 16px;border-radius:8px;border:1px solid var(--green);background:var(--green);color:#fff;font-family:Murecho;font-size:12px;font-weight:700;cursor:pointer;',
                )}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
