import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { db, requireRole, safeEqual } from '../lib/lib.mjs';

// Server-to-server auth for the Discord bot (shared secret, like the telemetry link
// lookup). The bot sends `x-bot-secret`; anything else is rejected.
const BOT_SECRET = () => process.env.BOT_SHARED_SECRET || process.env.LINK_LOOKUP_SECRET || 'dev-bot-secret';
function botAuth(req, reply) {
  if (!safeEqual(req.headers['x-bot-secret'] || '', BOT_SECRET())) { reply.code(401).send({ error: 'unauthorized' }); return false; }
  return true;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
const genCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('').replace(/(.{4})(.{4})/, '$1-$2');

// Default bot configuration. Admins edit a subset from the dashboard; the bot reads
// the merged result. Kept here so a fresh install has sane values.
const DEFAULT_BOT_CONFIG = {
  enabled: true,
  moderation: { enabled: true, antiSelfbot: true, purgeChannelId: '', clearMax: 100 },
  joinToCreate: { enabled: true, lobbyChannelId: '', categoryId: '', tempCategoryName: 'Temp Voice', renameCooldownSec: 720 },
  welcome: { enabled: true, channelId: '', joinMessage: 'Welcome {user} to {servername}! You are member #{joinnumber}.', leaveMessage: '{user} left the server.', gifBg: 'dark' },
  // Multi-role gating: each rule grants one role to members meeting ITS own
  // requirements. Legacy single-role fields (roleId/requireX) are still honoured
  // by the bot when `rules` is empty, so old configs keep working.
  gating: { enabled: false, rules: [], requireBmm: false, requireDiscord: true, requireBcweb: true, roleId: '', channelIds: [] },
  // Blog announcements: when enabled, the bot posts new PUBLISHED blog posts
  // (title + excerpt + link + cover) to one or more routes. Each route targets a
  // channel (in ANY server the bot is in — a channel id is globally unique) and a
  // set of blog "sources" to include: '*' (all), a fixed project key (bmm/bsm/
  // community/installer), or 'showcase' (every Other-projects page). The legacy
  // single `channelId` is still honoured by the bot as an all-sources route so old
  // configs keep working.
  blog: { enabled: false, channelId: '', routes: [] },
  // Server-perf alerts (CPU/RAM/disk/service-down — see monitor.mjs): when
  // enabled, the bot posts each fired ServerAlertLog to this channel.
  alerts: { enabled: false, channelId: '' },
  // Ko-fi tips (see kofi.mjs's webhook → KofiDonation): when enabled, the bot
  // posts each new tip to this channel with the running total.
  kofi: { enabled: false, channelId: '' },
  // Stripe payments & refunds: when enabled, the bot posts each new successful
  // payment to every id in `channelIds` and each refund to every id in
  // `refundChannelIds`. The legacy single `channelId`/`refundChannelId` are still
  // honoured (merged in) so old configs keep working; refunds fall back to the
  // payment channels when no refund channels are set. Fed by the Stripe webhook
  // (Payment rows + bot.refundEvents).
  payments: { enabled: false, channelId: '', refundChannelId: '', channelIds: [], refundChannelIds: [] },
  limits: { maxTempChannels: 50, storageMB: 200 },
  // Per-server overrides: guilds[guildId] = { moderation?, welcome?, joinToCreate?,
  // gating? }. A feature present here REPLACES the top-level default for that guild;
  // absent → the top-level config applies (so single-server setups need no changes).
  guilds: {},
};

async function getBotConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'bot.config' } });
  return { ...DEFAULT_BOT_CONFIG, ...(row?.value || {}) };
}
// The bot heartbeats while connected; a recent beat with online!==false means it's live.
const botOnline = (status) => !!status?.at && status.online !== false && (Date.now() - new Date(status.at).getTime()) < 120_000;
// The effective token: an env DISCORD_TOKEN always wins over the dashboard-stored one.
async function storedToken(p) {
  if (process.env.DISCORD_TOKEN) return process.env.DISCORD_TOKEN;
  const row = await p.adminSetting.findUnique({ where: { key: 'bot.token' } });
  return row?.value?.token || null;
}

