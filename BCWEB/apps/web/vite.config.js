import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxies /api -> the API container so the SPA + API share an origin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } } },
});
