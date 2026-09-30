import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser talks to the gateway (http://localhost:4010), which routes /api/v1/* to the services
// and everything else to the legacy API. Override with VITE_PROXY_TARGET when needed.
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:4010';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: proxyTarget, changeOrigin: true },
      '/health': { target: proxyTarget, changeOrigin: true },
    },
  },
  optimizeDeps: {
    // Workspace package ships TypeScript source; let Vite treat it as app code.
    exclude: ['@b2b/shared', '@b2b/contracts'],
  },
});
