import { z } from 'zod';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { db, requireRole, requireCap, optionalUid } from '../lib/lib.mjs';
import { userBcId } from '../lib/repofingerprint.mjs';
import { RETENTION_DEFAULTS, resolveRetention } from '../lib/retention.mjs';
import { getRedis, getRedisSubscriber } from '../lib/redis.mjs';
import { getRecentServerErrors } from '../lib/errorlog.mjs';
// Client-origin helpers (IP / geo / user-agent). Moved to lib/ verbatim so the
// Sessions panel answers these questions the same way this file does.
import { clientIp, visitorHash, geoOf, parseUA } from '../lib/geo.mjs';

// Push bus for the admin live events feed: ingestion emits normalized events, the SSE
// endpoint (/admin/analytics/events/stream) relays them to connected admins in real time.
// A local EventEmitter fans out to THIS instance's streams; with Redis configured the
// event is also published so OTHER replicas re-emit it to their own streams — so an admin
// sees every event regardless of which replica ingested it or which one they're streaming
// from. No Redis (single container) → the local bus alone already sees everything.
const feedBus = new EventEmitter();
feedBus.setMaxListeners(0); // many admins may stream at once; don't warn
const FEED_CHANNEL = 'bcw:feed';
const INSTANCE_ID = createHash('sha1').update(`${process.pid}-${Math.random()}`).digest('hex').slice(0, 12);
const emitFeed = (ev) => {
  try { feedBus.emit('ev', ev); } catch { /* never let telemetry break ingestion */ }
  const r = getRedis();
  if (r) { try { r.publish(FEED_CHANNEL, JSON.stringify({ from: INSTANCE_ID, ev })); } catch { /* Redis down → local-only, still fine */ } }
};
// Subscribe once per process: re-emit events from OTHER replicas onto the local bus.
// Skips our own messages (we already emitted them locally) so there's no double-fire or loop.
let feedSubInit = false;
function initFeedSubscriber() {
  if (feedSubInit) return; feedSubInit = true;
  const sub = getRedisSubscriber();
  if (!sub) return;
  // The connection disables the offline queue, so subscribing before it's ready is
  // rejected — (re)subscribe on every 'ready' (initial connect AND reconnects), and now
  // if it's already up. Re-subscribing to the same channel is idempotent.
  const doSub = () => sub.subscribe(FEED_CHANNEL).catch(() => {});
  if (sub.status === 'ready') doSub();
  sub.on('ready', doSub);
  sub.on('message', (ch, msg) => {
    if (ch !== FEED_CHANNEL) return;
    try { const { from, ev } = JSON.parse(msg); if (from !== INSTANCE_ID) feedBus.emit('ev', ev); } catch { /* ignore malformed */ }
  });
}

