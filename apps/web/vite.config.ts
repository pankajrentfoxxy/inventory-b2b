import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  optimizeDeps: {
    // Workspace package ships TypeScript source; let Vite treat it as app code.
    exclude: ['@b2b/shared'],
  },
});
