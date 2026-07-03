import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db, requireRole } from '../lib.mjs';

// Real client IP as seen by our trusted proxy (Caddy appends it last on X-Forwarded-For).
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip || '0.0.0.0';
}
// Daily-rotating anonymous visitor hash — no persistent cookie, no PII stored.
function visitorHash(req) {
  const day = new Date().toISOString().slice(0, 10);
  const ua = req.headers['user-agent'] || '';
  return createHash('sha256').update(`${clientIp(req)}|${ua}|${day}|${process.env.JWT_SECRET || 'salt'}`).digest('hex').slice(0, 24);
}
// Country resolution: CDN/proxy header first (Cloudflare / Vercel / custom), then a
// LOCAL geoip lookup on the real client IP (geoip-lite, offline MaxMind-lite DB) —
// so Countries works when self-hosted without any CDN. Private/loopback IPs (local
// dev) resolve to null: still real data only, never faked.
let _geoip = null, _geoipTried = false;
async function loadGeoip() {
  if (_geoipTried) return _geoip;
  _geoipTried = true;
  try { _geoip = (await import('geoip-lite')).default; } catch { _geoip = null; }
  return _geoip;
}
async function countryOf(req) {
  const c = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country'] || req.headers['x-geo-country'] || '';
  const cc = String(c).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cc) && cc !== 'XX') return cc;
  const geo = await loadGeoip();
  if (!geo) return null;
  try {
    const hit = geo.lookup(clientIp(req));
    return hit?.country && /^[A-Z]{2}$/.test(hit.country) ? hit.country : null;
  } catch { return null; }
}
function parseUA(ua = '') {
  const u = ua.toLowerCase();
  const device = /ipad|tablet/.test(u) ? 'tablet' : /mobi|android|iphone|ipod/.test(u) ? 'mobile' : 'desktop';
  const browser = /edg\//.test(u) ? 'Edge' : /opr\/|opera/.test(u) ? 'Opera' : /firefox/.test(u) ? 'Firefox'
    : /chrome|crios/.test(u) ? 'Chrome' : /safari/.test(u) ? 'Safari' : 'Other';
  const os = /android/.test(u) ? 'Android' : /iphone|ipad|ipod/.test(u) ? 'iOS'
    : /windows/.test(u) ? 'Windows' : /mac os x|macintosh/.test(u) ? 'macOS'
    : /linux|x11/.test(u) ? 'Linux' : 'Other';
  return { device, browser, os };
}

// Privacy-friendly first-party analytics: page path + referrer + a daily anonymous
// visitor hash + coarse device/browser. No cookies, no third party. Consent-gated client-side.
export default async function analyticsRoutes(app) {
  app.post('/analytics/pageview', async (req, reply) => {
    const b = z.object({ path: z.string().max(300), ref: z.string().max(300).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    const { device, browser, os } = parseUA(req.headers['user-agent']);
    const country = await countryOf(req);
    await p.analyticsEvent.create({ data: { path: b.data.path, ref: b.data.ref || null, visitor: visitorHash(req), device, browser, os, country } }).catch(() => {});
    return reply.code(204).send();
  });

  // Rich admin overview (telemetry-grade): totals, unique visitors, live, per-day
  // series (views + visitors), top pages/referrers, device & browser breakdowns.
  app.get('/admin/analytics', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    // `hours` (1..168) → hourly buckets over the last N hours (zoom-in view);
    // otherwise `days` (1..365) → daily buckets. Granularity is echoed back.
    const hours = req.query?.hours ? Math.min(Math.max(Number(req.query.hours), 1), 168) : null;
    const gran = hours ? 'hour' : 'day';
    const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 365);
    const since = hours ? new Date(Date.now() - hours * 3600e3) : new Date(Date.now() - days * 864e5);
    const liveSince = new Date(Date.now() - 30 * 60e3); // last 30 min
    const uniq = async (where) => (await p.analyticsEvent.findMany({ where, select: { visitor: true }, distinct: ['visitor'] })).filter((x) => x.visitor).length;
    const [total, windowed, uniqueVisitors, totalVisitors, live, top, refs, devices, browsers, oses, countries, series, visitorSeries, bounce, flows] = await Promise.all([
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
      p.analyticsEvent.groupBy({ by: ['country'], _count: { country: true }, where: { createdAt: { gte: since }, country: { not: null } }, orderBy: { _count: { country: 'desc' } }, take: 12 }),
      p.$queryRaw`SELECT date_trunc(${gran}, "createdAt") AS day, count(*)::int AS count FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      p.$queryRaw`SELECT date_trunc(${gran}, "createdAt") AS day, count(DISTINCT "visitor")::int AS count FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      // Bounce: visitors who viewed exactly one page.
      p.$queryRaw`SELECT count(*) FILTER (WHERE n = 1)::int AS bounces, count(*)::int AS total FROM (SELECT "visitor", count(*) AS n FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND "visitor" IS NOT NULL GROUP BY "visitor") t`,
      // Top page→page transitions (journey / flow), computed per-visitor over time.
      p.$queryRaw`SELECT frm, path AS "to", count(*)::int AS c FROM (SELECT "visitor", path, lag(path) OVER (PARTITION BY "visitor" ORDER BY "createdAt") AS frm FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND "visitor" IS NOT NULL) t WHERE frm IS NOT NULL AND frm <> path GROUP BY frm, path ORDER BY c DESC LIMIT 25`,
    ]);
    const vs = Object.fromEntries(visitorSeries.map((s) => [new Date(s.day).toISOString(), Number(s.count)]));
    const b0 = bounce[0] || { bounces: 0, total: 0 };

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
      top: top.map((t) => ({ path: t.path, count: t._count.path })),
      refs: refs.map((r) => ({ ref: r.ref, count: r._count.ref })),
      devices: devices.map((d) => ({ label: d.device, count: d._count.device })),
      browsers: browsers.map((b) => ({ label: b.browser, count: b._count.browser })),
      oses: oses.map((o) => ({ label: o.os, count: o._count.os })),
      countries: countries.map((c) => ({ label: c.country, count: c._count.country })),
      flows: flows.map((f) => ({ from: f.frm, to: f.to, count: Number(f.c) })),
      series: hourlySeries || series.map((s) => ({ day: s.day, count: Number(s.count), visitors: vs[new Date(s.day).toISOString()] || 0 })),
      compare,
    };
  });
}
