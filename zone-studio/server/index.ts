/*
 * Entry point for the bundled runtime image.
 *
 * It selects a DataProvider (Phase 1: the mock), builds the Fastify app from the
 * environment, and binds 0.0.0.0:8099. Phase 2 changes only the provider line.
 */
import { buildServer } from './app'
import { configFromEnv } from './config'
import { MockDataProvider } from './provider/MockDataProvider'

async function main() {
  const cfg = configFromEnv()
  const provider = new MockDataProvider()
  const app = await buildServer(cfg, provider)

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
