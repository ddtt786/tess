import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  server: { port: 5173, host: '127.0.0.1' },
  build: { outDir: '../demo-dist', emptyOutDir: true },
});
