// BetterCommunity Web API. Boots Fastify, wires Postgres (Prisma) + Redis, and
// registers the feature routes. See ARCHITECTURE.md for the design.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { db } from './lib/lib.mjs';
import { startFlagRefresh } from './lib/flags.mjs';
import { getRedis } from './lib/redis.mjs';
import { ensureBucket } from './lib/storage.mjs';
import { startSweeper } from './lib/sweeper.mjs';
import { recordServerError, pathOnly } from './lib/errorlog.mjs';
import authRoutes from './routes/auth.mjs';
import catalogRoutes from './routes/catalog.mjs';
import communityCatalogRoutes from './routes/catalogs.mjs';
import miscRoutes from './routes/misc.mjs';
import contentBackupRoutes from './routes/content-backup.mjs';
import historyRoutes from './routes/history.mjs';
import transferRoutes from './routes/transfers.mjs';
import closureRoutes from './routes/closure.mjs';
import myBackupRoutes from './routes/my-backup.mjs';
import sanctionRoutes from './routes/sanctions.mjs';
import webhookRoutes from './routes/webhooks.mjs';
import devtoolRoutes from './routes/devtools.mjs';
import pollRoutes from './routes/polls.mjs';
import charityRoutes from './routes/charity.mjs';
import localeRoutes from './routes/locales.mjs';
import newsletterRoutes from './routes/newsletter.mjs';
import uploadRoutes from './routes/uploads.mjs';
import platformAssetRoutes from './routes/platform-assets.mjs';
import hostingRoutes from './routes/hosting.mjs';
import marketplaceRoutes from './routes/marketplace.mjs';
import stripeWebhook from './routes/stripe-webhook.mjs';
import analyticsRoutes from './routes/analytics.mjs';
import projectRoutes from './routes/projects.mjs';
import blogRoutes from './routes/blog.mjs';
import docRoutes from './routes/docs.mjs';
import faqRoutes from './routes/faq.mjs';
import gameRoutes from './routes/game.mjs';
import apiKeyRoutes from './routes/api-keys.mjs';
import avatarRoutes from './routes/avatar.mjs';
import repoRoutes, { recheckRepos } from './routes/repos.mjs';
import hostingContentRoutes from './routes/hosting-content.mjs';
import repoDashboardRoutes from './routes/repo-dashboard.mjs';
import repoAgentRoutes from './routes/repo-agent.mjs';
import domainRoutes, { resolveHostTarget } from './routes/domains.mjs';
import promoRoutes from './routes/promo.mjs';
import campaignRoutes from './routes/campaigns.mjs';
import eventRoutes from './routes/events.mjs';
import oidcProviderRoutes from './routes/oidc-provider.mjs';
import linkRoutes from './routes/links.mjs';
import botRoutes from './routes/bot.mjs';
import showcaseRoutes from './routes/showcase.mjs';
import showcaseRequestRoutes from './routes/showcase-requests.mjs';
import announcementRoutes from './routes/announcements.mjs';
import roleRoutes from './routes/roles.mjs';
import myoRoutes from './routes/myo.mjs';
import accessPolicyRoutes from './routes/access-policy.mjs';
import siteBanRoutes from './routes/site-bans.mjs';
import { installSiteBans } from './lib/siteban.mjs';
import serverControlRoutes from './routes/server-control.mjs';
import telemetryRoutes from './routes/telemetry.mjs';
import serverPerfRoutes from './routes/server-perf.mjs';
import kofiRoutes from './routes/kofi.mjs';
import oauthRoutes from './routes/oauth.mjs';
import ogRoutes from './routes/og.mjs';
import socialRoutes from './routes/social.mjs';
import statusRoutes from './routes/status.mjs';
import codeWebhookRoutes from './routes/code-webhook.mjs';
import reportRoutes from './routes/reports.mjs';
import feedbackRoutes from './routes/feedback.mjs';
import jwt from 'jsonwebtoken';
import connectionRoutes from './routes/connections.mjs';
import { recordRequest } from './lib/monitor.mjs';
import { registerApiUsageHook, flushApiUsage } from './lib/apiusage.mjs';
import { installAbuseGuards } from './lib/abuse.mjs';
import { productionSecretProblems, formatProblems, isProduction, productionSiteUrlProblem, formatSiteUrlProblem } from './lib/boot-guard.mjs';

