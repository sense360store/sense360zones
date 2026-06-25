import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests inject a fake location and use Node's global fetch/WebSocket, so no
    // browser DOM environment is needed.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
