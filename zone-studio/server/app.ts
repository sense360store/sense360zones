/*
 * The Fastify application, as a factory so tests can build it without binding a
 * port. `index.ts` calls `buildServer` then `listen`.
 *
 * Layout:
 *   - an onRequest guard that, in production, only admits the Supervisor ingress
 *     peer (172.30.32.2). The dev switch ALLOW_ALL_ORIGINS=1 disables it. There
 *     is no auth: Home Assistant authenticates the user before ingress.
 *   - /health, exempt from the guard so a local probe can reach it.
 *   - /api/* for discovery and config, backed by the injected DataProvider.
 *   - /ws, a WebSocket that streams live targets from the provider.
 *   - the built SPA as static files, with a fallback to index.html so the app
 *     loads at the ingress base path (and any sub-path) without absolute URLs.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import type { ServerConfig } from './config'
import type { DataProvider, DeviceConfig } from './provider/DataProvider'

/** Strip the query string from a raw request URL. */
function pathOf(url: string): string {
  const q = url.indexOf('?')
  return q === -1 ? url : url.slice(0, q)
}

export async function buildServer(cfg: ServerConfig, provider: DataProvider): Promise<FastifyInstance> {
  // trustProxy: false → request.ip is the socket peer, which is what the
  // ingress guard must check. Do not trust forwarded headers here.
  const app = Fastify({ trustProxy: false, logger: { level: cfg.logLevel } })

  // Ingress guard. /health is exempt so a loopback probe still works.
  app.addHook('onRequest', async (req, reply) => {
    if (cfg.allowAll) return
    if (pathOf(req.url) === '/health') return
    if (req.ip !== cfg.ingressIp) {
      return reply.code(403).send({ error: 'forbidden' })
    }
  })

  app.get('/health', async () => ({ status: 'ok' }))

  await app.register(websocket)

  // ---- API -----------------------------------------------------------------
  await app.register(
    async (api) => {
      api.get('/discover', async () => provider.discover())

      api.get<{ Params: { deviceId: string } }>('/config/:deviceId', async (req) =>
        provider.readConfig(req.params.deviceId),
      )

      api.post<{ Params: { deviceId: string }; Body: DeviceConfig }>('/config/:deviceId', async (req, reply) => {
        try {
          await provider.writeConfig(req.params.deviceId, req.body)
        } catch (err) {
          // A rejected write (a non-native set, or a value the device refused) is a
          // client-actionable error, not a server fault. Return the reason so the
          // editor can show it rather than a bare 500.
          reply.code(422)
          return { error: err instanceof Error ? err.message : 'write failed' }
        }
        // Echo back the device's config so the caller can reset its baseline to the
        // confirmed read-back.
        return provider.readConfig(req.params.deviceId)
      })
    },
    { prefix: '/api' },
  )

  // ---- live target stream --------------------------------------------------
  app.get<{ Querystring: { device?: string } }>('/ws', { websocket: true }, (socket, req) => {
    const deviceId = req.query.device ?? ''
    const unsubscribe = provider.subscribeTargets(deviceId, (targets) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(targets))
    })
    socket.on('close', unsubscribe)
    socket.on('error', unsubscribe)
  })

  // ---- static SPA ----------------------------------------------------------
  if (cfg.staticRoot && existsSync(cfg.staticRoot)) {
    const root = path.resolve(cfg.staticRoot)
    await app.register(fastifyStatic, { root, index: ['index.html'] })

    // SPA fallback: any non-API GET that is not a real file serves index.html,
    // so the app loads under the ingress base path and deep links resolve.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET') {
        const p = pathOf(req.url)
        if (!p.startsWith('/api') && p !== '/ws') {
          return reply.sendFile('index.html')
        }
      }
      return reply.code(404).send({ error: 'not_found' })
    })
  }

  return app
}
