import { defineConfig } from 'vite';

// base: './' so the built site works under any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  // Permit the sandbox's HTTPS preview hostname while keeping Vite's host check.
  server: { host: '0.0.0.0', port: 5173, allowedHosts: ['.e2b.app'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
