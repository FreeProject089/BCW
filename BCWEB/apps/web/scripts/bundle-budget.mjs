#!/usr/bin/env node
// Bundle-size budget for what EVERY visitor downloads on first load. Run after `vite build`.
//
// Two numbers, two budgets:
//
//   1. the entry chunk (`index-<hash>.js`), as before;
//   2. the TOTAL first-load JS: the entry, every `<link rel="modulepreload">` that Vite
//      wrote into dist/index.html, and every chunk those import statically (recursively).
//      The browser fetches all of those before the app runs, so
//      they are first-load cost exactly like the entry is.
//
// Why the second one exists. Measuring the entry alone lied twice. On Sept 23 the entry read
// 323 KB (budget 430, green) while index.html also preloaded `showcase` (358 KB: a manual
// chunk that had absorbed the i18n dictionaries, react-dom, the router and lucide),
// `vendor-three` (124) and `vendor-gsap` (28): about 838 KB for real. And an attempted
// markdown split made the entry fall to 154 KB while the TOTAL rose to 1029 KB, because a
// manual chunk swallowed what left the entry and was still preloaded. An entry-only gate
// would have called that an improvement. Moving bytes from the entry to a preloaded chunk
// is not a saving, and this gate is what says so.
//
// The dist directory can be overridden (`--dist <dir>` or BUDGET_DIST), so a build written
// elsewhere (`vite build --outDir <dir>`) can be measured without touching ./dist.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// gzip, both. Measured by M18 on Sept 23, 2026 (production build): entry 143 KB, total first
// load 236 KB (entry + showcase 93). Before M18 the entry was 323 and the total 880 (826 in
// preloads + a 54 KB static import nobody preloaded). About 30 % headroom for normal growth.
// If one fails, look at WHICH file grew (listed above the verdict) before raising it: a new
// preload or static import is usually an eager import of something that should arrive later
// (see ui/md-lazy.jsx, hero/fireworks.js, hero/scene-read.js, ui/code-highlight.jsx).
const ENTRY_BUDGET_KB = 190;
const PRELOAD_BUDGET_KB = 300;

const argDist = (() => { const i = process.argv.indexOf('--dist'); return i > 0 ? process.argv[i + 1] : null; })();
const DIST = resolve(argDist || process.env.BUDGET_DIST || join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
const HTML = join(DIST, 'index.html');

if (!existsSync(HTML)) { console.error(`bundle-budget: no build found at ${DIST} (no index.html). Run \`vite build\` first.`); process.exit(1); }
const html = readFileSync(HTML, 'utf8');

// Every script the page loads as a module, and every chunk it asks the browser to preload.
// Attribute order is not fixed, so each tag is matched whole and then read.
const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || [];
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag); return m ? m[1] : null; };
let entrySrc = null;
const preloads = [];
for (const tag of tags) {
  if (/^<script/i.test(tag) && attr(tag, 'type') === 'module' && attr(tag, 'src')) { if (!entrySrc) entrySrc = attr(tag, 'src'); }
  else if (/^<link/i.test(tag) && (attr(tag, 'rel') || '').toLowerCase() === 'modulepreload' && attr(tag, 'href')) preloads.push(attr(tag, 'href'));
}
if (!entrySrc) { console.error('bundle-budget: index.html has no <script type="module" src>; cannot find the entry.'); process.exit(1); }

