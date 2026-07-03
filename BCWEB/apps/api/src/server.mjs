// BetterCommunity Web API. Boots Fastify, wires Postgres (Prisma) + Redis, and
// registers the feature routes. See ARCHITECTURE.md for the design.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { db } from './lib.mjs';
import { ensureBucket } from './storage.mjs';
import { startSweeper } from './sweeper.mjs';
import authRoutes from './routes/auth.mjs';
import catalogRoutes from './routes/catalog.mjs';
import miscRoutes from './routes/misc.mjs';
import uploadRoutes from './routes/uploads.mjs';
import hostingRoutes from './routes/hosting.mjs';
import stripeWebhook from './routes/stripe-webhook.mjs';
import analyticsRoutes from './routes/analytics.mjs';
import projectRoutes from './routes/projects.mjs';
import blogRoutes from './routes/blog.mjs';
import repoRoutes, { recheckRepos } from './routes/repos.mjs';
import hostingContentRoutes from './routes/hosting-content.mjs';
import repoDashboardRoutes from './routes/repo-dashboard.mjs';
import promoRoutes from './routes/promo.mjs';
import linkRoutes from './routes/links.mjs';
import botRoutes from './routes/bot.mjs';
import showcaseRoutes from './routes/showcase.mjs';
import announcementRoutes from './routes/announcements.mjs';
import accessPolicyRoutes from './routes/access-policy.mjs';
import serverControlRoutes from './routes/server-control.mjs';
import serverPerfRoutes from './routes/server-perf.mjs';
import kofiRoutes from './routes/kofi.mjs';
import oauthRoutes from './routes/oauth.mjs';
import { recordRequest } from './monitor.mjs';
import { installAbuseGuards } from './abuse.mjs';

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
await app.register(rateLimit, {
  max: 600, timeWindow: '1 minute', keyGenerator: clientKey, ban: 4,
  errorResponseBuilder: (req, ctx) => ({ error: 'rate_limited', retryAfterSec: Math.ceil(ctx.ttl / 1000) }),
});
// Anti-bot / anti-scan guards (bad-UA denylist + repeat-offender soft block),
// running before any route. Runs after rate-limit so a banned IP is cheap.
installAbuseGuards(app);

app.get('/health', async () => {
  let dbOk = false;
  try { await (await db()).$queryRaw`SELECT 1`; dbOk = true; } catch { /* not ready */ }
  return { ok: true, db: dbOk, ts: Date.now() };
});

// Feeds the server-perf dashboard's response-time/status-code stats (monitor.mjs
// flushes + persists this on each sweeper tick). Cheap: just two subtractions.
app.addHook('onResponse', (req, reply, done) => {
  recordRequest(reply.elapsedTime, reply.statusCode);
  done();
});

await app.register(authRoutes);
await app.register(catalogRoutes);
await app.register(miscRoutes);
await app.register(uploadRoutes);
await app.register(hostingRoutes);
await app.register(analyticsRoutes);
await app.register(projectRoutes);
await app.register(blogRoutes);
await app.register(repoRoutes);
await app.register(hostingContentRoutes);
await app.register(repoDashboardRoutes);
await app.register(promoRoutes);
await app.register(linkRoutes);
await app.register(botRoutes);
await app.register(showcaseRoutes);
await app.register(announcementRoutes);
await app.register(accessPolicyRoutes);
await app.register(serverControlRoutes);
await app.register(serverPerfRoutes);
await app.register(kofiRoutes);
await app.register(oauthRoutes);
await app.register(stripeWebhook); // encapsulated: raw-body for Stripe signature

// Make sure the object-storage bucket exists (non-fatal if storage isn't up yet).
ensureBucket().catch((e) => app.log.warn({ e: String(e) }, 'ensureBucket failed (will retry on demand)'));

// Periodic sweep: hard-delete items/repos whose 72h grace window has elapsed.
startSweeper(app);

// Periodic repo re-verification (health + SHA) so listed statuses stay fresh.
setInterval(() => recheckRepos().then((r) => { if (r.checked) app.log.info(`[repos] re-checked ${r.checked} (${r.online} online, ${r.verified} verified)`); }).catch(() => {}), 15 * 60 * 1000);

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`BCWEB API listening on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
