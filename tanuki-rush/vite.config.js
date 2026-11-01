import { defineConfig } from 'vite';

// base: './' so the built site works under any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
