/*
 * Runtime configuration for the Zone Studio backend.
 *
 * The server reads its settings from the environment so the s6 launch script
 * (which sources the add-on options via bashio) is the single place that maps
 * Home Assistant options to the process. Tests construct a ServerConfig
 * directly instead of going through the environment.
 */

/** Levels accepted by the add-on `log_level` option (see config.yaml schema). */
export type HaLogLevel = 'trace' | 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'fatal'

/** Levels understood by Fastify's pino logger. */
export type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

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
}

/** The fixed Supervisor ingress peer address (documented by Home Assistant). */
export const INGRESS_IP = '172.30.32.2'

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

/** Build a ServerConfig from process.env, applying the add-on defaults. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.INGRESS_PORT ?? 8099),
    host: '0.0.0.0',
    allowAll: env.ALLOW_ALL_ORIGINS === '1',
    ingressIp: env.INGRESS_IP ?? INGRESS_IP,
    logLevel: toPinoLevel(env.LOG_LEVEL),
    staticRoot: env.STATIC_ROOT,
  }
}
