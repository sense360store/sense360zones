/*
 * Runtime configuration for the Zone Studio backend.
 *
 * The server reads its settings from the environment so the s6 launch script
 * (which sources the add-on options via bashio) is the single place that maps
 * Home Assistant options to the process. Tests construct a ServerConfig
 * directly instead of going through the environment.
 */
import os from 'node:os'
import path from 'node:path'

/** Levels accepted by the add-on `log_level` option (see config.yaml schema). */
export type HaLogLevel = 'trace' | 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'fatal'

/** Levels understood by Fastify's pino logger. */
export type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/** Which DataProvider the server runs behind the routes. */
export type ProviderKind = 'mock' | 'ha'

export interface ServerConfig {
  /** TCP port. The add-on always exposes ingress on 8099. */
  port: number
  /** Host to bind. Always 0.0.0.0 inside the container. */
  host: string
  /** When true the ingress peer guard is disabled (local development only). */
  allowAll: boolean
  /** The Supervisor ingress peer address. Only this peer is allowed in production. */
  ingressIp: string
  /** Logger level, already mapped to a pino level. */
  logLevel: PinoLevel
  /** Directory of the built SPA. When unset or missing, static serving is skipped. */
  staticRoot?: string
  /** The data provider. `ha` talks to Home Assistant; `mock` runs the simulation. */
  provider: ProviderKind
  /** Home Assistant WebSocket API URL (the `ha` provider connects here). */
  haWsUrl: string
  /** Writable directory for the mapping and mount record. `/data` inside the add-on. */
  dataDir: string
  /**
   * Pattern (a regular expression source) that recognises a Sense360 identity in a
   * device's manufacturer or model. When at least one ESPHome device matches,
   * discovery prefers the matching devices and marks them as known Sense360
   * hardware; otherwise it falls back to the full ESPHome candidate list.
   */
  sense360Match: string
}

/** The fixed Supervisor ingress peer address (documented by Home Assistant). */
export const INGRESS_IP = '172.30.32.2'

/** The Supervisor-provided Home Assistant WebSocket endpoint inside an add-on. */
export const DEFAULT_HA_WS_URL = 'ws://supervisor/core/websocket'

/**
 * Default data directory. Inside the add-on this is `/data`, a persistent volume
 * the Supervisor mounts. That path does not exist in development or tests, so off
 * the production path we fall back to a temporary directory.
 */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'production') return '/data'
  return path.join(os.tmpdir(), 'sense360-zone-studio')
}

/** Map a Home Assistant log level to the nearest pino level. */
export function toPinoLevel(level: string | undefined): PinoLevel {
  switch (level) {
    case 'trace':
    case 'debug':
    case 'info':
    case 'error':
    case 'fatal':
      return level
    case 'notice':
      return 'info'
    case 'warning':
      return 'warn'
    default:
      return 'info'
  }
}

/** Resolve the provider kind. Anything other than `mock` is treated as `ha`. */
export function toProviderKind(value: string | undefined): ProviderKind {
  return value === 'mock' ? 'mock' : 'ha'
}

/** Build a ServerConfig from process.env, applying the add-on defaults. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.INGRESS_PORT ?? 8099),
    host: '0.0.0.0',
    allowAll: env.ALLOW_ALL_ORIGINS === '1',
    ingressIp: env.INGRESS_IP ?? INGRESS_IP,
    logLevel: toPinoLevel(env.LOG_LEVEL),
    staticRoot: env.STATIC_ROOT,
    provider: toProviderKind(env.PROVIDER),
    haWsUrl: env.HA_WS_URL ?? DEFAULT_HA_WS_URL,
    dataDir: env.DATA_DIR ?? defaultDataDir(env),
    sense360Match: env.SENSE360_MATCH ?? 'sense360',
  }
}
