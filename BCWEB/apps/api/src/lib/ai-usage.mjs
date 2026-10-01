// AI usage analytics (aios, agent-bcw-ai-os): how much the AI layer is used, how fast it
// answers, how often it fails, what it costs — and NEVER what was said.
//
// Same shape as lib/apiusage.mjs, for the same reason: counts accumulate in memory and are
// flushed on a timer, so a call to a model never waits on a statistics write, and a burst of
// calls costs one upsert per (day, feature, provider) per flush. A hard crash loses at most
// FLUSH_MS of counts, which is the right way round.
//
// What a row may hold: counters, a latency histogram, token counts and an estimated cost.
// What it may NOT hold, by construction: a text, an excerpt, a hash of a text, a URL, a key.
// recordAi() takes named numbers and short enum strings and drops everything else, so a caller
// that passes the whole request by mistake still stores nothing of it.
//
// Latency percentiles: every call lands in one of LAT_BOUNDS' buckets. p50/p95 over any time
// range is then the sum of the rows' arrays and a walk up the cumulative count — exact to a
// bucket, which is what a dashboard needs, and it never keeps a single raw timing.
// lib.mjs is imported lazily, at flush time: ai.mjs imports this file, and ai.mjs is loaded by
// unit tests that never touch a database.
const db = async () => (await import('./lib.mjs')).db();

const FLUSH_MS = 15_000;
/** Upper bounds (ms) of the latency buckets; the last bucket is "slower than all of these". */
export const LAT_BOUNDS = Object.freeze([50, 100, 200, 400, 800, 1500, 3000, 6000, 12000, 30000]);
export const OUTCOMES = Object.freeze(['ok', 'failed', 'timeout', 'dropped', 'rateLimited', 'cacheHit', 'breakerOpen', 'breakerRefused', 'killed', 'disabled', 'badAnswer']);
// accepted / rejected: a member applied an AI suggestion, or dismissed it (unticked a tag,
// closed the draft without using it). A count per (day, feature, provider), never what it was.
export const EVENTS = Object.freeze(['changed', 'falsePositive', 'confirmed', 'accepted', 'rejected']);
export const PROVIDERS = Object.freeze(['laya', 'external', 'byok', 'site', 'rules', 'off']);

const FEATURE_RE = /^[a-z][a-z0-9_:.-]{0,47}$/;
const cleanFeature = (f) => { const s = String(f || '').toLowerCase().slice(0, 48); return FEATURE_RE.test(s) ? s : 'other'; };
const cleanProvider = (p) => (PROVIDERS.includes(p) ? p : 'off');
const nonNeg = (v, max = 1e9) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(max, n) : 0; };
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** The bucket index for one latency. */
export function bucketOf(ms) {
  const n = nonNeg(ms, 1e7);
  for (let i = 0; i < LAT_BOUNDS.length; i++) if (n <= LAT_BOUNDS[i]) return i;
  return LAT_BOUNDS.length;
}

/** A histogram (any length, missing = 0) → the bucket's upper bound at percentile p. */
export function percentileFromHist(hist, p) {
  // Array.from, not map: map skips the holes of a sparse array and leaves them undefined.
  const h = Array.isArray(hist) ? Array.from(hist, (x) => nonNeg(x)) : [];
  const total = h.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const want = Math.max(1, Math.ceil((p / 100) * total));
  let run = 0;
  for (let i = 0; i < h.length; i++) {
    run += h[i];
    if (run >= want) return i < LAT_BOUNDS.length ? LAT_BOUNDS[i] : LAT_BOUNDS[LAT_BOUNDS.length - 1] * 2;
  }
  return LAT_BOUNDS[LAT_BOUNDS.length - 1] * 2;
}

/** Add histogram b into a (lengths may differ). Pure. */
export function addHist(a = [], b = []) {
  const n = Math.max(a.length, b.length, LAT_BOUNDS.length + 1);
  return Array.from({ length: n }, (_, i) => nonNeg(a[i]) + nonNeg(b[i]));
}

// The admin's token prices (ai.features pricing), pushed here by lib/ai-features.mjs whenever it
// reads its settings, so this file never has to read a setting itself.
let _pricing = { external: { inPerMTok: 0, outPerMTok: 0 }, site: { inPerMTok: 0, outPerMTok: 0 } };
export function setAiPricing(pr) { if (pr && pr.external && pr.site) _pricing = pr; }

// ── The in-memory buffer ────────────────────────────────────────────────────────────────────
const rows = new Map();   // `${day}|${feature}|${provider}` → aggregate
const users = new Map();  // `${userId}|${day}|${feature}` → { calls, tokens, costUsd }
let timer = null;
let flushing = null;
const MAX_KEYS = 5000;    // a flood of invented feature names cannot grow this without bound

