import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxies /api -> the API container so the SPA + API share an origin.
export default defineConfig({
  plugins: [react()],
  // Dev server prefers :5176 (the site's base URL); if that's taken — e.g. the
  // Docker Caddy is already serving on 5176 — Vite falls back to the next free port
  // instead of hard-failing. Proxies /api to the local API (run apps/api on :3000).
  // NOTE the `rewrite` STRIPS the /api prefix: the API registers routes WITHOUT it
  // (e.g. `/health`, `/auth/login`) and in production Caddy's `handle_path /api/*`
  // strips the prefix before proxying. Without this rewrite every dev API call 404s.
  server: {
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    // Split the heavy, rarely-changing libraries into their own hashed chunks so
    // (a) the main app chunk shrinks and parses faster on first paint, and (b)
    // each vendor lib is cached independently — an app code change no longer
    // busts three.js/rrweb/etc. Previously everything was one 1.67 MB chunk.
    rollupOptions: {
      output: {
        // Only carve out the heavy, self-contained libraries into their own
        // hashed chunks (three.js is 470 KB alone). React + everything else stays
        // with the app code — trying to split react out created a circular chunk
        // (some vendor lib imports react which imports back into vendor).
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('three')) return 'vendor-three';
          if (id.includes('rrweb')) return 'vendor-rrweb';
          if (id.includes('jszip')) return 'vendor-jszip';
          if (id.includes('gsap')) return 'vendor-gsap';
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