// Fail-safe: never boot in production on a secret that is in the repository (CWE-798).
//
// This covered JWT_SECRET only. The secrets map found the rest — LINK_LOOKUP_SECRET falls
// back to 'dev-bot-secret' in four route files with no guard anywhere, so an instance
// deployed without it authenticates the /bot/* endpoints and the telemetry link lookup with
// a value anybody reading the repository knows. It fails open, silently, and works.
//
// A failed boot is loud and fixed in a minute; a silent one is found by whoever reads the
// repository first.
if (isProduction(process.env)) {
  const siteProblem = productionSiteUrlProblem(process.env);
  // A localhost SITE_URL is a WARNING, not a stop: the bundled compose is the production
  // artifact yet is also what people run locally, where localhost is correct and is the
  // shipped default. It is logged loudly so a real cloud deploy that left it there sees it.
  // Everything else about SITE_URL (unset, unparseable, non-https) is a hard stop.
  const fatalSite = siteProblem && siteProblem.severity !== 'warning';
  const problems = productionSecretProblems(process.env);
  if (siteProblem && siteProblem.severity === 'warning') {
    console.warn('[warn] ' + formatSiteUrlProblem(siteProblem).trim());
  }
  if (problems.length || fatalSite) {
    console.error('[fatal] refusing to start in production:');
    if (problems.length) console.error(formatProblems(problems));
    if (fatalSite) console.error(formatSiteUrlProblem(siteProblem));
    process.exit(1);
  }
}

// `logger: true` alone logs `req.url` RAW on every incoming request, and on this API the
// query string is sometimes the credential: `/r/<id>?k=<shareKey>` is how a private repo
// is shared, and repo sync accepts `?password=` as an alternative to the X-Repo-Password
// header (presentedPassword, hosting-content.mjs). So every hit on a private link wrote a
// live secret into stdout — which is exactly what gets shipped to a log pipeline (CWE-532).
//
// Verified before fixing, by requesting a URL carrying canary values and reading the
// container's log: the line was
//   {"level":30,"req":{"url":"/r/…?k=LEAKCANARY123&password=PWCANARY456"},"msg":"incoming request"}
//
// The custom serialiser keeps everything the default one gives (method, host, remote
// address) and replaces `url` with the path. The KEY NAMES are kept — knowing a request
// carried `k` is useful when reading a log, knowing its value is a breach.
const app = Fastify({
  logger: {
    serializers: {
      req(req) {
        const raw = String(req.url || '');
        const q = raw.indexOf('?');
        const path = q === -1 ? raw : raw.slice(0, q);
        const keys = q === -1 ? null : [...new URLSearchParams(raw.slice(q + 1)).keys()];
        return {
          method: req.method,
          url: path,
          ...(keys && keys.length ? { queryKeys: keys } : {}),
          host: req.headers?.host,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        };
      },
    },
  },
});

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

// The per-IP ceiling, settable from Admin -> Hosting settings.
//
// It was env-only and read once at boot, so changing it meant editing .env and restarting
// the API - which nobody does at the moment they actually need it, i.e. while something is
// hammering the site.
//
// REFRESHED ON A TIMER, not per request. `max` runs on every single request; making it
// await a database read would put the DB on the hot path of the thing that protects the
// DB, and a slow query would become a slow site. A 15s-stale ceiling is harmless.
const RL_ENV_MAX = Number(process.env.RATE_LIMIT_MAX) || 600;
// Clamped, because this is reachable from a form. Below ~30/min ordinary browsing trips
// 429s (a single page load is several requests), and an unbounded value is a way to switch
// the protection off by typing a large number rather than by deciding to.
const RL_MIN = 30;
const RL_MAX = 100000;
let rlMax = RL_ENV_MAX;
async function refreshRateLimit() {
  try {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'hosting.apiRateLimitMax' } });
    const v = Number(row?.value);
    // Unset, zero or nonsense -> the env default. An admin clearing the field means "use
    // the default", not "allow nothing".
    rlMax = Number.isFinite(v) && v > 0 ? Math.min(RL_MAX, Math.max(RL_MIN, Math.round(v))) : RL_ENV_MAX;
  } catch { /* leave the current value; a DB blip must not change the ceiling */ }
}
await refreshRateLimit();
// Loaded before the first request, then refreshed on a timer. A route asking "is payments
// on?" must never be the thing that opens a database connection.
await startFlagRefresh();
const rlTimer = setInterval(refreshRateLimit, 15_000);
rlTimer.unref?.();   // never hold the process open on this

