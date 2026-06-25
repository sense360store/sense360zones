/*
 * HTTP surface and the ingress guard, exercised with Fastify's inject (no real
 * socket). WebSocket streaming is covered by http-client.test.ts and
 * provider.test.ts.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server/app'
import { INGRESS_IP, type ServerConfig } from '../server/config'
import { MockDataProvider } from '../server/provider/MockDataProvider'

function makeStaticRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zone-studio-static-'))
  writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><div id="root"></div><script src="./assets/app.js"></script>',
  )
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'assets', 'app.js'), '// built asset')
  return dir
}

const baseConfig = (over: Partial<ServerConfig>): ServerConfig => ({
  port: 0,
  host: '127.0.0.1',
  allowAll: true,
  ingressIp: INGRESS_IP,
  logLevel: 'error',
  ...over,
})

describe('API routes (guard off)', () => {
  let app: FastifyInstance
  let provider: MockDataProvider
  const staticRoot = makeStaticRoot()

  beforeAll(async () => {
    provider = new MockDataProvider()
    app = await buildServer(baseConfig({ staticRoot }), provider)
    await app.ready()
  })
  afterAll(async () => {
    provider.dispose()
    await app.close()
  })

  it('serves health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('discovers rooms', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/discover' })
    expect(res.statusCode).toBe(200)
    const rooms = res.json()
    expect(rooms).toHaveLength(1)
    expect(rooms[0].devices[0].id).toBe('dev-living-1')
    expect(rooms[0].devices[0].sensors).toHaveLength(2)
  })

  it('reads device config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/dev-living-1' })
    expect(res.statusCode).toBe(200)
    const cfg = res.json()
    expect(cfg.zones).toHaveLength(4)
    expect(cfg.band.maxR).toBe(4.4)
  })

  it('writes device config and echoes it back', async () => {
    const next = {
      zones: [{ id: 'zX', name: 'Test', type: 'detection', shape: 'rect', cx: 0, cy: 1, w: 1, h: 1, rot: 0 }],
      band: { minR: 0.5, maxR: 3, beam: 40, trigSens: 5, sustSens: 4, reducedRange: 0 },
    }
    const post = await app.inject({ method: 'POST', url: '/api/config/dev-living-1', payload: next })
    expect(post.statusCode).toBe(200)
    expect(post.json().zones).toHaveLength(1)
    // A follow-up read reflects the in-memory write.
    const get = await app.inject({ method: 'GET', url: '/api/config/dev-living-1' })
    expect(get.json().zones[0].name).toBe('Test')
    expect(get.json().band.maxR).toBe(3)
  })

  it('serves the SPA at the root', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
    expect(res.body).toContain('./assets/app.js')
  })

  it('serves built assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' })
    expect(res.statusCode).toBe(200)
  })

  it('falls back to index.html for unknown GET paths (SPA routing)', async () => {
    const res = await app.inject({ method: 'GET', url: '/some/deep/link' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
  })

  it('returns JSON 404 for unknown API paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
  })
})

describe('ingress guard (guard on)', () => {
  let app: FastifyInstance
  let provider: MockDataProvider

  beforeAll(async () => {
    provider = new MockDataProvider()
    app = await buildServer(baseConfig({ allowAll: false }), provider)
    await app.ready()
  })
  afterAll(async () => {
    provider.dispose()
    await app.close()
  })

  it('rejects a request from a non-ingress peer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/discover', remoteAddress: '10.0.0.9' })
    expect(res.statusCode).toBe(403)
  })

  it('admits a request from the Supervisor ingress peer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/discover', remoteAddress: INGRESS_IP })
    expect(res.statusCode).toBe(200)
  })

  it('exempts the health route so a local probe still works', async () => {
    const res = await app.inject({ method: 'GET', url: '/health', remoteAddress: '10.0.0.9' })
    expect(res.statusCode).toBe(200)
  })
})
