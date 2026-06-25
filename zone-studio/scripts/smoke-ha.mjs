/*
 * End-to-end smoke test for the HA provider path. Run against a live instance of
 * the runtime image started with PROVIDER=ha and HA_WS_URL pointed at the
 * WebSocket simulator (test/ha-sim.ts). It proves the real provider authenticates,
 * discovers the fixture rooms and devices, and streams a live target frame.
 *
 * Usage: node scripts/smoke-ha.mjs [baseUrl]   (default http://127.0.0.1:8099)
 */
const base = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://127.0.0.1:8099').replace(/\/$/, '')

let failures = 0
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`ok   - ${name}`)
  } else {
    failures++
    console.error(`FAIL - ${name}${detail ? ': ' + detail : ''}`)
  }
}

async function main() {
  // 1. Health
  {
    const res = await fetch(`${base}/health`)
    const body = await res.json()
    check('health returns ok', res.status === 200 && body.status === 'ok')
  }

  // 2. Discovery resolves the simulator's fixture rooms and an LD2450 device.
  let deviceId = 'dev_ld'
  {
    const res = await fetch(`${base}/api/discover`)
    const rooms = await res.json()
    const names = Array.isArray(rooms) ? rooms.map((r) => r.name).sort() : []
    const ok = res.status === 200 && names.includes('Living Room') && names.includes('Bedroom')
    check('discovery returns the fixture rooms', ok, JSON.stringify(names))

    const ld = (rooms ?? [])
      .flatMap((r) => r.devices)
      .find((d) => d.sensors.some((s) => s.kind === 'ld2450'))
    check('an LD2450 device was discovered', !!ld)
    if (ld) deviceId = ld.id
  }

  // 3. The live WebSocket streams a target frame for the LD2450.
  {
    const wsBase = base.replace(/^http/, 'ws')
    const frame = await new Promise((resolve) => {
      const ws = new WebSocket(`${wsBase}/ws?device=${encodeURIComponent(deviceId)}`)
      const timer = setTimeout(() => {
        try { ws.close() } catch { /* ignore */ }
        resolve(null)
      }, 8000)
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (Array.isArray(data) && data.length > 0) {
            clearTimeout(timer)
            try { ws.close() } catch { /* ignore */ }
            resolve(data)
          }
        } catch { /* wait for the next frame */ }
      }
      ws.onerror = () => { clearTimeout(timer); resolve(null) }
    })
    const ok = Array.isArray(frame) && frame.length >= 1 && typeof frame[0].x === 'number' && typeof frame[0].y === 'number'
    check('websocket streams a live target frame in metres', ok, JSON.stringify(frame))
  }

  if (failures > 0) {
    console.error(`\n${failures} HA smoke check(s) failed`)
    process.exit(1)
  }
  console.log('\nall HA smoke checks passed')
}

main().catch((err) => {
  console.error('HA smoke test error:', err)
  process.exit(1)
})
