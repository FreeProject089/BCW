import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// B.MD lives in packages/bmd — a real npm package (its own package.json, README, docs, CHANGELOG)
// that this app consumes IN PLACE. Not through node_modules: there is no root workspace in this
// repo (each app installs on its own), so a `file:` link would leave the kit's own imports —
// react, react-markdown… — with no node_modules above them. Two things make the in-place read
// work: the alias below maps the package name onto the folder, and `resolve.dedupe` tells Vite
// to resolve those bare names from THIS app's root rather than from the importing file's
// directory. The result is one React, one renderer, and a kit that is also a package.
const BMD = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/bmd/src');
const BMD_DEPS = ['react', 'react-dom', 'react-markdown', 'remark-gfm', 'remark-directive', 'rehype-raw', 'rehype-sanitize',
  'unist-util-visit', 'lucide-react', 'rehype-highlight', 'remark-math', 'rehype-katex', 'katex',
  'unified', 'remark-parse', 'mermaid',
];

// Which port the API container actually got. Compose publishes it as a RANGE
// (`ports: ["3000-3009:3000"]`, so `--scale api=3` does not collide) and Docker hands out the
// next FREE one — an already-busy 3000 puts the API on 3005 and a proxy pinned to 3000 gets
// ECONNREFUSED for every call. The site still renders, because each request is caught and
// falls back, so what you get is every page showing its offline state at once: it reads as a
// broken app, and the port is the last thing anyone suspects.
//
// So probe the range once at dev-server start instead of guessing. BCWEB_API_URL still wins
// outright, and a failed probe keeps the old :3000 default rather than refusing to start.
async function findApi() {
  if (process.env.BCWEB_API_URL) return process.env.BCWEB_API_URL;
  for (let port = 3000; port <= 3009; port++) {
    const url = `http://localhost:${port}`;
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 400);
      const r = await fetch(`${url}/live`, { signal: ac.signal }).finally(() => clearTimeout(to));
      if (r.ok) { if (port !== 3000) console.log(`[vite] API found on :${port}`); return url; }
    } catch { /* next port */ }
  }
  console.warn('[vite] no API answered on :3000-3009 — proxying to :3000 anyway');
  return 'http://localhost:3000';
}

/**
 * Google's ownership tag, written into the HTML the server sends.
 *
 * The site also sets it from JavaScript (lib/seo.js, from /api/seo), which is enough for a
 * visitor and for the SEO health card, but Search Console's HTML-tag check reads the page
 * as served: a tag that only exists after the bundle runs is a tag it may never see, and
 * then verification fails with "tag not found" while the admin screen shows it set.
 *
 * So when the token is known at BUILD time it goes straight into <head> here, without
 * touching index.html (which is the owner's file). The runtime copy in lib/seo.js still
 * runs; setMeta() updates an existing tag rather than adding a second one.
 *
 * Only a token is accepted, not markup: the value lands inside an HTML attribute, so
 * anything outside the token alphabet is dropped rather than escaped. The API's seoToken()
 * uses the same alphabet, so a value accepted there is accepted here.
 */
function verificationTag() {
  const raw = String(process.env.VITE_GOOGLE_SITE_VERIFICATION || process.env.GOOGLE_SITE_VERIFICATION || '').trim();
  const m = /content\s*=\s*["']([^"']*)["']/i.exec(raw);
  const tok = (m ? m[1] : raw).trim();
  const ok = /^[A-Za-z0-9_\-.=+/]{1,200}$/.test(tok);
  return {
    name: 'bcweb-google-verification',
    transformIndexHtml() {
      return ok ? [{ tag: 'meta', attrs: { name: 'google-site-verification', content: tok }, injectTo: 'head-prepend' }] : [];
    },
  };
}

/**
 * The PWA: a manifest link in <head>, and a service worker built from the real bundle.
 *
 * Same reason as verificationTag() above for going through a plugin: index.html is the
 * owner's file. The <link rel="manifest"> is injected here; the manifest itself is a static
 * file in public/ because nothing in it depends on the build.
 *
 * The WORKER does depend on the build, which is the whole point of generating it:
 *
 *   · it precaches the app shell and the exact hashed chunks the offline destination needs.
 *     The 404 page is a lazily imported route, so "offline lands on the 404 page with the
 *     game playable" is only true if that chunk AND everything it imports are in the cache
 *     before the network goes away. A hand-written list cannot name them: the file names
 *     carry a content hash that changes whenever the code does.
 *   · the cache names carry a build id, so `activate` drops every cache from every previous
 *     build in one sweep and two builds can never be mixed.
 *
 * scripts/sw-source.js holds the worker's code and the caching policy it implements, written
 * out. This function only fills in the two placeholders and emits the result as dist/sw.js.
 * Read the generated file after a build if you want to check the list: it is plain and short.
 */
