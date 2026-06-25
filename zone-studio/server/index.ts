/*
 * Entry point for the bundled runtime image.
 *
 * It selects a DataProvider from the environment, builds the Fastify app, and
 * binds 0.0.0.0:8099. PROVIDER selects the provider: `ha` (the default) talks to
 * Home Assistant; `mock` runs the simulation, which keeps the Phase 1 container
 * smoke test working without a Home Assistant.
 */
import { buildServer } from './app'
import { configFromEnv } from './config'
import type { DataProvider } from './provider/DataProvider'
import { HaDataProvider } from './provider/HaDataProvider'
import { MockDataProvider } from './provider/MockDataProvider'

async function main() {
  const cfg = configFromEnv()

  // For `ha`, the Supervisor injects SUPERVISOR_TOKEN into the add-on
  // environment; it is read here, where the provider is built, rather than in the
  // shared config.
  const haProvider = cfg.provider === 'ha'
    ? new HaDataProvider({
        wsUrl: cfg.haWsUrl,
        token: process.env.SUPERVISOR_TOKEN ?? '',
        dataDir: cfg.dataDir,
      })
    : null
  const provider: DataProvider = haProvider ?? new MockDataProvider()

  const app = await buildServer(cfg, provider)
  // Give the HA provider the server logger so detection and connection events
  // appear in the add-on log with the operator's configured level.
  haProvider?.attachLogger(app.log)
  app.log.info({ provider: cfg.provider, haWsUrl: cfg.provider === 'ha' ? cfg.haWsUrl : undefined }, 'data provider selected')

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down')
    provider.dispose?.()
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  try {
    await app.listen({ host: cfg.host, port: cfg.port })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

void main()