// Real welcome-banner render for the admin preview — mirrors the bot's
// features/welcome.mjs drawBanner() so what admins see is what members get
// (a single static frame of the same 1200x400 canvas). Canvas is optional.
let _canvas = null, _canvasTried = false;
async function loadCanvas() {
  if (_canvasTried) return _canvas;
  _canvasTried = true;
  try { _canvas = await import('@napi-rs/canvas'); } catch { _canvas = null; }
  return _canvas;
}
async function renderWelcomePng({ username = 'NewMember', members = 1024, server = 'BetterCommunity', avatarUrl = null }) {
  const C = await loadCanvas();
  if (!C) return null;
  const { createCanvas, loadImage } = C;
  const W = 1200, H = 400;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0e0c09'; ctx.fillRect(0, 0, W, H);
  const gx = W / 2;
  const g = ctx.createRadialGradient(gx, H, 60, gx, H, W);
  g.addColorStop(0, 'rgba(245,158,11,0.22)'); g.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 36; i++) { const s = 2 + Math.random() * 4; ctx.fillStyle = `rgba(245,158,11,${0.15 + Math.random() * 0.35})`; ctx.fillRect(Math.random() * W, Math.random() * H, s, s); }
  const r = 92, cx = 190, cy = H / 2;
  let avatar = null;
  if (avatarUrl) { try { avatar = await loadImage(avatarUrl); } catch { /* optional */ } }
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  if (avatar) { ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2); }
  else {
    const ag = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    ag.addColorStop(0, '#f97316'); ag.addColorStop(1, '#f59e0b');
    ctx.fillStyle = ag; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(username).slice(0, 2).toUpperCase(), cx, cy + 4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  ctx.lineWidth = 6; ctx.strokeStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 58px sans-serif'; ctx.fillText('Welcome', 340, 170);
  ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 46px sans-serif'; ctx.fillText(String(username).slice(0, 22), 342, 236);
  ctx.fillStyle = '#9ca3af'; ctx.font = '28px sans-serif'; ctx.fillText(`Member #${members} · ${server}`.slice(0, 46), 344, 288);
  return await cv.encode('png');
}