// Per-ACCOUNT ceiling, on top of the per-IP one. Set from Admin → Feedback & crashes → limits
// (AdminSetting hosting.apiRateLimitPerAccount, requests per minute; 0 = off). Reads the
// session cookie without touching the database — a limiter that costs a query per request
// would be the load it exists to prevent.
const ACCT_JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
let rlAcct = 0;
async function refreshAcctLimit() {
  try {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'hosting.apiRateLimitPerAccount' } });
    const v = Number(row?.value);
    rlAcct = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  } catch { /* keep the current value */ }
}
await refreshAcctLimit();
const acctTimer = setInterval(refreshAcctLimit, 15_000);
acctTimer.unref?.();
// Our own hostname, resolved once. Every request compares against it, so parsing the URL
// per request would be work done millions of times to get the same answer.
const OWN_HOST = (() => { try { return new URL(process.env.SITE_URL || '').hostname.toLowerCase(); } catch { return ''; } })();
const acctHits = new Map();
app.addHook('onRequest', async (req, reply) => {
  if (!rlAcct) return;
  const tok = req.cookies?.bcw_session;
  if (!tok) return;
  let uid;
  try { uid = jwt.verify(tok, ACCT_JWT_SECRET)?.uid; } catch { return; }
  if (!uid) return;
  const now = Date.now();
  const rec = acctHits.get(uid);
  if (!rec || now - rec.at >= 60_000) {
    if (acctHits.size > 50_000) acctHits.clear();
    acctHits.set(uid, { at: now, n: 1 });
    return;
  }
  if (++rec.n > rlAcct) {
    reply.code(429).send({ error: 'rate_limited', retryAfterSec: Math.ceil((60_000 - (now - rec.at)) / 1000) });
    return reply;
  }
});

await app.register(rateLimit, {
  // 600/min per IP is generous for a human (~10 req/s) and is what keeps the DB safe under
  // abuse — keep it in production. Env-tunable so an operator can adjust it, and so a load
  // test can raise it to measure a route's RAW capacity (from one IP the limiter otherwise
  // sheds the flood and every number is just 429s). See guides/ENV + loadtest/BENCHMARK.
  // Sync, reading the value the timer above keeps fresh.
  max: () => rlMax,
  timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
  keyGenerator: clientKey, ban: 4,
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
  // PATH only. `req.url` carries the query string, and on this API the query string is
  // sometimes the secret: `/r/<id>?k=<shareKey>` for a private repo, `?password=` for repo
  // sync. A 500 on either wrote a live credential into stdout — and stdout is what gets
  // shipped to a log pipeline (CWE-532). The ErrorEvent row was already sanitised; only the
  // log line was not.
  req.log.error({ err: { message: err.message, stack: err.stack }, path: pathOnly(req.url) }, 'request error');
  // …and record it, so the admin Errors page shows API failures too. It only ever held
  // browser-reported errors (POST /analytics/error, which is consent-gated), so a 500 was
  // invisible to anyone not tailing stdout — the client saw {error:'internal_error'} and
  // the dashboard stayed empty. Fire-and-forget and fully swallowed: an error handler that
  // can throw (or that awaits a dead DB) turns one failure into two.
  recordServerError(req, err);
  return reply.code(500).send({ error: 'internal_error' });
});
// Anti-bot / anti-scan guards (bad-UA denylist + repeat-offender soft block),
// running before any route. Runs after rate-limit so a banned IP is cheap.
installAbuseGuards(app);
// Site-wide bans (admin lists) + the shield that blocks an address after too many 429s.
installSiteBans(app);

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

// ── Custom domains ────────────────────────────────────────────────────────────────────────
//
// A request arriving on a hostname that is not ours is rewritten to whatever that name points
// at, so `https://mods.example.com/foo.zip` reaches exactly the handler
// `/hosting/<ownerSlug>/<repoSlug>/files/foo.zip` would. Everything downstream — the access
// lists, the sync password, the counters, the autoindex switch — is the code that was already
// there; this only changes the path it sees.
//
// The lookup is skipped entirely for our own host, which is every request in practice, and
// memoised for a minute otherwise. Without that this would be a database round trip on every
// request in the system, added for a feature almost nobody is using at any given moment.
const _hostCache = new Map();
const HOST_TTL_MS = 60_000;
app.addHook('onRequest', async (req) => {
  const raw = String(req.headers.host || '');
  if (!raw) return;
  const host = raw.split(':')[0].toLowerCase();
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === OWN_HOST || host.endsWith(`.${OWN_HOST}`)) return;
  const now = Date.now();
  let hit = _hostCache.get(host);
  if (!hit || now - hit.at > HOST_TTL_MS) {
    let target = null;
    try { target = await resolveHostTarget(await db(), host); } catch { target = null; }
    if (_hostCache.size > 5000) _hostCache.clear();
    hit = { at: now, target };
    _hostCache.set(host, hit);
  }
  if (!hit.target) return;
  const url = req.raw.url || '/';
  const [path, query] = url.split('?');
  const q = query ? `?${query}` : '';
  if (hit.target.kind === 'repo') {
    const base = `/hosting/${hit.target.hostPath}`;
    // The apex of a repo domain is its manifest: a client handed "mods.example.com" and
    // nothing else is asking for the repo, and the repo IS repo.json.
    req.raw.url = (path === '/' || path === '')
      ? `${base}/repo.json${q}`
      : `${base}/files${path}${q}`;
  } else {
    const base = `/c/${hit.target.slug}`;
    req.raw.url = (path === '/' || path === '') ? `${base}/catalog.json${q}` : `${base}${path}${q}`;
  }
});

