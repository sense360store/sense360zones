/*
 * HttpZonesClient — the live `ZonesClient`, talking to the Fastify backend.
 *
 * It implements the identical contract `MockZonesClient` does: discovery and
 * config over `fetch`, the live target stream over a WebSocket. The UI and store
 * cannot tell which client is wired (see store/instance.ts).
 *
 * Ingress correctness (the highest-risk part of Phase 1): every URL is built
 * from the document's own path so it carries the ingress base prefix the browser
 * must send. Under Home Assistant the page is served at
 * `/api/hassio_ingress/<token>/`; the Supervisor strips that prefix before the
 * request reaches the add-on, so the browser must include it and the add-on must
 * never emit an absolute, prefix-less path. In development the base is empty and
 * the Vite dev proxy forwards `/api` and `/ws` to the backend.
 */
import type { Room, Target } from '../domain/types'
import type { DeviceConfig, TargetListener, Unsubscribe, ZonesClient } from './ZonesClient'

/** Minimal view of `window.location` the URL helpers need (injectable for tests). */
export interface LocationLike {
  pathname: string
  host: string
  protocol: string
}

/**
 * The ingress base: the document path without a trailing slash. Home Assistant
 * always serves the app at the token root with a trailing slash, so stripping it
 * yields the prefix every API and WebSocket URL must carry.
 */
export function ingressBase(loc: LocationLike): string {
  return loc.pathname.replace(/\/+$/, '')
}

/**
 * Build an http(s) API URL under the ingress base. The URL is absolute against
 * the document's own origin and carries the ingress prefix, so it resolves the
 * same way the WebSocket URL does and never collapses to a bare, prefix-less
 * "/api/..." path that ingress would fail to route. `path` has no leading slash.
 */
export function apiUrl(path: string, loc: LocationLike): string {
  return `${loc.protocol}//${loc.host}${ingressBase(loc)}/api/${path}`
}

/** Build a ws(s) URL under the ingress base. `path` has no leading slash. */
export function wsUrl(path: string, loc: LocationLike): string {
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${loc.host}${ingressBase(loc)}/${path}`
}

/** How long to wait before reconnecting a dropped target stream, milliseconds. */
const RECONNECT_MS = 1000

export class HttpZonesClient implements ZonesClient {
  private loc: LocationLike

  constructor(loc: LocationLike = window.location) {
    this.loc = loc
  }

  async discover(): Promise<Room[]> {
    const res = await fetch(apiUrl('discover', this.loc))
    if (!res.ok) throw new Error(`discover failed: ${res.status}`)
    return (await res.json()) as Room[]
  }

  async readConfig(deviceId: string): Promise<DeviceConfig> {
    const res = await fetch(apiUrl(`config/${encodeURIComponent(deviceId)}`, this.loc))
    if (!res.ok) throw new Error(`readConfig failed: ${res.status}`)
    return (await res.json()) as DeviceConfig
  }

  async writeConfig(deviceId: string, config: DeviceConfig): Promise<void> {
    const res = await fetch(apiUrl(`config/${encodeURIComponent(deviceId)}`, this.loc), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) {
      // Prefer the server's reason (e.g. the native violations) over a bare status.
      let detail = `writeConfig failed: ${res.status}`
      try {
        const body = (await res.json()) as { error?: string }
        if (body?.error) detail = body.error
      } catch {
        // No JSON body; keep the status-based message.
      }
      throw new Error(detail)
    }
  }

  streamTargets(deviceId: string, onSample: TargetListener): Unsubscribe {
    let closed = false
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (closed) return
      const url = wsUrl(`ws?device=${encodeURIComponent(deviceId)}`, this.loc)
      socket = new WebSocket(url)
      socket.onmessage = (ev) => {
        try {
          onSample(JSON.parse(ev.data as string) as Target[])
        } catch {
          // Ignore a malformed frame; the next one will refresh the canvas.
        }
      }
      socket.onclose = () => {
        socket = null
        // Reconnect on an ingress flap or a backend restart.
        if (!closed) retry = setTimeout(connect, RECONNECT_MS)
      }
      socket.onerror = () => {
        socket?.close()
      }
    }
    connect()

    return () => {
      closed = true
      if (retry !== null) clearTimeout(retry)
      socket?.close()
    }
  }
}
