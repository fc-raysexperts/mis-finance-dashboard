import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // http-proxy's default proxyTimeout is 120000ms (2 minutes) — too
        // short for the NPD endpoints, which can legitimately take longer
        // than that for busy parks like Dechu on a cold cache. Extending to
        // 5 minutes to match the Vercel maxDuration ceiling we set for the
        // same endpoints, so local dev doesn't cut off requests that would
        // otherwise succeed.
        timeout: 300000,
        proxyTimeout: 300000,
      }
    }
  }
})
