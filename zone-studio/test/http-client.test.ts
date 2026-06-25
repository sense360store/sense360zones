/*
 * End-to-end client/server contract: a real Fastify server with the mock
 * provider, driven through HttpZonesClient exactly as the UI drives it. Proves
 * the swap from MockZonesClient to HttpZonesClient is transparent to the store.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server/app'
import { INGRESS_IP } from '../server/config'
import { MockDataProvider } from '../server/provider/MockDataProvider'
import { HttpZonesClient, type LocationLike } from '../src/client/HttpZonesClient'
import type { Target } from '../src/domain/types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('HttpZonesClient against a live backend', () => {
  let app: FastifyInstance
  let provider: MockDataProvider
  let client: HttpZonesClient

  beforeAll(async () => {
    provider = new MockDataProvider()
    app = await buildServer(
      { port: 0, host: '127.0.0.1', allowAll: true, ingressIp: INGRESS_IP, logLevel: 'error' },
      provider,
    )
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const loc: LocationLike = { pathname: '/', host: `127.0.0.1:${port}`, protocol: 'http:' }
    client = new HttpZonesClient(loc)
  })
  afterAll(async () => {
    provider.dispose()
    await app.close()
  })

  it('discovers rooms over HTTP', async () => {
    const rooms = await client.discover()
    expect(rooms[0].name).toBe('Living Room')
    expect(rooms[0].devices[0].id).toBe('dev-living-1')
  })

  it('reads and writes config over HTTP', async () => {
    const cfg = await client.readConfig('dev-living-1')
    expect(cfg.zones).toHaveLength(4)
    cfg.band.maxR = 4.9
    await client.writeConfig('dev-living-1', cfg)
    const after = await client.readConfig('dev-living-1')
    expect(after.band.maxR).toBe(4.9)
  })

  it('streams live targets over the WebSocket', async () => {
    const frames: Target[][] = []
    const unsubscribe = client.streamTargets('dev-living-1', (t) => frames.push(t))
    // Wait for the initial frame plus a few animation ticks.
    await sleep(300)
    unsubscribe()
    expect(frames.length).toBeGreaterThanOrEqual(2)
    expect(frames[0]).toHaveLength(3)
    await sleep(50)
  })
})
