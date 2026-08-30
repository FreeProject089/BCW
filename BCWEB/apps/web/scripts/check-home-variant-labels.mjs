#!/usr/bin/env node
// The same three landing pages, named twice.
//
// What a landing-page variant is CALLED, held in one place.
//
// The admin's home editor offered "The long one", with a sentence explaining who that page
// is for. A second screen offered "The long landing page", with no sentence at all — the same
// page, two vocabularies, in two files, and nothing rendering them side by side. Whichever
// list anybody edited, the other went stale silently. That second screen is gone; the meta
// module and this check outlived it, and both still earn their place the moment a third
// screen offers the list again.
//
// So the names live in one module and this holds the arrangement in place:
//   · the ids in that module are exactly the ids the API declares — no card for a variant
//     the site cannot be set to, and no variant that quietly has no card;
//   · neither screen writes its own list back.
import { readFileSync, existsSync } from 'node:fs';

const META = 'src/lib/home-variants-meta.js';
const API = '../api/src/routes/misc.mjs';
// Every screen that lets somebody pick a landing page. A new one belongs on this list.
const SCREENS = ['src/pages/admin.jsx'];

for (const f of [META, API, ...SCREENS]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}

const meta = readFileSync(META, 'utf8');
const api = readFileSync(API, 'utf8');

// ── the ids the module offers ──
const listAt = meta.indexOf('export const homeVariantList');
if (listAt < 0) { console.error('✗ homeVariantList moved — this check cannot be trusted'); process.exit(2); }
const metaIds = [...meta.slice(listAt).matchAll(/\bv:\s*'([^']+)'/g)].map((m) => m[1]);

// ── the ids the API declares ──
const varAt = api.indexOf('export const HOME_VARIANTS');
if (varAt < 0) { console.error('✗ HOME_VARIANTS moved — this check cannot be trusted'); process.exit(2); }
const apiIds = [...api.slice(varAt, api.indexOf('\n};', varAt)).matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);

if (metaIds.length < 2 || apiIds.length < 2) {
  console.error(`✗ read ${metaIds.length} label(s) and ${apiIds.length} variant(s) — too few to be right`);
  process.exit(2);
}

const problems = [];
for (const id of apiIds) if (!metaIds.includes(id)) problems.push(`the site can be set to "${id}" and no screen has a name for it`);
for (const id of metaIds) if (!apiIds.includes(id)) problems.push(`"${id}" is offered as a landing page and the API does not declare it`);

// ── neither screen keeps its own copy ──
for (const f of SCREENS) {
  const src = readFileSync(f, 'utf8');
  if (!/homeVariantList/.test(src)) problems.push(`${f} does not read the shared list`);
  // A second `t('hp.v…')` anywhere but the module is the list being written again. The
  // strings are quoted from the module deliberately: this is the one file allowed to hold
  // them, and grepping for the key is how the copy announces itself.
  const own = [...src.matchAll(/t\('hp\.v\d[^']*'/g)].length;
  if (own) problems.push(`${f} writes ${own} variant label(s) of its own — they belong in ${META}`);
}

if (problems.length) {
  console.error('✗ home variant labels:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  A landing page is chosen by its description, not by "v2". Two screens describing');
  console.error('  the same three pages differently is one of them being wrong, and neither says so.');
  process.exit(1);
}
console.log(`✓ home variant labels OK — ${metaIds.length} page(s) named once (${metaIds.join(', ')}), read by ${SCREENS.length} screen(s)`);
