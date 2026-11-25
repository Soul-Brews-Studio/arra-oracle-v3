import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const env = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
const proxyTarget = env?.FRONTEND_PROXY_TARGET ?? 'http://127.0.0.1:47778';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@soul-brews/canvas-plugins': new URL('../packages/canvas-plugins/src/index.ts', import.meta.url).pathname,
    },
  },
  build: {
    // hub.html is the arra hub UI (#3110), served at /hub by the backend.
    rollupOptions: { input: { main: new URL('./index.html', import.meta.url).pathname, hub: new URL('./hub.html', import.meta.url).pathname } },
  },
  server: {
    port: Number(env?.VITE_PORT ?? 3000),
    strictPort: true,
    proxy: {
      '/api': proxyTarget,
    },
  },
});
