// BetterCommunity Web API. Boots Fastify, wires Postgres (Prisma) + Redis, and
// registers the feature routes. See ARCHITECTURE.md for the design.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { db } from './lib/lib.mjs';
import { getRedis } from './lib/redis.mjs';
import { ensureBucket } from './lib/storage.mjs';
import { startSweeper } from './lib/sweeper.mjs';
import authRoutes from './routes/auth.mjs';
import catalogRoutes from './routes/catalog.mjs';
import communityCatalogRoutes from './routes/catalogs.mjs';
import miscRoutes from './routes/misc.mjs';
import newsletterRoutes from './routes/newsletter.mjs';
import uploadRoutes from './routes/uploads.mjs';
import hostingRoutes from './routes/hosting.mjs';
import stripeWebhook from './routes/stripe-webhook.mjs';
import analyticsRoutes from './routes/analytics.mjs';
import projectRoutes from './routes/projects.mjs';
import blogRoutes from './routes/blog.mjs';
import docRoutes from './routes/docs.mjs';
import faqRoutes from './routes/faq.mjs';
import gameRoutes from './routes/game.mjs';
import apiTokenRoutes from './routes/api-tokens.mjs';
import avatarRoutes from './routes/avatar.mjs';
import repoRoutes, { recheckRepos } from './routes/repos.mjs';
import hostingContentRoutes from './routes/hosting-content.mjs';
import repoDashboardRoutes from './routes/repo-dashboard.mjs';
import promoRoutes from './routes/promo.mjs';
import campaignRoutes from './routes/campaigns.mjs';
import eventRoutes from './routes/events.mjs';
import oidcProviderRoutes from './routes/oidc-provider.mjs';
import linkRoutes from './routes/links.mjs';
import botRoutes from './routes/bot.mjs';
import showcaseRoutes from './routes/showcase.mjs';
import announcementRoutes from './routes/announcements.mjs';
import accessPolicyRoutes from './routes/access-policy.mjs';
import serverControlRoutes from './routes/server-control.mjs';
import telemetryRoutes from './routes/telemetry.mjs';
import serverPerfRoutes from './routes/server-perf.mjs';
import kofiRoutes from './routes/kofi.mjs';
import oauthRoutes from './routes/oauth.mjs';
import ogRoutes from './routes/og.mjs';
import socialRoutes from './routes/social.mjs';
import reportRoutes from './routes/reports.mjs';
import connectionRoutes from './routes/connections.mjs';
import { recordRequest } from './lib/monitor.mjs';
import { installAbuseGuards } from './lib/abuse.mjs';

// Fail-safe: never boot in production with the insecure default JWT secret — that
// would let anyone forge session tokens (incl. ADMIN) (CWE-798). Force a real one.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-only-insecure-secret')) {
  console.error('[fatal] JWT_SECRET is unset or the insecure default — set a strong secret before running in production.');
  process.exit(1);
}

const app = Fastify({ logger: true });

// CORS: the web app is same-origin (/api via Caddy). Reflecting any origin with
// credentials (origin:true) would be a permissive-CORS weakness (CWE-942), so we
// deny cross-origin by default and only allow an explicit list: the Tauri desktop
// app (BMM — a legitimate cross-origin client at tauri.localhost) plus anything set
// via CORS_ORIGINS.
const TAURI_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const corsAllow = new Set([...TAURI_ORIGINS, ...corsOrigins]);
await app.register(cors, {
  origin: (origin, cb) => cb(null, !origin || corsAllow.has(origin)), // no Origin (same-origin / server) or allow-listed
  credentials: true,
});
await app.register(cookie);
// Rate-limit per *real* client IP — the last X-Forwarded-For entry Caddy appends —
// not the socket peer, which behind the proxy is one shared bucket for every visitor
// (that made normal browsing trip 429s). Auth endpoints keep their stricter override.
const clientKey = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip || '0.0.0.0';
};
// `ban: 4` — after an IP exceeds the limit 4 windows in a row the plugin stops
// even counting and just 403s it, so a sustained flood from one address costs
// almost nothing to reject. keyGenerator is the real client IP (see above).
// Back the limiter with Redis when available so the per-IP budget is SHARED across
// every API replica (behind Caddy) instead of each replica keeping its own count —
// otherwise N replicas would let an IP do N×600/min. Falls back to in-process.
const rlRedis = getRedis();
await app.register(rateLimit, {
  max: 600, timeWindow: '1 minute', keyGenerator: clientKey, ban: 4,
  ...(rlRedis ? { redis: rlRedis } : {}),
  // The plugin THROWS whatever this returns — so it must carry a statusCode, else
  // Fastify's default handler turns it into a 500 (was logging every rate-limit as
  // an error). Return an Error with the plugin's status (429, or 403 on ban) + a
  // `payload` our error handler sends as the JSON body.
  errorResponseBuilder: (req, ctx) => {
    const err = new Error('rate_limited');
    err.statusCode = ctx.statusCode;
    err.payload = { error: 'rate_limited', retryAfterSec: Math.ceil(ctx.ttl / 1000) };
    return err;
  },
});
// Central error handler: 4xx (rate limit, validation, thrown client errors) reply
// cleanly and are NOT logged at error level — that killed the flood of level-50
// "rate_limited → 500" lines. Only real 5xx are logged as errors.
app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status < 500) return reply.code(status).send(err.payload || { error: err.message || 'error' });
  req.log.error({ err: { message: err.message, stack: err.stack }, url: req.url }, 'request error');
  return reply.code(500).send({ error: 'internal_error' });
});
// Anti-bot / anti-scan guards (bad-UA denylist + repeat-offender soft block),
// running before any route. Runs after rate-limit so a banned IP is cheap.
installAbuseGuards(app);

