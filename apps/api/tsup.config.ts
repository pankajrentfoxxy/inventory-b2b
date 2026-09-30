import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The workspace packages ship TypeScript source, so bundle them in.
  noExternal: ['@b2b/shared', '@b2b/contracts', '@b2b/platform-kit'],
});