function bcwebPwa() {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), 'scripts/sw-source.js');
  // Unhashed files that are part of the shell's first paint or of the installed-app identity.
  // world.json (1 MB, the globe on the analytics map) is deliberately NOT here: it is not on
  // any path to the offline page, and precaching it would cost every visitor a megabyte on
  // install to make one admin screen work offline.
  const STATIC = ['/manifest.webmanifest', '/logo.png', '/logo-white.webp', '/icons/maskable.svg'];
  // Which lazily imported routes must survive offline. The 404 page is the offline
  // destination (the owner's call), so its chunk is not optional.
  // M18 (agent-perf-M18): plus the 3D backdrop. three.js used to be a static import of the
  // entry, so this walk precached it without being asked; it is lazy now (main.jsx prefetches
  // it), and without this line an offline page would try to fetch it, fail, and reload once.
  // The French dictionary is deliberately NOT here: 262 KB on every install for one language
  // (the runtime asset cache keeps it after a French visitor's first online load).
  const OFFLINE_ROUTES = ['pages/notfound.jsx', 'hero/Hero3D.jsx'];
  return {
    name: 'bcweb-pwa',
    transformIndexHtml() {
      return [{ tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' }];
    },
    generateBundle(_opts, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
      const byName = new Map(chunks.map((c) => [c.fileName, c]));
      const wanted = new Set();
      // Walk a chunk and everything it STATICALLY imports. Dynamic imports are left out on
      // purpose: following those from the entry would drag in every route on the site and
      // turn a precache into a full mirror.
      const walk = (chunk, seen = new Set()) => {
        if (!chunk || seen.has(chunk.fileName)) return;
        seen.add(chunk.fileName);
        wanted.add('/' + chunk.fileName);
        for (const css of chunk.viteMetadata?.importedCss || []) wanted.add('/' + css);
        for (const imp of chunk.imports || []) walk(byName.get(imp), seen);
      };
      for (const c of chunks) if (c.isEntry) walk(c);
      for (const route of OFFLINE_ROUTES) {
        const hit = chunks.find((c) => c.facadeModuleId && c.facadeModuleId.replace(/\\/g, '/').endsWith(route));
        if (hit) walk(hit);
        else this.warn(`[bcweb-pwa] no chunk for ${route}: the offline page will not work offline`);
      }
      for (const s of STATIC) wanted.add(s);
      // A build id that changes only when the output does, so a rebuild of identical sources
      // does not needlessly evict every visitor's asset cache.
      const list = [...wanted].sort();
      const build = createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12);
      // replaceAll, not replace. The worker's own header comment NAMES both placeholders
      // while explaining them, so a single-occurrence replace substituted the prose and left
      // the code holding `const BUILD = '__BUILD_ID__'` and `const PRECACHE = __PRECACHE__`.
      // That builds green and emits a file: the worker then throws on its first line at
      // install time, silently, and the only symptom is a site that never caches anything.
      const source = readFileSync(SRC, 'utf8')
        .replaceAll('__BUILD_ID__', build)
        .replaceAll('__PRECACHE__', JSON.stringify(list, null, 2));
      if (source.includes('__BUILD_ID__') || source.includes('__PRECACHE__')) {
        this.error('[bcweb-pwa] a placeholder survived substitution in sw.js');
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/**
 * M18 (agent-perf-M18): preload the French dictionary, for French visitors only.
 *
 * DICT.fr is a chunk of its own (src/i18n-fr.js, imported on demand by i18n.jsx), and main.jsx
 * holds a French visitor's first render until it has arrived. Left to the dynamic import, its
 * fetch would only START once the entry has downloaded and run: one extra round trip, on the
 * critical path, for exactly the visitors it is meant to serve. A static <link modulepreload>
 * would put it back on EVERY visitor's first load, which is what moving it out undid.
 *
 * So a few bytes of inline script in <head> read the saved language and add the preload only
 * when it is French; the chunk then downloads in parallel with the entry. The site's CSP allows
 * inline scripts (infra/caddy/Caddyfile, script-src 'unsafe-inline'). Injected here rather than
 * written into index.html, which is the owner's file, and because the name carries a hash.
 */
function bcwebLangPreload() {
  return {
    name: 'bcweb-lang-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const chunk = Object.values(ctx.bundle || {}).find((c) => c.type === 'chunk'
          && c.facadeModuleId && c.facadeModuleId.replace(/\\/g, '/').endsWith('/src/i18n-fr.js'));
        if (!chunk) return [];
        const href = '/' + chunk.fileName;
        if (!/^\/[\w./-]+\.js$/.test(href)) return [];
        const code = `try{if(localStorage.getItem('bcw_lang')==='fr'){var l=document.createElement('link');`
          + `l.rel='modulepreload';l.crossOrigin='';l.href='${href}';document.head.appendChild(l)}}catch(e){}`;
        return [{ tag: 'script', attrs: { 'data-lang-preload': 'fr' }, children: code, injectTo: 'head' }];
      },
    },
  };
}

// Dev proxies /api -> the API container so the SPA + API share an origin.
export default defineConfig(async () => ({
  plugins: [react(), verificationTag(), bcwebPwa(), bcwebLangPreload()],
  resolve: {
    alias: [
      { find: /^@bettercommunity\/bmd$/, replacement: `${BMD}/index.jsx` },
      { find: /^@bettercommunity\/bmd\/config$/, replacement: `${BMD}/config.js` },
      { find: /^@bettercommunity\/bmd\/brands$/, replacement: `${BMD}/brands.jsx` },
      { find: /^@bettercommunity\/bmd\/icons$/, replacement: `${BMD}/icons.jsx` },
      { find: /^@bettercommunity\/bmd\/plugins$/, replacement: `${BMD}/plugins.js` },
      { find: /^@bettercommunity\/bmd\/openapi$/, replacement: `${BMD}/openapi.js` },
      { find: /^@bettercommunity\/bmd\/export$/, replacement: `${BMD}/export.jsx` },
      { find: /^@bettercommunity\/bmd\/ast$/, replacement: `${BMD}/ast.js` },
      { find: /^@bettercommunity\/bmd\/editor-blocks$/, replacement: `${BMD}/editor-blocks.js` },
      { find: /^@bettercommunity\/bmd\/links$/, replacement: `${BMD}/links.js` },
      { find: /^@bettercommunity\/bmd-editor$/, replacement: `${BMD}/../../bmd-editor/src/index.jsx` },
      { find: /^@bettercommunity\/bmd-editor\/snippets$/, replacement: `${BMD}/../../bmd-editor/src/snippets.js` },
      { find: /^@bettercommunity\/bmd-editor\/block-canvas$/, replacement: `${BMD}/../../bmd-editor/src/block-canvas.jsx` },
      { find: /^@bettercommunity\/bmd-editor\/editor\.css$/, replacement: `${BMD}/../../bmd-editor/src/editor.css` },
      { find: /^@bettercommunity\/bmd\/markdown\.css$/, replacement: `${BMD}/markdown.css` },
      { find: /^@bettercommunity\/bmd\/src\/(.*)$/, replacement: `${BMD}/$1` },
    ],
    dedupe: BMD_DEPS,
  },
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
        target: await findApi(),
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
    // M18 (agent-perf-M18): there used to be a modulePreload.resolveDependencies here that
    // dropped the <link rel="modulepreload"> of vendor-highlight, "fetched only when a markdown
    // document is rendered". It was not: that manual chunk (below, now removed) had absorbed
    // the small unist/hast utilities the renderer shares with it, so the ENTRY imported
    // vendor-highlight statically, and removing the preload only made its 54 KB a waterfall
    // on every first load. scripts/bundle-budget.mjs now counts static imports too.
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
          // M18 (agent-perf-M18): no 'vendor-highlight' chunk any more. rehype-highlight is
          // imported dynamically by the renderer (packages/bmd/src/index.jsx), which is all it
          // takes for Rollup to keep highlight.js and its grammars out of the first load. Naming
          // a manual chunk did the opposite: Rollup puts a manual chunk's static dependencies
          // IN it, so it took unist-util-visit & co. with it and the entry had to import it.
          // (The same mechanism made 'showcase' swallow the i18n dictionaries.)
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
}));
