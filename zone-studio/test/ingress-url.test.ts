/*
 * Ingress URL derivation. The browser must send the ingress base prefix so the
 * Supervisor routes to this add-on; the add-on itself never sees the prefix.
 * These cover both the Home Assistant ingress path and local development.
 */
import { describe, expect, it } from 'vitest'
import { apiUrl, ingressBase, wsUrl, type LocationLike } from '../src/client/HttpZonesClient'

const ingress: LocationLike = {
  pathname: '/api/hassio_ingress/abc123token/',
  host: 'home.example.com',
  protocol: 'https:',
}

const dev: LocationLike = { pathname: '/', host: 'localhost:5173', protocol: 'http:' }

describe('ingress URL derivation', () => {
  it('carries the ingress prefix on API URLs', () => {
    expect(apiUrl('discover', ingress)).toBe(
      'https://home.example.com/api/hassio_ingress/abc123token/api/discover',
    )
    expect(apiUrl('config/dev-living-1', ingress)).toBe(
      'https://home.example.com/api/hassio_ingress/abc123token/api/config/dev-living-1',
    )
  })

  it('carries the ingress prefix on the WebSocket URL and upgrades to wss on https', () => {
    expect(wsUrl('ws?device=d1', ingress)).toBe(
      'wss://home.example.com/api/hassio_ingress/abc123token/ws?device=d1',
    )
  })

  it('never emits a bare prefix-less absolute API path under ingress', () => {
    // A leading "/api/discover" without the token would break under ingress.
    const url = new URL(apiUrl('discover', ingress))
    expect(url.pathname.startsWith('/api/discover')).toBe(false)
    expect(url.pathname).toBe('/api/hassio_ingress/abc123token/api/discover')
  })

  it('strips a trailing slash to form the base', () => {
    expect(ingressBase(ingress)).toBe('/api/hassio_ingress/abc123token')
    expect(ingressBase(dev)).toBe('')
  })

  it('works in development against the Vite proxy', () => {
    expect(apiUrl('discover', dev)).toBe('http://localhost:5173/api/discover')
    expect(wsUrl('ws', dev)).toBe('ws://localhost:5173/ws')
  })
})