function rowFor(day, feature, provider) {
  const k = `${day}|${feature}|${provider}`;
  let r = rows.get(k);
  if (!r) {
    if (rows.size >= MAX_KEYS) return null;
    r = { day, feature, provider, latencySumMs: 0, latencyHist: [], tokensIn: 0, tokensOut: 0, costUsd: 0, calls: 0 };
    for (const o of OUTCOMES) r[o] = 0;
    for (const e of EVENTS) r[e] = 0;
    rows.set(k, r);
  }
  return r;
}

/**
 * Record one AI call (or one call that never happened: killed, rate-limited, cached…).
 * Never throws, never awaits. `userId` is optional and only feeds the per-user daily table.
 *
 * @param {{ feature: string, provider: string, outcome: string, latencyMs?: number,
 *           tokensIn?: number, tokensOut?: number, costUsd?: number, userId?: string|null }} e
 */
export function recordAi(e = {}) {
  try {
    const outcome = OUTCOMES.includes(e.outcome) ? e.outcome : 'failed';
    const day = dayKey();
    const r = rowFor(day, cleanFeature(e.feature), cleanProvider(e.provider));
    if (!r) return;
    r[outcome] += 1;
    // A "call" is a request that actually went to a provider. A cache hit, a refusal by a rate
    // limit or the kill switch cost nothing and are counted apart.
    const wentOut = outcome === 'ok' || outcome === 'failed' || outcome === 'timeout' || outcome === 'badAnswer';
    if (wentOut) {
      r.calls += 1;
      const ms = nonNeg(e.latencyMs, 1e7);
      r.latencySumMs += Math.round(ms);
      const b = bucketOf(ms);
      while (r.latencyHist.length <= b) r.latencyHist.push(0);
      r.latencyHist[b] += 1;
    }
    const tin = Math.round(nonNeg(e.tokensIn, 1e7));
    const tout = Math.round(nonNeg(e.tokensOut, 1e7));
    // A caller that knows its cost passes it (the generative calls); the moderation pipeline's
    // external calls only know their size, priced here from the admin's per-million figures.
    const cost = e.costUsd != null ? nonNeg(e.costUsd, 1e4)
      : r.provider === 'external' ? (tin * _pricing.external.inPerMTok + tout * _pricing.external.outPerMTok) / 1_000_000 : 0;
    r.tokensIn += tin; r.tokensOut += tout; r.costUsd += cost;
    const uid = typeof e.userId === 'string' && /^[a-z0-9]{8,40}$/i.test(e.userId) ? e.userId : null;
    if (uid && (wentOut || outcome === 'cacheHit')) {
      const k = `${uid}|${day}|${r.feature}`;
      const u = users.get(k) || (users.size < MAX_KEYS ? { userId: uid, day, feature: r.feature, calls: 0, tokens: 0, costUsd: 0 } : null);
      if (u) { u.calls += 1; u.tokens += tin + tout; u.costUsd += cost; users.set(k, u); }
    }
    schedule();
  } catch { /* statistics must never break a call */ }
}

/** Record a decision-level event: the AI changed a moderation decision, a human judged it, or
 *  a member accepted / rejected a suggestion. `n` (1..50) counts several at once (three tags
 *  applied out of four suggested = accepted 3, rejected 1). */
export function recordAiEvent(feature, event, provider = 'laya', n = 1) {
  try {
    if (!EVENTS.includes(event)) return;
    const r = rowFor(dayKey(), cleanFeature(feature), cleanProvider(provider));
    if (!r) return;
    r[event] += Math.max(1, Math.min(50, Math.round(Number(n) || 1)));
    schedule();
  } catch { /* never */ }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flushAiUsage().catch(() => {}); }, FLUSH_MS);
  timer.unref?.();
}

