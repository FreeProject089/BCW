// Demo mode — the site shown with believable content, without touching real data.
//
// ══════════════════════════════════════════════════════════════════════════════════════
// THE MODEL, AND WHY
// ══════════════════════════════════════════════════════════════════════════════════════
//
// The honest question is whether demo mode WRITES demo rows into the real tables or SERVES
// a synthetic overlay. This is an overlay, and it writes exactly ONE row: a session marker.
//
//   · Demo content is not stored. It is a pure function of a random `seed`, produced by
//     `generateCatalogItems` below — the same generator `npm run seed:demo` imports, so there
//     is one body of fixtures and not two. Reload the page and the catalogue is identical,
//     because the seed is.
//   · The only row demo mode creates anywhere is `AdminSetting['demo.session']`, ~300 bytes:
//     { id, seed, n, startedAt, startedBy, expiresAt, label }. Nothing else, in any table.
//     It is identified by its KEY (a column), in a namespace only an admin can write: the
//     generic `PUT /admin/settings/:key` refuses `demo.*` (see `isDemoKey`), so the one way
//     in is `startDemo`, behind `requireRole('ADMIN')` in routes/demo.mjs.
//   · Demo actions (publish this, ban that) are recorded in an in-process list keyed by
//     session id, capped, and dropped on stop, on restart, or as soon as the session they
//     belong to is no longer the live one. They never reach Postgres.
//
// WHY NOT WRITE ROWS. Tagged rows in the real tables would mean a `NOT demo` filter on every
// public read path — the catalogue feed, the blog index, the profile pages, the sitemap, the
// OG renderer, the Discord bot, the analytics rollup. That is one rule written twenty times,
// and this repo has already been bitten by a visibility rule written twice diverging (the
// staff-only poll tally that went public the moment the poll closed). One forgotten filter is
// a leak of fake content into a real visitor's view. Worse, there is no column to tag with:
// the only free-form place on a content row is `meta`, which users write themselves
// (`meta: z.record(z.any())` on submit), so a "demo" marker there is one a real user can
// type — and a cleanup keyed on it would delete their content. Here there is no filter to
// forget and nothing to delete by guesswork: no public route reads `demo.*`, and demo items
// exist only in the response body of a route behind `requireRole('ADMIN')`. Isolation is
// structural, not maintained.
//
// WHAT IT COSTS, AND WHAT IT CAN NEVER DO. Being an overlay, demo mode does not exercise the
// production read path: the admin sees the real UI fed by a demo endpoint, not the real
// queries. So it can never demonstrate a genuine search ranking, a real cache hit, a real
// permission check against a real row, or a paid flow end to end. A demo "publish" changes an
// in-memory list and is gone on restart. If a demo ever needs to prove the real pipeline
// works, the tool for that is `npm run seed:demo` against a DEV database — a separate,
// deliberate act by somebody at a terminal, not a button in the live dashboard.
//
// WHY NOT STORE THE GENERATED DATASET IN THAT ROW. Several readers (`pruneAuditLog`'s settings
// cache, `grantPlan`, catalog/blog/docs `settings()`) do `adminSetting.findMany()` with no
// `where` and build an object of every row. A few hundred kB of demo catalogue parked in that
// table would be dragged through memory on unrelated code paths. A seed is 8 bytes.
//
// HOW THE SITE IS RETURNED TO NORMAL. `stopDemo()` deletes every `AdminSetting` key starting
// with `demo.` and clears the in-process lists. That is the whole of it, and `demoAudit()`
// exists to prove it by counting, afterwards, every place demo mode can put something. Both
// THROW on a database error rather than reporting zero: "it is off" and "nothing is left"
// are claims, and a claim made because the query failed is the one lie this module must
// never tell. A session also expires on its own: reading one past `expiresAt` removes it, so
// an unattended demo does not stay up for ever.
//
// ══════════════════════════════════════════════════════════════════════════════════════
// THE THREE THINGS THAT MUST NOT HAPPEN
// ══════════════════════════════════════════════════════════════════════════════════════
//
// Demo mode is not a site-wide sandbox: turning it on changes nothing for anybody but the
// admin looking at the demo screens. Real users keep getting real mail and real checkouts,
// which is correct — so there is nothing to "suppress", only nothing to CALL. The guarantee
// is that no code path starting in demo mode reaches a side-effecting service:
//
//   NO REAL STRIPE CHARGE.  Neither this file nor routes/demo.mjs imports the Stripe client,
//     routes/hosting.mjs, or anything that does. No demo object carries a Stripe id; the
//     billing panel is `provider: 'demo'`. A demo catalogue item has an id (`demo-item-N`)
//     that no checkout route can look up, because it is not a row.
//   NO REAL E-MAIL.  `sendMail`/`mail.mjs` is not imported here or by the routes, and every
//     generated address is at `demo.invalid` (RFC 6761: guaranteed never to resolve). Demo
//     accounts are not rows, so no digest, newsletter or notification sweeper can enumerate
//     them. The audit entry the routes write goes through `logAudit`, whose only side channel
//     is an in-app notification to SUPERADMINs, and only for actions matching its
//     SENSITIVE_ACTION list — `demo.*` is not on it.
//   NO DISCORD BOT CONNECTION.  The bot lives in routes/bot.mjs and is never imported from
//     demo mode; guild figures are numbers from the seeded PRNG. No token, no gateway, no
//     webhook post, no `fetch` at all.
//
// `test/demo-mode.test.mjs` asserts all three by reading the import lists of this file and
// routes/demo.mjs, and asserts at runtime that the routes' only database WRITES are on
// `adminSetting`. A comment promising a boundary is worth what checking it costs.
import crypto from 'node:crypto';
import { safeEqual } from './lib.mjs';

