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
// Full geo (country + region + city). CDN country header is authoritative for the
// country when present; region/city always come from the local offline GeoIP DB (the
// CDN header only carries a country). Private/loopback IPs (local dev) → nulls.
// Is this a private / loopback / link-local address? Such IPs never geolocate — in
// production only internal traffic uses them (real visitors have public IPs behind the
// proxy), so a dev-only sample geo for them can't pollute real-user data.
function isPrivateIp(ip) {
  return !ip || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::$|fc|fd)/i.test(ip) || ip === 'localhost' || ip === '0.0.0.0';
}
// Dev fallback: deterministically place a private/loopback visitor in one real city
// (by their anonymous hash, so a given visitor stays put). Lets Countries/Regions/Cities
// /Map/Globe all populate on a local machine. OFF only if ANALYTICS_DEV_GEO=0.
const DEV_CITIES = [
  { country: 'US', region: 'California', city: 'San Francisco', lat: 37.77, lng: -122.42 },
  { country: 'US', region: 'New York', city: 'New York', lat: 40.71, lng: -74.01 },
  { country: 'GB', region: 'England', city: 'London', lat: 51.51, lng: -0.13 },
  { country: 'FR', region: 'Île-de-France', city: 'Paris', lat: 48.86, lng: 2.35 },
  { country: 'DE', region: 'Berlin', city: 'Berlin', lat: 52.52, lng: 13.40 },
  { country: 'ES', region: 'Madrid', city: 'Madrid', lat: 40.42, lng: -3.70 },
  { country: 'CA', region: 'Ontario', city: 'Toronto', lat: 43.65, lng: -79.38 },
  { country: 'BR', region: 'São Paulo', city: 'São Paulo', lat: -23.55, lng: -46.63 },
  { country: 'IN', region: 'Maharashtra', city: 'Mumbai', lat: 19.08, lng: 72.88 },
  { country: 'JP', region: 'Tokyo', city: 'Tokyo', lat: 35.68, lng: 139.69 },
  { country: 'AU', region: 'New South Wales', city: 'Sydney', lat: -33.87, lng: 151.21 },
  { country: 'CH', region: 'Vaud', city: 'Lausanne', lat: 46.52, lng: 6.63 },
];
function devGeoSample(seed) {
  let h = 0; const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DEV_CITIES[h % DEV_CITIES.length];
}
// In local dev the client IP is loopback, so we can't geolocate the visitor. Resolve the
// DEV MACHINE's own public IP once (cached 1h) and geolocate THAT — so localhost traffic
// shows the developer's real location (real data), not a made-up sample city.
let _devPubGeo = { at: 0, val: undefined };
let _devGeoInflight = null;
function devRealGeo() {
  // Keep a successful lookup for an hour; retry a failed one after 5 min (so a cold-start
  // timeout doesn't wedge us on the sample fallback for a whole hour).
  const ttl = _devPubGeo.val ? 3600e3 : 5 * 60e3;
  if (_devPubGeo.val !== undefined && Date.now() - _devPubGeo.at < ttl) return Promise.resolve(_devPubGeo.val);
  // Collapse concurrent callers onto ONE outbound lookup (no thundering herd of fetches).
  if (_devGeoInflight) return _devGeoInflight;
  _devGeoInflight = (async () => {
  let val = null;
  for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip']) {
    try {
      const ctrl = AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined;
      const ip = (await fetch(url, ctrl ? { signal: ctrl } : {}).then((r) => r.text())).trim();
      const geo = await loadGeoip();
      const hit = geo && /^[0-9.]+$/.test(ip) ? geo.lookup(ip) : null;
      if (hit?.country && /^[A-Z]{2}$/.test(hit.country)) {
        val = { country: hit.country, region: hit.region || null, city: hit.city || null, lat: Array.isArray(hit.ll) ? hit.ll[0] : null, lng: Array.isArray(hit.ll) ? hit.ll[1] : null };
        break;
      }
    } catch { /* try the next resolver, else fall back to the sample */ }
  }
  _devPubGeo = { at: Date.now(), val };
  return val;
  })().finally(() => { _devGeoInflight = null; });
  return _devGeoInflight;
}