// Privacy-friendly first-party analytics: page path + referrer + a daily anonymous
// visitor hash + coarse device/browser. No cookies, no third party. Consent-gated client-side.
export default async function analyticsRoutes(app) {
  initFeedSubscriber(); // start relaying other replicas' live events onto this instance's bus

  // ── Session replay (rrweb) — OFF unless an admin turns it on ────────────────
  //
  // The heaviest thing this site can collect: it reproduces what a page LOOKED like, where
  // everything else here is a count. So it is off by default, and the client asks before it
  // records rather than the server refusing afterwards — a browser that has already recorded
  // three minutes of somebody's session has already done the thing consent was meant to gate.
  const REPLAY_KEY = 'analytics.replay';
  const REPLAY_DEFAULTS = { enabled: false, sampleRate: 10, keep: 50 };
  // 2 MB of events per session. rrweb is chatty on a long visit, and an unbounded column is
  // how one afternoon fills a disk that nothing was watching.
  const REPLAY_MAX_BYTES = 2 * 1024 * 1024;

  const replayConfig = async (p) => {
    const row = await p.adminSetting.findUnique({ where: { key: REPLAY_KEY } }).catch(() => null);
    return { ...REPLAY_DEFAULTS, ...(row?.value || {}) };
  };

  // Public, and deliberately says nothing else. The client needs two numbers to decide whether
  // to load rrweb at all; anything more here would be configuration handed to everybody.
  app.get('/analytics/replay/config', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async () => {
    const p = await db();
    const c = await replayConfig(p);
    return { enabled: !!c.enabled, sampleRate: Math.max(0, Math.min(100, Number(c.sampleRate) || 0)) };
  });

  app.post('/analytics/replay', {
    // Raised because a recording is now many requests rather than one. Still bounded — a
    // long visit flushes every ~20s, so this is roughly an hour of continuous recording.
    config: { rateLimit: { max: 200, timeWindow: '5 minutes' } },
    bodyLimit: REPLAY_MAX_BYTES + 64 * 1024,
  }, async (req, reply) => {
    const b = z.object({
      // One recording, arriving in pieces. It HAS to: sendBeacon and a keepalive fetch are both
      // capped at roughly 64 KB, and five seconds of an ordinary page is already past that. A
      // recorder that only sends at the end sends nothing at all, and the browser refuses
      // silently — there is no error anywhere, just an empty table that looks like no traffic.
      sid: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
      path: z.string().max(300),
      durationMs: z.number().int().min(0).max(6 * 60 * 60 * 1000).default(0),
      // `min(1)`, not 2: only the FIRST chunk carries the Meta + FullSnapshot pair. A later
      // chunk is whatever happened since, which can legitimately be a single event.
      events: z.array(z.any()).min(1).max(20000),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });

    const p = await db();
    const c = await replayConfig(p);
    // Checked again on the server. The client decides whether to RECORD; the server decides
    // whether to keep — otherwise turning the feature off would still accept whatever was
    // already recording in an open tab.
    if (!c.enabled) return reply.code(204).send();

    const chunkBytes = Buffer.byteLength(JSON.stringify(b.data.events));
    if (chunkBytes > REPLAY_MAX_BYTES) return reply.code(413).send({ error: 'too_large' });

    const existing = await p.sessionReplay.findUnique({ where: { sid: b.data.sid } }).catch(() => null);
    if (existing) {
      const prior = Array.isArray(existing.events) ? existing.events : [];
      // The cap applies to the WHOLE recording, not the chunk. Over it, the recording stops
      // growing and keeps what it has — a truncated replay is worth something, a discarded one
      // is worth nothing, and silently dropping the oldest events would break playback, since
      // rrweb cannot rebuild a DOM without the snapshot the stream opened with.
      if (existing.bytes >= REPLAY_MAX_BYTES) return reply.code(204).send();
      const merged = prior.concat(b.data.events).slice(0, 20000);
      await p.sessionReplay.update({
        where: { sid: b.data.sid },
        data: {
          events: merged,
          bytes: existing.bytes + chunkBytes,
          eventCount: merged.length,
          durationMs: Math.max(existing.durationMs, b.data.durationMs),
        },
      }).catch(() => {});
      return reply.code(204).send();
    }

    const { device, browser } = parseUA(req.headers['user-agent']);
    const { country } = await geoOf(req);
    await p.sessionReplay.create({
      data: {
        sid: b.data.sid, visitor: visitorHash(req), path: b.data.path, events: b.data.events,
        bytes: chunkBytes, durationMs: b.data.durationMs, eventCount: b.data.events.length,
        device, browser, country,
      },
    }).catch(() => {});

    // Rotate here rather than in the sweeper: the sweeper runs every ten minutes, and ten
    // minutes of a busy afternoon is what the cap exists to prevent. `keep: 0` means unbounded
    // and is the admin's explicit choice, not a missing value.
    const keep = Number(c.keep);
    if (Number.isFinite(keep) && keep > 0) {
      const rows = await p.sessionReplay.findMany({
        orderBy: { createdAt: 'desc' }, skip: keep, select: { id: true },
      }).catch(() => []);
      if (rows.length) await p.sessionReplay.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }).catch(() => {});
    }
    return reply.code(204).send();
  });

  app.get('/admin/analytics/replays', { preHandler: requireCap('manage_analytics') }, async () => {
    const p = await db();
    const [rows, total, c] = await Promise.all([
      // Never the events: a list of fifty streams is tens of megabytes, and the screen draws
      // rows. The stream is fetched one at a time, when somebody presses play.
      p.sessionReplay.findMany({
        orderBy: { createdAt: 'desc' }, take: 100,
        select: { id: true, path: true, bytes: true, durationMs: true, eventCount: true, device: true, browser: true, country: true, createdAt: true },
      }),
      p.sessionReplay.aggregate({ _count: true, _sum: { bytes: true } }),
      replayConfig(p),
    ]);
    return { replays: rows, count: total._count, bytes: total._sum.bytes || 0, config: c };
  });

  app.get('/admin/analytics/replays/:id', { preHandler: requireCap('manage_analytics') }, async (req, reply) => {
    const p = await db();
    const row = await p.sessionReplay.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { id: row.id, path: row.path, durationMs: row.durationMs, createdAt: row.createdAt, events: row.events };
  });

  app.delete('/admin/analytics/replays/:id', { preHandler: requireCap('manage_analytics') }, async (req, reply) => {
    const p = await db();
    await p.sessionReplay.delete({ where: { id: String(req.params.id) } }).catch(() => {});
    return reply.code(204).send();
  });

  app.put('/admin/analytics/replay/config', { preHandler: requireCap('manage_analytics') }, async (req, reply) => {
    const b = z.object({
      enabled: z.boolean(),
      // A percentage of sessions. Recording everybody is rarely what anybody wants and always
      // what they get by leaving a default alone.
      sampleRate: z.number().int().min(0).max(100).optional(),
      keep: z.number().int().min(0).max(2000).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const prev = (await p.adminSetting.findUnique({ where: { key: REPLAY_KEY } }))?.value || {};
    const value = {
      enabled: b.data.enabled,
      sampleRate: b.data.sampleRate ?? prev.sampleRate ?? REPLAY_DEFAULTS.sampleRate,
      keep: b.data.keep ?? prev.keep ?? REPLAY_DEFAULTS.keep,
    };
    await p.adminSetting.upsert({ where: { key: REPLAY_KEY }, create: { key: REPLAY_KEY, value }, update: { value } });
    return { ok: true, config: value };
  });
  app.post('/analytics/pageview', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ path: z.string().max(300), ref: z.string().max(300).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    const { device, browser, os } = parseUA(req.headers['user-agent']);
    const { country, region, city, lat, lng } = await geoOf(req);
    const visitor = visitorHash(req);
    await p.analyticsEvent.create({ data: { path: b.data.path, ref: b.data.ref || null, visitor, device, browser, os, country, region, city, lat, lng } }).catch(() => {});
    emitFeed({ ts: new Date().toISOString(), kind: 'pageview', path: b.data.path, visitor, device, browser, os, country, label: null });
    return reply.code(204).send();
  });

  // Real-user Web Vitals sample (one metric per call, sent by the web-vitals client on
  // page unload). Best-effort, unauthenticated (same trust model as pageviews) — bounded
  // by strict validation so it can't be used to inject arbitrary metrics.
  app.post('/analytics/vital', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({
      path: z.string().max(300),
      metric: z.enum(['LCP', 'CLS', 'INP', 'FCP', 'TTFB']),
      // One hour was the old ceiling, and it let a 1466-SECOND TTFB into the table —
      // recorded while the API itself was restarting. That is an outage, not a slow page:
      // it describes nothing a change to this site could improve, while dragging every
      // percentile and firing "poor" alerts nobody can act on.
      value: z.number().finite().nonnegative().max(60_000),
      rating: z.enum(['good', 'needs-improvement', 'poor']).optional(),
      // INP only: which element the slowest interaction landed on. Bounded, and identity
      // only — the client sends a tag plus an aria-label or name, never a field's value.
      label: z.string().max(80).optional(),
    }).safeParse(req.body);
    // The client drops these too, but it is untrusted and older builds keep running for
    // as long as a tab stays open, so the ceiling is enforced on both ends. Rejected
    // quietly with 400: a beacon has nobody to report an error to.
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    // CLS is unitless (a layout-shift score), so the millisecond ceiling above is
    // meaningless for it — anything past 10 is already off the "poor" end of the scale.
    if (b.data.metric === 'CLS' && b.data.value > 10) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    const { device, browser, os } = parseUA(req.headers['user-agent']);
    const geo = await geoOf(req).catch(() => ({}));
    await p.webVital.create({ data: { path: b.data.path, metric: b.data.metric, value: b.data.value, rating: b.data.rating || null, label: b.data.label || null, visitor: visitorHash(req), device, browser, os, country: geo?.country || null } }).catch(() => {});
    return reply.code(204).send();
  });

  // First-party in-page interactions (clicks, field edits, submits, modal open/close),
  // batched by the client. Same trust/consent model as pageviews — the visitor hash is
  // recomputed server-side (client can't spoof identity), labels are short and bounded,
  // and `kind` is a strict enum. Stored in a separate table so pageview aggregates stay
  // clean; merged into the admin Sessions timeline. Never carries a field value.
  app.post('/analytics/interactions', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({
      items: z.array(z.object({
        path: z.string().max(300),
        kind: z.enum(['click', 'copy', 'input', 'submit', 'modal_open', 'modal_close', 'nav']),
        label: z.string().max(80).nullish(),
      })).max(40),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    if (!b.data.items.length) return reply.code(204).send();
    const p = await db();
    const { device } = parseUA(req.headers['user-agent']);
    const visitor = visitorHash(req);
    await p.interactionEvent.createMany({
      data: b.data.items.map((it) => ({ path: it.path, kind: it.kind, label: it.label || null, visitor, device })),
    }).catch(() => {});
    const now = new Date().toISOString();
    for (const it of b.data.items) emitFeed({ ts: now, kind: it.kind, path: it.path, visitor, device, browser: null, os: null, country: null, label: it.label || null });
    return reply.code(204).send();
  });

  // Client error report (uncaught error / unhandled rejection). Best-effort, consent-
  // gated on the client; strictly bounded here so it can't be used to store large blobs.
  app.post('/analytics/error', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({
      path: z.string().max(300),
      message: z.string().min(1).max(400),
      stack: z.string().max(6000).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    const { device, browser, os } = parseUA(req.headers['user-agent']);
    const geo = await geoOf(req).catch(() => ({}));
    await p.errorEvent.create({ data: { path: b.data.path, message: b.data.message, stack: b.data.stack || null, visitor: visitorHash(req), userId: optionalUid(req), device, browser, os, country: geo?.country || null } }).catch(() => {});
    return reply.code(204).send();
  });

  // Rich admin overview (telemetry-grade): totals, unique visitors, live, per-day
  // series (views + visitors), top pages/referrers, device & browser breakdowns.
  app.get('/admin/analytics', { preHandler: requireCap('manage_analytics') }, async (req) => {
    const p = await db();
    // `hours` (1..168) → hourly buckets over the last N hours (zoom-in view);
    // otherwise `days` (1..365) → daily buckets. Granularity is echoed back.
    const hours = req.query?.hours ? Math.min(Math.max(Number(req.query.hours), 1), 168) : null;
    const gran = hours ? 'hour' : 'day';
    const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 365);
    const since = hours ? new Date(Date.now() - hours * 3600e3) : new Date(Date.now() - days * 864e5);
    const liveSince = new Date(Date.now() - 30 * 60e3); // last 30 min
    // Immediately-preceding window of the SAME length, for period-over-period deltas.
    const windowMs = Date.now() - since.getTime();
    const prevSince = new Date(since.getTime() - windowMs);
    const uniq = async (where) => (await p.analyticsEvent.findMany({ where, select: { visitor: true }, distinct: ['visitor'] })).filter((x) => x.visitor).length;
    // Day-granularity series comes from the AnalyticsDaily rollup (a small PK range read)
    // instead of two full-window GROUP BY scans of AnalyticsEvent. The hourly zoom stays raw.
    const sinceDay = new Date(since); sinceDay.setUTCHours(0, 0, 0, 0);
    const dayRollup = gran === 'day'
      ? await p.analyticsDaily.findMany({ where: { day: { gte: sinceDay } }, orderBy: { day: 'asc' } })
      : null;
    const [total, windowed, uniqueVisitors, totalVisitors, live, top, refs, devices, browsers, oses, countries, series, visitorSeries, bounce, flows, regions, cities] = await Promise.all([
      p.analyticsEvent.count(),
      p.analyticsEvent.count({ where: { createdAt: { gte: since } } }),
      uniq({ createdAt: { gte: since } }),
      uniq({}),
      uniq({ createdAt: { gte: liveSince } }),
      p.analyticsEvent.groupBy({ by: ['path'], _count: { path: true }, where: { createdAt: { gte: since } }, orderBy: { _count: { path: 'desc' } }, take: 12 }),
      p.analyticsEvent.groupBy({ by: ['ref'], _count: { ref: true }, where: { createdAt: { gte: since }, ref: { not: null } }, orderBy: { _count: { ref: 'desc' } }, take: 8 }),
      p.analyticsEvent.groupBy({ by: ['device'], _count: { device: true }, where: { createdAt: { gte: since }, device: { not: null } }, orderBy: { _count: { device: 'desc' } } }),
      p.analyticsEvent.groupBy({ by: ['browser'], _count: { browser: true }, where: { createdAt: { gte: since }, browser: { not: null } }, orderBy: { _count: { browser: 'desc' } } }),
      p.analyticsEvent.groupBy({ by: ['os'], _count: { os: true }, where: { createdAt: { gte: since }, os: { not: null } }, orderBy: { _count: { os: 'desc' } } }),
      p.analyticsEvent.groupBy({ by: ['country'], _count: { country: true }, where: { createdAt: { gte: since }, country: { not: null } }, orderBy: { _count: { country: 'desc' } }, take: 30 }),
      gran === 'day' ? dayRollup.map((r) => ({ day: r.day, count: r.views }))
        : p.$queryRaw`SELECT date_trunc(${gran}, "createdAt") AS day, count(*)::int AS count FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      gran === 'day' ? dayRollup.map((r) => ({ day: r.day, count: r.visitors }))
        : p.$queryRaw`SELECT date_trunc(${gran}, "createdAt") AS day, count(DISTINCT "visitor")::int AS count FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      // Bounce: visitors who viewed exactly one page.
      p.$queryRaw`SELECT count(*) FILTER (WHERE n = 1)::int AS bounces, count(*)::int AS total FROM (SELECT "visitor", count(*) AS n FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND "visitor" IS NOT NULL GROUP BY "visitor") t`,
      // Top page→page transitions (journey / flow), computed per-visitor over time.
      p.$queryRaw`SELECT frm, path AS "to", count(*)::int AS c FROM (SELECT "visitor", path, lag(path) OVER (PARTITION BY "visitor" ORDER BY "createdAt") AS frm FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND "visitor" IS NOT NULL) t WHERE frm IS NOT NULL AND frm <> path GROUP BY frm, path ORDER BY c DESC LIMIT 25`,
      // Regions & cities carry the country alongside so the UI shows the right flag.
      p.$queryRaw`SELECT country, region, count(*)::int AS c FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND region IS NOT NULL GROUP BY country, region ORDER BY c DESC LIMIT 30`,
      p.$queryRaw`SELECT country, region, city, count(*)::int AS c FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND city IS NOT NULL GROUP BY country, region, city ORDER BY c DESC LIMIT 30`,
    ]);
    const vs = Object.fromEntries(visitorSeries.map((s) => [new Date(s.day).toISOString(), Number(s.count)]));
    const b0 = bounce[0] || { bounces: 0, total: 0 };
    // Previous-period figures for the headline KPI deltas (pageviews + unique visitors).
    const [prevWindowed, prevUniqueVisitors, prevBounce] = await Promise.all([
      p.analyticsEvent.count({ where: { createdAt: { gte: prevSince, lt: since } } }),
      uniq({ createdAt: { gte: prevSince, lt: since } }),
      p.$queryRaw`SELECT count(*) FILTER (WHERE n = 1)::int AS bounces, count(*)::int AS total FROM (SELECT "visitor", count(*) AS n FROM "AnalyticsEvent" WHERE "createdAt" >= ${prevSince} AND "createdAt" < ${since} AND "visitor" IS NOT NULL GROUP BY "visitor") t`,
    ]);
    const pb = prevBounce[0] || { bounces: 0, total: 0 };
    const prevBounceRate = pb.total ? Math.round((Number(pb.bounces) / Number(pb.total)) * 100) : 0;
    const prevViewsPerVisitor = prevUniqueVisitors ? +(prevWindowed / prevUniqueVisitors).toFixed(1) : 0;

    // Hour-granularity: zero-fill gaps and compute a "same hour, previous day"
    // comparison. The GROUP BY query above silently skips hours with zero events —
    // for a quiet site that meant the chart showed fewer than `hours` points spaced
    // as if they WERE consecutive hours (a real 24h gap could render as a smooth
    // line across 3 points instead of a flat zero stretch). Re-derived from a raw,
    // explicitly zero-filled bucket loop instead so the chart is accurate either way.
    let compare = null;
    let hourlySeries = null;
    if (gran === 'hour') {
      // Bucket keys must land on exact hour boundaries to match Postgres's
      // date_trunc('hour', ...) — `since` itself is "now minus N hours" (an
      // arbitrary minute/second offset), so anchoring the loop on it directly
      // meant these lookup keys almost never matched the truncated SQL keys.
      const sinceHour = new Date(Math.floor(since.getTime() / 3600e3) * 3600e3);
      const prevSinceHour = new Date(sinceHour.getTime() - hours * 3600e3);
      const [rows, visitorRows] = await Promise.all([
        p.$queryRaw`SELECT date_trunc('hour', "createdAt") AS day, count(*)::int AS count FROM "AnalyticsEvent" WHERE "createdAt" >= ${prevSinceHour} GROUP BY 1 ORDER BY 1`,
        p.$queryRaw`SELECT date_trunc('hour', "createdAt") AS day, count(DISTINCT "visitor")::int AS count FROM "AnalyticsEvent" WHERE "createdAt" >= ${prevSinceHour} GROUP BY 1 ORDER BY 1`,
      ]);
      const byHour = Object.fromEntries(rows.map((r) => [new Date(r.day).toISOString(), Number(r.count)]));
      const visitorsByHour = Object.fromEntries(visitorRows.map((r) => [new Date(r.day).toISOString(), Number(r.count)]));
      hourlySeries = Array.from({ length: hours }, (_, i) => {
        const hour = new Date(sinceHour.getTime() + i * 3600e3);
        return { day: hour, count: byHour[hour.toISOString()] || 0, visitors: visitorsByHour[hour.toISOString()] || 0 };
      });
      compare = Array.from({ length: hours }, (_, i) => {
        const hour = new Date(sinceHour.getTime() + i * 3600e3);
        const prevHour = new Date(prevSinceHour.getTime() + i * 3600e3);
        const count = byHour[hour.toISOString()] || 0;
        const prevCount = byHour[prevHour.toISOString()] || 0;
        const pct = prevCount > 0 ? Math.round(((count - prevCount) / prevCount) * 1000) / 10 : (count > 0 ? 100 : 0);
        return { hour, count, prevHour, prevCount, pct };
      });
    }
    return {
      total, days, windowed, last30: windowed, granularity: gran, hours,
      uniqueVisitors, totalVisitors, live, sessions: uniqueVisitors,
      viewsPerVisitor: uniqueVisitors ? +(windowed / uniqueVisitors).toFixed(1) : 0,
      bounceRate: b0.total ? Math.round((Number(b0.bounces) / Number(b0.total)) * 100) : 0,
      // Previous equal-length window → the client renders ↑/↓ % deltas per KPI.
      prev: { pageviews: prevWindowed, uniqueVisitors: prevUniqueVisitors, sessions: prevUniqueVisitors, viewsPerVisitor: prevViewsPerVisitor, bounceRate: prevBounceRate },
      top: top.map((t) => ({ path: t.path, count: t._count.path })),
      refs: refs.map((r) => ({ ref: r.ref, count: r._count.ref })),
      devices: devices.map((d) => ({ label: d.device, count: d._count.device })),
      browsers: browsers.map((b) => ({ label: b.browser, count: b._count.browser })),
      oses: oses.map((o) => ({ label: o.os, count: o._count.os })),
      countries: countries.map((c) => ({ label: c.country, count: c._count.country })),
      regions: regions.map((r) => ({ country: r.country, label: r.region, count: Number(r.c) })),
      cities: cities.map((c) => ({ country: c.country, region: c.region, label: c.city, count: Number(c.c) })),
      flows: flows.map((f) => ({ from: f.frm, to: f.to, count: Number(f.c) })),
      series: hourlySeries || series.map((s) => ({ day: s.day, count: Number(s.count), visitors: vs[new Date(s.day).toISOString()] || 0 })),
      compare,
    };
  });

  // Real-user Web Vitals overview (Rybbit-style): overall percentiles per metric, an hourly
  // p75 trend, and p75 breakdowns of every metric BY page / country / device / browser / OS.
  // An optional `?path=` filter (case-insensitive contains) narrows everything to a page.
  // Percentiles computed in Postgres (percentile_cont); dimension column is whitelisted and
  // since/path are bound params ($1/$2) → no SQL injection.
  app.get('/admin/analytics/vitals', { preHandler: requireCap('manage_analytics') }, async (req) => {
    const p = await db();
    const hours = req.query?.hours ? Math.min(Math.max(Number(req.query.hours), 1), 168) : null;
    const gran = hours ? 'hour' : 'day';
    const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 365);
    const since = hours ? new Date(Date.now() - hours * 3600e3) : new Date(Date.now() - days * 864e5);
    const q = String(req.query?.path || '').trim();
    const METRICS = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];
    const num = (v) => (v == null ? null : Number(v));
    const whereSql = q ? `"createdAt" >= $1 AND path ILIKE $2` : `"createdAt" >= $1`;
    const params = q ? [since, `%${q}%`] : [since];
    const P75 = (m) => `percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = '${m}')`;
    const COLS = { path: 'path', country: 'country', device: 'device', browser: 'browser', os: 'os' };
    const breakdown = (col) => p.$queryRawUnsafe(
      `SELECT ${COLS[col]} AS key, ${P75('LCP')} AS lcp, ${P75('CLS')} AS cls, ${P75('INP')} AS inp,
              ${P75('FCP')} AS fcp, ${P75('TTFB')} AS ttfb, count(*)::int AS samples
         FROM "WebVital" WHERE ${whereSql} AND ${COLS[col]} IS NOT NULL
         GROUP BY key ORDER BY samples DESC LIMIT 60`, ...params);
    const [overall, trend, byPath, byCountry, byDevice, byBrowser, byOs] = await Promise.all([
      p.$queryRawUnsafe(
        `SELECT metric, percentile_cont(0.50) WITHIN GROUP (ORDER BY value) AS p50,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
                percentile_cont(0.90) WITHIN GROUP (ORDER BY value) AS p90,
                percentile_cont(0.99) WITHIN GROUP (ORDER BY value) AS p99,
                count(*)::int AS n, (count(*) FILTER (WHERE rating = 'good'))::int AS good
           FROM "WebVital" WHERE ${whereSql} GROUP BY metric`, ...params),
      p.$queryRawUnsafe(
        `SELECT metric, date_trunc('${gran}', "createdAt") AS bucket,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
           FROM "WebVital" WHERE ${whereSql} GROUP BY metric, bucket ORDER BY bucket`, ...params),
      breakdown('path'), breakdown('country'), breakdown('device'), breakdown('browser'), breakdown('os'),
    ]);
    const om = new Map(overall.map((o) => [o.metric, o]));
    const map = (rows) => rows.map((r) => ({ key: r.key, samples: Number(r.samples), lcp: num(r.lcp), cls: num(r.cls), inp: num(r.inp), fcp: num(r.fcp), ttfb: num(r.ttfb) }));
    return {
      days, hours, granularity: gran, filter: q || null,
      metrics: METRICS.map((m) => { const o = om.get(m); return {
        metric: m, n: o ? Number(o.n) : 0,
        p50: o ? num(o.p50) : null, p75: o ? num(o.p75) : null, p90: o ? num(o.p90) : null, p99: o ? num(o.p99) : null,
        goodShare: o && Number(o.n) ? Math.round((Number(o.good) / Number(o.n)) * 100) : null,
      }; }),
      trend: trend.map((t) => ({ metric: t.metric, bucket: t.bucket, p75: num(t.p75) })),
      pages: byPath.map((r) => ({ path: r.key, samples: Number(r.samples), lcp: num(r.lcp), cls: num(r.cls), inp: num(r.inp), fcp: num(r.fcp), ttfb: num(r.ttfb) })),
      countries: map(byCountry), devices: map(byDevice), browsers: map(byBrowser), oses: map(byOs),
    };
  });

  // Custom-events feed (à la Rybbit): the recent stream of pageviews + in-page
  // interactions (click/copy/input/submit/modal/nav), newest first, filterable by path
  // (contains) and kind. Interaction rows are enriched with the visitor's browser/OS/
  // country from their latest pageview (those columns live on AnalyticsEvent).
  app.get('/admin/analytics/events', { preHandler: requireCap('manage_analytics') }, async (req) => {
    const p = await db();
    const hours = req.query?.hours ? Math.min(Math.max(Number(req.query.hours), 1), 168) : null;
    const days = Math.min(Math.max(Number(req.query?.days) || 7, 1), 365);
    const since = hours ? new Date(Date.now() - hours * 3600e3) : new Date(Date.now() - days * 864e5);
    const q = String(req.query?.path || '').trim();
    const kinds = req.query?.kinds ? String(req.query.kinds).split(',').filter(Boolean) : null;
    const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 1), 500);
    const pathWhere = q ? { path: { contains: q, mode: 'insensitive' } } : {};
    const wantPv = !kinds || kinds.includes('pageview');
    const ixKinds = kinds ? kinds.filter((k) => k !== 'pageview') : null;
    const wantIx = !kinds || (ixKinds && ixKinds.length);
    const [pvs, ixs] = await Promise.all([
      wantPv ? p.analyticsEvent.findMany({ where: { createdAt: { gte: since }, ...pathWhere }, orderBy: { createdAt: 'desc' }, take: limit, select: { createdAt: true, path: true, visitor: true, device: true, browser: true, os: true, country: true } }) : [],
      wantIx ? p.interactionEvent.findMany({ where: { createdAt: { gte: since }, ...pathWhere, ...(ixKinds && ixKinds.length ? { kind: { in: ixKinds } } : {}) }, orderBy: { createdAt: 'desc' }, take: limit, select: { createdAt: true, path: true, visitor: true, kind: true, label: true, device: true } }) : [],
    ]);
    // Enrich interactions with browser/OS/country from each visitor's latest pageview.
    const visitors = [...new Set(ixs.map((x) => x.visitor).filter(Boolean))];
    const enrich = new Map();
    if (visitors.length) {
      const rows = await p.analyticsEvent.findMany({ where: { visitor: { in: visitors } }, orderBy: { createdAt: 'desc' }, distinct: ['visitor'], select: { visitor: true, browser: true, os: true, country: true } });
      rows.forEach((r) => enrich.set(r.visitor, r));
    }
    const events = [
      ...pvs.map((e) => ({ ts: e.createdAt, kind: 'pageview', path: e.path, visitor: e.visitor, device: e.device, browser: e.browser, os: e.os, country: e.country, label: null })),
      ...ixs.map((e) => { const en = enrich.get(e.visitor) || {}; return { ts: e.createdAt, kind: e.kind, path: e.path, visitor: e.visitor, device: e.device, browser: en.browser || null, os: en.os || null, country: en.country || null, label: e.label }; }),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, limit);
    // Per-kind counts over the window (for the filter chips), independent of the feed slice.
    const [pvCount, ixCounts] = await Promise.all([
      p.analyticsEvent.count({ where: { createdAt: { gte: since }, ...pathWhere } }),
      p.interactionEvent.groupBy({ by: ['kind'], where: { createdAt: { gte: since }, ...pathWhere }, _count: { kind: true } }),
    ]);
    const counts = { pageview: pvCount };
    ixCounts.forEach((c) => { counts[c.kind] = c._count.kind; });
    return { events, counts };
  });

  // Live events stream (Server-Sent Events): pushes each new pageview/interaction to the
  // admin feed the instant it's ingested — no client polling. Optional ?path= (substring,
  // case-insensitive) and ?kinds=a,b filters are applied server-side so a filtered feed
  // only receives what it wants. Cookie-authenticated via requireCap (EventSource sends the
  // same-origin session cookie). Heartbeats keep the connection alive through proxies.
  app.get('/admin/analytics/events/stream', { preHandler: requireCap('manage_analytics') }, async (req, reply) => {
    const pathQ = String(req.query?.path || '').trim().toLowerCase();
    const kinds = req.query?.kinds ? new Set(String(req.query.kinds).split(',').filter(Boolean)) : null;
    reply.hijack(); // take ownership of the socket before writing the SSE head
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // don't let a reverse proxy buffer the stream
    });
    raw.write('retry: 5000\n\n'); // tell EventSource to reconnect after 5s if dropped
    const onEv = (ev) => {
      if (kinds && !kinds.has(ev.kind)) return;
      if (pathQ && !String(ev.path || '').toLowerCase().includes(pathQ)) return;
      try { raw.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* client gone */ }
    };
    feedBus.on('ev', onEv);
    const hb = setInterval(() => { try { raw.write(': ping\n\n'); } catch { /* client gone */ } }, 25000);
    const cleanup = () => { clearInterval(hb); feedBus.removeListener('ev', onEv); };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });

  // Client errors, grouped by message: occurrences, distinct sessions (visitors), first/
  // last seen, and a latest sample (path + stack + device/browser/OS/country) for detail.
  app.get('/admin/analytics/errors', { preHandler: requireCap('manage_analytics') }, async (req) => {
    const p = await db();
    const hours = req.query?.hours ? Math.min(Math.max(Number(req.query.hours), 1), 168) : null;
    const days = Math.min(Math.max(Number(req.query?.days) || 7, 1), 365);
    const since = hours ? new Date(Date.now() - hours * 3600e3) : new Date(Date.now() - days * 864e5);
    const q = String(req.query?.path || '').trim();
    // 'server' = a 5xx the API caught, 'client' = an uncaught error in a visitor's browser.
    const src = ['server', 'client'].includes(String(req.query?.source || '')) ? String(req.query.source) : null;
    const where = { createdAt: { gte: since }, ...(q ? { path: { contains: q, mode: 'insensitive' } } : {}), ...(src ? { source: src } : {}) };
    // Aggregate per message: occurrences, distinct visitors, first/last seen. Params are
    // positional and appended in the same order the predicates are, so the indexes line up.
    const params = [since];
    if (q) params.push(`%${q}%`);
    const pathPred = q ? `AND path ILIKE $${params.length}` : '';
    if (src) params.push(src);
    const srcPred = src ? `AND source = $${params.length}` : '';
    const groups = await p.$queryRawUnsafe(
      `SELECT message, count(*)::int AS occurrences, count(DISTINCT visitor)::int AS sessions,
              min("createdAt") AS "firstSeen", max("createdAt") AS "lastSeen"
         FROM "ErrorEvent" WHERE "createdAt" >= $1 ${pathPred} ${srcPred}
         GROUP BY message ORDER BY max("createdAt") DESC LIMIT 100`,
      ...params);
    // Latest sample per message (path/stack/device/browser/os/country) for the detail view.
    const msgs = groups.map((g) => g.message);
    const samples = new Map();
    const bcIdsByMsg = new Map();
    if (msgs.length) {
      const rows = await p.errorEvent.findMany({ where: { ...where, message: { in: msgs } }, orderBy: { createdAt: 'desc' }, distinct: ['message'], select: { message: true, path: true, stack: true, source: true, device: true, browser: true, os: true, country: true, createdAt: true } });
      rows.forEach((r) => samples.set(r.message, r));
      // Which signed-in accounts hit each error → their BC ids (admin-only). Anonymous
      // (logged-out) hits contribute no id. Bounded to a handful of ids per message.
      const idRows = await p.errorEvent.findMany({ where: { ...where, message: { in: msgs }, userId: { not: null } }, select: { message: true, userId: true }, distinct: ['message', 'userId'], take: 2000 });
      for (const r of idRows) {
        const arr = bcIdsByMsg.get(r.message) || []; if (arr.length < 50) arr.push(userBcId(r.userId));
        bcIdsByMsg.set(r.message, arr);
      }
    }
    const total = await p.errorEvent.count({ where });
    return {
      total,
      errors: groups.map((g) => { const s = samples.get(g.message) || {}; return {
        message: g.message, occurrences: Number(g.occurrences), sessions: Number(g.sessions),
        firstSeen: g.firstSeen, lastSeen: g.lastSeen,
        path: s.path || null, stack: s.stack || null, source: s.source || 'client', device: s.device || null, browser: s.browser || null, os: s.os || null, country: s.country || null,
        bcIds: bcIdsByMsg.get(g.message) || [],
      }; }),
    };
  });

  // The in-memory tail of server errors — deliberately does NOT touch the DB. Its whole
  // reason to exist is the case where the DB is what's broken: the /errors query above would
  // then fail too, so this is the only window into a data-layer outage. `persisted:false`
  // entries are the ones that never reached the table — exactly the previously-invisible 500s.
  app.get('/admin/analytics/errors/recent', { preHandler: requireCap('manage_analytics') }, async () => {
    const recent = getRecentServerErrors();
    return { recent, unpersisted: recent.filter((e) => e.persisted === false).length };
  });

  // ── Conversion goals ────────────────────────────────────────────────────────
  // Interaction goals count InteractionEvents; dimension goals count pageviews matching a
  // visitor attribute (referrer / geo / tech). Both share the same visitor-based rate.
  const DIMENSION_KINDS = { referrer: 'ref', country: 'country', region: 'region', city: 'city', device: 'device', os: 'os', browser: 'browser' };
  const goalSchema = z.object({
    name: z.string().min(1).max(80),
    kind: z.enum(['pageview', 'click', 'submit', 'input', 'copy', 'referrer', 'country', 'region', 'city', 'device', 'os', 'browser']),
    path: z.string().max(200).nullish(),
    label: z.string().max(120).nullish(),
    target: z.number().int().min(0).max(100000000).nullish(),
    active: z.boolean().optional(),
  });
  // List goals with their completions + unique-visitor conversion rate over the window.
  app.get('/admin/analytics/goals', { preHandler: requireCap('manage_analytics') }, async (req) => {
    const p = await db();
    const hours = req.query?.hours ? Math.min(Math.max(Number(req.query.hours), 1), 168) : null;
    const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 365);
    const since = hours ? new Date(Date.now() - hours * 3600e3) : new Date(Date.now() - days * 864e5);
    const goals = await p.analyticsGoal.findMany({ orderBy: { createdAt: 'asc' } });
    // Total unique visitors in the window (the conversion denominator).
    const totalVisitorsRow = await p.$queryRaw`SELECT count(DISTINCT visitor)::int AS n FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND visitor IS NOT NULL`;
    const totalVisitors = Number(totalVisitorsRow?.[0]?.n || 0);
    const withStats = await Promise.all(goals.map(async (g) => {
      const pathCond = g.path ? { path: { contains: g.path, mode: 'insensitive' } } : {};
      let completions = 0; let visitors = 0;
      if (g.kind === 'pageview') {
        const [c, v] = await Promise.all([
          p.analyticsEvent.count({ where: { createdAt: { gte: since }, ...pathCond } }),
          p.$queryRawUnsafe(`SELECT count(DISTINCT visitor)::int AS n FROM "AnalyticsEvent" WHERE "createdAt" >= $1 AND visitor IS NOT NULL ${g.path ? 'AND path ILIKE $2' : ''}`, ...(g.path ? [since, `%${g.path}%`] : [since])),
        ]);
        completions = c; visitors = Number(v?.[0]?.n || 0);
      } else if (DIMENSION_KINDS[g.kind]) {
        // A pageview-dimension goal: match visitors by referrer / geo / tech attribute.
        const field = DIMENSION_KINDS[g.kind];
        const val = (g.label || '').trim();
        // country/device match exactly (short controlled vocab); the rest are contains.
        const exact = g.kind === 'country' || g.kind === 'device';
        const dimCond = val ? { [field]: exact ? { equals: val, mode: 'insensitive' } : { contains: val, mode: 'insensitive' } } : { [field]: { not: null } };
        const where = { createdAt: { gte: since }, ...pathCond, ...dimCond };
        const [c, vrows] = await Promise.all([
          p.analyticsEvent.count({ where }),
          p.analyticsEvent.findMany({ where, select: { visitor: true }, distinct: ['visitor'] }),
        ]);
        completions = c; visitors = vrows.filter((x) => x.visitor).length;
      } else {
        const labelCond = g.label ? { label: { contains: g.label, mode: 'insensitive' } } : {};
        const [c, v] = await Promise.all([
          p.interactionEvent.count({ where: { createdAt: { gte: since }, kind: g.kind, ...pathCond, ...labelCond } }),
          p.$queryRawUnsafe(`SELECT count(DISTINCT visitor)::int AS n FROM "InteractionEvent" WHERE "createdAt" >= $1 AND kind = $2 AND visitor IS NOT NULL ${g.path ? 'AND path ILIKE $3' : ''} ${g.label ? `AND label ILIKE $${g.path ? 4 : 3}` : ''}`,
            ...[since, g.kind, ...(g.path ? [`%${g.path}%`] : []), ...(g.label ? [`%${g.label}%`] : [])]),
        ]);
        completions = c; visitors = Number(v?.[0]?.n || 0);
      }
      // Progress toward an optional numeric target (based on raw completions).
      const progress = g.target ? Math.min(100, Math.round((completions / g.target) * 100)) : null;
      return { ...g, completions, visitors, rate: totalVisitors ? Math.round((visitors / totalVisitors) * 1000) / 10 : 0, progress };
    }));
    return { goals: withStats, totalVisitors };
  });
  app.post('/admin/analytics/goals', { preHandler: requireCap('manage_analytics') }, async (req, reply) => {
    const b = goalSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const g = await p.analyticsGoal.create({ data: { name: b.data.name, kind: b.data.kind, path: b.data.path || null, label: b.data.label || null, target: b.data.target ?? null, active: b.data.active ?? true } });
    return { ok: true, goal: g };
  });
  app.patch('/admin/analytics/goals/:id', { preHandler: requireCap('manage_analytics') }, async (req, reply) => {
    const b = goalSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = {};
    for (const k of ['name', 'kind', 'active']) if (b.data[k] !== undefined) data[k] = b.data[k];
    if (b.data.path !== undefined) data.path = b.data.path || null;
    if (b.data.label !== undefined) data.label = b.data.label || null;
    if (b.data.target !== undefined) data.target = b.data.target ?? null;
    const g = await p.analyticsGoal.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!g) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, goal: g };
  });
  app.delete('/admin/analytics/goals/:id', { preHandler: requireCap('manage_analytics') }, async (req) => {
    const p = await db();
    await p.analyticsGoal.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });

  // Recent visitor sessions (Rybbit-style live feed). Pageviews are grouped per visitor
  // and split into sessions on a 30-min inactivity gap; each session carries its ordered
  // page timeline, entry/exit, duration, device/geo, and a `live` flag (active < 5 min
  // ago). Built from the pageview stream we already collect — no extra recording needed.
  app.get('/admin/analytics/sessions', { preHandler: requireCap('manage_analytics') }, async (req) => {
    const p = await db();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 40, 1), 100);
    // Pull the most recent pageviews AND in-page interactions, then sessionize
    // newest-first in JS (bounded scan). Interactions are merged into each session's
    // timeline so the feed shows the real activity — which button, which field, which
    // modal — not just page hops.
    const [rows, interactions] = await Promise.all([
      p.analyticsEvent.findMany({
        where: { visitor: { not: null } },
        orderBy: { createdAt: 'desc' }, take: 4000,
        select: { visitor: true, path: true, ref: true, device: true, browser: true, os: true, country: true, region: true, city: true, lat: true, lng: true, createdAt: true },
      }),
      p.interactionEvent.findMany({
        where: { visitor: { not: null } },
        orderBy: { createdAt: 'desc' }, take: 8000,
        select: { visitor: true, path: true, kind: true, label: true, createdAt: true },
      }),
    ]);
    const GAP = 30 * 60e3, LIVE = 5 * 60e3, now = Date.now();
    // Interleave pageviews (kind 'page') and interactions into one chronological stream
    // per visitor. Pageviews still anchor the session's identity (device/geo) and the
    // page/entry/exit counters; interactions are timeline-only.
    const byVisitor = new Map();
    const bump = (v) => { if (!byVisitor.has(v)) byVisitor.set(v, []); return byVisitor.get(v); };
    for (const e of rows) bump(e.visitor).push({ ...e, kind: 'page' });
    for (const e of interactions) bump(e.visitor).push({ kind: e.kind, path: e.path, label: e.label, createdAt: e.createdAt, _int: true });
    const sessions = [];
    for (const [visitor, evs] of byVisitor) {
      // Chronological. A session must START on a pageview (interactions before the first
      // pageview in the scan window would otherwise spawn a page-less ghost session).
      evs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      let cur = null;
      for (const e of evs) {
        const t = new Date(e.createdAt).getTime();
        if (!cur || t - cur._last > GAP) {
          if (e._int) continue; // don't open a session on a stray interaction
          cur = { visitor, start: e.createdAt, _startMs: t, _last: t, events: [], pages: 0, device: e.device, browser: e.browser, os: e.os, country: e.country, region: e.region, city: e.city, lat: e.lat, lng: e.lng, ref: e.ref };
          sessions.push(cur);
        }
        if (e._int) cur.events.push({ kind: e.kind, path: e.path, label: e.label, at: e.createdAt });
        else { cur.events.push({ kind: 'page', path: e.path, at: e.createdAt }); cur.pages++; cur.end = e.createdAt; cur._lastPage = e.path; cur._firstPage = cur._firstPage || e.path; }
        cur._last = t;
      }
    }
    sessions.sort((a, b) => b._startMs - a._startMs);
    const out = sessions.slice(0, limit).map((s) => ({
      visitor: s.visitor, start: s.start, end: s.end,
      durationSec: Math.max(0, Math.round((new Date(s.end).getTime() - s._startMs) / 1000)),
      pages: s.pages, entry: s._firstPage, exit: s._lastPage,
      events: s.events, device: s.device, browser: s.browser, os: s.os,
      country: s.country, region: s.region, city: s.city, lat: s.lat, lng: s.lng, ref: s.ref,
      live: now - new Date(s.end).getTime() < LIVE,
    }));
    return { sessions: out, liveCount: out.filter((s) => s.live).length };
  });

  // Aggregated geography for the map — per country AND per region, each with: current
  // count, previous-equal-window count (→ % change vs the period before, e.g. "vs
  // yesterday"), and average coordinates (for region bubbles). Totals let the client show
  // each area's share of all located traffic. Powers Geography→Map and Sessions→Globe.
  app.get('/admin/analytics/geo', { preHandler: requireCap('manage_analytics') }, async (req) => {
    const p = await db();
    const hours = req.query?.hours ? Math.min(Math.max(Number(req.query.hours), 1), 168) : null;
    const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 365);
    const since = hours ? new Date(Date.now() - hours * 3600e3) : new Date(Date.now() - days * 864e5);
    const windowMs = Date.now() - since.getTime();
    const prevSince = new Date(since.getTime() - windowMs);
    const num = (v) => (v == null ? null : Number(v));
    const [curC, prevC, curR, prevR, tot] = await Promise.all([
      p.$queryRaw`SELECT country AS cc, count(*)::int AS c, avg(lat) AS lat, avg(lng) AS lng FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND country IS NOT NULL GROUP BY country`,
      p.$queryRaw`SELECT country AS cc, count(*)::int AS c FROM "AnalyticsEvent" WHERE "createdAt" >= ${prevSince} AND "createdAt" < ${since} AND country IS NOT NULL GROUP BY country`,
      p.$queryRaw`SELECT country AS cc, region, count(*)::int AS c, avg(lat) AS lat, avg(lng) AS lng FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND region IS NOT NULL GROUP BY country, region`,
      p.$queryRaw`SELECT country AS cc, region, count(*)::int AS c FROM "AnalyticsEvent" WHERE "createdAt" >= ${prevSince} AND "createdAt" < ${since} AND region IS NOT NULL GROUP BY country, region`,
      p.$queryRaw`SELECT
          count(*) FILTER (WHERE "createdAt" >= ${since} AND country IS NOT NULL)::int AS cur,
          count(*) FILTER (WHERE "createdAt" >= ${prevSince} AND "createdAt" < ${since} AND country IS NOT NULL)::int AS prev
        FROM "AnalyticsEvent"`,
    ]);
    const prevCMap = Object.fromEntries(prevC.map((r) => [r.cc, Number(r.c)]));
    const prevRMap = Object.fromEntries(prevR.map((r) => [`${r.cc}|${r.region}`, Number(r.c)]));
    return {
      total: Number(tot[0]?.cur || 0), totalPrev: Number(tot[0]?.prev || 0),
      countries: curC.map((r) => ({ cc: r.cc, count: Number(r.c), prev: prevCMap[r.cc] || 0, lat: num(r.lat), lng: num(r.lng) }))
        .sort((a, b) => b.count - a.count),
      regions: curR.map((r) => ({ cc: r.cc, region: r.region, count: Number(r.c), prev: prevRMap[`${r.cc}|${r.region}`] || 0, lat: num(r.lat), lng: num(r.lng) }))
        .sort((a, b) => b.count - a.count),
    };
  });

  // Retention config for the append-only analytics tables. The sweeper purges rows
  // older than each window (0 = keep forever). Returns the effective config, the
  // defaults, and — so the admin can see the pressure — the current row count and
  // oldest-row age per table.
  app.get('/admin/analytics/retention', { preHandler: requireCap('manage_analytics') }, async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'analytics.retention' } });
    const stat = async (model) => {
      const [count, oldest] = await Promise.all([
        model.count(),
        model.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      ]);
      return { count, oldest: oldest?.createdAt || null };
    };
    const [pageview, interaction, vital, login, error] = await Promise.all([
      stat(p.analyticsEvent), stat(p.interactionEvent), stat(p.webVital), stat(p.loginAttempt), stat(p.errorEvent),
    ]);
    return { config: resolveRetention(row?.value), defaults: RETENTION_DEFAULTS, tables: { pageview, interaction, vital, login, error } };
  });

  const retentionSchema = z.object({
    pageviewDays: z.number().int().min(0).max(3650),
    interactionDays: z.number().int().min(0).max(3650),
    vitalDays: z.number().int().min(0).max(3650),
    loginDays: z.number().int().min(0).max(3650),
    errorDays: z.number().int().min(0).max(3650),
  }).partial();
  app.put('/admin/analytics/retention', { preHandler: requireCap('manage_analytics') }, async (req, reply) => {
    const b = retentionSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cfg = resolveRetention(b.data); // normalize + fill defaults so the stored value is complete
    await p.adminSetting.upsert({ where: { key: 'analytics.retention' }, create: { key: 'analytics.retention', value: cfg }, update: { value: cfg } });
    return { ok: true, config: cfg };
  });
}
