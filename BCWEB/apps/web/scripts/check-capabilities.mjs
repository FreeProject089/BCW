#!/usr/bin/env node
// The permission vocabulary is written twice, and the two copies must agree.
//
// WHY THIS EXISTS
//
// A capability lives in two places that cannot import each other: `CAPABILITIES` in the
// API's lib/lib.mjs, which is what a grant is validated against, and `ADMIN_CAPS` in the
// admin page, which is the only list a human ever sees. The comment above the second one
// has always said "mirrors CAPABILITIES in the API" — and nothing checked it.
//
// It had already drifted. `manage_docs` was in the API and not in the editor: grantable
// through the API, impossible to tick, and therefore a permission nobody could give
// anybody through the interface that exists for giving permissions.
//
// The two failure directions are different and both quiet:
//
//   IN THE API, NOT IN THE EDITOR   the section cannot be delegated at all — the endpoints
//                                   check for a capability no screen can grant
//   IN THE EDITOR, NOT IN THE API   worse: the box ticks, the role saves, the grant is
//                                   stored, and every route rejects it. The person is told
//                                   they have access and does not.
//
// It also checks that a declared capability is ENFORCED somewhere. A capability no route
// asks for is a promise on a checkbox: an admin grants "manage the Discord bot", the
// grantee sees the tab, and every request behind it 403s — or, if the route was left on
// requireRole, silently does not need the grant at all.
//
// WHAT A CAPABILITY REACHES
//
// A guard being present says nothing about whether it is the RIGHT one. The Sept-9 refactor
// converted guards per FILE — every requireRole('ADMIN') in bot.mjs became
// requireCap('manage_bot') — which is correct exactly as long as one file is one section,
// and bot.mjs is not: it also holds /admin/economy/*, the routes that mint the currency the
// Discord shop spends. All three checks above stayed green through it.
//
// So the set of sections each capability guards is recorded. It may shrink freely. A pair
// that is not in the record fails, and the fix is either a different guard or a line in the
// baseline that somebody chose to write.
//
// THE RATCHET
//
// `requireRole('ADMIN')` is the coarse guard: everything or nothing. 201 routes used it
// against 171 behind a capability, so half the admin surface could not be delegated in any
// smaller piece than "the whole site". The count below is a ceiling, not a target — it may
// fall, never rise. A new admin route either takes a capability or moves this number, and
// moving it is a decision somebody has to write down.
//
// Usage: node scripts/check-capabilities.mjs [--update]

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const API = join(WEB, '../api');
const ADMIN_JSX = join(WEB, 'src/pages/admin.jsx');
const LIB = join(API, 'src/lib/lib.mjs');
const ROUTES = join(API, 'src/routes');
const BASELINE = join(HERE, 'capabilities-baseline.json');

/** Capabilities that legitimately have no route of their own, and why. */
const NO_ROUTE_OK = {
  // The three translator scopes gate CONTENT, not endpoints: the blog and docs routes ask
  // "may this user edit this post", and the site one opens a locale editor that writes
  // through the ordinary settings route. There is nothing for requireCap to sit on.
  translate_site: 'opens the runtime-locale editor; writes through the settings route',
  translate_blog: 'checked inside the blog routes against the post, not at the door',
  translate_docs: 'checked inside the docs routes against the page, not at the door',
};

const fail = [];