/** The one settings key demo mode owns. Everything demo-related starts with `demo.`. */
export const DEMO_KEY = 'demo.session';
export const DEMO_PREFIX = 'demo.';
/** Stamped on every generated object in a RESPONSE, so a demo object that reached a real
 *  screen is identifiable by a field. It is never written to a table — see the header for why
 *  a tag in `meta` would be forgeable — and nothing is ever deleted by it. */
export const DEMO_TAG = '__bcweb_demo__';
/** RFC 6761 reserved: an address here can never be delivered. */
export const DEMO_MAIL_DOMAIN = 'demo.invalid';

export const MAX_MINUTES = 8 * 60;
export const MAX_ITEMS = 400;
const MAX_OVERLAY = 200;
const ID_SHAPE = /^dm_[0-9a-f]{32}$/;

/** Is this settings key demo mode's? The generic settings writer refuses these. */
export function isDemoKey(key) {
  return typeof key === 'string' && key.startsWith(DEMO_PREFIX);
}

// ── The fixture generator, shared with seed-demo.mjs ─────────────────────────────────────
// This is the single body of demo fixtures. `seed:demo` turns these objects into CatalogItem
// rows in a dev database; demo mode serves them as JSON and stores none of them. The SHAPE is
// the part that matters and the comment that guards it lives in seed-demo.mjs: only PLUGIN
// items carry `meta.validation`, because only plugins are ever re-checked.

/** Deterministic PRNG. Two runs of the same seed produce the same site. */
export function makeRng(seed = 42) {
  let s = (Number(seed) >>> 0) || 42;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return {
    rnd,
    pick: (a) => a[Math.floor(rnd() * a.length)],
    int: (min, max) => min + Math.floor(rnd() * (max - min + 1)),
    // Long tail: most items near zero, a few big hits — so "order by downloads" behaves
    // like the real feed instead of a uniform block.
    longTail: (max) => Math.floor(max * Math.pow(rnd(), 3.2)),
  };
}

export const ADJ = ['Better', 'Ultra', 'Quick', 'Smart', 'Neon', 'Turbo', 'Simple', 'Advanced', 'Compact', 'Lite', 'Pro', 'Nova'];
export const NOUN = ['Manager', 'Loader', 'Toolkit', 'Inspector', 'Bridge', 'Overlay', 'Sync', 'Tweaks', 'Panel', 'Helper', 'Suite', 'Studio'];
export const TAGS = ['utility', 'ui', 'performance', 'qol', 'graphics', 'audio', 'modding', 'tools', 'automation', 'experimental'];
export const CATS = ['utility', 'graphics', 'audio', 'gameplay', 'other'];

/**
 * The catalogue, as plain objects. No database, no ids, no ownership — the caller decides
 * what those are, which is the whole difference between the seeder and demo mode.
 *
 * `at` fixes the timestamps so the output is fully deterministic (the seeder passes `new
 * Date()`; demo mode passes the session's start, so a reload does not renumber the site).
 */