// ── Health probes ─────────────────────────────────────────────────────────────
// Split on purpose, for load-balancer / Kubernetes semantics:
//  • /live  — LIVENESS: cheap, NO dependencies. "Is the event loop responding?" A
//    liveness failure means "restart me". It deliberately never touches the DB: if
//    Postgres is down, restarting won't help and would just crash-loop the pod.
//  • /ready — READINESS: checks the deps needed to actually serve (DB). A 503 means
//    "pull me out of the LB rotation until deps recover" WITHOUT killing the process.
//  • /health — the original combined probe, kept unchanged so the Docker healthcheck
//    and Caddy's `depends_on` keep working: always 200 with a `db` flag (never 5xx).
// All are exempt from the rate limiter (probes hammer them) and silence their logs.
const PROBE_OPTS = { config: { rateLimit: false }, logLevel: 'silent' };
app.get('/live', PROBE_OPTS, async () => ({ ok: true, ts: Date.now() }));
app.get('/health', PROBE_OPTS, async () => {
  let dbOk = false;
  try { await (await db()).$queryRaw`SELECT 1`; dbOk = true; } catch { /* not ready */ }
  return { ok: true, db: dbOk, ts: Date.now() };
});
app.get('/ready', PROBE_OPTS, async (req, reply) => {
  let dbOk = false;
  try { await (await db()).$queryRaw`SELECT 1`; dbOk = true; } catch { /* not ready */ }
  return dbOk ? { ok: true, db: true, ts: Date.now() }
             : reply.code(503).send({ ok: false, db: false, ts: Date.now() });
});

// Feeds the server-perf dashboard's response-time/status-code stats (monitor.mjs
// flushes + persists this on each sweeper tick). Cheap: just two subtractions.
app.addHook('onResponse', (req, reply, done) => {
  recordRequest(reply.elapsedTime, reply.statusCode, req.url, reply.getHeader('content-length'));
  done();
});

await app.register(authRoutes);
await app.register(catalogRoutes);
await app.register(communityCatalogRoutes);
await app.register(miscRoutes);
await app.register(newsletterRoutes);
await app.register(uploadRoutes);
await app.register(hostingRoutes);
await app.register(analyticsRoutes);
await app.register(projectRoutes);
await app.register(blogRoutes);
await app.register(docRoutes);
await app.register(faqRoutes);
await app.register(gameRoutes);
await app.register(apiTokenRoutes);
await app.register(avatarRoutes);
await app.register(repoRoutes);
await app.register(hostingContentRoutes);
await app.register(repoDashboardRoutes);
await app.register(promoRoutes);
await app.register(campaignRoutes);
await app.register(eventRoutes);
await app.register(oidcProviderRoutes);
await app.register(linkRoutes);
await app.register(botRoutes);
await app.register(showcaseRoutes);
await app.register(announcementRoutes);
await app.register(accessPolicyRoutes);
await app.register(serverControlRoutes);
await app.register(telemetryRoutes);
await app.register(serverPerfRoutes);
await app.register(kofiRoutes);
await app.register(oauthRoutes);
await app.register(ogRoutes); // crawler link-unfurl prerender (og:title/image per page)
await app.register(socialRoutes); // profile badges + public profiles + user search
await app.register(reportRoutes); // user reports + support threads + admin moderation
await app.register(connectionRoutes); // social profile connections (youtube/twitch/github/steam)
await app.register(stripeWebhook); // encapsulated: raw-body for Stripe signature