// ── The two lists ───────────────────────────────────────────────────────────────────────
const lib = readFileSync(LIB, 'utf8');
const capBlock = lib.slice(lib.indexOf('export const CAPABILITIES = ['));
const apiCaps = [...capBlock.slice(0, capBlock.indexOf('];')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
if (apiCaps.length < 5) { console.error('✗ could not read CAPABILITIES from lib.mjs'); process.exit(1); }

const jsx = readFileSync(ADMIN_JSX, 'utf8');
const uiBlock = jsx.slice(jsx.indexOf('const ADMIN_CAPS = ['));
const uiEnd = uiBlock.indexOf('\n];');
const uiSrc = uiBlock.slice(0, uiEnd);
const uiCaps = [...uiSrc.matchAll(/\{\s*id:\s*'([a-z_]+)'/g)].map((m) => m[1]);
if (uiCaps.length < 5) { console.error('✗ could not read ADMIN_CAPS from admin.jsx'); process.exit(1); }

for (const c of apiCaps) {
  if (!uiCaps.includes(c)) {
    fail.push(`"${c}" is in the API's CAPABILITIES and not in ADMIN_CAPS\n`
      + '    the section cannot be delegated — no screen can grant it');
  }
}
for (const c of uiCaps) {
  if (!apiCaps.includes(c)) {
    fail.push(`"${c}" is in ADMIN_CAPS and not in the API's CAPABILITIES\n`
      + '    the box ticks, the role saves, and every route rejects the grant');
  }
}

// ── Every capability has a home in the editor's grouping ────────────────────────────────
const cats = [...jsx.slice(jsx.indexOf('const CAP_CATEGORIES = [')).matchAll(/\{\s*id:\s*'([a-z]+)'/g)].map((m) => m[1]);
for (const m of uiSrc.matchAll(/\{\s*id:\s*'([a-z_]+)'[^}]*?cat:\s*'([a-z]+)'/g)) {
  if (!cats.includes(m[2])) fail.push(`"${m[1]}" is filed under category "${m[2]}", which CAP_CATEGORIES does not have`);
}

// ── Every capability is actually enforced ───────────────────────────────────────────────
const routeFiles = readdirSync(ROUTES).filter((f) => f.endsWith('.mjs'));
const routeSrc = routeFiles.map((f) => readFileSync(join(ROUTES, f), 'utf8')).join('\n');
const libSrc = readFileSync(LIB, 'utf8');
const enforced = new Set([...`${routeSrc}\n${libSrc}`.matchAll(/(?:requireCap|hasCap)\(\s*(?:user|req\.user|[a-z]+),?\s*'([a-z_]+)'|requireCap\('([a-z_]+)'/g)]
  .flatMap((m) => [m[1], m[2]]).filter(Boolean));
for (const c of apiCaps) {
  if (!enforced.has(c) && !(c in NO_ROUTE_OK)) {
    fail.push(`"${c}" is declared and no route or check asks for it\n`
      + '    a grant for it opens a tab whose every request is refused');
  }
}

// ── What each capability reaches ─────────────────────────────────────────
// First two non-parameter segments: /admin/economy/purchases/:id/deliver → /admin/economy.
const sectionOf = (p) => `/${p.split('/').filter((x) => x && !x.startsWith(':')).slice(0, 2).join('/')}`;
const reach = {};
for (const f of routeFiles) {
  const src = readFileSync(join(ROUTES, f), 'utf8');
  // Some files hold their guard in a const (feedback.mjs: READ/WRITE, content-backup.mjs:
  // GUARD). Resolve those, or the routes behind them read as unguarded — which is how a
  // recon script of mine reported 19 imaginary holes before I read the files.
  const alias = new Map([...src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*requireCap\(\s*'([a-z_]+)'/g)]
    .map((m) => [m[1], m[2]]));
  // Bounded at the NEXT route, not at a fixed 400 characters: a window that overruns
  // attributes the following route's guard to this one, and announcements.mjs put a public
  // GET /announcements 9 lines above a guarded one. A gate that mis-reads a guard is worse
  // than no gate -- the same mistake a recon script of mine made over 19 routes.
  const hits = [...src.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g)];
  for (let i = 0; i < hits.length; i++) {
    const m = hits[i];
    const win = src.slice(m.index, Math.min(hits[i + 1]?.index ?? src.length, m.index + 400));
    let cap = win.match(/requireCap\(\s*'([a-z_]+)'/)?.[1];
    if (!cap) {
      const named = win.match(/preHandler:\s*\[?\s*([A-Z][A-Z0-9_]*)/)?.[1];
      if (named && alias.has(named)) cap = alias.get(named);
    }
    if (cap) (reach[cap] ||= new Set()).add(sectionOf(m[1]));
  }
}
const reachNow = Object.fromEntries(Object.entries(reach)
  .map(([c, set]) => [c, [...set].sort()]).sort(([a], [b]) => a.localeCompare(b)));

// A whole-line comment is prose, not a guard. Mine mentioned requireRole by name while
// explaining why the bot token uses it, and that alone moved this count by one — a security
// ratchet you can push by writing a sentence measures nothing. Only whole-line comments are
// dropped: a trailing // after code could swallow a real guard sharing the line.
const code = routeSrc.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ── The ratchet ─────────────────────────────────────────────────────────────────────────
const coarse = (code.match(/requireRole\('ADMIN'\)/g) || []).length;
let baseline = { maxAdminOnlyRoutes: coarse };
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* first run writes it */ }

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ maxAdminOnlyRoutes: coarse, reach: reachNow }, null, 2)}\n`);
  console.log(`baseline written: ${coarse} admin-only route(s), `
    + `${Object.keys(reachNow).length} capabilities over ${Object.values(reachNow).flat().length} section(s)`);
  process.exit(0);
}
for (const [cap, sections] of Object.entries(reachNow)) {
  const known = baseline.reach?.[cap];
  for (const sec of sections) {
    if (known && known.includes(sec)) continue;
    fail.push(`"${cap}" now guards ${sec}, which it did not before\n`
      + `    it is recorded as covering ${known ? known.join(', ') : 'nothing'}.\n`
      + '    A capability that reaches a second section grants more than its name says \u2014 that is\n'
      + '    how manage_bot came to mint currency. Use the right guard, or run --update.');
  }
}
if (coarse > baseline.maxAdminOnlyRoutes) {
  fail.push(`${coarse} routes are requireRole('ADMIN'), up from ${baseline.maxAdminOnlyRoutes}\n`
    + '    an admin-only route cannot be delegated in any smaller piece than the whole site.\n'
    + '    Give the new one a capability, or run --update and say in the commit why not.');
}

if (fail.length) {
  console.error(`✗ capabilities: ${fail.length} problem(s)\n`);
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}

const slack = baseline.maxAdminOnlyRoutes - coarse;
console.log(`✓ capabilities OK — ${apiCaps.length} declared, ${apiCaps.length - Object.keys(NO_ROUTE_OK).length} enforced by a route, `
  + `editor catalogue agrees; ${coarse} admin-only route(s)${slack > 0 ? ` (${slack} below the ceiling — run --update to lower it)` : ''}`);