export function generateCatalogItems({ seed = 42, n = 400, at = new Date() } = {}) {
  const { rnd, pick, int, longTail } = makeRng(seed);
  const checkedAt = new Date(at).toISOString();
  const out = [];
  for (let i = 0; i < n; i++) {
    const kind = pick(['APP', 'APP', 'APP', 'PLUGIN', 'PLUGIN', 'THEME', 'PRESET']); // apps dominate, like the real catalog
    const projectKey = kind === 'PRESET' ? 'bsm' : pick(['bmm', 'bmm', 'bmm', 'community']);
    const name = `${pick(ADJ)} ${pick(NOUN)} ${i}`;
    // Most content is live; a realistic slice is still awaiting or failed moderation.
    const status = rnd() < 0.82 ? 'PUBLISHED' : pick(['PENDING', 'PENDING', 'REJECTED', 'HIDDEN']);
    const size = int(80_000, 40_000_000);

    const meta = {
      category: pick(CATS),
      price: rnd() < 0.9 ? 'free' : 'paid',
      file_type: kind === 'PLUGIN' ? 'bmmplug' : kind === 'THEME' ? 'bmmtheme' : kind === 'PRESET' ? 'json' : 'exe',
      size,
      download_url: `https://cdn.example.invalid/demo/${i}/${kind.toLowerCase()}.bin`,
      images: { thumb: `https://cdn.example.invalid/demo/${i}/thumb.png` },
      requirements: rnd() < 0.3 ? 'Windows 10+' : null,
    };

    // THE shape that matters: only plugins are ever re-checked, so only plugins carry
    // `validation`. Everything else legitimately has none.
    if (kind === 'PLUGIN') {
      const r = rnd();
      if (r < 0.08) meta.validation = { valid: false, reason: 'checksum mismatch', checkedAt };
      else if (r < 0.16) meta.validation = { unverified: true, reason: 'download url unreachable', checkedAt };
      else meta.validation = { valid: true, sha256: 'f'.repeat(64), files: int(3, 40), checkedAt };
    }

    out.push({
      projectKey, kind, status, name,
      slug: `demo-${kind.toLowerCase()}-${i}`,
      description: `${name} — demo catalog content generated by lib/demo.mjs for local development, load testing and the admin demo mode.`,
      tags: Array.from(new Set([pick(TAGS), pick(TAGS)])),
      version: `${int(0, 3)}.${int(0, 9)}.${int(0, 9)}`,
      payloadSize: size,
      meta,
      downloads: longTail(250_000),
      views: longTail(900_000),
    });
  }
  return out;
}

// ── The session ─────────────────────────────────────────────────────────────────────────

const overlays = new Map(); // sessionId -> [{ at, action, note }]

const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

const shape = (s) => ({
  id: s.id, seed: s.seed, n: s.n, label: s.label || null,
  startedAt: s.startedAt, startedBy: s.startedBy || null, expiresAt: s.expiresAt,
  expiresInSec: Math.max(0, Math.round((new Date(s.expiresAt).getTime() - Date.now()) / 1000)),
});
export { shape as publicSession };

/**
 * A stored session, checked. Returns null for anything startDemo could not have written.
 *
 * The row is JSON in a table other code can reach (an SQL console, a settings import, a
 * future route), so it is not trusted just because it is there: `n: 1e9` would make the data
 * route build a billion objects, and an `expiresAt` in 2099 would make a demo that never
 * ends. The limits are re-applied on the way OUT, not only on the way in.
 */
function normalize(v) {
  if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !ID_SHAPE.test(v.id)) return null;
  const started = Date.parse(v.startedAt); const expires = Date.parse(v.expiresAt);
  if (!Number.isFinite(started) || !Number.isFinite(expires)) return null;
  const seed = Number(v.seed);
  if (!Number.isInteger(seed) || seed < 1 || seed > 0x7fffffff) return null;
  return {
    id: v.id, seed,
    n: clamp(v.n, 1, MAX_ITEMS, 120),
    label: v.label ? String(v.label).slice(0, 80) : null,
    startedAt: new Date(started).toISOString(),
    startedBy: typeof v.startedBy === 'string' ? v.startedBy : null,
    expiresAt: new Date(Math.min(expires, started + MAX_MINUTES * 60_000)).toISOString(),
  };
}

/** Forget every in-process list that does not belong to `keepId`. Another API process may
 *  have started or stopped the demo; the list for a session that is no longer the live one
 *  is unreachable, and this is where it stops taking memory. */
function pruneOverlays(keepId) {
  for (const id of overlays.keys()) if (id !== keepId) overlays.delete(id);
}

/**
 * The live session, or null.
 *
 * Expiry is LAZY and destructive: a session read past its `expiresAt` is deleted here and
 * reported as absent. An unattended demo therefore turns itself off, and "off" is the same
 * state whether a human pressed stop or the clock ran out — there is no second kind of off
 * to reason about. A row that is not a well-formed session is removed the same way.
 *
 * Database errors propagate. Answering "off" because the read failed would let the status
 * route tell an admin the demo is gone when nobody knows.
 */
