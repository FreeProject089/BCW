import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { db, requireRole, safeEqual } from '../lib.mjs';

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
  // (title + excerpt + link) to this channel.
  blog: { enabled: false, channelId: '' },
  // Server-perf alerts (CPU/RAM/disk/service-down — see monitor.mjs): when
  // enabled, the bot posts each fired ServerAlertLog to this channel.
  alerts: { enabled: false, channelId: '' },
  // Ko-fi tips (see kofi.mjs's webhook → KofiDonation): when enabled, the bot
  // posts each new tip to this channel with the running total.
  kofi: { enabled: false, channelId: '' },
  limits: { maxTempChannels: 50, storageMB: 200 },
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
    const where = q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { discordId: { contains: q } }] } : {};
    const [rows, total] = await Promise.all([
      p.discordActivity.findMany({ where, orderBy: { updatedAt: 'desc' }, take, skip }),
      p.discordActivity.count({ where }),
    ]);
    const links = await p.discordLink.findMany({ where: { discordId: { in: rows.map((r) => r.discordId) } }, include: { user: { select: { id: true, displayName: true, email: true } } } });
    const linkByDiscordId = Object.fromEntries(links.map((l) => [l.discordId, l.user]));
    return { members: rows.map((r) => ({ ...r, linkedUser: linkByDiscordId[r.discordId] || null })), total, hasMore: skip + rows.length < total };
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
  // Which published posts haven't been announced yet. First call ever initialises
  // the announced-set with EVERYTHING already published (so enabling the feature
  // doesn't flood the channel with the whole blog history) and returns [].
  app.get('/bot/blog/unannounced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const posts = await p.blogPost.findMany({
      where: { status: 'PUBLISHED', publishedAt: { not: null } },
      orderBy: { publishedAt: 'asc' },
      select: { id: true, slug: true, title: true, excerpt: true, cover: true, publishedAt: true, project: { select: { name: true } }, author: { select: { displayName: true } } },
    });
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.blogAnnounced' } });
    if (!row) {
      await p.adminSetting.create({ data: { key: 'bot.blogAnnounced', value: { ids: posts.map((x) => x.id) } } });
      return { posts: [] };
    }
    const seen = new Set(row.value?.ids || []);
    const siteUrl = (process.env.SITE_URL || 'http://localhost').replace(/\/+$/, '');
    return { posts: posts.filter((x) => !seen.has(x.id)).slice(0, 5).map((x) => ({ ...x, url: `${siteUrl}/blog/${x.slug}` })) };
  });

  app.post('/bot/blog/announced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ ids: z.array(z.string().max(64)).min(1).max(50) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.blogAnnounced' } });
    const ids = [...new Set([...(row?.value?.ids || []), ...b.data.ids])].slice(-500);
    await p.adminSetting.upsert({ where: { key: 'bot.blogAnnounced' }, create: { key: 'bot.blogAnnounced', value: { ids } }, update: { value: { ids } } });
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
      ping: z.number().nullable().optional(), // gateway latency (ms)
      mod: z.object({ kicks: z.number().optional(), timeouts: z.number().optional(), purged: z.number().optional() }).optional(), // since-restart moderation counters
    }).safeParse(req.body || {});
    const d = b.success ? b.data : {};
    const p = await db();
    // online defaults to true; a failed-login report posts online:false + an error message.
    const value = { ...d, at: new Date().toISOString(), online: d.online !== false };
    await p.adminSetting.upsert({ where: { key: 'bot.status' }, create: { key: 'bot.status', value }, update: { value } });
    return { ok: true };
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