// Make sure the object-storage bucket exists (non-fatal if storage isn't up yet).
ensureBucket().catch((e) => app.log.warn({ e: String(e) }, 'ensureBucket failed (will retry on demand)'));

// One-time backfill of the freePlan provenance flag (marker-guarded, best effort):
// hosted repos with no HOSTING payment whose owner holds a REPO FreeTierClaim were
// provisioned through the real Free plan → flag them (and their pool). Everything
// else (admin-provisioned, promo grants) stays freePlan=false — see capacityStatus().
(async () => {
  const p = await db();
  if (await p.adminSetting.findUnique({ where: { key: 'migr.freePlanBackfill' } })) return;
  const claims = await p.freeTierClaim.findMany({ where: { kind: 'REPO' }, select: { userId: true } });
  const claimants = [...new Set(claims.map((c) => c.userId))];
  let flagged = 0;
  if (claimants.length) {
    const paid = await p.payment.findMany({ where: { kind: 'HOSTING', serverRepoId: { not: null } }, select: { serverRepoId: true } });
    const paidIds = new Set(paid.map((x) => x.serverRepoId));
    const repos = await p.serverRepo.findMany({ where: { hosted: true, ownerId: { in: claimants } }, select: { id: true, groupId: true } });
    const candidates = repos.filter((r) => !paidIds.has(r.id));
    const groupIds = [...new Set(candidates.map((r) => r.groupId).filter(Boolean))];
    if (candidates.length) ({ count: flagged } = await p.serverRepo.updateMany({ where: { id: { in: candidates.map((r) => r.id) } }, data: { freePlan: true } }));
    if (groupIds.length) await p.hostingGroup.updateMany({ where: { id: { in: groupIds } }, data: { freePlan: true } });
  }
  await p.adminSetting.create({ data: { key: 'migr.freePlanBackfill', value: { at: new Date().toISOString(), flagged } } });
  app.log.info(`[migr] freePlan backfill: flagged ${flagged} repo(s)`);
})().catch((e) => app.log.warn({ e: String(e) }, 'freePlan backfill failed (will retry next boot)'));

// Periodic sweep: hard-delete items/repos whose 72h grace window has elapsed.
startSweeper(app);

// Periodic repo re-verification (health + SHA) so listed statuses stay fresh.
const repoRecheckTimer = setInterval(() => recheckRepos().then((r) => { if (r.checked) app.log.info(`[repos] re-checked ${r.checked} (${r.online} online, ${r.verified} verified)`); }).catch(() => {}), 15 * 60 * 1000);

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`BCWEB API listening on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// On SIGTERM/SIGINT (`docker stop`, `compose up --build` replacing the container,
// a Kubernetes rolling deploy) stop accepting new connections, let in-flight
// requests finish, then close the DB/Redis handles — so a redeploy never drops a
// live request or leaks a connection. A hard timeout guarantees we still exit even
// if a request is wedged. This is what makes zero-downtime rollouts possible today
// and is exactly the SIGTERM contract Kubernetes expects.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;                 // a second signal shouldn't re-enter
  shuttingDown = true;
  app.log.info(`[shutdown] ${signal} received — draining in-flight requests…`);
  const hard = setTimeout(() => { app.log.error('[shutdown] drain timed out — forcing exit'); process.exit(1); }, 10_000);
  hard.unref();                             // don't let the timer itself keep us alive
  try {
    clearInterval(repoRecheckTimer);
    await app.close();                      // stops the listener, awaits open requests
    try { await (await db()).$disconnect(); } catch { /* already gone */ }
    try { await getRedis()?.quit(); } catch { /* already gone */ }
    clearTimeout(hard);
    app.log.info('[shutdown] clean exit');
    process.exit(0);
  } catch (e) {
    app.log.error(e, '[shutdown] error during close');
    process.exit(1);
  }
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => shutdown(sig));