// Feeds the server-perf dashboard's response-time/status-code stats (monitor.mjs
// flushes + persists this on each sweeper tick). Cheap: just two subtractions.
app.addHook('onResponse', (req, reply, done) => {
  recordRequest(reply.elapsedTime, reply.statusCode, req.url, reply.getHeader('content-length'));
  done();
});
// The API-key half of the same job, defined next to the recorder so the tests can register
// the identical rule (see lib/apiusage.mjs).
registerApiUsageHook(app);

await app.register(authRoutes);
await app.register(catalogRoutes);
await app.register(communityCatalogRoutes);
await app.register(miscRoutes);
await app.register(contentBackupRoutes);
await app.register(historyRoutes);
await app.register(transferRoutes);
await app.register(closureRoutes);
await app.register(myBackupRoutes);
await app.register(sanctionRoutes);
await app.register(webhookRoutes);
await app.register(devtoolRoutes);
await app.register(pollRoutes);
await app.register(charityRoutes);
await app.register(localeRoutes);
await app.register(newsletterRoutes);
await app.register(uploadRoutes);
await app.register(platformAssetRoutes);
await app.register(hostingRoutes);
await app.register(marketplaceRoutes);
await app.register(analyticsRoutes);
await app.register(projectRoutes);
await app.register(blogRoutes);
await app.register(docRoutes);
await app.register(faqRoutes);
await app.register(gameRoutes);
await app.register(apiKeyRoutes);
await app.register(avatarRoutes);
await app.register(repoRoutes);
await app.register(hostingContentRoutes);
await app.register(repoDashboardRoutes);
await app.register(repoAgentRoutes);
await app.register(domainRoutes);
await app.register(promoRoutes);
await app.register(campaignRoutes);
await app.register(eventRoutes);
await app.register(oidcProviderRoutes);
await app.register(linkRoutes);
await app.register(botRoutes);
await app.register(showcaseRoutes);
await app.register(showcaseRequestRoutes);
await app.register(announcementRoutes);
await app.register(roleRoutes); // custom roles + per-project edit grants
await app.register(myoRoutes); // "Make Your Own" commission service
await app.register(accessPolicyRoutes);
await app.register(siteBanRoutes);
await app.register(serverControlRoutes);
await app.register(telemetryRoutes);
await app.register(serverPerfRoutes);
await app.register(kofiRoutes);
await app.register(oauthRoutes);
await app.register(ogRoutes); // crawler link-unfurl prerender (og:title/image per page)
await app.register(socialRoutes); // profile badges + public profiles + user search
await app.register(reportRoutes); // user reports + support threads + admin moderation
await app.register(feedbackRoutes); // feedback & crash centre (per-project inbox for BMM and friends)
await app.register(connectionRoutes); // social profile connections (youtube/twitch/github/steam)
await app.register(statusRoutes); // public status page: service uptime, incidents, alert sign-up
await app.register(codeWebhookRoutes); // encapsulated: raw-body for the GitHub HMAC
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

// Backfill Subscription.poolContribBytes = its pool's poolBytes for pre-existing pool subs
// (the new column defaults to 0; without this, recomputePoolBytes would zero those pools and
// wrongly suspend their content). Idempotent — only touches 0-contrib pool subs.
(async () => {
  const p = await db();
  const n = await p.$executeRawUnsafe(`UPDATE "Subscription" s SET "poolContribBytes" = g."poolBytes" FROM "HostingGroup" g WHERE s."hostingGroupId" = g."id" AND s."poolContribBytes" = 0 AND g."poolBytes" > 0`);
  if (n) app.log.info(`[migr] poolContribBytes backfill: set ${n} pool sub(s)`);
})().catch((e) => app.log.warn({ e: String(e) }, 'poolContribBytes backfill failed (will retry next boot)'));

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
    // After close, so the last requests are counted: the flush is buffered work, and the
    // whole point of draining is that those calls really happened.
    try { await flushApiUsage(); } catch { /* statistics are not worth blocking an exit */ }
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