export async function readDemoSession(p) {
  const row = await p.adminSetting.findUnique({ where: { key: DEMO_KEY } });
  if (!row) { pruneOverlays(null); return null; }
  const s = normalize(row.value);
  if (!s || Date.parse(s.expiresAt) <= Date.now()) { await stopDemo(p); return null; }
  pruneOverlays(s.id);
  return s;
}

/** Start (or restart) demo mode. Replacing a session drops the old overlay with it. */
export async function startDemo(p, { byUserId = null, minutes = 60, items = 120, label = null } = {}) {
  const n = clamp(items, 1, MAX_ITEMS, 120);
  const mins = clamp(minutes, 1, MAX_MINUTES, 60);
  const session = {
    id: `dm_${crypto.randomUUID().replace(/-/g, '')}`,
    // Not the session id: the id is presented by the client on every data call, so deriving
    // content from it would make the content guessable from a value that travels. A separate
    // random seed keeps "what the demo looks like" out of anything that is transmitted.
    seed: crypto.randomInt(1, 0x7fffffff),
    n,
    label: label ? String(label).slice(0, 80) : null,
    startedAt: new Date().toISOString(),
    startedBy: byUserId,
    expiresAt: new Date(Date.now() + mins * 60_000).toISOString(),
  };
  await p.adminSetting.upsert({ where: { key: DEMO_KEY }, create: { key: DEMO_KEY, value: session }, update: { value: session } });
  pruneOverlays(session.id);
  overlays.set(session.id, []);
  return session;
}

/**
 * Turn it off, completely. Idempotent: stopping a site that is not in demo mode is a no-op
 * that still reports success, because "make sure it is off" must never be a thing that fails
 * for a reason that is not a failure.
 *
 * `startsWith('demo.')` rather than the one key by name, so a future demo key added by
 * somebody who forgets to update this function is still removed.
 *
 * It does NOT swallow a database error. The previous draft caught it and returned
 * `{ settings: 0 }` — which is exactly the output of a successful stop on a clean site, so a
 * failed delete read as proof that nothing had been there.
 */
export async function stopDemo(p) {
  const removed = await p.adminSetting.deleteMany({ where: { key: { startsWith: DEMO_PREFIX } } });
  const overlayCount = overlays.size;
  overlays.clear();
  return { settings: removed.count, overlays: overlayCount };
}

/**
 * Is anything demo left anywhere? The proof behind "turning it off is complete".
 *
 * It counts every place demo mode can put something — `demo.*` settings keys and the
 * in-process lists — and `clean` is true only when both are zero. Errors propagate.
 *
 * What it deliberately does NOT count: rows in the content tables "tagged" demo. Demo mode
 * never writes one (the test proves that at runtime by recording every write the routes
 * make), and there is no tag to count them by that a real user could not also produce —
 * `meta` is user-written JSON, and a `demo-` slug or `demo-…@` address is a name anybody can
 * pick. A check keyed on those would let one user make `clean` false for ever, and would
 * invite somebody to "fix" that with a delete keyed on it.
 *
 * `seededItems` is informational: the dev seeder's rows (`npm run seed:demo`), which are not
 * demo mode's and are removed by `npm run clear-demo`, never by `stopDemo`.
 */
export async function demoAudit(p) {
  const settings = await p.adminSetting.count({ where: { key: { startsWith: DEMO_PREFIX } } });
  const seededItems = await p.catalogItem.count({ where: { slug: { startsWith: 'demo-' } } });
  return {
    clean: settings === 0 && overlays.size === 0,
    settings, overlays: overlays.size,
    seededItems,
  };
}

/**
 * Does the id the caller presented match the live session?
 *
 * `safeEqual`, never `===`. A stale id from a previous demo must not work, which is why this
 * compares against the CURRENT session and not merely "some session exists": a tab left open
 * on last week's demo gets a 409 instead of silently showing this week's.
 */
export function sessionMatches(session, presented) {
  if (!session?.id || !presented) return false;
  return safeEqual(session.id, presented);
}

// ── The dataset ─────────────────────────────────────────────────────────────────────────

const FIRST = ['Alex', 'Robin', 'Sam', 'Noa', 'Kai', 'Mira', 'Jules', 'Ines', 'Theo', 'Lena', 'Ravi', 'Yuki'];
const LAST = ['Fischer', 'Moreau', 'Kowalski', 'Nakamura', 'Silva', 'Okafor', 'Novak', 'Bergström', 'Rossi', 'Dubois'];