const gzKB = (href) => {
  const p = join(DIST, href.replace(/^\//, '').split('?')[0]);
  if (!existsSync(p)) { console.error(`bundle-budget: index.html references ${href}, which is not in the build.`); process.exit(1); }
  return gzipSync(readFileSync(p)).length / 1024;
};
const r = (n) => Math.round(n);
const name = (href) => href.split('/').pop();

// …and every chunk the entry (or a preloaded chunk) imports STATICALLY, followed recursively.
// A static import is fetched before the entry can run whether or not index.html preloads it:
// dropping the <link> only turns it into a waterfall. That is how vendor-highlight (54 KB)
// was on every first load while vite.config.js's comment said it only came with a markdown
// document: resolveDependencies had removed its preload, and the entry still imported it.
// Minified output writes them as `import{a as b}from"./x.js"` or `import"./x.js"`; a dynamic
// `import("./x.js")` has a parenthesis and is not matched.
const STATIC_IMPORT = /(?:^|[;}\s])import\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.\/[^"']+\.js)["']/g;
const hrefDir = (href) => href.slice(0, href.lastIndexOf('/') + 1);
/** Everything `roots` import statically, recursively (the roots included). */
function staticClosure(roots, viaImport = null) {
  const seen = new Set(roots);
  const queue = [...seen];
  while (queue.length) {
    const h = queue.shift();
    const p = join(DIST, h.replace(/^\//, ''));
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, 'utf8').matchAll(STATIC_IMPORT)) {
      const dep = hrefDir(h) + m[1].slice(2);
      if (!seen.has(dep)) { seen.add(dep); viaImport?.add(dep); queue.push(dep); }
    }
  }
  return seen;
}
const viaImport = new Set();
const closure = staticClosure([entrySrc, ...preloads], viaImport);

const entryKB = gzKB(entrySrc);
const uniq = [...closure].filter((h) => h !== entrySrc);
const rows = uniq.map((h) => ({ h, kb: gzKB(h) })).sort((a, b) => b.kb - a.kb);
const totalKB = entryKB + rows.reduce((s, x) => s + x.kb, 0);

console.log(`bundle-budget: entry ${name(entrySrc)} = ${r(entryKB)} KB gzip (budget ${ENTRY_BUDGET_KB})`);
for (const x of rows) console.log(`  + ${viaImport.has(x.h) ? 'static import (NOT preloaded: a waterfall)' : 'modulepreload'} ${name(x.h)} = ${r(x.kb)} KB`);
console.log(`bundle-budget: total first-load JS = ${r(totalKB)} KB gzip (budget ${PRELOAD_BUDGET_KB}, ${1 + rows.length} files)`);
// Per-language extra: the French dictionary is preloaded only when the saved language is
// French (an inline script that vite.config.js injects). Reported, not counted above.
const fr = /l\.href='(\/assets\/i18n-fr-[\w-]+\.js)'/.exec(html);
if (fr) console.log(`  (French visitors also fetch ${name(fr[1])} = ${r(gzKB(fr[1]))} KB, in parallel with the entry)`);

let fail = false;
if (entryKB > ENTRY_BUDGET_KB) {
  console.error(`\n✖ entry chunk ${r(entryKB)} KB exceeds the ${ENTRY_BUDGET_KB} KB budget by ${r(entryKB - ENTRY_BUDGET_KB)} KB.`);
  console.error('  Something heavy is loading eagerly: route-split it (React.lazy) or defer it. See guides/PERF_AUDIT_EN.md §1.');
  fail = true;
}
if (totalKB > PRELOAD_BUDGET_KB) {
  console.error(`\n✖ total first-load JS ${r(totalKB)} KB exceeds the ${PRELOAD_BUDGET_KB} KB budget by ${r(totalKB - PRELOAD_BUDGET_KB)} KB.`);
  console.error('  The entry, every <link rel="modulepreload"> in index.html and every chunk they import statically is what a first visit downloads.');
  console.error('  Check which file grew (listed above). A manual chunk takes its static dependencies with it, and an eager import of it drags the lot in.');
  fail = true;
}
// three.js stays LAZY (PLAN-STUDIO-2026, phase 4). A studio page can have a 3D background, drawn
// by hero/ScenePreview.jsx through a dynamic import in ui/canvas-background.jsx, and the studio
// itself shows every background. One static import of the scene from either (the entry-chunk
// hoist trap: a chunk imported eagerly anywhere is dragged up) and ~120 KB gzip ride along with every studio page and
// every visit. So: vendor-three must not be in the first load, nor in what the studio route or
// the page renderer load before a 3D background is actually drawn. And the check proves it can
// see three at all: the scene chunk must reach it, or the answer "absent" means nothing.
const ASSETS = join(DIST, 'assets');
const assetJs = existsSync(ASSETS) ? readdirSync(ASSETS).filter((f) => f.endsWith('.js')) : [];
const threeChunks = assetJs.filter((f) => /^vendor-three-[\w-]+\.js$/.test(f)).map((f) => `/assets/${f}`);
const lazyRoots = assetJs.filter((f) => /^(?:studio|canvas-view|canvas-studio|canvas-background)-[\w-]+\.js$/.test(f)).map((f) => `/assets/${f}`);
const sceneChunks = assetJs.filter((f) => /^ScenePreview-[\w-]+\.js$/.test(f)).map((f) => `/assets/${f}`);
const hasThree = (set) => threeChunks.some((h) => set.has(h));
if (!threeChunks.length || !sceneChunks.length || !lazyRoots.some((h) => /\/studio-(?!page-)/.test(h)) || !lazyRoots.some((h) => h.includes('/canvas-view-'))) {
  console.error(`\n✖ three.js check: could not find the chunks it measures (vendor-three: ${threeChunks.length}, ScenePreview: ${sceneChunks.length}, studio/canvas-view: ${lazyRoots.map(name).join(', ') || 'none'}). Refusing to report success.`);
  fail = true;
} else {
  if (!sceneChunks.some((h) => hasThree(staticClosure([h])))) {
    console.error('\n✖ three.js check: the 3D scene chunk does not import vendor-three, so this check cannot see three at all.');
    fail = true;
  }
  if (hasThree(closure)) {
    console.error('\n✖ three.js is in the first load (the entry, a modulepreload or one of their static imports). It must arrive only with the 3D scene.');
    fail = true;
  }
  for (const root of lazyRoots) {
    if (hasThree(staticClosure([root]))) {
      console.error(`\n✖ ${name(root)} imports three.js statically: the studio and a studio page must not load it until a 3D background is drawn (ui/canvas-background.jsx loads it lazily).`);
      fail = true;
    }
  }
  if (!fail) console.log(`three.js: absent from the first load and from ${lazyRoots.map(name).join(', ')}; reached only through the 3D scene chunk.`);
}
if (fail) process.exit(1);
console.log('bundle-budget OK');
