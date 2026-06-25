/*
 * Bundle the Fastify backend to a single runnable file for the runtime image.
 *
 * Runtime dependencies (fastify and its plugins) are kept external and resolved
 * from the production node_modules the image installs, so the output is just our
 * server code plus the shared domain modules it imports. The output is CommonJS
 * with a .cjs extension so Node runs it regardless of the package "type".
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist-server/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
})