async function geoOf(req) {
  const hdr = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country'] || req.headers['x-geo-country'] || '';
  const cc = String(hdr).trim().toUpperCase();
  const headerCountry = /^[A-Z]{2}$/.test(cc) && cc !== 'XX' ? cc : null;
  const ip = clientIp(req);
  // Dev/local traffic → use the dev machine's REAL public-IP location (so it shows the
  // developer's actual country), falling back to a sample city only if that lookup fails.
  if (!headerCountry && isPrivateIp(ip) && process.env.ANALYTICS_DEV_GEO !== '0') {
    const real = await devRealGeo();
    if (real) return real;
    const d = devGeoSample(visitorHash(req));
    return { country: d.country, region: d.region, city: d.city, lat: d.lat, lng: d.lng };
  }
  const geo = await loadGeoip();
  let hit = null;
  if (geo) { try { hit = geo.lookup(ip); } catch { hit = null; } }
  const country = headerCountry || (hit?.country && /^[A-Z]{2}$/.test(hit.country) ? hit.country : null);
  // geoip-lite returns `region` as a subdivision code (e.g. "CA") and `city` as a name.
  const region = hit?.region ? String(hit.region).slice(0, 80) || null : null;
  const city = hit?.city ? String(hit.city).slice(0, 120) || null : null;
  // `ll` = [lat, lng]; present on most geoip hits even when city/region are blank.
  const lat = Array.isArray(hit?.ll) && Number.isFinite(hit.ll[0]) ? hit.ll[0] : null;
  const lng = Array.isArray(hit?.ll) && Number.isFinite(hit.ll[1]) ? hit.ll[1] : null;
  return { country, region: region || null, city: city || null, lat, lng };
}
// OS + distro detection. Distro/edition is only reliably present in the UA for a few
// cases (Firefox exposes Ubuntu/Fedora; ChromeOS uses the "CrOS" token) — best-effort,
// falling back to the generic family. Never guesses beyond what the UA actually states.
function parseUA(ua = '') {
  const u = ua.toLowerCase();
  const device = /ipad|tablet/.test(u) ? 'tablet' : /mobi|android|iphone|ipod/.test(u) ? 'mobile' : 'desktop';
  const browser = /edg\//.test(u) ? 'Edge' : /opr\/|opera/.test(u) ? 'Opera' : /firefox/.test(u) ? 'Firefox'
    : /samsungbrowser/.test(u) ? 'Samsung Internet' : /brave/.test(u) ? 'Brave'
    : /chrome|crios/.test(u) ? 'Chrome' : /safari/.test(u) ? 'Safari' : 'Other';
  let os;
  if (/android/.test(u)) os = 'Android';
  else if (/iphone|ipad|ipod/.test(u)) os = 'iOS';
  else if (/cros/.test(u)) os = 'ChromeOS';
  else if (/windows/.test(u)) os = 'Windows';
  else if (/mac os x|macintosh/.test(u)) os = 'macOS';
  else if (/ubuntu/.test(u)) os = 'Ubuntu';
  else if (/fedora/.test(u)) os = 'Fedora';
  else if (/debian/.test(u)) os = 'Debian';
  else if (/kali/.test(u)) os = 'Kali';
  else if (/arch/.test(u)) os = 'Arch';
  else if (/manjaro/.test(u)) os = 'Manjaro';
  else if (/mint/.test(u)) os = 'Linux Mint';
  else if (/steamos/.test(u)) os = 'SteamOS';
  else if (/linux|x11/.test(u)) os = 'Linux';
  else os = 'Other';
  return { device, browser, os };
}