/** Write everything buffered. Called on the timer, on shutdown, and by the tests. */
export async function flushAiUsage(client = null) {
  if (flushing) { try { await flushing; } catch { /* the previous one's problem */ } }
  if (!rows.size && !users.size) return { rows: 0, users: 0 };
  const pendingRows = [...rows.values()];
  const pendingUsers = [...users.values()];
  rows.clear(); users.clear();
  flushing = (async () => {
    const p = client || await db();
    for (const r of pendingRows) {
      const day = new Date(`${r.day}T00:00:00.000Z`);
      const where = { day_feature_provider: { day, feature: r.feature, provider: r.provider } };
      const counters = {};
      for (const k of [...OUTCOMES, ...EVENTS, 'calls', 'tokensIn', 'tokensOut']) counters[k] = r[k];
      try {
        // The histogram is an array, and Prisma cannot increment an array element: read,
        // add, write. Two replicas flushing the same row in the same instant can lose one
        // flush's histogram (never its counters, which are increments) — acceptable for a
        // percentile, and the unique index keeps them from duplicating the row.
        const cur = await p.aiUsageDay.findUnique({ where, select: { latencyHist: true } });
        if (!cur) {
          try {
            await p.aiUsageDay.create({ data: { day, feature: r.feature, provider: r.provider, ...counters, latencySumMs: BigInt(r.latencySumMs), latencyHist: addHist([], r.latencyHist), costUsd: r.costUsd } });
            continue;
          } catch { /* lost the race to create: fall through to the update */ }
        }
        const again = cur || await p.aiUsageDay.findUnique({ where, select: { latencyHist: true } });
        await p.aiUsageDay.update({
          where,
          data: {
            ...Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, { increment: v }])),
            latencySumMs: { increment: BigInt(r.latencySumMs) },
            costUsd: { increment: r.costUsd },
            latencyHist: addHist(again?.latencyHist || [], r.latencyHist),
          },
        });
      } catch { /* a statistics row that will not write is not worth an error */ }
    }
    for (const u of pendingUsers) {
      const day = new Date(`${u.day}T00:00:00.000Z`);
      await p.aiUserUsageDay.upsert({
        where: { userId_day_feature: { userId: u.userId, day, feature: u.feature } },
        create: { userId: u.userId, day, feature: u.feature, calls: u.calls, tokens: u.tokens, costUsd: u.costUsd },
        update: { calls: { increment: u.calls }, tokens: { increment: u.tokens }, costUsd: { increment: u.costUsd } },
      }).catch(() => {}); // the account may have been erased meanwhile (FK): drop the count
    }
    return { rows: pendingRows.length, users: pendingUsers.length };
  })();
  try { return await flushing; } finally { flushing = null; }
}

/** What is buffered and not yet written, for a user's quota (so a burst inside one flush
 *  window still counts). */
export function pendingUserCalls(userId, feature, day = dayKey()) {
  const u = users.get(`${userId}|${day}|${feature}`);
  return u ? u.calls : 0;
}

// ── Reading it back ─────────────────────────────────────────────────────────────────────────
export const RANGES = Object.freeze({ '24h': 1, '7d': 7, '30d': 30, '90d': 90 });

/**
 * The admin dashboard's report for a range. Pure over the rows it is handed (the route does
 * the reading), so the arithmetic is testable without a database.
 */
export function buildReport(rowsIn = [], userRows = [], { days = 7, names = {} } = {}) {
  const sumRow = () => ({ calls: 0, ok: 0, failed: 0, timeout: 0, dropped: 0, rateLimited: 0, cacheHit: 0, breakerOpen: 0, breakerRefused: 0, killed: 0, disabled: 0, badAnswer: 0, changed: 0, falsePositive: 0, confirmed: 0, accepted: 0, rejected: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, latencySumMs: 0, latencyHist: [] });
  const add = (acc, r) => {
    for (const k of Object.keys(acc)) {
      if (k === 'latencyHist') acc.latencyHist = addHist(acc.latencyHist, r.latencyHist);
      else acc[k] += Number(r[k] || 0);
    }
    return acc;
  };
  const finish = (a) => {
    const lookedUp = a.calls + a.cacheHit;
    const judged = a.accepted + a.rejected;
    return {
      ...a,
      latencyHist: undefined,
      errors: a.failed + a.timeout + a.badAnswer,
      errorRate: a.calls ? (a.failed + a.timeout + a.badAnswer) / a.calls : null,
      cacheHitRate: lookedUp ? a.cacheHit / lookedUp : null,
      acceptanceRate: judged ? a.accepted / judged : null,
      avgMs: a.calls ? Math.round(a.latencySumMs / a.calls) : null,
      p50: percentileFromHist(a.latencyHist, 50),
      p95: percentileFromHist(a.latencyHist, 95),
      costUsd: Math.round(a.costUsd * 10000) / 10000,
    };
  };
  const total = sumRow();
  const byFeature = new Map();
  const byProvider = new Map();
  const byDay = new Map();
  for (const r of rowsIn) {
    add(total, r);
    add(byFeature.get(r.feature) || byFeature.set(r.feature, sumRow()).get(r.feature), r);
    add(byProvider.get(r.provider) || byProvider.set(r.provider, sumRow()).get(r.provider), r);
    const d = (r.day instanceof Date ? r.day.toISOString() : String(r.day)).slice(0, 10);
    add(byDay.get(d) || byDay.set(d, sumRow()).get(d), r);
  }
  const users = new Map();
  for (const u of userRows) {
    const cur = users.get(u.userId) || { userId: u.userId, calls: 0, tokens: 0, costUsd: 0, features: {} };
    cur.calls += Number(u.calls || 0); cur.tokens += Number(u.tokens || 0); cur.costUsd += Number(u.costUsd || 0);
    cur.features[u.feature] = (cur.features[u.feature] || 0) + Number(u.calls || 0);
    users.set(u.userId, cur);
  }
  const topUsers = [...users.values()].sort((a, b) => b.calls - a.calls || b.costUsd - a.costUsd).slice(0, 20)
    .map((u) => ({ ...u, costUsd: Math.round(u.costUsd * 10000) / 10000, name: names[u.userId] || null }));
  // A day with no AI traffic has no row: fill the series so a chart does not draw a gap as a line.
  const series = [];
  const today = new Date(`${dayKey()}T00:00:00.000Z`);
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(new Date(today.getTime() - i * 86400_000));
    const a = byDay.get(d);
    series.push(a ? { day: d, calls: a.calls, errors: a.failed + a.timeout + a.badAnswer, cacheHit: a.cacheHit, rateLimited: a.rateLimited, accepted: a.accepted, rejected: a.rejected, p95: percentileFromHist(a.latencyHist, 95), costUsd: Math.round(a.costUsd * 10000) / 10000 } : { day: d, calls: 0, errors: 0, cacheHit: 0, rateLimited: 0, accepted: 0, rejected: 0, p95: null, costUsd: 0 });
  }
  const sortEntries = (m) => [...m.entries()].map(([k, a]) => ({ key: k, ...finish(a) })).sort((a, b) => (b.calls + b.cacheHit) - (a.calls + a.cacheHit));
  return { days, total: finish(total), byFeature: sortEntries(byFeature), byProvider: sortEntries(byProvider), series, topUsers };
}

