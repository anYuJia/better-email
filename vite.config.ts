import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 17420,
    strictPort: true,
    host: '127.0.0.1',
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2020',
    minify: 'esbuild',
  },
  test: {
    environment: 'jsdom',
    // The mock backend, localStorage, and jsdom globals are process-scoped.
    // Running files concurrently makes the full release gate flaky even though
    // each affected test passes in isolation.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
