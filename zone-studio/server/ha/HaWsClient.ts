/*
 * A small Home Assistant WebSocket client.
 *
 * It speaks just enough of the protocol for read-only discovery and live state:
 *   - the auth handshake (auth_required -> auth -> auth_ok / auth_invalid),
 *   - request/response correlation by an incrementing id (`command`),
 *   - long-lived subscriptions whose events share the subscribe id (`subscribe`),
 *   - reconnect with exponential backoff that re-authenticates and re-subscribes,
 *     so the add-on survives a Home Assistant restart.
 *
 * It deliberately does not depend on a Home Assistant SDK; the `ws` package
 * (already pulled in by @fastify/websocket) is the only dependency. The shapes it
 * exchanges live in ./types.
 */
import WebSocket from 'ws'
import type { IncomingMessage } from './types'

/** The connection state the provider surfaces to the rest of the system. */
export type ConnectionState = 'connecting' | 'connected' | 'offline'

export interface Logger {
  debug(obj: unknown, msg?: string): void
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
}

/** A logger that does nothing, used until a real one is attached. */
const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

export interface HaWsClientOptions {
  url: string
  token: string
  logger?: Logger
  /** First reconnect delay, doubling each attempt up to `reconnectMaxMs`. */
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  /** How long `connect()` and `command()` wait before giving up. */
  timeoutMs?: number
}

/** A live subscription handle. `unsubscribe` is safe to call at any time. */
export interface Subscription {
  unsubscribe(): void
}

type EventHandler = (event: unknown) => void

interface PendingCommand {
  resolve(result: unknown): void
  reject(err: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface ActiveSubscription {
  payload: Record<string, unknown>
  handler: EventHandler
  /** The id of the in-flight subscribe command, valid until the socket drops. */
  haId: number | null
}

interface ConnectWaiter {
  resolve(): void
  reject(err: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class HaWsClient {
  private readonly url: string
  private readonly token: string
  private logger: Logger
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number
  private readonly timeoutMs: number

  private ws: WebSocket | null = null
  private state: ConnectionState = 'connecting'
  private id = 0
  private attempt = 0
  private closed = false
  /** Set when auth fails: the token is wrong, so reconnecting cannot help. */
  private fatal: Error | null = null
  private starting = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private readonly pending = new Map<number, PendingCommand>()
  private readonly handlers = new Map<number, EventHandler>()
  private readonly subscriptions = new Set<ActiveSubscription>()
  private readonly connectWaiters = new Set<ConnectWaiter>()
  private readonly stateListeners = new Set<(s: ConnectionState) => void>()

  constructor(opts: HaWsClientOptions) {
    this.url = opts.url
    this.token = opts.token
    this.logger = opts.logger ?? silentLogger
    this.reconnectBaseMs = opts.reconnectBaseMs ?? 1000
    this.reconnectMaxMs = opts.reconnectMaxMs ?? 30000
    this.timeoutMs = opts.timeoutMs ?? 10000
  }

  setLogger(logger: Logger): void {
    this.logger = logger
  }

  getState(): ConnectionState {
    return this.state
  }

  onState(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  /**
   * Resolve once authenticated, or reject on a fatal auth error or after the
   * timeout. Starts the socket machinery if it is not already running. Callers
   * (discovery) use this so a wedged Home Assistant surfaces as an error rather
   * than hanging the request.
   */
  connect(timeoutMs: number = this.timeoutMs): Promise<void> {
    if (this.fatal) return Promise.reject(this.fatal)
    if (this.state === 'connected') return Promise.resolve()
    this.ensureStarted()
    return new Promise<void>((resolve, reject) => {
      const waiter: ConnectWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.connectWaiters.delete(waiter)
          reject(new Error('Home Assistant connection timed out'))
        }, timeoutMs),
      }
      if (typeof waiter.timer.unref === 'function') waiter.timer.unref()
      this.connectWaiters.add(waiter)
    })
  }

  /** Send a command and resolve with its `result` payload (rejects on failure). */
  command<T = unknown>(payload: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.state !== 'connected') {
        reject(new Error('Home Assistant is not connected'))
        return
      }
      const msgId = ++this.id
      const timer = setTimeout(() => {
        this.pending.delete(msgId)
        reject(new Error(`Home Assistant command timed out: ${String(payload.type)}`))
      }, this.timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.pending.set(msgId, { resolve: (r) => resolve(r as T), reject, timer })
      this.ws.send(JSON.stringify({ id: msgId, ...payload }))
    })
  }

