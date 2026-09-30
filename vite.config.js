import { defineConfig } from 'vite'

// Browsers cannot call api.otter.ai directly (CORS). The dev server proxies
// /otter-api/* to https://api.otter.ai/* and forwards the bearer token.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 41721,
    strictPort: true,
    proxy: {
      '/otter-api': {
        target: 'https://api.otter.ai',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/otter-api/, ''),
      },
    },
  },
})