/** Read a range from the database and build the report. `days` is clamped to 1..366. */
export async function aiUsageReport(p, { days = 7 } = {}) {
  const d = Math.max(1, Math.min(366, Math.round(Number(days) || 7)));
  // Whatever is still in memory goes first, so the dashboard never trails the last 15 s.
  await flushAiUsage(p).catch(() => {});
  const since = new Date(`${dayKey(new Date(Date.now() - (d - 1) * 86400_000))}T00:00:00.000Z`);
  const [r, u] = await Promise.all([
    p.aiUsageDay.findMany({ where: { day: { gte: since } } }),
    p.aiUserUsageDay.groupBy({ by: ['userId', 'feature'], where: { day: { gte: since } }, _sum: { calls: true, tokens: true, costUsd: true } }),
  ]);
  const userRows = u.map((x) => ({ userId: x.userId, feature: x.feature, calls: x._sum.calls || 0, tokens: x._sum.tokens || 0, costUsd: x._sum.costUsd || 0 }));
  const ids = [...new Set(userRows.map((x) => x.userId))].slice(0, 500);
  const people = ids.length ? await p.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }) : [];
  const names = Object.fromEntries(people.map((x) => [x.id, x.displayName]));
  return buildReport(r.map((x) => ({ ...x, latencySumMs: Number(x.latencySumMs) })), userRows, { days: d, names });
}

/** How many calls one user made today for one feature (database + what is still buffered). */
export async function userCallsToday(p, userId, feature) {
  const day = dayKey();
  const row = await p.aiUserUsageDay.findUnique({ where: { userId_day_feature: { userId, day: new Date(`${day}T00:00:00.000Z`), feature } }, select: { calls: true } }).catch(() => null);
  return (row?.calls || 0) + pendingUserCalls(userId, feature, day);
}

/** Drop per-user rows past their retention (the aggregates are small and kept). */
export async function pruneAiUsage(p, retentionDays = 90, log = null) {
  const days = Math.max(7, Math.min(730, Math.round(Number(retentionDays) || 90)));
  const cutoff = new Date(Date.now() - days * 86400_000);
  const r = await p.aiUserUsageDay.deleteMany({ where: { day: { lt: cutoff } } }).catch(() => ({ count: 0 }));
  if (r.count) log?.info?.({ removed: r.count, days }, 'sweeper: pruned per-user AI usage');
  return r.count;
}

export function _resetAiUsageForTests() { rows.clear(); users.clear(); if (timer) { clearTimeout(timer); timer = null; } }
export function _peekAiUsageForTests() { return { rows: [...rows.values()].map((r) => ({ ...r })), users: [...users.values()].map((u) => ({ ...u })) }; }
