/*
 * A small Home Assistant WebSocket simulator.
 *
 * It speaks enough of the protocol for the provider to authenticate, discover,
 * and stream: the auth handshake, the three registry list commands, get_states,
 * and subscribe_events with scripted state_changed pushes. The loop cannot reach
 * a real Home Assistant, so this is what the provider is verified against.
 *
 * Tests drive it directly (emitState, dropConnections, close). Run as a script
 * (`tsx test/ha-sim.ts`) it serves the fixtures with an auto-streaming target for
 * the end-to-end container check; `HA_SIM_PORT` and `HA_SIM_TOKEN` configure it.
 */
import { WebSocketServer, type WebSocket } from 'ws'
import { areas, devices, entities, initialStates, LD } from './ha-fixtures'
import type { HassState } from '../server/ha/types'

export interface HaSimOptions {
  /** 0 picks a free port (the default for tests). */
  port?: number
  /** If set, only this access token authenticates. Otherwise any non-empty token. */
  token?: string
  /** Drive a moving target automatically once a client subscribes (CI only). */
  autoStream?: boolean
  host?: string
}

interface Client {
  ws: WebSocket
  authed: boolean
  /** subscribe_events ids on this socket. */
  subscriptions: Set<number>
}

export class HaSim {
  private readonly wss: WebSocketServer
  private readonly token?: string
  private readonly autoStream: boolean
  private readonly clients = new Set<Client>()
  private readonly states = new Map<string, HassState>()
  private autoTimer: ReturnType<typeof setInterval> | null = null
  private autoAngle = 0
  readonly port: number
  /** Entity ids whose service writes are acknowledged but ignored (a device that
   *  refuses a value), so a read-back mismatch can be exercised. */
  readonly frozen = new Set<string>()

  constructor(wss: WebSocketServer, port: number, opts: HaSimOptions) {
    this.wss = wss
    this.port = port
    this.token = opts.token
    this.autoStream = opts.autoStream ?? false
    for (const s of initialStates()) this.states.set(s.entity_id, s)
    this.wss.on('connection', (ws) => this.onConnection(ws))
  }

  get url(): string {
    return `ws://127.0.0.1:${this.port}/websocket`
  }

  private onConnection(ws: WebSocket): void {
    const client: Client = { ws, authed: false, subscriptions: new Set() }
    this.clients.add(client)
    ws.on('message', (data) => this.onMessage(client, data.toString()))
    ws.on('close', () => this.clients.delete(client))
    ws.on('error', () => {})
    // The server greets first, exactly like Home Assistant.
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.6.0' }))
  }

  private onMessage(client: Client, raw: string): void {
    let msg: {
      id?: number
      type?: string
      access_token?: string
      domain?: string
      service?: string
      service_data?: Record<string, unknown>
      target?: { entity_id?: string | string[] }
    }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    if (msg.type === 'auth') {
      const ok = this.token ? msg.access_token === this.token : Boolean(msg.access_token)
      if (ok) {
        client.authed = true
        client.ws.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.6.0' }))
      } else {
        client.ws.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token' }))
      }
      return
    }

    if (!client.authed || typeof msg.id !== 'number') return
    const id = msg.id

    switch (msg.type) {
      case 'config/area_registry/list':
        return this.result(client, id, areas)
      case 'config/device_registry/list':
        return this.result(client, id, devices)
      case 'config/entity_registry/list':
        return this.result(client, id, entities)
      case 'get_states':
        return this.result(client, id, [...this.states.values()])
      case 'subscribe_events':
        client.subscriptions.add(id)
        this.result(client, id, null)
        if (this.autoStream) this.startAutoStream()
        return
      case 'unsubscribe_events': {
        const sub = (msg as { subscription?: number }).subscription
        if (typeof sub === 'number') client.subscriptions.delete(sub)
        return this.result(client, id, null)
      }
      case 'call_service':
        this.callService(msg.domain, msg.service, msg.service_data, msg.target)
        return this.result(client, id, { context: { id: 'ctx' } })
      default:
        return this.result(client, id, null)
    }
  }