  /**
   * Subscribe to live events. The handler receives every `event` payload that
   * Home Assistant pushes for the subscribe id. The subscription is restored
   * automatically across reconnects, so the returned handle stays valid even if
   * the socket drops in between.
   */
  subscribe(payload: Record<string, unknown>, handler: EventHandler): Subscription {
    const sub: ActiveSubscription = { payload, handler, haId: null }
    this.subscriptions.add(sub)
    this.ensureStarted()
    if (this.state === 'connected') this.sendSubscribe(sub)
    return {
      unsubscribe: () => {
        this.subscriptions.delete(sub)
        if (sub.haId !== null) {
          this.handlers.delete(sub.haId)
          if (this.state === 'connected') {
            this.command({ type: 'unsubscribe_events', subscription: sub.haId }).catch(() => {
              /* the socket may already be gone; nothing to unsubscribe */
            })
          }
          sub.haId = null
        }
      },
    }
  }

  /** Tear down for good: no further reconnects. */
  close(): void {
    this.closed = true
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.failPending(new Error('Home Assistant client closed'))
    if (this.ws) {
      this.ws.removeAllListeners()
      try {
        this.ws.close()
      } catch {
        /* already closing */
      }
      this.ws = null
    }
  }

  // ---- internals ---------------------------------------------------------

  private ensureStarted(): void {
    if (this.closed || this.fatal) return
    if (this.ws || this.starting) return
    this.open()
  }

  private open(): void {
    this.starting = true
    this.setState('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch (err) {
      this.starting = false
      this.logger.error({ err }, 'Home Assistant WebSocket failed to open')
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.on('message', (data: WebSocket.RawData) => this.onMessage(data))
    ws.on('error', (err) => {
      this.logger.warn({ err: String(err) }, 'Home Assistant WebSocket error')
    })
    ws.on('close', () => this.onClose())
  }

  private onMessage(data: WebSocket.RawData): void {
    let msg: IncomingMessage
    try {
      msg = JSON.parse(data.toString()) as IncomingMessage
    } catch {
      this.logger.warn({}, 'ignoring a malformed Home Assistant frame')
      return
    }

    switch (msg.type) {
      case 'auth_required':
        this.ws?.send(JSON.stringify({ type: 'auth', access_token: this.token }))
        return
      case 'auth_ok':
        this.onAuthOk()
        return
      case 'auth_invalid':
        this.onAuthInvalid((msg as { message?: string }).message ?? 'authentication failed')
        return
      case 'result': {
        const { id, success, result, error } = msg as {
          id: number
          success: boolean
          result?: unknown
          error?: { message?: string }
        }
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        clearTimeout(p.timer)
        if (success) p.resolve(result)
        else p.reject(new Error(error?.message ?? 'Home Assistant command failed'))
        return
      }
      case 'event': {
        const { id, event } = msg as { id: number; event: unknown }
        this.handlers.get(id)?.(event)
        return
      }
      default:
        return
    }
  }

  private onAuthOk(): void {
    this.starting = false
    this.attempt = 0
    this.setState('connected')
    this.logger.info({ url: this.url }, 'authenticated to Home Assistant')
    for (const waiter of this.connectWaiters) {
      clearTimeout(waiter.timer)
      waiter.resolve()
    }
    this.connectWaiters.clear()
    // Re-establish every active subscription under fresh ids.
    for (const sub of this.subscriptions) {
      sub.haId = null
      this.sendSubscribe(sub)
    }
  }

  private onAuthInvalid(message: string): void {
    this.starting = false
    this.fatal = new Error(`Home Assistant rejected the token: ${message}`)
    this.setState('offline')
    this.logger.error({ message }, 'Home Assistant authentication failed (fatal)')
    for (const waiter of this.connectWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(this.fatal)
    }
    this.connectWaiters.clear()
    if (this.ws) {
      this.ws.removeAllListeners()
      try {
        this.ws.close()
      } catch {
        /* already closing */
      }
      this.ws = null
    }
  }

  private onClose(): void {
    this.starting = false
    this.ws = null
    this.handlers.clear()
    for (const sub of this.subscriptions) sub.haId = null
    this.failPending(new Error('Home Assistant connection dropped'))
    if (this.closed || this.fatal) {
      this.setState('offline')
      return
    }
    this.setState('connecting')
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.closed || this.fatal || this.reconnectTimer !== null) return
    const delay = Math.min(this.reconnectBaseMs * 2 ** this.attempt, this.reconnectMaxMs)
    this.attempt += 1
    this.logger.info({ delay, attempt: this.attempt }, 'reconnecting to Home Assistant')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref()
  }

  private sendSubscribe(sub: ActiveSubscription): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const msgId = ++this.id
    sub.haId = msgId
    this.handlers.set(msgId, sub.handler)
    // The result only confirms; events arrive later under the same id. Register a
    // pending entry so a failure (or timeout) is logged rather than swallowed.
    const timer = setTimeout(() => {
      this.pending.delete(msgId)
    }, this.timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.pending.set(msgId, {
      resolve: () => {},
      reject: (err) => this.logger.warn({ err: String(err) }, 'Home Assistant subscription failed'),
      timer,
    })
    this.ws.send(JSON.stringify({ id: msgId, ...sub.payload }))
  }

  private failPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    for (const l of this.stateListeners) l(state)
  }
}