// Privacy-friendly first-party analytics: page path + referrer + a daily anonymous
// visitor hash + coarse device/browser. No cookies, no third party. Consent-gated client-side.
export default async function analyticsRoutes(app) {
  app.post('/analytics/pageview', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ path: z.string().max(300), ref: z.string().max(300).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    const { device, browser, os } = parseUA(req.headers['user-agent']);
    const { country, region, city, lat, lng } = await geoOf(req);
    await p.analyticsEvent.create({ data: { path: b.data.path, ref: b.data.ref || null, visitor: visitorHash(req), device, browser, os, country, region, city, lat, lng } }).catch(() => {});
    return reply.code(204).send();
  });

  // Real-user Web Vitals sample (one metric per call, sent by the web-vitals client on
  // page unload). Best-effort, unauthenticated (same trust model as pageviews) — bounded
  // by strict validation so it can't be used to inject arbitrary metrics.
  app.post('/analytics/vital', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({
      path: z.string().max(300),
      metric: z.enum(['LCP', 'CLS', 'INP', 'FCP', 'TTFB']),
      value: z.number().finite().nonnegative().max(3_600_000),
      rating: z.enum(['good', 'needs-improvement', 'poor']).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    const { device } = parseUA(req.headers['user-agent']);
    await p.webVital.create({ data: { path: b.data.path, metric: b.data.metric, value: b.data.value, rating: b.data.rating || null, visitor: visitorHash(req), device } }).catch(() => {});
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
    // Immediately-preceding window of the SAME length, for period-over-period deltas.
    const windowMs = Date.now() - since.getTime();
    const prevSince = new Date(since.getTime() - windowMs);
    const uniq = async (where) => (await p.analyticsEvent.findMany({ where, select: { visitor: true }, distinct: ['visitor'] })).filter((x) => x.visitor).length;
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
      p.$queryRaw`SELECT date_trunc(${gran}, "createdAt") AS day, count(*)::int AS count FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      p.$queryRaw`SELECT date_trunc(${gran}, "createdAt") AS day, count(DISTINCT "visitor")::int AS count FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
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

  // Real-user Web Vitals overview: overall percentiles per metric (p50/p75/p90/p99),
  // an hourly p75 trend per metric, and a per-page table (p75 of each metric + samples).
  // Percentiles are computed in Postgres (percentile_cont) over the selected window.
  app.get('/admin/analytics/vitals', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const hours = req.query?.hours ? Math.min(Math.max(Number(req.query.hours), 1), 168) : null;
    const gran = hours ? 'hour' : 'day';
    const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 365);
    const since = hours ? new Date(Date.now() - hours * 3600e3) : new Date(Date.now() - days * 864e5);
    const METRICS = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];
    const [overall, trend, byPage] = await Promise.all([
      // One row per metric: the four percentiles + a sample count + a "good" share.
      p.$queryRaw`SELECT metric,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY value) AS p50,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
          percentile_cont(0.90) WITHIN GROUP (ORDER BY value) AS p90,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY value) AS p99,
          count(*)::int AS n,
          (count(*) FILTER (WHERE rating = 'good'))::int AS good
        FROM "WebVital" WHERE "createdAt" >= ${since} GROUP BY metric`,
      // p75 per metric per time bucket → sparkline/line per metric.
      p.$queryRaw`SELECT metric, date_trunc(${gran}, "createdAt") AS bucket,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
        FROM "WebVital" WHERE "createdAt" >= ${since} GROUP BY metric, bucket ORDER BY bucket`,
      // Per-page p75 for every metric, pivoted, ordered by sample volume.
      p.$queryRaw`SELECT path,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'LCP')  AS lcp,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'CLS')  AS cls,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'INP')  AS inp,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'FCP')  AS fcp,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'TTFB') AS ttfb,
          count(*)::int AS samples
        FROM "WebVital" WHERE "createdAt" >= ${since} GROUP BY path ORDER BY samples DESC LIMIT 40`,
    ]);
    const om = new Map(overall.map((o) => [o.metric, o]));
    const num = (v) => (v == null ? null : Number(v));
    return {
      days, hours, granularity: gran,
      metrics: METRICS.map((m) => {
        const o = om.get(m);
        return {
          metric: m, n: o ? Number(o.n) : 0,
          p50: o ? num(o.p50) : null, p75: o ? num(o.p75) : null, p90: o ? num(o.p90) : null, p99: o ? num(o.p99) : null,
          goodShare: o && Number(o.n) ? Math.round((Number(o.good) / Number(o.n)) * 100) : null,
        };
      }),
      trend: trend.map((t) => ({ metric: t.metric, bucket: t.bucket, p75: num(t.p75) })),
      pages: byPage.map((r) => ({ path: r.path, samples: Number(r.samples), lcp: num(r.lcp), cls: num(r.cls), inp: num(r.inp), fcp: num(r.fcp), ttfb: num(r.ttfb) })),
    };
  });

  // Recent visitor sessions (Rybbit-style live feed). Pageviews are grouped per visitor
  // and split into sessions on a 30-min inactivity gap; each session carries its ordered
  // page timeline, entry/exit, duration, device/geo, and a `live` flag (active < 5 min
  // ago). Built from the pageview stream we already collect — no extra recording needed.
  app.get('/admin/analytics/sessions', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 40, 1), 100);
    // Pull the most recent events, then sessionize newest-first in JS (bounded scan).
    const rows = await p.analyticsEvent.findMany({
      where: { visitor: { not: null } },
      orderBy: { createdAt: 'desc' }, take: 4000,
      select: { visitor: true, path: true, ref: true, device: true, browser: true, os: true, country: true, region: true, city: true, lat: true, lng: true, createdAt: true },
    });
    const GAP = 30 * 60e3, LIVE = 5 * 60e3, now = Date.now();
    // Group by visitor (events are desc; reverse each group to chronological).
    const byVisitor = new Map();
    for (const e of rows) { if (!byVisitor.has(e.visitor)) byVisitor.set(e.visitor, []); byVisitor.get(e.visitor).push(e); }
    const sessions = [];
    for (const [visitor, evs] of byVisitor) {
      evs.reverse(); // chronological
      let cur = null;
      for (const e of evs) {
        const t = new Date(e.createdAt).getTime();
        if (!cur || t - cur._last > GAP) {
          cur = { visitor, start: e.createdAt, _startMs: t, _last: t, events: [], device: e.device, browser: e.browser, os: e.os, country: e.country, region: e.region, city: e.city, lat: e.lat, lng: e.lng, ref: e.ref };
          sessions.push(cur);
        }
        cur.events.push({ path: e.path, at: e.createdAt });
        cur._last = t; cur.end = e.createdAt;
      }
    }
    sessions.sort((a, b) => b._startMs - a._startMs);
    const out = sessions.slice(0, limit).map((s) => ({
      visitor: s.visitor, start: s.start, end: s.end,
      durationSec: Math.max(0, Math.round((new Date(s.end).getTime() - s._startMs) / 1000)),
      pages: s.events.length, entry: s.events[0]?.path, exit: s.events[s.events.length - 1]?.path,
      events: s.events, device: s.device, browser: s.browser, os: s.os,
      country: s.country, region: s.region, city: s.city, lat: s.lat, lng: s.lng, ref: s.ref,
      live: now - new Date(s.end).getTime() < LIVE,
    }));
    return { sessions: out, liveCount: out.filter((s) => s.live).length };
  });
}
