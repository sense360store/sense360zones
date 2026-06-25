import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs are required for Home Assistant ingress: the app is
  // served under /api/hassio_ingress/<token>/, so absolute (slash-prefixed)
  // asset paths would drop the prefix and 404.
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // In development the SPA runs on Vite and the backend on 8099. Proxy the
    // API and WebSocket so the same relative URLs the app uses under ingress
    // also work locally.
    proxy: {
      '/api': 'http://localhost:8099',
      '/ws': { target: 'ws://localhost:8099', ws: true },
    },
  },
})