/**
 * Everything demo mode shows, as one deterministic object.
 *
 * Every record carries `__bcweb_demo__: true`, and every id is `demo-<kind>-<n>` — a shape
 * no real row has (real ids are cuids), so an id from this dataset presented to a real route
 * finds nothing.
 */
export function buildDemoData(session) {
  const s = normalize(session);
  if (!s) throw new Error('buildDemoData: not a demo session');
  const { rnd, pick, int, longTail } = makeRng(s.seed);
  const at = s.startedAt;
  const tag = { [DEMO_TAG]: true };

  const users = Array.from({ length: 12 }, (_, i) => ({
    ...tag,
    id: `demo-user-${i}`,
    displayName: `${pick(FIRST)} ${pick(LAST)}`,
    // .invalid is reserved by RFC 6761 and can never resolve — a demo address is
    // undeliverable by construction, not by us remembering not to send to it.
    email: `demo-${i}@${DEMO_MAIL_DOMAIN}`,
    role: i === 0 ? 'ADMIN' : i < 3 ? 'MOD' : 'USER',
    createdAt: new Date(Date.parse(at) - int(1, 900) * 86_400_000).toISOString(),
    points: longTail(40_000),
    level: int(1, 60),
  }));

  // Generated with the session's start as the clock, so the catalogue does not renumber
  // itself every time the page is refreshed.
  const catalog = generateCatalogItems({ seed: s.seed, n: s.n, at }).map((it, i) => ({
    ...tag, ...it, id: `demo-item-${i}`, ownerId: pick(users).id,
    createdAt: new Date(Date.parse(at) - int(1, 600) * 86_400_000).toISOString(),
  }));

  const posts = Array.from({ length: 8 }, (_, i) => ({
    ...tag,
    id: `demo-post-${i}`,
    slug: `demo-post-${i}`,
    title: `${pick(ADJ)} ${pick(NOUN)} — what changed`,
    excerpt: 'Demo article. Generated for a presentation; it is not stored and is visible only inside demo mode.',
    authorId: pick(users).id,
    publishedAt: new Date(Date.parse(at) - i * 5 * 86_400_000).toISOString(),
    reactions: int(0, 240),
  }));

  // 30 days of traffic, shaped like a week (weekends lower) so a chart looks like a chart.
  const analytics = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.parse(at) - (29 - i) * 86_400_000);
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    const base = int(700, 1500) * (weekend ? 0.6 : 1);
    return { ...tag, date: day.toISOString().slice(0, 10), views: Math.round(base), visitors: Math.round(base * (0.4 + rnd() * 0.2)), downloads: Math.round(base * 0.12) };
  });

  return {
    ...tag,
    session: shape(s),
    // Named so no screen can render this dataset believing it to be real without the word
    // "demo" being available to put on it.
    banner: 'DEMO MODE — every figure on this screen is generated and stored nowhere.',
    users,
    catalog,
    posts,
    analytics,
    // A Discord panel with no bot behind it: numbers, not a gateway connection.
    discord: { ...tag, connected: false, guildName: 'Demo Community', members: int(400, 9000), online: int(20, 400), note: 'generated; demo mode never connects the bot' },
    // A billing panel with no Stripe behind it: `provider: 'demo'` is not a payment processor.
    billing: { ...tag, provider: 'demo', mrr: int(200, 2400), subscriptions: int(10, 180), note: 'generated; demo mode never calls Stripe' },
    totals: { users: users.length, catalog: catalog.length, published: catalog.filter((c) => c.status === 'PUBLISHED').length, posts: posts.length },
    overlay: overlays.get(s.id) || [],
  };
}

/**
 * A demo action. It is recorded in memory and changes nothing — the response says so in
 * words, so a screen cannot report "saved" for something that was not.
 */
export function applyDemoAction(session, action, note = '') {
  const list = overlays.get(session.id) || [];
  const entry = { [DEMO_TAG]: true, at: new Date().toISOString(), action: String(action).slice(0, 60), note: String(note || '').slice(0, 200), persisted: false };
  list.push(entry);
  if (list.length > MAX_OVERLAY) list.splice(0, list.length - MAX_OVERLAY);
  overlays.set(session.id, list);
  return { ...entry, overlaySize: list.length, detail: 'recorded in memory for this demo only; nothing was written to the database' };
}

/** Test seam: the in-process overlay count, without reaching into module state. */
export function overlayCount() { return overlays.size; }