  /**
   * Apply a service call to the in-memory state so a subsequent read observes it.
   * Handles the two services the LD2450 apply path uses; attributes (unit, the
   * select's option set) are preserved so reads round-trip.
   */
  private callService(
    domain: string | undefined,
    service: string | undefined,
    data: Record<string, unknown> = {},
    target: { entity_id?: string | string[] } = {},
  ): void {
    const entityId = Array.isArray(target.entity_id) ? target.entity_id[0] : target.entity_id
    if (!entityId || this.frozen.has(entityId)) return
    const attributes = this.states.get(entityId)?.attributes ?? {}
    if (domain === 'number' && service === 'set_value') {
      this.emitState(entityId, String(data.value), attributes)
    } else if (domain === 'select' && service === 'select_option') {
      this.emitState(entityId, String(data.option), attributes)
    }
  }

  /** The current state value of an entity (tests assert what a write stored). */
  peek(entityId: string): string | undefined {
    return this.states.get(entityId)?.state
  }

  private result(client: Client, id: number, result: unknown): void {
    if (client.ws.readyState === client.ws.OPEN) {
      client.ws.send(JSON.stringify({ id, type: 'result', success: true, result }))
    }
  }

  /**
   * Update an entity's state and push a state_changed event to every subscriber.
   * Tests call this to script frames; it also feeds the auto-stream.
   */
  emitState(entityId: string, value: string, attributes: HassState['attributes'] = {}): void {
    const old = this.states.get(entityId) ?? null
    const next: HassState = { entity_id: entityId, state: value, attributes }
    this.states.set(entityId, next)
    const event = {
      event_type: 'state_changed',
      data: { entity_id: entityId, new_state: next, old_state: old },
    }
    for (const client of this.clients) {
      if (client.ws.readyState !== client.ws.OPEN) continue
      for (const id of client.subscriptions) {
        client.ws.send(JSON.stringify({ id, type: 'event', event }))
      }
    }
  }

  /** Drop every client socket while keeping the server listening (reconnect test). */
  dropConnections(): void {
    for (const client of this.clients) {
      try {
        client.ws.terminate()
      } catch {
        /* already gone */
      }
    }
    this.clients.clear()
  }

  close(): Promise<void> {
    if (this.autoTimer) clearInterval(this.autoTimer)
    this.autoTimer = null
    this.dropConnections()
    return new Promise((resolve) => this.wss.close(() => resolve()))
  }

  private startAutoStream(): void {
    if (this.autoTimer) return
    this.autoTimer = setInterval(() => {
      this.autoAngle += 0.25
      const x = Math.round(Math.sin(this.autoAngle) * 2000)
      const y = 1500 + Math.round((Math.cos(this.autoAngle) + 1) * 500)
      this.emitState(LD.t1x, String(x), { unit_of_measurement: 'mm' })
      this.emitState(LD.t1y, String(y), { unit_of_measurement: 'mm' })
    }, 250)
    if (typeof this.autoTimer.unref === 'function') this.autoTimer.unref()
  }
}

/** Start a simulator. Resolves once it is listening. */
export function startHaSim(opts: HaSimOptions = {}): Promise<HaSim> {
  const host = opts.host ?? '127.0.0.1'
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: opts.port ?? 0, host }, () => {
      const addr = wss.address()
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0)
      resolve(new HaSim(wss, port, opts))
    })
  })
}

// Standalone mode for the end-to-end container check.
if (process.argv[1] && process.argv[1].endsWith('ha-sim.ts')) {
  const port = Number(process.env.HA_SIM_PORT ?? 8123)
  const token = process.env.HA_SIM_TOKEN
  void startHaSim({ port, token, autoStream: true, host: '0.0.0.0' }).then((sim) => {
    console.log(`ha-sim listening on ${sim.url} (token ${token ? 'required' : 'any'})`)
  })
}
