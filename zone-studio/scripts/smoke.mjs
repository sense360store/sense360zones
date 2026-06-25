/*
 * Server smoke test, run against a live instance (the runtime image in CI, or a
 * local server). Verifies the SPA, the API, the live WebSocket stream, and that
 * the server still serves correctly under a simulated ingress subpath.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]   (default http://127.0.0.1:8099)
 */
import http from 'node:http'

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

  // 2. SPA root with relative assets
  {
    const res = await fetch(`${base}/`)
    const html = await res.text()
    check('serves the SPA at the root', res.status === 200 && html.includes('id="root"'))
    check('SPA references assets relatively', /(?:src|href)="\.\/assets\//.test(html) && !/(?:src|href)="\/assets\//.test(html))
  }

  // 3. Discovery
  let deviceId = 'dev-living-1'
  {
    const res = await fetch(`${base}/api/discover`)
    const rooms = await res.json()
    const ok = res.status === 200 && Array.isArray(rooms) && rooms[0]?.name === 'Living Room'
    check('discovery returns mock rooms', ok)
    if (ok) deviceId = rooms[0].devices[0].id
  }

  // 4. Config read
  {
    const res = await fetch(`${base}/api/config/${encodeURIComponent(deviceId)}`)
    const cfg = await res.json()
    check('config read returns zones and band', res.status === 200 && cfg.zones.length === 4 && typeof cfg.band.maxR === 'number')
  }

  // 5. WebSocket target stream
  {
    const wsBase = base.replace(/^http/, 'ws')
    const frame = await new Promise((resolve) => {
      const ws = new WebSocket(`${wsBase}/ws?device=${encodeURIComponent(deviceId)}`)
      const timer = setTimeout(() => {
        try { ws.close() } catch { /* ignore */ }
        resolve(null)
      }, 6000)
      ws.onmessage = (ev) => {
        clearTimeout(timer)
        try { ws.close() } catch { /* ignore */ }
        try { resolve(JSON.parse(ev.data)) } catch { resolve(null) }
      }
      ws.onerror = () => { clearTimeout(timer); resolve(null) }
    })
    check('websocket emits a target frame', Array.isArray(frame) && frame.length === 3)
  }

  // 6. Simulated ingress subpath: a proxy strips the prefix, the server serves
  // the clean path. This is how Home Assistant ingress forwards requests.
  {
    const prefix = '/api/hassio_ingress/SMOKETOKEN'
    const target = new URL(base)
    const proxy = http.createServer((req, res) => {
      const stripped = req.url.startsWith(prefix) ? req.url.slice(prefix.length) || '/' : req.url
      const up = http.request(
        { host: target.hostname, port: target.port, path: stripped, method: req.method, headers: req.headers },
        (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) },
      )
      up.on('error', () => { res.statusCode = 502; res.end() })
      req.pipe(up)
    })
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
    const proxyPort = proxy.address().port
    const res = await fetch(`http://127.0.0.1:${proxyPort}${prefix}/api/discover`)
    const rooms = await res.json()
    check('serves under a simulated ingress subpath', res.status === 200 && rooms[0]?.name === 'Living Room')
    proxy.close()
  }

  if (failures > 0) {
    console.error(`\n${failures} smoke check(s) failed`)
    process.exit(1)
  }
  console.log('\nall smoke checks passed')
}

main().catch((err) => {
  console.error('smoke test error:', err)
  process.exit(1)
})
