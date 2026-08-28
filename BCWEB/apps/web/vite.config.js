import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxies /api -> the API container so the SPA + API share an origin.
export default defineConfig({
  plugins: [react()],
  // Dev server prefers :5176 (the site's base URL); if that's taken — e.g. the
  // Docker Caddy is already serving on 5176 — Vite falls back to the next free port
  // instead of hard-failing. Proxies /api to the local API.
  // NOTE the `rewrite` STRIPS the /api prefix: the API registers routes WITHOUT it
  // (e.g. `/health`, `/auth/login`) and in production Caddy's `handle_path /api/*`
  // strips the prefix before proxying. Without this rewrite every dev API call 404s.
  //
  // The target was hard-coded to :3000, which is right only when the API happens to have got
  // that port. Compose publishes it as a RANGE — `ports: ["3000-3009:3000"]`, so `--scale
  // api=3` does not collide — and Docker hands out the next free one, so an already-busy 3000
  // puts the API on 3007 and every dev-server API call is ECONNREFUSED. The page still
  // renders: each request is caught and falls back, so what you get is the site with no data
  // and a console full of 500s, which reads as a broken app rather than a wrong port.
  //
  // BCWEB_API_URL overrides it. Same default, so nothing changes for the common case.
  server: {
    port: 5176,
    proxy: {
      '/api': {
        target: process.env.BCWEB_API_URL || 'http://localhost:3000',
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
    // Vite adds a <link rel="modulepreload"> for chunks it expects the entry to need.
    // vendor-highlight is fetched only when a markdown document is rendered, so preloading
    // it puts the 55kB (gzipped) syntax highlighter back on the first-load path that making
    // its import dynamic just removed it from. Everything else keeps its preload.
    modulePreload: {
      resolveDependencies: (_url, deps) => deps.filter((d) => !d.includes('vendor-highlight')),
    },
    rollupOptions: {
      output: {
        // Only carve out the heavy, self-contained libraries into their own
        // hashed chunks (three.js is 470 KB alone). React + everything else stays
        // with the app code — trying to split react out created a circular chunk
        // (some vendor lib imports react which imports back into vendor).
        manualChunks(id) {
          // Our own files come first, and only where leaving it to Rollup measurably hurts.
          //
          // ProjectShowcase is dynamically imported by BOTH an eager page (home.jsx) and a
          // lazy one (dev.jsx). Left alone, Rollup answers that by rebalancing — and what it
          // chose was to pull the whole of dev.jsx UP into the entry chunk, so every visitor
          // downloaded the developer hub. +6 KB gzip on the entry, 5 over budget, and the
          // sourcemap named the culprit (457 entry modules → 458, the new one being
          // dev.jsx). Naming the chunk pins it and the rebalancing stops.
          if (id.includes('/hero/ProjectShowcase')) return 'showcase';
          if (!id.includes('node_modules')) return;
          if (id.includes('three')) return 'vendor-three';
          if (id.includes('rrweb')) return 'vendor-rrweb';
          if (id.includes('jszip')) return 'vendor-jszip';
          if (id.includes('gsap')) return 'vendor-gsap';
          // highlight.js ships a grammar per language and rehype-highlight pulls the lot in.
          // It was landing in the ENTRY chunk, so every visitor downloaded a syntax
          // highlighter to read a page that may contain no code at all. Split out, it is
          // fetched with the markdown renderer that actually needs it.
          if (id.includes('highlight.js') || id.includes('lowlight') || id.includes('rehype-highlight')) return 'vendor-highlight';
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