export default async function botRoutes(app) {
  // ── Admin dashboard: read/update bot config + see live status ──
  app.get('/admin/bot/config', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const cfg = await getBotConfig(p);
    const status = (await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value || null;
    const tokenRow = await p.adminSetting.findUnique({ where: { key: 'bot.token' } });
    const online = cfg.enabled !== false && botOnline(status);
    const [{ bytes: activityBytes }] = await p.$queryRaw`SELECT pg_total_relation_size('"DiscordActivity"')::bigint AS bytes`;
    const activityCount = await p.discordActivity.count();
    return {
      config: cfg, status, online,
      // Surface the bot's last connection error (e.g. privileged intents disabled) so the
      // admin knows WHY it isn't online, with an actionable message.
      error: !online ? (status?.error || null) : null,
      hasToken: !!(process.env.DISCORD_TOKEN || tokenRow?.value?.token),
      tokenFromEnv: !!process.env.DISCORD_TOKEN, // env token can't be changed from the UI
      // The bot's own "database" — DiscordActivity, capped by limits.storageMB (see sweeper.mjs).
      storage: { usedBytes: Number(activityBytes), memberCount: activityCount },
    };
  });

  // Paginated view of the bot's per-user activity table — the "member database"
  // (join date, last message/voice, and the linked BCWEB account when there is one).
  app.get('/admin/bot/members', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    const take = Math.min(Number(req.query?.take) || 30, 100);
    const skip = Math.max(0, Number(req.query?.skip) || 0);
    const q = String(req.query?.q || '').trim();
    const link = ['linked', 'unlinked'].includes(req.query?.link) ? req.query.link : null;
    // All linked Discord ids (bounded by account count) — lets us filter the member table
    // by link status and report the linked/unlinked totals for the header.
    const linkedIds = (await p.discordLink.findMany({ select: { discordId: true } })).map((l) => l.discordId);
    const qWhere = q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { discordId: { contains: q } }] } : {};
    const where = { ...qWhere, ...(link === 'linked' ? { discordId: { in: linkedIds } } : link === 'unlinked' ? { discordId: { notIn: linkedIds } } : {}) };
    const [rows, total, allTotal, linkedTotal] = await Promise.all([
      p.discordActivity.findMany({ where, orderBy: { updatedAt: 'desc' }, take, skip }),
      p.discordActivity.count({ where }),
      p.discordActivity.count(),
      p.discordActivity.count({ where: { discordId: { in: linkedIds } } }),
    ]);
    const links = await p.discordLink.findMany({ where: { discordId: { in: rows.map((r) => r.discordId) } }, include: { user: { select: { id: true, displayName: true, email: true } } } });
    const linkByDiscordId = Object.fromEntries(links.map((l) => [l.discordId, l.user]));
    return {
      members: rows.map((r) => ({ ...r, linkedUser: linkByDiscordId[r.discordId] || null })),
      total, hasMore: skip + rows.length < total,
      counts: { all: allTotal, linked: linkedTotal, unlinked: allTotal - linkedTotal },
    };
  });
  app.put('/admin/bot/config', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ config: z.record(z.any()) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_config' });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'bot.config' }, create: { key: 'bot.config', value: b.data.config }, update: { value: b.data.config } });
    return { ok: true };
  });

  // Set / clear the Discord bot token from the dashboard. Only allowed while the bot is
  // DISABLED (so a running bot's token isn't swapped under it) and when no env token is
  // set (env always wins). The idle bot polls GET /bot/token and connects once set.
  app.put('/admin/bot/token', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ token: z.string().max(120).nullable() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    if (process.env.DISCORD_TOKEN) return reply.code(409).send({ error: 'token_from_env' });
    const cfg = await getBotConfig(p);
    if (cfg.enabled !== false) return reply.code(409).send({ error: 'bot_enabled', detail: 'Disable the bot before changing its token.' });
    const token = (b.data.token || '').trim();
    await p.adminSetting.upsert({ where: { key: 'bot.token' }, create: { key: 'bot.token', value: { token } }, update: { value: { token } } });
    return { ok: true, hasToken: !!token };
  });

  // Real welcome banner (PNG) for the admin preview — the same render the bot sends.
  app.get('/admin/bot/welcome-preview.png', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const q = req.query || {};
    const png = await renderWelcomePng({
      username: String(q.username || 'NewMember').slice(0, 32),
      members: Number(q.members) || 1024,
      server: String(q.server || 'BetterCommunity').slice(0, 40),
      // Allow-list the Discord CDN only — never fetch an arbitrary URL server-side (SSRF).
      avatarUrl: (typeof q.avatar === 'string' && /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(q.avatar)) ? q.avatar : null,
    });
    if (!png) return reply.code(503).send({ error: 'canvas_unavailable' });
    reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store');
    return reply.send(png);
  });

  // ── Bot ↔ API (shared secret) ──
  app.get('/bot/config', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    return { config: await getBotConfig(await db()) };
  });
  // ── Blog announcements (bot ↔ API, shared secret) ──
  // Multi-route: the bot posts the SAME post to several channels (across servers),
  // each filtered to its own set of blog sources. Dedup is therefore tracked
  // PER CHANNEL (bot.blogAnnounced.byChannel[channelId] = [postId…]) rather than
  // globally, so a post can be new for one channel and already-sent for another.
  //
  // The bot sends the channel ids it currently routes to; we return the recent
  // published posts (each tagged with its source key) plus each channel's
  // already-announced set. A channel we've never seen is SEEDED with every current
  // post id (and reported as fully-announced) so newly-added routes never flood
  // with the whole back-catalogue — exactly the old single-channel behaviour, now
  // per channel.
  app.post('/bot/blog/sync', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ channels: z.array(z.string().max(40)).max(100).optional() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const channels = [...new Set(b.data.channels || [])];
    const p = await db();
    const posts = await p.blogPost.findMany({
      where: { status: 'PUBLISHED', publishedAt: { not: null } },
      orderBy: { publishedAt: 'asc' },
      select: {
        id: true, slug: true, title: true, excerpt: true, cover: true, publishedAt: true,
        project: { select: { key: true, name: true, icon: true } },
        showcaseProject: { select: { slug: true, name: true, icon: true } },
        author: { select: { displayName: true } },
      },
    });
    const allIds = posts.map((x) => x.id);
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.blogAnnounced' } });
    const byChannel = { ...(row?.value?.byChannel || {}) };
    let dirty = false;
    const announcedByChannel = {};
    for (const ch of channels) {
      if (byChannel[ch] == null) {
        // First time we've seen this channel → seed with everything currently
        // published so a newly-added route never floods with the back-catalogue
        // (mirrors the old single-channel "don't re-post history" behaviour).
        byChannel[ch] = [...allIds];
        dirty = true;
      }
      announcedByChannel[ch] = byChannel[ch];
    }
    if (dirty) {
      await p.adminSetting.upsert({ where: { key: 'bot.blogAnnounced' }, create: { key: 'bot.blogAnnounced', value: { byChannel } }, update: { value: { byChannel } } });
    }
    const siteUrl = (process.env.SITE_URL || 'http://localhost').replace(/\/+$/, '');
    const out = posts.slice(-50).map((x) => ({
      id: x.id, slug: x.slug, title: x.title, excerpt: x.excerpt, cover: x.cover, publishedAt: x.publishedAt,
      url: `${siteUrl}/blog/${x.slug}`,
      // Source key used by the bot to match a route's `sources` filter.
      source: x.project?.key || (x.showcaseProject ? 'showcase' : 'community'),
      space: { name: x.project?.name || x.showcaseProject?.name || 'BetterCommunity', icon: x.project?.icon || x.showcaseProject?.icon || null },
      project: x.project ? { name: x.project.name } : null,
      author: x.author,
    }));
    return { posts: out, announcedByChannel };
  });

  // Mark posts as announced, per channel. Accepts a batch of {channelId, ids} marks.
  app.post('/bot/blog/announced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      marks: z.array(z.object({ channelId: z.string().max(40), ids: z.array(z.string().max(64)).max(50) })).max(100),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.blogAnnounced' } });
    const byChannel = { ...(row?.value?.byChannel || {}) };
    for (const m of b.data.marks) {
      if (!m.ids.length) continue;
      byChannel[m.channelId] = [...new Set([...(byChannel[m.channelId] || []), ...m.ids])].slice(-500);
    }
    await p.adminSetting.upsert({ where: { key: 'bot.blogAnnounced' }, create: { key: 'bot.blogAnnounced', value: { byChannel } }, update: { value: { byChannel } } });
    return { ok: true };
  });

  // ── Ko-fi tip announcements (bot ↔ API, shared secret) — same shape as blog:
  // the first call ever initialises the announced-set with every EXISTING tip,
  // so enabling the feature never floods the channel with old donation history. ──
  app.get('/bot/kofi/unannounced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const [tips, agg] = await Promise.all([
      p.kofiDonation.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, fromName: true, amount: true, currency: true, isSubscription: true, createdAt: true } }),
      p.kofiDonation.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const totals = { totalAmount: agg._sum.amount || 0, tipCount: agg._count._all };
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.kofiAnnounced' } });
    if (!row) {
      await p.adminSetting.create({ data: { key: 'bot.kofiAnnounced', value: { ids: tips.map((x) => x.id) } } });
      return { tips: [], totals };
    }
    const seen = new Set(row.value?.ids || []);
    return { tips: tips.filter((x) => !seen.has(x.id)).slice(0, 10), totals };
  });

  app.post('/bot/kofi/announced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ ids: z.array(z.string().max(64)).min(1).max(50) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.kofiAnnounced' } });
    const ids = [...new Set([...(row?.value?.ids || []), ...b.data.ids])].slice(-500);
    await p.adminSetting.upsert({ where: { key: 'bot.kofiAnnounced' }, create: { key: 'bot.kofiAnnounced', value: { ids } }, update: { value: { ids } } });
    return { ok: true };
  });

  // ── Stripe payments & refunds (bot ↔ API, shared secret) — same first-call-seeds
  // shape as blog/kofi so enabling never floods with old history. Payments come from
  // Payment rows; refunds from the bot.refundEvents set the webhook appends to. ──
  app.get('/bot/payments/unannounced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const [payments, refundRow, seen, testRow] = await Promise.all([
      p.payment.findMany({ where: { status: 'paid' }, orderBy: { createdAt: 'asc' }, take: 500,
        select: { id: true, kind: true, description: true, amountCents: true, currency: true, createdAt: true, userId: true, user: { select: { displayName: true } } } }),
      p.adminSetting.findUnique({ where: { key: 'bot.refundEvents' } }),
      p.adminSetting.findUnique({ where: { key: 'bot.paymentsAnnounced' } }),
      p.adminSetting.findUnique({ where: { key: 'bot.paymentsTest' } }),
    ]);
    const refunds = refundRow?.value?.events || [];
    // Shared payment → bot payload. Includes the buyer's BCWEB id (for a profile
    // deep-link in the embed) + a stable invoice number (same scheme as /me/invoices).
    const mapPay = (x) => ({ id: x.id, kind: x.kind, description: x.description, amountCents: x.amountCents, currency: x.currency, createdAt: x.createdAt, buyer: x.user?.displayName || null, userId: x.userId || null, invoiceNo: `BCW-${String(x.id).slice(-8).toUpperCase()}` });
    // Read-once test ping — the admin "Send test message" button sets it; report it
    // to the bot (which posts a sample embed) and clear it so it fires exactly once.
    let test = false;
    if (testRow?.value?.at && Date.now() - testRow.value.at < 10 * 60_000) { test = true; await p.adminSetting.delete({ where: { key: 'bot.paymentsTest' } }).catch(() => {}); }
    if (!seen) {
      // First call ever → bury only genuinely OLD activity so a purchase made right
      // around the moment you enabled the module still announces (previously we
      // seeded EVERYTHING, which silently swallowed a just-made payment → "it doesn't
      // send"). Anything newer than the cutoff is left unseen and announces next poll.
      const cutoff = Date.now() - 10 * 60_000;
      const oldPayIds = payments.filter((x) => new Date(x.createdAt).getTime() < cutoff).map((x) => x.id);
      const oldRefundIds = refunds.filter((r) => (r.at ? new Date(r.at).getTime() : 0) < cutoff).map((r) => r.id);
      await p.adminSetting.create({ data: { key: 'bot.paymentsAnnounced', value: { paymentIds: oldPayIds, refundIds: oldRefundIds } } });
      const pSeen0 = new Set(oldPayIds); const rSeen0 = new Set(oldRefundIds);
      return {
        test,
        payments: payments.filter((x) => !pSeen0.has(x.id)).slice(0, 20).map(mapPay),
        refunds: refunds.filter((r) => !rSeen0.has(r.id)).slice(0, 20),
      };
    }
    const pSeen = new Set(seen.value?.paymentIds || []);
    const rSeen = new Set(seen.value?.refundIds || []);
    return {
      test,
      payments: payments.filter((x) => !pSeen.has(x.id)).slice(0, 20).map(mapPay),
      refunds: refunds.filter((r) => !rSeen.has(r.id)).slice(0, 20),
    };
  });

  // Admin: fire a one-off test payment/refund embed to the configured channels so
  // you can verify the bot can actually post there (config + permissions) without a
  // real Stripe payment. The bot picks it up on its next poll (≤2 min).
  app.post('/admin/bot/payments/test', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'bot.paymentsTest' }, create: { key: 'bot.paymentsTest', value: { at: Date.now() } }, update: { value: { at: Date.now() } } });
    return { ok: true };
  });

  // Diagnostic for "the bot doesn't post real payments": tells the admin whether any
  // Payment rows even EXIST. If total stays 0 after a checkout, the Stripe webhook
  // isn't reaching the API (nothing is recorded OR provisioned) — that's an infra
  // wiring issue (run `stripe listen --forward-to <api>/hosting/webhook`), not a bot
  // bug. If total > announced, the bot has new activity queued to post.
  app.get('/admin/bot/payments/status', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const [total, last, seen, refundRow] = await Promise.all([
      p.payment.count({ where: { status: 'paid' } }),
      p.payment.findFirst({ where: { status: 'paid' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, amountCents: true, currency: true, kind: true } }),
      p.adminSetting.findUnique({ where: { key: 'bot.paymentsAnnounced' } }),
      p.adminSetting.findUnique({ where: { key: 'bot.refundEvents' } }),
    ]);
    const announced = (seen?.value?.paymentIds || []).length;
    const refunds = (refundRow?.value?.events || []).length;
    // Env flags so the admin can see WHY nothing is recorded: without a Stripe key
    // there are no checkouts; without the webhook secret the /hosting/webhook handler
    // 503s and never records/provisions anything (the #1 cause of "no notifications").
    const stripeKey = !!process.env.STRIPE_SECRET_KEY;
    const webhookSecret = !!process.env.STRIPE_WEBHOOK_SECRET;
    return { totalPayments: total, announced, refundEvents: refunds, lastPaymentAt: last?.createdAt || null, lastPayment: last || null, stripeKey, webhookSecret, webhookHint: total === 0 };
  });

  // Bot-facing: the real Stripe invoice PDF url + number for a payment, so the bot can
  // attach the actual invoice PDF to its announcement embed. Stripe's invoice_pdf is a
  // no-auth hosted link, so we just hand it back for the bot to download.
  app.get('/bot/payments/:id/invoice', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    if (!process.env.STRIPE_SECRET_KEY) return reply.code(503).send({ error: 'stripe_not_configured' });
    const p = await db();
    const pay = await p.payment.findUnique({ where: { id: req.params.id }, select: { stripeSessionId: true } });
    if (!pay?.stripeSessionId) return reply.code(404).send({ error: 'no_session' });
    try {
      const Stripe = (await import('stripe')).default;
      const sk = new Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await sk.checkout.sessions.retrieve(pay.stripeSessionId, { expand: ['invoice'] });
      const inv = session.invoice && typeof session.invoice === 'object' ? session.invoice : null;
      if (!inv?.invoice_pdf) return reply.code(404).send({ error: 'no_pdf' });
      return { pdfUrl: inv.invoice_pdf, number: inv.number || null };
    } catch (e) { return reply.code(502).send({ error: 'stripe_error', detail: String(e.message) }); }
  });

  // ── Bot direct messages + gift codes ──
  // Admin sends a DM to a Discord user; optionally mints a one-off promo code assigned
  // to the recipient's linked account and appends it. The bot delivers on its next poll.
  app.post('/admin/bot/dm', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      discordId: z.string().min(5).max(32),
      message: z.string().max(1500).default(''),
      gift: z.object({
        kind: z.enum(['discount', 'free_hosting', 'free_boost']),
        percentOff: z.number().int().min(1).max(100).optional(),
        freeMonths: z.number().int().min(0).max(24).optional(),
        storageGB: z.number().int().min(1).max(2000).optional(),
        uploadMbps: z.number().int().min(1).max(2000).optional(),
        hostMonths: z.number().int().min(0).max(60).optional(),
        boostDays: z.number().int().min(1).max(3650).optional(),
      }).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    let message = b.data.message || '';
    let giftCode = null;
    if (b.data.gift) {
      const g = b.data.gift;
      if (g.kind === 'discount' && !g.percentOff && !g.freeMonths) return reply.code(400).send({ error: 'discount_needs_value' });
      if (g.kind === 'free_hosting' && !g.storageGB) return reply.code(400).send({ error: 'hosting_needs_storage' });
      if (g.kind === 'free_boost' && !g.boostDays) return reply.code(400).send({ error: 'boost_needs_days' });
      // Assigning a gift code needs the recipient's BCWEB account (via their Discord link).
      const link = await p.discordLink.findUnique({ where: { discordId: b.data.discordId } });
      if (!link) return reply.code(400).send({ error: 'no_linked_account' });
      let code = genCode();
      for (let i = 0; i < 5 && (await p.promoCode.findUnique({ where: { code } })); i++) code = genCode();
      await p.promoCode.create({ data: {
        code, kind: g.kind, percentOff: g.percentOff ?? null, freeMonths: g.freeMonths ?? null,
        storageGB: g.storageGB ?? null, uploadMbps: g.uploadMbps ?? null, hostMonths: g.hostMonths ?? null, boostDays: g.boostDays ?? null,
        maxRedemptions: 1, perUserLimit: 1, assignedUserIds: [link.userId], note: `gift DM → ${b.data.discordId}`,
      } });
      giftCode = code;
      const siteUrl = process.env.SITE_URL || 'http://localhost';
      const redeem = `Redeem it at ${siteUrl}/dashboard (Billing → “Redeem a promo code”). It’s reserved for your account.`;
      // If the admin's message uses {code}, substitute it inline; otherwise append the
      // gift block. ({user}/{username}/{server} are substituted bot-side, where the user
      // + guild are known.)
      message = message.includes('{code}')
        ? `${message.replaceAll('{code}', `\`${code}\``)}\n\n${redeem}`
        : `${message}\n\n🎁 **Your gift code:** \`${code}\`\n${redeem}`;
    }
    // No gift → a stray {code} token shouldn't leak into the DM.
    if (!giftCode) message = message.replace(/\s*`?\{code\}`?/g, '');
    if (!message.trim()) return reply.code(400).send({ error: 'empty_message' });
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.dmQueue' } });
    const items = [...(row?.value?.items || []), { id: genCode(), discordId: b.data.discordId, message: message.slice(0, 1900), at: Date.now() }].slice(-200);
    await p.adminSetting.upsert({ where: { key: 'bot.dmQueue' }, create: { key: 'bot.dmQueue', value: { items } }, update: { value: { items } } });
    return { ok: true, giftCode };
  });

  app.get('/bot/dm/pending', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.dmQueue' } });
    return { items: (row?.value?.items || []).slice(0, 20) };
  });
  app.post('/bot/dm/sent', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ ids: z.array(z.string().max(40)).max(50) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.dmQueue' } });
    const done = new Set(b.data.ids);
    const items = (row?.value?.items || []).filter((x) => !done.has(x.id));
    await p.adminSetting.upsert({ where: { key: 'bot.dmQueue' }, create: { key: 'bot.dmQueue', value: { items } }, update: { value: { items } } });
    return { ok: true };
  });

  // ── Giveaways ──
  const giftShape = z.object({
    kind: z.enum(['discount', 'free_hosting', 'free_boost']),
    percentOff: z.number().int().min(1).max(100).optional(),
    freeMonths: z.number().int().min(0).max(24).optional(),
    storageGB: z.number().int().min(1).max(2000).optional(),
    uploadMbps: z.number().int().min(1).max(2000).optional(),
    hostMonths: z.number().int().min(0).max(60).optional(),
    boostDays: z.number().int().min(1).max(3650).optional(),
  });
  app.get('/admin/bot/giveaways', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const list = await p.giveaway.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    return { giveaways: list.map((g) => ({ id: g.id, prize: g.prize, channelId: g.channelId, endsAt: g.endsAt, winnersCount: g.winnersCount, status: g.status, entryCount: g.entries.length, winnerIds: g.winnerIds, hasGift: !!g.giftConfig, requirements: g.requirements || null, createdAt: g.createdAt })) };
  });
  app.post('/admin/bot/giveaways', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      prize: z.string().min(1).max(200),
      channelId: z.string().min(5).max(32),
      durationMinutes: z.number().int().min(1).max(60 * 24 * 60),
      winnersCount: z.number().int().min(1).max(50).default(1),
      gift: giftShape.optional(),
      winnerMessage: z.string().max(1500).optional(),
      // Entry gate: require a linked BetterCommunity account (Discord ⇄ BCWEB) and/or
      // a linked BMM creator id. Enforced server-side when a user clicks Enter.
      requirements: z.object({ linked: z.boolean().optional(), creator: z.boolean().optional() }).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // A creator-id requirement implies a linked account (creator ids live on BCWEB accounts).
    const reqs = b.data.requirements ? { linked: !!(b.data.requirements.linked || b.data.requirements.creator), creator: !!b.data.requirements.creator } : null;
    const gw = await p.giveaway.create({ data: {
      prize: b.data.prize, channelId: b.data.channelId, winnersCount: b.data.winnersCount,
      endsAt: new Date(Date.now() + b.data.durationMinutes * 60_000),
      giftConfig: b.data.gift || null, requirements: (reqs && (reqs.linked || reqs.creator)) ? reqs : null,
      winnerMessage: b.data.winnerMessage?.trim() || null, createdBy: req.user.uid,
    } });
    return { ok: true, id: gw.id };
  });
  app.post('/admin/bot/giveaways/:id/end', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    // Bring the end forward to now → the bot draws on its next poll (≤30s).
    const gw = await p.giveaway.updateMany({ where: { id: req.params.id, status: 'active' }, data: { endsAt: new Date() } });
    if (!gw.count) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
  app.delete('/admin/bot/giveaways/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    await p.giveaway.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });

  // Bot-facing giveaway sync
  app.get('/bot/giveaways/active', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const list = await p.giveaway.findMany({ where: { status: 'active' }, take: 100 });
    return { giveaways: list.map((g) => ({ id: g.id, prize: g.prize, channelId: g.channelId, messageId: g.messageId, endsAt: g.endsAt, winnersCount: g.winnersCount, entries: g.entries, requirements: g.requirements || null, winnerMessage: g.winnerMessage || null, due: new Date(g.endsAt) <= new Date() })) };
  });
  app.post('/bot/giveaways/:id/posted', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ messageId: z.string().max(40) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.giveaway.update({ where: { id: req.params.id }, data: { messageId: b.data.messageId } }).catch(() => {});
    return { ok: true };
  });
  app.post('/bot/giveaways/:id/enter', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ discordId: z.string().min(5).max(32) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const gw = await p.giveaway.findUnique({ where: { id: req.params.id } });
    if (!gw || gw.status !== 'active') return reply.code(409).send({ error: 'not_active' });
    // Entry requirements: must have a linked BCWEB account (and optionally a BMM
    // creator id on it). Enforced here — the button on Discord can't be trusted.
    const gr = gw.requirements || {};
    if (gr.linked || gr.creator) {
      const link = await p.discordLink.findUnique({ where: { discordId: b.data.discordId }, include: { user: { select: { _count: { select: { creatorLinks: true } } } } } });
      if (!link) return reply.code(403).send({ error: 'need_link' });
      if (gr.creator && !link.user._count.creatorLinks) return reply.code(403).send({ error: 'need_creator' });
    }
    if (gw.entries.includes(b.data.discordId)) return { ok: true, already: true, count: gw.entries.length };
    await p.giveaway.update({ where: { id: gw.id }, data: { entries: { push: b.data.discordId } } });
    return { ok: true, count: gw.entries.length + 1 };
  });
  // Create a giveaway from the /giveaway slash command (bot is the trust boundary;
  // the command itself is gated to Manage-Server members). No gift via command — use
  // the dashboard for gift-backed giveaways.
  app.post('/bot/giveaways/create', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ prize: z.string().min(1).max(200), channelId: z.string().min(5).max(32), durationMinutes: z.number().int().min(1).max(60 * 24 * 60), winnersCount: z.number().int().min(1).max(50).default(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const gw = await p.giveaway.create({ data: { prize: b.data.prize, channelId: b.data.channelId, winnersCount: b.data.winnersCount, endsAt: new Date(Date.now() + b.data.durationMinutes * 60_000) } });
    return { ok: true, id: gw.id };
  });
  app.post('/bot/giveaways/:id/drawn', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ winnerIds: z.array(z.string().max(32)).max(50) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const gw = await p.giveaway.findUnique({ where: { id: req.params.id } });
    if (!gw) return reply.code(404).send({ error: 'not_found' });
    await p.giveaway.update({ where: { id: gw.id }, data: { status: 'ended', winnerIds: b.data.winnerIds } });
    // Mint a gift code per winner that has a linked account (the bot DMs each one).
    const gifts = {};
    if (gw.giftConfig) {
      for (const did of b.data.winnerIds) {
        const link = await p.discordLink.findUnique({ where: { discordId: did } });
        if (!link) continue;
        const g = gw.giftConfig;
        let code = genCode();
        for (let i = 0; i < 5 && (await p.promoCode.findUnique({ where: { code } })); i++) code = genCode();
        await p.promoCode.create({ data: {
          code, kind: g.kind, percentOff: g.percentOff ?? null, freeMonths: g.freeMonths ?? null,
          storageGB: g.storageGB ?? null, uploadMbps: g.uploadMbps ?? null, hostMonths: g.hostMonths ?? null, boostDays: g.boostDays ?? null,
          maxRedemptions: 1, perUserLimit: 1, assignedUserIds: [link.userId], note: `giveaway ${gw.id} winner`,
        } });
        gifts[did] = code;
      }
    }
    return { ok: true, gifts };
  });

  app.post('/bot/payments/announced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      paymentIds: z.array(z.string().max(64)).max(50).optional(),
      refundIds: z.array(z.string().max(80)).max(50).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.paymentsAnnounced' } });
    const paymentIds = [...new Set([...(row?.value?.paymentIds || []), ...(b.data.paymentIds || [])])].slice(-1000);
    const refundIds = [...new Set([...(row?.value?.refundIds || []), ...(b.data.refundIds || [])])].slice(-500);
    await p.adminSetting.upsert({ where: { key: 'bot.paymentsAnnounced' }, create: { key: 'bot.paymentsAnnounced', value: { paymentIds, refundIds } }, update: { value: { paymentIds, refundIds } } });
    return { ok: true };
  });

  // The bot fetches its token here (shared-secret protected — never public). Returns
  // null when disabled or unset, so the bot disconnects/idles accordingly.
  app.get('/bot/token', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const cfg = await getBotConfig(p);
    return { token: cfg.enabled === false ? null : await storedToken(p) };
  });
  // The bot posts periodic heartbeats; the dashboard shows uptime / guild counts.
  app.post('/bot/heartbeat', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      uptimeSec: z.number().optional(), guilds: z.number().optional(), users: z.number().optional(), tempChannels: z.number().optional(), version: z.string().optional(), online: z.boolean().optional(), error: z.string().max(300).optional(),
      // The servers the bot is currently in (id + name) — lets the admin pick a
      // target server when configuring per-server blog routes.
      guildList: z.array(z.object({ id: z.string().max(32), name: z.string().max(120), icon: z.string().max(400).nullable().optional(), members: z.number().nullable().optional() })).max(200).optional(),
      ping: z.number().nullable().optional(), // gateway latency (ms)
      mod: z.object({ kicks: z.number().optional(), timeouts: z.number().optional(), purged: z.number().optional() }).optional(), // since-restart moderation counters
      logs: z.array(z.object({ t: z.number(), level: z.string().max(10), msg: z.string().max(500) })).max(200).optional(), // recent bot console output → live logs tab
    }).safeParse(req.body || {});
    const d = b.success ? b.data : {};
    const p = await db();
    // Logs are stored separately (they change every heartbeat and can be large) so the
    // small bot.status blob the config page reads stays lean.
    const { logs, ...rest } = d;
    const value = { ...rest, at: new Date().toISOString(), online: rest.online !== false };
    await p.adminSetting.upsert({ where: { key: 'bot.status' }, create: { key: 'bot.status', value }, update: { value } });
    if (logs) await p.adminSetting.upsert({ where: { key: 'bot.logs' }, create: { key: 'bot.logs', value: { logs, at: Date.now() } }, update: { value: { logs, at: Date.now() } } });
    return { ok: true };
  });

  // Admin: recent bot console logs (live logs tab).
  app.get('/admin/bot/logs', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.logs' } });
    return { logs: row?.value?.logs || [], at: row?.value?.at || null };
  });

  // ── Discord ↔ account linking ──
  // Bot issues a pairing code (user ran /link). Rate-limited per Discord id.
  app.post('/bot/link/issue', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ discordId: z.string().min(1).max(32), username: z.string().max(80).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const existing = await p.discordLink.findUnique({ where: { discordId: b.data.discordId } });
    if (existing) return { linked: true };
    const code = genCode();
    await p.discordLinkCode.create({ data: { code, discordId: b.data.discordId, username: b.data.username || null, expiresAt: new Date(Date.now() + 15 * 60_000) } });
    return { code, expiresAt: new Date(Date.now() + 15 * 60_000), linked: false };
  });

  // Discord activity reported by the bot (join / message / voice) → surfaced in the
  // BMM telemetry dashboard alongside the linked creator id.
  app.post('/bot/activity', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      discordId: z.string().min(1).max(32),
      username: z.string().max(80).optional(),
      avatar: z.string().max(400).optional(),
      event: z.enum(['join', 'message', 'voiceJoin', 'voiceCreate']),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const now = new Date();
    const field = { join: 'guildJoinedAt', message: 'lastMessageAt', voiceJoin: 'lastVoiceJoinAt', voiceCreate: 'lastVoiceCreateAt' }[b.data.event];
    const base = { username: b.data.username, avatar: b.data.avatar };
    await p.discordActivity.upsert({
      where: { discordId: b.data.discordId },
      create: { discordId: b.data.discordId, ...base, [field]: now },
      update: { ...base, [field]: now },
    });
    return { ok: true };
  });

  // Bulk member sync — the bot posts its FULL guild roster on startup (and periodically)
  // so the member database contains every member, not just those who happened to send a
  // message or join while the bot was online. Upserts in chunks; guildJoinedAt is only
  // filled when known and not already set (a real join event is more authoritative).
  app.post('/bot/members/sync', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      members: z.array(z.object({
        discordId: z.string().min(1).max(32),
        username: z.string().max(80).optional(),
        avatar: z.string().max(400).optional(),
        joinedAt: z.string().datetime().optional(),
      })).max(2000),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    let synced = 0;
    for (const m of b.data.members) {
      const joinedAt = m.joinedAt ? new Date(m.joinedAt) : null;
      await p.discordActivity.upsert({
        where: { discordId: m.discordId },
        create: { discordId: m.discordId, username: m.username, avatar: m.avatar, guildJoinedAt: joinedAt },
        // Don't clobber a known join date with null; refresh name/avatar (they change).
        update: { username: m.username, avatar: m.avatar, ...(joinedAt ? { guildJoinedAt: joinedAt } : {}) },
      }).then(() => synced++).catch(() => {});
    }
    return { ok: true, synced };
  });

  // Account resolution for gated access + telemetry enrichment.
  app.get('/bot/account/:discordId', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const link = await p.discordLink.findUnique({ where: { discordId: req.params.discordId }, include: { user: { select: { id: true, displayName: true, creatorLinks: { select: { creatorId: true } } } } } });
    if (!link) return { linked: false };
    return { linked: true, userId: link.user.id, displayName: link.user.displayName, creatorIds: link.user.creatorLinks.map((c) => c.creatorId), hasBmm: link.user.creatorLinks.length > 0 };
  });

  // ── Website side: redeem / list / unlink Discord links ──
  app.get('/me/discord/links', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    return { links: await p.discordLink.findMany({ where: { userId: req.user.uid }, orderBy: { linkedAt: 'desc' } }) };
  });
  app.post('/me/discord/redeem', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ code: z.string().min(4).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const raw = b.data.code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const code = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}` : raw;
    const row = await p.discordLinkCode.findUnique({ where: { code } });
    if (!row || row.expiresAt < new Date()) return reply.code(404).send({ error: 'invalid_or_expired' });
    if (await p.discordLink.findUnique({ where: { discordId: row.discordId } })) return reply.code(409).send({ error: 'already_linked' });
    const link = await p.discordLink.create({ data: { userId: req.user.uid, discordId: row.discordId, username: row.username } });
    await p.discordLinkCode.delete({ where: { id: row.id } }).catch(() => {});
    return { ok: true, link };
  });
  app.delete('/me/discord/links/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const link = await p.discordLink.findUnique({ where: { id: req.params.id } });
    if (!link || link.userId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    await p.discordLink.delete({ where: { id: link.id } });
    return { ok: true };
  });
}
