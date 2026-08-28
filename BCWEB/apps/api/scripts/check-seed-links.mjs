// Every internal link in the SEEDED content has to lead somewhere.
//
// The blog posts, the docs, the site guide and the FAQ are shipped: they are written into
// every install by `npm run seed:content`, and their markdown is full of
// `:::card{href=/docs/…}` blocks and `[text](/…)` links. A slug that gets renamed, or a card
// pointing at a page nobody ever wrote, is invisible from here — the seed succeeds, the page
// renders, the card looks like a card. It only fails for a reader, one click in, on an
// install that is not ours.
//
// So the three lists are checked against each other:
//
//   · the routes App.jsx declares
//   · the doc slugs the doc seeds create (seed-docs.mjs AND seed-site-guide.mjs — the second
//     is where the five `site-*` pages come from, and a check that only reads files with
//     "doc" in the name reports all five as broken)
//   · every internal link in every seed
//
// Two things are deliberately NOT treated as broken, because they are not web routes: an
// `/api/...` path, which the API serves (`/api/assets/setup.exe` is a real download), and a
// parameterised route like `/r/:id`, matched by shape.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = join(HERE, '..');
const SRC = join(API, 'src');
const APP = join(API, '../web/src/App.jsx');

if (!existsSync(APP)) {
  console.error(`✗ ${APP} is missing — refusing to report success`);
  process.exit(2);
}

const seeds = readdirSync(SRC).filter((f) => /^seed.*\.mjs$/.test(f));
const blob = new Map(seeds.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));

const routes = [...readFileSync(APP, 'utf8').matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
// Doc slugs, from every seed that creates a docPage — not from a filename guess.
const slugs = new Set();
for (const [, s] of blob) {
  if (!/docPage/.test(s)) continue;
  for (const m of s.matchAll(/slug:\s*'([a-z0-9-]+)'/g)) slugs.add(m[1]);
}

if (routes.length < 20 || slugs.size < 10) {
  console.error(`✗ read ${routes.length} route(s) and ${slugs.size} doc slug(s) — too few to be right, so this check cannot be trusted`);
  process.exit(2);
}

const params = routes.filter((r) => r.includes(':')).map((r) => new RegExp(`^${r.replace(/:[^/]+/g, '[^/]+')}$`));
const exact = new Set(routes);

const resolves = (u) => {
  const path = (u.split('?')[0].split('#')[0].replace(/\/$/, '')) || '/';
  if (path.startsWith('/api/')) return true;   // served by the API, not routed by the SPA
  if (exact.has(path)) return true;
  if (path.startsWith('/docs/')) return slugs.has(path.slice('/docs/'.length));
  return params.some((re) => re.test(path));
};

const found = new Map();
for (const [f, s] of blob) {
  for (const m of s.matchAll(/href=(\/[A-Za-z0-9/_?=#.-]*)/g)) {
    if (!found.has(m[1])) found.set(m[1], new Set());
    found.get(m[1]).add(f);
  }
  for (const m of s.matchAll(/\]\((\/[A-Za-z0-9/_?=#.-]*)\)/g)) {
    if (!found.has(m[1])) found.set(m[1], new Set());
    found.get(m[1]).add(f);
  }
}

if (found.size < 10) {
  console.error(`✗ found ${found.size} link(s) in ${seeds.length} seed file(s) — the markdown idiom moved and this check no longer reads it`);
  process.exit(2);
}

const bad = [...found].filter(([u]) => !resolves(u));
if (bad.length) {
  console.error('✗ seeded content links nowhere:');
  // `.map(basename)` here passed the ARRAY INDEX as path.basename's `suffix` and crashed
  // the error path — so the one run that had something to say died before saying it.
  // These are already bare filenames from readdirSync; there was nothing to strip.
  for (const [u, files] of bad) console.error(`  ${u}  (in ${[...files].join(', ')})`);
  console.error('\nEvery install gets this content. A card pointing at a page nobody wrote is a dead');
  console.error('link on somebody else\'s site, and it looks exactly like a working one until clicked.');
  process.exit(1);
}

console.log(`✓ seeded links OK — ${found.size} internal link(s) across ${seeds.length} seed(s), against ${routes.length} route(s) and ${slugs.size} doc slug(s)`);
