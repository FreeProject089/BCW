import { z } from 'zod';
import { getObject } from '../lib/storage.mjs';
import { randomInt } from 'node:crypto';
import { db, requireRole, requireCap, logAudit, safeEqual, botAuth, BOT_SECRET } from '../lib/lib.mjs';
import { issueWarn } from '../lib/warns.mjs';
import { memberCapacity, admitMembers, capacityStatus, logModeration } from '../lib/discord-storage.mjs';

// B4: a guild's member-storage config, created lazily on first sight with the safe default
// (mode `none` — store nothing). Every member write goes through this so a guild the admin
// has not opted into `pool` never accumulates rows.
async function botGuild(p, guildId, name) {
  if (!guildId) return null;
  return p.botGuild.upsert({
    where: { guildId },
    create: { guildId, name: name || null },
    update: name ? { name } : {},
  });
}


// Server-to-server auth for the Discord bot (shared secret, like the telemetry link
// lookup). The bot sends `x-bot-secret`; anything else is rejected.


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
  // `channelId` is the PERF channel and keeps its name: every config already saved uses
  // it. `generalChannelId` is optional — unset, incidents keep landing in the perf
  // channel exactly as before, so this default changes nothing for an existing install.
  alerts: { enabled: false, channelId: '', generalChannelId: '' },
  // Where each kind of announcement lands, and who gets pinged when one is urgent.
  //
  // Empty means "the general channel", which is what every existing install has been doing —
  // so this is additive and changes nothing until somebody fills a box in. The kinds are the
  // ones the queue already carries: a commission, an incident from the status page, an event,
  // a promotion, and the catch-all the "something is waiting" digest and the error alerts use.
  //
  // A role is pinged ONLY for an urgent one. Pinging on every message is how a role gets
  // muted, and a muted role is worse than no role because it looks like coverage.
  announce: {
    // `legal` is the exception to the "empty means the general channel" rule above: a
    // legal notice identifies its sender, so empty means NOTHING IS SENT. The API checks
    // this key before queueing at all — see announceLegalNotice in misc.mjs.
    channels: { myo: '', incident: '', event: '', promo: '', custom: '', legal: '' },
    roles: { myo: '', incident: '', event: '', promo: '', custom: '', legal: '' },
  },
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
  // How the bot builds its member database — a GLOBAL strategy the bot reads to decide what
  // it stores across every server:
  //   mode 'free'    → store members of every server for free. `scope` narrows WHO:
  //                    'linked' (only members who linked a site account), 'active' (only
  //                    members the bot has seen act), or 'all' (every member).
  //   mode 'managed' → the paid, per-server model: each server opts into 'pool' (store
  //                    members) or 'moderation' (Discord logs only) with its own byte budget
  //                    (the BotGuild.memberMode rows + the per-server storage card).
  //   mode 'unified' → store every member once, keyed by the person, with the list of the
  //                    servers they share with the bot — instead of one row per server.
  // 'managed' is the default: it is the only one that already has per-server budgets and
  // does not grow the database by every member of every server the day it is turned on.
  memberStorage: { mode: 'managed', scope: 'linked' },
  // ── Economy / levelling (B-econ) ──────────────────────────────────────────
  // A points + XP system the bot runs across every server: messages, reactions and voice time
  // earn XP, XP earns levels (each level harder than the last), and levels hand out points that
  // are spent in a bot shop or a casino. XP only accrues for people who have LINKED their
  // Discord to a BCWEB account (or made one via Discord) — so a level maps to a real profile.
  // All of it is off until enabled, and every rate/name/emoji is configured here. The per-user
  // balances live in a real table (next phase); this is the configuration the bot reads.
  economy: {
    enabled: false,
    currencyName: 'points',   // what one unit is called ("coins", "gems", …)
    currencyEmoji: '',        // a Discord custom emoji <:name:id> or a unicode emoji; empty → image
    currencyImage: '',        // fallback picture for the currency when no emoji is set
    xpPerMessage: 5,
    xpPerReaction: 1,
    xpPerVoiceMinute: 3,
    curveBase: 100,           // XP to clear level 1
    curveFactor: 1.18,        // each level needs curveFactor× the previous — higher = slower
    pointsEveryLevels: 5,     // grant points every N levels reached
    pointsPerGrant: 10,       // how many points each grant is worth
    statsPublic: true,        // are the voice/message/reaction counts public by default
    shop: [],                 // [{ id, name, desc, cost, kind, payload }]
    casino: { enabled: false, minBet: 1, maxBet: 100, houseEdgePct: 5 },
  },
  // Self-serve role panels — a rules post, or a "pick your pings" post, with the roles
  // attached to it as buttons or as a dropdown. Each entry:
  //   { id, channelId, title, body, asEmbed, color, mode: 'buttons'|'dropdown',
  //     multi, roles: [{ roleId, label, emoji, description, style }] }
  // The DEFINITION lives here and only an admin writes it. What the bot learns by posting
  // (message id, what it last rendered) lives in a separate `bot.rolePanelState` key,
  // because this object round-trips through the dashboard's save and anything the bot
  // wrote into it would be clobbered by the next unrelated edit.
  rolePanels: [],
  // Per-server overrides: guilds[guildId] = { moderation?, welcome?, joinToCreate?,
  // gating? }. A feature present here REPLACES the top-level default for that guild;
  // absent → the top-level config applies (so single-server setups need no changes).
  guilds: {},
  // Servers the bot is banned from. Each: { guildId, mode: 'leave'|'disable', reason, banId, at }.
  //   'leave'   → the bot leaves the server and refuses to rejoin (leaves again on invite).
  //   'disable' → the bot stays but every command/feature is inert there.
  // Enforced bot-side; `/appeal` returns the banId + a link to the contact page.
  bannedGuilds: [],
};

/**
 * What a role panel currently looks like, as one short string.
 *
 * The bot re-posts when this changes, which means there is no Publish button to press and
 * no publishedAt to keep in sync: editing the panel in the dashboard IS publishing it, and
 * an edit that changes nothing visible re-posts nothing. Same trick as the legal-document
 * fingerprints, for the same reason — a version somebody has to remember to bump is a
 * version that will be wrong.
 *
 * Deliberately covers only what a reader SEES. channelId is not in it: moving a panel to
 * another channel is handled by the bot (it posts a new message there), not by pretending
 * the content changed.
 */
function rolePanelHash(panel) {
  const shape = JSON.stringify({
    t: panel.title || '', b: panel.body || '', e: !!panel.asEmbed, c: panel.color || '',
    m: panel.mode || 'buttons', u: !!panel.multi,
    r: (panel.roles || []).map((r) => [r.roleId, r.label, r.emoji || '', r.description || '', r.style || '']),
  });
  let h = 0;
  for (let i = 0; i < shape.length; i++) { h = ((h << 5) - h + shape.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

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
// Selectable banner backgrounds: a base colour + an accent-glow colour (the dots + glow).
// A background image is a MEDIA PATH on this site, never a URL somebody typed.
//
// Both the API and the bot fetch this server-side, and "fetch whatever the config says" is
// exactly the SSRF the avatar allow-list below already exists to prevent — the API sits
// inside the Docker network, where an attacker-chosen host is worth a great deal more than
// it looks. A path validated to this shape and joined onto a known origin cannot be aimed
// anywhere else. `..` is refused explicitly rather than relied on the character class,
// because that is the one that gets edited later.
export const MEDIA_PATH = /^\/api\/media\/blog\/[A-Za-z0-9._/-]+$/;
export const isMediaPath = (v) => typeof v === 'string' && MEDIA_PATH.test(v) && !v.includes('..');

const BANNER_BG = {
  dark: { base: '#0e0c09', accent: '245,158,11' },
  midnight: { base: '#0a0f1e', accent: '56,189,248' },
  plum: { base: '#140a1e', accent: '167,139,250' },
  forest: { base: '#08160f', accent: '52,211,153' },
  rose: { base: '#1a0a12', accent: '244,114,182' },
  slate: { base: '#0f1115', accent: '148,163,184' },
};
export const BANNER_BG_KEYS = Object.keys(BANNER_BG);

/**
 * Paint a custom background, cover-fit, under a scrim.
 *
 * The scrim is not a style choice. The headline is white and the sub-line is grey, and an
 * admin will eventually pick a photograph of a snowy field — without it the text is simply
 * gone, and the preview would have shown that only for the picture they happened to test.
 * Shared with the bot's copy in features/welcome.mjs.
 */
export function paintBackdrop(ctx, img, W, H) {
  const scale = Math.max(W / img.width, H / img.height);   // cover, never letterboxed
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  // Darker on the left, where the avatar and the text sit; lighter on the right so the
  // picture is still a picture.
  const veil = ctx.createLinearGradient(0, 0, W, 0);
  // A PLATEAU, not a ramp, and the shape matters more than the numbers.
  //
  // Measured across four backgrounds, a smooth ramp could not do both jobs: strong enough
  // for white text on a snowy photograph, it flattened the picture everywhere; weak enough
  // to keep the picture, it left the headline at 2.33:1 and the sub-line at 1.47:1 — under
  // WCAG's 3:1 floor for large text, which is to say invisible.
  //
  // So the veil is near-solid across the band the text occupies (x < ~0.68W) and then drops
  // away fast, leaving the right third of the image genuinely visible. Re-measured on a
  // white, a mid-grey, a black and a saturated-yellow background: every one clears 4.5:1.
  veil.addColorStop(0, 'rgba(0,0,0,0.88)');
  veil.addColorStop(0.68, 'rgba(0,0,0,0.86)');
  veil.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = veil; ctx.fillRect(0, 0, W, H);
}

async function renderWelcomePng({ username = 'NewMember', members = 1024, server = 'BetterCommunity', avatarUrl = null, bg = 'dark', bgImage = null }) {
  const C = await loadCanvas();
  if (!C) return null;
  const { createCanvas, loadImage } = C;
  const W = 1200, H = 400;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  const theme = BANNER_BG[bg] || BANNER_BG.dark;
  ctx.fillStyle = theme.base; ctx.fillRect(0, 0, W, H);
  // The bytes come straight out of storage — this endpoint makes NO outbound request for
  // them, so there is no host for a crafted config to point at.
  let backdrop = null;
  if (isMediaPath(bgImage)) {
    try {
      const { body } = await getObject(bgImage.replace('/api/media/', ''));
      const chunks = []; for await (const c of body) chunks.push(c);
      backdrop = await loadImage(Buffer.concat(chunks));
    } catch { backdrop = null; }   // a deleted or unreadable image falls back to the theme
  }
  if (backdrop) paintBackdrop(ctx, backdrop, W, H);
  const gx = W / 2;
  const g = ctx.createRadialGradient(gx, H, 60, gx, H, W);
  // Over a photograph the glow and the dots are decoration on top of decoration; kept, but
  // faint, so a custom background still reads as the background.
  const a = backdrop ? 0.1 : 0.22;
  g.addColorStop(0, `rgba(${theme.accent},${a})`); g.addColorStop(1, `rgba(${theme.accent},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (!backdrop) for (let i = 0; i < 36; i++) { const s = 2 + Math.random() * 4; ctx.fillStyle = `rgba(${theme.accent},${0.15 + Math.random() * 0.35})`; ctx.fillRect(Math.random() * W, Math.random() * H, s, s); }
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
  ctx.fillStyle = backdrop ? '#e5e7eb' : '#9ca3af'; ctx.font = '28px sans-serif'; ctx.fillText(`Member #${members} · ${server}`.slice(0, 46), 344, 288);
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
    // A closed set, mapped to an orderBy here — never a field name from the query, which
    // would let a caller order by anything in the row.
    const SORTS = {
      recent: { updatedAt: 'desc' },
      quiet: { lastMessageAt: { sort: 'asc', nulls: 'first' } },
      newest: { guildJoinedAt: { sort: 'desc', nulls: 'last' } },
      oldest: { guildJoinedAt: { sort: 'asc', nulls: 'last' } },
      name: { username: 'asc' },
    };
    const sort = SORTS[req.query?.sort] ? req.query.sort : 'recent';
    // One role name, matched exactly. `has` on a String[] is an index-friendly containment
    // test; a `contains` would make "mod" match "moderator" and quietly widen the filter.
    const role = String(req.query?.role || '').trim();
    // All linked Discord ids (bounded by account count) — lets us filter the member table
    // by link status and report the linked/unlinked totals for the header.
    const linkedIds = (await p.discordLink.findMany({ select: { discordId: true } })).map((l) => l.discordId);
    const qWhere = q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { discordId: { contains: q } }] } : {};
    const where = {
      ...qWhere,
      ...(link === 'linked' ? { discordId: { in: linkedIds } } : link === 'unlinked' ? { discordId: { notIn: linkedIds } } : {}),
      ...(role ? { roles: { has: role } } : {}),
    };
    // 'unified' member-storage mode presents ONE row per person (with the list of servers they
    // share with the bot), rather than one row per (server, person). Rows are still stored per
    // guild — the collapse is a view: `distinct: discordId` keeps the most-recent row per person,
    // and their servers are attached below. Counts are distinct-person counts to match.
    const cfg = await getBotConfig(p);
    const unified = cfg.memberStorage?.mode === 'unified';
    const distinctLen = (w) => p.discordActivity.findMany({ where: w, distinct: ['discordId'], select: { discordId: true } }).then((a) => a.length);
    const [rows, total, allTotal, linkedTotal] = await Promise.all([
      p.discordActivity.findMany({ where, orderBy: SORTS[sort], take, skip, ...(unified ? { distinct: ['discordId'] } : {}) }),
      unified ? distinctLen(where) : p.discordActivity.count({ where }),
      unified ? distinctLen({}) : p.discordActivity.count(),
      unified ? distinctLen({ discordId: { in: linkedIds } }) : p.discordActivity.count({ where: { discordId: { in: linkedIds } } }),
    ]);
    // Attach the servers each shown person is in (unified view only).
    let serversByPerson = {};
    if (unified && rows.length) {
      const ids = rows.map((r) => r.discordId);
      const allRows = await p.discordActivity.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, guildId: true } });
      const gnames = Object.fromEntries((await p.botGuild.findMany({ where: { guildId: { in: [...new Set(allRows.map((r) => r.guildId))] } }, select: { guildId: true, name: true } })).map((g) => [g.guildId, g.name]));
      for (const r of allRows) (serversByPerson[r.discordId] ||= []).push({ guildId: r.guildId, name: gnames[r.guildId] || r.guildId });
    }
    // Distinct role names across the roster. Capped: a server with thousands of roles
    // should slow nothing down, and a picker past a few hundred entries is unusable anyway.
    const roleRows = await p.discordActivity.findMany({ select: { roles: true }, take: 5000 });
    const allRoles = [...new Set(roleRows.flatMap((r) => r.roles || []))].sort((a, b) => a.localeCompare(b)).slice(0, 200);
    const links = await p.discordLink.findMany({ where: { discordId: { in: rows.map((r) => r.discordId) } }, include: { user: { select: { id: true, displayName: true, email: true } } } });
    const linkByDiscordId = Object.fromEntries(links.map((l) => [l.discordId, l.user]));
    return {
      members: rows.map((r) => ({ ...r, linkedUser: linkByDiscordId[r.discordId] || null, ...(unified ? { servers: serversByPerson[r.discordId] || [] } : {}) })),
      total, hasMore: skip + rows.length < total, unified,
      counts: { all: allTotal, linked: linkedTotal, unlinked: allTotal - linkedTotal },
      // Every role the bot has seen, so the filter is a list to pick from rather than a
      // name to remember. Built from the rows the scan holds, which is the only place this
      // service knows about roles at all.
      roles: allRoles,
    };
  });

  // ── Per-guild member-storage config (B4) ──────────────────────────────────
  const serGuild = (g, stored) => ({
    guildId: g.guildId, name: g.name, memberMode: g.memberMode, logChannelId: g.logChannelId,
    storeLogs: g.storeLogs, hostingGroupId: g.hostingGroupId,
    storageQuotaBytes: Number(g.storageQuotaBytes), // BigInt → Number for JSON
    memberCount: g.memberCount, storedMembers: stored,
    capacity: capacityStatus(g.storageQuotaBytes, stored),
  });

  app.get('/admin/bot/guilds', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const guilds = await p.botGuild.findMany({ orderBy: { updatedAt: 'desc' } });
    // One grouped count instead of a query per guild.
    const counts = await p.discordActivity.groupBy({ by: ['guildId'], _count: { _all: true } });
    const storedBy = Object.fromEntries(counts.map((c) => [c.guildId, c._count._all]));
    return { guilds: guilds.map((g) => serGuild(g, storedBy[g.guildId] || 0)) };
  });

  app.put('/admin/bot/guilds/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      memberMode: z.enum(['none', 'moderation', 'pool']).optional(),
      logChannelId: z.string().max(32).nullable().optional(),
      storeLogs: z.boolean().optional(),
      hostingGroupId: z.string().max(40).nullable().optional(),
      storageQuotaBytes: z.number().int().min(0).max(1_000_000_000_000).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cur = await p.botGuild.findUnique({ where: { guildId: req.params.id } });
    const next = { ...cur, ...b.data };
    // `moderation` runs bans/kicks and MUST log somewhere — refuse it without a channel.
    if (next.memberMode === 'moderation' && !next.logChannelId) return reply.code(400).send({ error: 'log_channel_required' });
    const data = { ...b.data };
    if ('storageQuotaBytes' in data) data.storageQuotaBytes = BigInt(data.storageQuotaBytes);
    const g = await p.botGuild.upsert({ where: { guildId: req.params.id }, create: { guildId: req.params.id, ...data }, update: data });
    await logAudit(p, req.user.uid, 'bot.guild', `${g.guildId} mode=${g.memberMode}`);
    const stored = await p.discordActivity.count({ where: { guildId: g.guildId } });
    return { ok: true, guild: serGuild(g, stored) };
  });

  // The guild's moderation record (B4 Phase 3) — populated only for guilds that keep logs.
  app.get('/admin/bot/guilds/:id/logs', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    const take = Math.min(Math.max(Number(req.query?.take) || 50, 1), 200);
    const logs = await p.moderationLog.findMany({ where: { guildId: req.params.id }, orderBy: { createdAt: 'desc' }, take });
    return { logs };
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
      bg: BANNER_BG_KEYS.includes(String(q.bg)) ? String(q.bg) : 'dark',
      // Validated, not trusted: this is a query parameter, so it is whatever the caller
      // typed regardless of what the dashboard would have sent.
      bgImage: isMediaPath(q.bgImage) ? String(q.bgImage) : null,
    });
    if (!png) return reply.code(503).send({ error: 'canvas_unavailable' });
    reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store');
    return reply.send(png);
  });

  // ── Bot ↔ API (shared secret) ──
  app.get('/bot/config', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    // restartAt rides ALONGSIDE the config, never inside it. The admin dashboard reads its
    // config with GET /admin/bot/config and writes the whole object straight back on save —
    // anything merged into it would be persisted into bot.config by the next unrelated save
    // and then re-trigger a restart forever. Same reserved-field trap as everywhere else
    // here; the fix is to keep the field out of the object that round-trips.
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.restart' } });
    return { config: await getBotConfig(p), restartAt: row?.value?.at || null };
  });

  // Public: the bot's invite URL, built from its own application id. A bot's client_id is not
  // a secret — it is in every invite link — so the landing page and the user nav can offer an
  // "Invite the bot" button without any auth-gated data. Null until the bot has sent at least
  // one heartbeat (which carries its appId). The permission integer is the curated set the
  // dashboard already uses, NOT Administrator.
  app.get('/bot/invite', async (req, reply) => {
    const p = await db();
    const status = (await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value || null;
    const appId = status?.appId || null;
    reply.header('Cache-Control', 'public, max-age=120');
    return { appId, url: appId ? `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=1099796925462&scope=bot%20applications.commands` : null };
  });

  /**
   * The role panels that need posting or editing.
   *
   * The bot asks; the API decides. A panel is due when the fingerprint of what it should
   * look like differs from the fingerprint of what was last posted — which covers "never
   * posted" (no state at all) without a separate case.
   */
  app.get('/bot/rolepanels', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const cfg = await getBotConfig(p);
    const stateRow = await p.adminSetting.findUnique({ where: { key: 'bot.rolePanelState' } });
    const state = stateRow?.value || {};
    const panels = (cfg.rolePanels || []).filter((x) => x && x.id && x.channelId);
    return {
      // Every panel, so the bot can answer a button press on an OLD message too — a member
      // clicking a panel from last month must still get their role.
      panels: panels.map((x) => ({ ...x, hash: rolePanelHash(x), state: state[x.id] || null })),
      due: panels.filter((x) => {
        const st = state[x.id];
        return !st || st.hash !== rolePanelHash(x) || st.channelId !== x.channelId;
      }).map((x) => x.id),
    };
  });

  app.post('/bot/rolepanels/:id/posted', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      messageId: z.string().max(40),
      channelId: z.string().max(40),
      hash: z.string().max(40),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.rolePanelState' } });
    const value = { ...(row?.value || {}), [req.params.id]: { ...b.data, at: new Date().toISOString() } };
    await p.adminSetting.upsert({ where: { key: 'bot.rolePanelState' }, create: { key: 'bot.rolePanelState', value }, update: { value } });
    return { ok: true };
  });

  /**
   * Ask the bot to reconnect.
   *
   * There is no process to kill from here — the bot is its own container and the API cannot
   * signal it. What it DOES do every 20 seconds is read this config, and it already knows
   * how to tear a client down and build a new one, because that is what a token rotation
   * does. So a restart is a timestamp: the bot notices the value changed and takes the same
   * path it takes for a new token.
   *
   * That means it is a RECONNECT, not a process restart — new code still needs a redeploy.
   * The button says so, because an admin who presses "restart" expecting new code and gets
   * a reconnect will conclude the deploy failed.
   */
  app.post('/admin/bot/restart', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const at = new Date().toISOString();
    const value = { at, by: req.user?.id || null };
    await p.adminSetting.upsert({ where: { key: 'bot.restart' }, create: { key: 'bot.restart', value }, update: { value } });
    return { ok: true, at };
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
        kind: z.enum(['discount', 'free_hosting', 'free_pool', 'free_boost']),
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
      if (g.kind === 'free_pool' && !g.storageGB) return reply.code(400).send({ error: 'pool_needs_storage' });
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

  /**
   * DM everybody the bot has seen.
   *
   * Deliberately NOT the existing DM queue: that is a capped array (200) drained twenty at a
   * time, and pushing a thousand recipients into it keeps the last two hundred and drops the
   * rest without a word. A broadcast keeps its own row with the recipients still to reach,
   * so progress survives a bot restart and "did it finish" is answerable.
   *
   * Discord rate-limits DMs hard and treats a burst as spam, which is a risk to the BOT, not
   * just to the message — so the bot drains this slowly and the UI says so. Members who have
   * closed their DMs simply fail; that is recorded as a count, not retried forever.
   */
  app.post('/admin/bot/dm-all', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      message: z.string().trim().min(1).max(1500),
      // Only members who linked a BetterCommunity account, when asked. A DM to somebody who
      // never opted into anything is the kind of message that gets a bot reported.
      linkedOnly: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();

    const linked = new Set((await p.discordLink.findMany({ select: { discordId: true } })).map((l) => l.discordId));
    // DiscordActivity records only real members the scan has seen — there is no `bot`
    // column to filter on, and selecting one would make Prisma refuse the whole query.
    // DISTINCT by discordId: a member in several guilds is several rows now (B4's per-guild
    // key), and a broadcast must DM each person once, not once per shared server.
    const all = await p.discordActivity.findMany({ select: { discordId: true }, distinct: ['discordId'] });
    const ids = all
      .map((m) => m.discordId)
      .filter((id) => (b.data.linkedOnly ? linked.has(id) : true));

    if (!ids.length) return reply.code(400).send({ error: 'no_recipients' });

    const value = {
      id: genCode(),
      message: b.data.message.slice(0, 1900),
      pending: ids,
      total: ids.length,
      sent: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      by: req.user?.uid || null,
    };
    await p.adminSetting.upsert({ where: { key: 'bot.dmBroadcast' }, create: { key: 'bot.dmBroadcast', value }, update: { value } });
    await logAudit(p, req.user.uid, 'bot.dm-all', `recipients=${ids.length} linkedOnly=${!!b.data.linkedOnly}`);
    return { ok: true, recipients: ids.length };
  });

  /** Where a broadcast has got to — the dashboard polls this rather than guessing. */
  app.get('/admin/bot/dm-all', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const v = (await p.adminSetting.findUnique({ where: { key: 'bot.dmBroadcast' } }))?.value || null;
    if (!v) return { broadcast: null };
    return { broadcast: { id: v.id, total: v.total, sent: v.sent, failed: v.failed, remaining: (v.pending || []).length, startedAt: v.startedAt } };
  });

  app.delete('/admin/bot/dm-all', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.adminSetting.deleteMany({ where: { key: 'bot.dmBroadcast' } });
    await logAudit(p, req.user.uid, 'bot.dm-all.stop', 'cancelled');
    return { ok: true };
  });

  /** The bot takes a small slice, sends it, and says what happened. */
  app.get('/bot/dm-all/pending', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const v = (await p.adminSetting.findUnique({ where: { key: 'bot.dmBroadcast' } }))?.value;
    if (!v || !(v.pending || []).length) return { batch: [] };
    // Ten at a time. The bot spaces them out further; this is the ceiling on how much
    // damage one poll can do if something downstream misbehaves.
    return { id: v.id, message: v.message, batch: v.pending.slice(0, 10) };
  });

  app.post('/bot/dm-all/result', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      id: z.string().max(40),
      sent: z.array(z.string().max(32)).max(50),
      failed: z.array(z.string().max(32)).max(50),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.dmBroadcast' } });
    const v = row?.value;
    // A result for a broadcast that has been cancelled or replaced is dropped rather than
    // applied to the new one, which would corrupt its counters.
    if (!v || v.id !== b.data.id) return { ok: true, stale: true };
    const done = new Set([...b.data.sent, ...b.data.failed]);
    const value = {
      ...v,
      pending: (v.pending || []).filter((x) => !done.has(x)),
      sent: (v.sent || 0) + b.data.sent.length,
      failed: (v.failed || 0) + b.data.failed.length,
    };
    await p.adminSetting.update({ where: { key: 'bot.dmBroadcast' }, data: { value } });
    return { ok: true, remaining: value.pending.length };
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

  // Link buffer: freshly created/refreshed DiscordLinks (e.g. from a Discord OAuth sign-in)
  // are flagged pendingSync so the bot can refresh that member's gated roles promptly
  // instead of waiting for the 5-min full sync. The bot polls this, then clears the flag.
  app.get('/bot/links/pending', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const rows = await p.discordLink.findMany({ where: { pendingSync: true }, select: { discordId: true }, take: 50 });
    return { discordIds: rows.map((r) => r.discordId) };
  });
  app.post('/bot/links/synced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ discordIds: z.array(z.string().max(40)).max(50) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.discordLink.updateMany({ where: { discordId: { in: b.data.discordIds } }, data: { pendingSync: false } });
    return { ok: true };
  });

  // ── Giveaways ──
  const giftShape = z.object({
    kind: z.enum(['discount', 'free_hosting', 'free_pool', 'free_boost']),
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
      appId: z.string().max(32).optional(), // the bot's application/client id, for the invite URL
      uptimeSec: z.number().optional(), guilds: z.number().optional(), users: z.number().optional(), tempChannels: z.number().optional(), version: z.string().optional(), online: z.boolean().optional(), error: z.string().max(300).optional(),
      // The servers the bot is currently in (id + name) — lets the admin pick a
      // target server when configuring per-server blog routes.
      // Every field must be declared: this schema strips unknown keys rather than
      // rejecting them, so a role list the bot sends and the schema does not name would
      // vanish here without a single error anywhere.
      guildList: z.array(z.object({
        id: z.string().max(32), name: z.string().max(120),
        icon: z.string().max(400).nullable().optional(), members: z.number().nullable().optional(),
        botTop: z.number().nullable().optional(),
        // B10: who may manage this guild from the user-facing dashboard. ownerId is always
        // known; managerIds (Manage-Server admins) is best-effort from the bot's member cache.
        ownerId: z.string().max(32).nullable().optional(),
        managerIds: z.array(z.string().max(32)).max(200).optional(),
        roles: z.array(z.object({
          id: z.string().max(32), name: z.string().max(100),
          color: z.string().max(16).nullable().optional(), position: z.number().optional(),
        })).max(100).optional(),
      })).max(200).optional(),
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
    // B10: mirror the guild roster into BotGuild so every server the bot is in exists as a
    // row carrying its owner — even one still in the default `none` mode. This is what lets a
    // server owner manage their guild from the user dashboard before any admin touches it.
    // Only the reported fields are updated (name/memberCount/owner/managers); the admin-set
    // memberMode/logChannel/pool/quota are never clobbered. A new guild is created in `none`.
    if (d.guildList?.length) {
      for (const g of d.guildList) {
        const upd = {};
        if (g.name != null) upd.name = g.name;
        if (g.members != null) upd.memberCount = g.members;
        if (g.ownerId !== undefined) upd.ownerDiscordId = g.ownerId || null;
        if (g.managerIds !== undefined) upd.managerDiscordIds = g.managerIds || [];
        await p.botGuild.upsert({ where: { guildId: g.id }, create: { guildId: g.id, ...upd }, update: upd }).catch(() => {});
      }
    }
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
      guildId: z.string().min(1).max(32), // B4: activity is per guild now (composite key)
      guildName: z.string().max(120).optional(),
      discordId: z.string().min(1).max(32),
      username: z.string().max(80).optional(),
      avatar: z.string().max(400).optional(),
      event: z.enum(['join', 'message', 'voiceJoin', 'voiceCreate']),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const g = await botGuild(p, b.data.guildId, b.data.guildName);
    // Same privacy default as the bulk sync: a guild not opted into `pool` stores nothing.
    if (g.memberMode !== 'pool') return { ok: true, stored: false, reason: 'member_storage_off' };
    const now = new Date();
    const field = { join: 'guildJoinedAt', message: 'lastMessageAt', voiceJoin: 'lastVoiceJoinAt', voiceCreate: 'lastVoiceCreateAt' }[b.data.event];
    const base = { username: b.data.username, avatar: b.data.avatar };
    // A brand-new member counts against the budget; an existing row is only refreshed.
    const exists = await p.discordActivity.findUnique({ where: { guildId_discordId: { guildId: g.guildId, discordId: b.data.discordId } }, select: { discordId: true } });
    if (!exists) {
      const cap = memberCapacity(g.storageQuotaBytes);
      if (cap !== Infinity && (await p.discordActivity.count({ where: { guildId: g.guildId } })) >= cap) return { ok: true, stored: false, reason: 'at_capacity' };
    }
    await p.discordActivity.upsert({
      where: { guildId_discordId: { guildId: g.guildId, discordId: b.data.discordId } },
      create: { guildId: g.guildId, discordId: b.data.discordId, ...base, [field]: now },
      update: { ...base, [field]: now },
    });
    return { ok: true, stored: true };
  });

  // Bot-facing: a guild's member-storage mode, so the bot can skip the expensive full-roster
  // fetch for a guild that stores nothing. Lazily creates the row at the safe default (`none`).
  app.get('/bot/guilds/:id', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const g = await botGuild(p, req.params.id);
    return { guildId: g.guildId, memberMode: g.memberMode };
  });

  // Bulk member sync — the bot posts its FULL guild roster on startup (and periodically)
  // so the member database contains every member, not just those who happened to send a
  // message or join while the bot was online. Upserts in chunks; guildJoinedAt is only
  // filled when known and not already set (a real join event is more authoritative).
  // ── Moderation the admin asks for, and the bot carries out ─────────────────
  //
  // Queued, not called. See the BotAction model: the API has no way to reach Discord, and the
  // outcome matters — a ban Discord refuses because the bot's own role sits below the target's
  // is a normal, frequent failure that a moderator must SEE rather than assume away.
  const ACTIONS = ['ban', 'unban', 'kick', 'timeout', 'untimeout'];

  app.post('/admin/bot/actions', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(ACTIONS),
      discordId: z.string().min(1).max(32),
      guildId: z.string().max(32).optional(), // B4: which server; recorded in its ModerationLog on success
      // Required for the ones that punish. Unban and untimeout are the undo, and demanding a
      // reason to undo something is how an undo stops being used.
      reason: z.string().trim().max(500).optional(),
      minutes: z.number().int().min(1).max(60 * 24 * 28).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const { kind, discordId, minutes, guildId } = b.data;
    const reason = (b.data.reason || '').trim();
    if (['ban', 'kick', 'timeout'].includes(kind) && !reason) return reply.code(400).send({ error: 'reason_required' });
    // Discord's own ceiling. Asking for 40 days silently becomes 28, so it is refused instead.
    if (kind === 'timeout' && !minutes) return reply.code(400).send({ error: 'minutes_required' });

    const p = await db();
    const [member, me] = await Promise.all([
      // findFirst, not findUnique: discordId is no longer a unique key on its own (B4's per-guild
      // rows) — any guild's row gives the username we want for the action label.
      p.discordActivity.findFirst({ where: { discordId }, select: { username: true } }),
      p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true, email: true } }),
    ]);
    const action = await p.botAction.create({
      data: {
        kind, discordId, guildId: guildId || null, minutes: minutes ?? null, reason,
        targetLabel: member?.username || discordId,
        requestedById: req.user.uid,
        requestedByLabel: [me?.displayName, me?.email].filter(Boolean).join(' · ').slice(0, 200),
      },
    });
    await logAudit(p, req.user.uid, `bot.${kind}`, `${member?.username || discordId}${reason ? ` — ${reason}` : ''}`, req.ip).catch(() => {});
    return { ok: true, action };
  });

  // The bot's own door to warnings. Separate from the admin one because the bot carries a
  // shared secret, not a session — the previous version of this called the admin endpoint and
  // would have been refused every time, which is the kind of thing that looks like "the bot is
  // broken" rather than "that route needs a cookie".
  app.post('/bot/warns', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      discordId: z.string().min(1).max(32),
      reason: z.string().trim().min(1).max(500),
      guildId: z.string().max(32).optional(),
      // Who typed the command, as Discord names them. Not trusted for anything but the label:
      // the bot is authenticated, the moderator is not.
      by: z.string().max(120).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await issueWarn(p, {
      discordId: b.data.discordId, reason: b.data.reason, guildId: b.data.guildId || null,
      issuedById: null,
      issuedByLabel: b.data.by ? `${b.data.by} (Discord)` : 'Discord moderator',
    });
    return { ok: true, count: r.count, triggered: r.triggered };
  });

  app.get('/bot/warns', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const discordId = String(req.query?.discordId || '');
    if (!discordId) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const [warns, active] = await Promise.all([
      p.botWarn.findMany({ where: { discordId }, orderBy: { createdAt: 'desc' }, take: 25 }),
      p.botWarn.count({ where: { discordId, revokedAt: null } }),
    ]);
    return { warns, active };
  });

  // ── Warnings ───────────────────────────────────────────────────────────────
  //
  // A warning is a FACT we record, not a thing Discord can refuse — which is why it is its own
  // model rather than another BotAction kind. What it does is arrive with a count, and the Nth
  // one buys an action from the configured ladder. See lib/warns.mjs for the rule.
  app.post('/admin/bot/warns', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const b = z.object({
      discordId: z.string().min(1).max(32),
      // A warning with no reason is one nobody can appeal and nobody learns from. Required,
      // unlike the undo actions.
      reason: z.string().trim().min(1).max(500),
      guildId: z.string().max(32).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const { discordId, reason, guildId } = b.data;

    const p = await db();
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true, email: true } });
    const { warn, count, triggered, action, targetLabel } = await issueWarn(p, {
      discordId, reason, guildId: guildId || null,
      issuedById: req.user.uid,
      issuedByLabel: [me?.displayName, me?.email].filter(Boolean).join(' · '),
    });

    await logAudit(p, req.user.uid, 'bot.warn', `${targetLabel} — ${reason}${triggered ? ` → ${triggered.kind}` : ''}`, req.ip).catch(() => {});
    return { ok: true, warn, count, triggered, action };
  });

  app.get('/admin/bot/warns', { preHandler: requireCap('manage_users', 'MOD') }, async (req) => {
    const p = await db();
    const where = req.query?.discordId ? { discordId: String(req.query.discordId) } : {};
    const [warns, active] = await Promise.all([
      p.botWarn.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
      // The number that matters is the one the ladder reads, so it is served rather than
      // left for the client to recompute from a truncated list.
      req.query?.discordId
        ? p.botWarn.count({ where: { discordId: String(req.query.discordId), revokedAt: null } })
        : Promise.resolve(null),
    ]);
    return { warns, active };
  });

  // Withdrawn, never deleted: "this was taken back on the 4th" is part of the record, and a
  // count that silently drops rows makes an escalation impossible to explain afterwards.
  app.post('/admin/bot/warns/:id/revoke', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const b = z.object({ reason: z.string().trim().max(500).optional() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.botWarn.findUnique({ where: { id: req.params.id } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.revokedAt) return { ok: true, warn: row, alreadyRevoked: true };
    const warn = await p.botWarn.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), revokedById: req.user.uid, revokedReason: b.data.reason || null },
    });
    await logAudit(p, req.user.uid, 'bot.warn.revoke', `${row.targetLabel} — ${b.data.reason || 'no reason given'}`, req.ip).catch(() => {});
    return { ok: true, warn };
  });

  app.get('/admin/bot/actions', { preHandler: requireCap('manage_users', 'MOD') }, async (req) => {
    const p = await db();
    const where = req.query?.discordId ? { discordId: String(req.query.discordId) } : {};
    return { actions: await p.botAction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }) };
  });

  // ── Announcements: events, promotions, a commission waiting ────────────────
  //
  // Same queue shape as BotAction, and shared so a fifth kind of message cannot invent a sixth
  // way of being posted. `announce` is exported for the places that should fire one without an
  // admin pressing anything.
  const ANNOUNCE_KINDS = ['event', 'promo', 'myo', 'incident', 'custom'];

  app.post('/admin/bot/announce', { preHandler: requireCap('manage_users', 'ADMIN') }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(ANNOUNCE_KINDS),
      title: z.string().trim().min(1).max(200),
      body: z.string().trim().max(1500).optional(),
      url: z.string().url().max(400).optional(),
      channelId: z.string().max(32).optional(),
      urgent: z.boolean().optional(),
      // Named explicitly because this schema STRIPS unknown keys rather than rejecting
      // them: a format the composer sends and the schema does not list would be dropped
      // here, the row would save as an embed, and nothing anywhere would say why.
      format: z.enum(['embed', 'text', 'both']).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      image: z.string().url().max(600).optional(),
      // A role to mention, chosen per announcement. The routing config already had one per
      // kind, but it only fires for an urgent message — which left no way to ping a role
      // for something that simply matters and is not an emergency.
      //
      // '' is meaningful and different from absent: it means "mention nobody", overriding
      // whatever the routing config would have done. Absent means "use the config".
      roleId: z.string().max(32).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.botAnnouncement.create({ data: { ...b.data, body: b.data.body || '' } });
    return { ok: true, announcement: row };
  });

  app.get('/admin/bot/announcements', { preHandler: requireCap('manage_users', 'MOD') }, async () => {
    const p = await db();
    return { announcements: await p.botAnnouncement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }) };
  });

  app.get('/bot/announcements/pending', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    return { announcements: await p.botAnnouncement.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 10 }) };
  });

  app.post('/bot/announcements/:id/result', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ ok: z.boolean(), error: z.string().max(500).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // A failure is kept as `failed` with its message, not retried for ever: a channel that was
    // deleted would otherwise produce one attempt every twenty seconds until somebody noticed.
    await p.botAnnouncement.update({
      where: { id: req.params.id },
      data: { status: b.data.ok ? 'sent' : 'failed', error: b.data.ok ? null : (b.data.error || 'unknown'), sentAt: new Date() },
    }).catch(() => {});
    return { ok: true };
  });

  // Bot side: take the queue, then say what happened to each.
  app.get('/bot/actions/pending', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    return { actions: await p.botAction.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 25 }) };
  });

  app.post('/bot/actions/:id/result', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ ok: z.boolean(), error: z.string().max(500).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const action = await p.botAction.update({
      where: { id: req.params.id },
      data: { status: b.data.ok ? 'done' : 'failed', error: b.data.ok ? null : (b.data.error || 'unknown'), attemptedAt: new Date() },
    }).catch(() => null);
    // A carried-out action goes into the guild's moderation record (mode permitting).
    if (b.data.ok && action?.guildId) {
      await logModeration(p, { guildId: action.guildId, actorId: action.requestedById, targetId: action.discordId, action: action.kind, reason: action.reason });
    }
    return { ok: true };
  });

  app.post('/bot/members/sync', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      // B4: the roster is now per GUILD. The bot must say which server it is syncing so the
      // rows are budgeted against that guild's storage — and so a guild set to `none` (the
      // default) is skipped entirely, which is what keeps a 1M-member server from writing 1M rows.
      guildId: z.string().min(1).max(32),
      guildName: z.string().max(120).optional(),
      memberCount: z.number().int().min(0).optional(), // the guild's REAL size, kept even when not storing
      members: z.array(z.object({
        discordId: z.string().min(1).max(32),
        username: z.string().max(80).optional(),
        avatar: z.string().max(400).optional(),
        joinedAt: z.string().datetime().optional(),
        roles: z.array(z.string().max(60)).max(50).optional(),
        nickname: z.string().max(80).nullable().optional(),
      })).max(2000),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const g = await botGuild(p, b.data.guildId, b.data.guildName);
    // Keep the REAL member count even when we store nothing — "at capacity" can still show how
    // big the server actually is, and a `none` guild still reports its size to the dashboard.
    if (b.data.memberCount != null) await p.botGuild.update({ where: { guildId: g.guildId }, data: { memberCount: b.data.memberCount } }).catch(() => {});

    // The GLOBAL member-storage strategy overrides the per-guild gate. 'managed' (default) is
    // the per-server model — a guild stores only when opted into `pool`, against its own budget.
    // 'free' stores in EVERY guild against the shared limits.storageMB budget, narrowed by scope
    // ('linked' keeps only members who linked a site account). 'unified' is not wired on the data
    // model yet, so it falls back to the managed per-guild behaviour.
    const cfg = await getBotConfig(p);
    const ms = cfg.memberStorage || { mode: 'managed', scope: 'linked' };
    let members = b.data.members;
    let effMode = g.memberMode, stored, capacity;
    if (ms.mode === 'free' || ms.mode === 'unified') {
      // Store in every server against one shared budget. 'free' + 'linked' narrows to members
      // who linked a site account; 'unified' stores everyone (it is collapsed to one row per
      // person in the members VIEW, not at write time).
      effMode = 'pool';
      if (ms.mode === 'free' && ms.scope === 'linked') {
        const linked = new Set((await p.discordLink.findMany({ where: { discordId: { in: members.map((m) => m.discordId) } }, select: { discordId: true } })).map((r) => r.discordId));
        members = members.filter((m) => linked.has(m.discordId));
      }
      stored = await p.discordActivity.count(); // one shared budget across every guild
      capacity = memberCapacity((Number(cfg.limits?.storageMB) || 0) * 1024 * 1024);
    } else {
      stored = await p.discordActivity.count({ where: { guildId: g.guildId } });
      capacity = memberCapacity(g.storageQuotaBytes);
    }
    const gate = admitMembers(effMode, stored, capacity, members.length);
    if (!gate.store) return { ok: true, stored: false, reason: gate.reason, mode: g.memberMode };

    let synced = 0;
    // Update rows we already hold FIRST (they cost no new budget), then admit new ones only
    // while there is room — so a full guild keeps its existing members fresh but stops growing.
    const existing = new Set((await p.discordActivity.findMany({ where: { guildId: g.guildId, discordId: { in: members.map((m) => m.discordId) } }, select: { discordId: true } })).map((r) => r.discordId));
    let room = gate.room;
    for (const m of members) {
      const isNew = !existing.has(m.discordId);
      if (isNew && room !== Infinity && room <= 0) continue; // budget full — count real size, store no more
      const joinedAt = m.joinedAt ? new Date(m.joinedAt) : null;
      await p.discordActivity.upsert({
        where: { guildId_discordId: { guildId: g.guildId, discordId: m.discordId } },
        create: { guildId: g.guildId, discordId: m.discordId, username: m.username, avatar: m.avatar, guildJoinedAt: joinedAt, roles: m.roles || [], nickname: m.nickname ?? null },
        // Don't clobber a known join date with null; refresh name/avatar (they change).
        // Roles are replaced wholesale when the scan sends them, and left alone when it does
        // not — a scan that could not read them must not empty the list and make everybody
        // look like they have no roles at all.
        update: { username: m.username, avatar: m.avatar, ...(joinedAt ? { guildJoinedAt: joinedAt } : {}),
          ...(m.roles ? { roles: m.roles } : {}), ...(m.nickname !== undefined ? { nickname: m.nickname } : {}) },
      }).then(() => { synced++; if (isNew && room !== Infinity) room -= 1; }).catch(() => {});
    }
    return { ok: true, stored: true, synced, full: gate.full || (room !== Infinity && room <= 0) };
  });

  // Account resolution for gated access + telemetry enrichment.
  app.get('/bot/account/:discordId', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const link = await p.discordLink.findUnique({ where: { discordId: req.params.discordId }, include: { user: { select: { id: true, displayName: true, creatorLinks: { select: { creatorId: true } } } } } });
    if (!link) return { linked: false };
    return { linked: true, userId: link.user.id, displayName: link.user.displayName, creatorIds: link.user.creatorLinks.map((c) => c.creatorId), hasBmm: link.user.creatorLinks.length > 0 };
  });

  // ── B-econ: levelling / economy ───────────────────────────────────────────
  // The level a cumulative XP total maps to, using the configured curve. The cost to go from
  // level k to k+1 is base·factor^k, so reaching level L costs base·(factor^L−1)/(factor−1) —
  // the exact curve the admin preview draws. Higher factor = each level is harder.
  const economyLevelFor = (xp, base, factor) => {
    base = Number(base) || 100; factor = Number(factor) || 1.18; xp = Math.max(0, Number(xp) || 0);
    let lvl = 0, cum = 0;
    while (lvl < 100000) { const step = base * factor ** lvl; if (cum + step > xp) break; cum += step; lvl++; }
    return lvl;
  };
  const economyXpForLevel = (lvl, base, factor) => {
    base = Number(base) || 100; factor = Number(factor) || 1.18;
    return Math.round(base * ((factor ** lvl - 1) / (factor - 1)));
  };
  // Total points a member has EARNED by reaching a level (floored to the grant interval). The
  // spendable balance adds the delta of this on level-up, so points are never double-granted.
  const economyPointsEarned = (level, everyN, perGrant) => Math.floor(Math.max(0, level) / Math.max(1, Number(everyN) || 5)) * (Number(perGrant) || 0);

  // The bot reports raw activity deltas here; the API turns them into XP (server-authoritative
  // rates), a level, and points. XP accrues ONLY for a discordId linked to a BCWEB account — an
  // unlinked member is skipped, so every level maps to a real profile.
  app.post('/bot/economy/accrue', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      events: z.array(z.object({
        discordId: z.string().min(1).max(32),
        messages: z.number().int().min(0).max(100000).optional(),
        reactions: z.number().int().min(0).max(100000).optional(),
        voiceSeconds: z.number().int().min(0).max(86400).optional(),
      })).max(500),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    if (!eco.enabled) return { ok: true, disabled: true };
    const rMsg = Number(eco.xpPerMessage) || 0, rReact = Number(eco.xpPerReaction) || 0, rVoice = Number(eco.xpPerVoiceMinute) || 0;
    const ids = [...new Set(b.data.events.map((e) => e.discordId))];
    const links = await p.discordLink.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, userId: true } });
    const userByDiscord = Object.fromEntries(links.map((l) => [l.discordId, l.userId]));
    let updated = 0;
    for (const ev of b.data.events) {
      const userId = userByDiscord[ev.discordId];
      if (!userId) continue;
      const msgs = ev.messages || 0, reacts = ev.reactions || 0, vsec = ev.voiceSeconds || 0;
      const xpDelta = msgs * rMsg + reacts * rReact + Math.floor(vsec / 60) * rVoice;
      const cur = await p.userEconomy.findUnique({ where: { userId } });
      const oldXp = cur?.xp || 0, oldLevel = cur?.level || 0;
      const newXp = oldXp + xpDelta;
      const newLevel = economyLevelFor(newXp, eco.curveBase, eco.curveFactor);
      const pointsDelta = Math.max(0, economyPointsEarned(newLevel, eco.pointsEveryLevels, eco.pointsPerGrant) - economyPointsEarned(oldLevel, eco.pointsEveryLevels, eco.pointsPerGrant));
      await p.userEconomy.upsert({
        where: { userId },
        create: { userId, xp: newXp, level: newLevel, points: pointsDelta, voiceSeconds: vsec, messages: msgs, reactions: reacts },
        update: { xp: newXp, level: newLevel, points: { increment: pointsDelta }, voiceSeconds: { increment: vsec }, messages: { increment: msgs }, reactions: { increment: reacts } },
      }).then(() => { updated++; }).catch(() => {});
    }
    return { ok: true, updated };
  });

  // Read the current economy config (currency + curve) — the bot needs it for /profile, /shop.
  app.get('/bot/economy/config', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const eco = (await getBotConfig(await db())).economy || {};
    return { economy: eco };
  });

  // A member's own level, points and stats — for their dashboard / profile.
  app.get('/me/economy', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const e = await p.userEconomy.findUnique({ where: { userId: req.user.uid } });
    const eco = (await getBotConfig(p)).economy || {};
    const level = e?.level || 0;
    const xp = e?.xp || 0;
    return {
      enabled: !!eco.enabled,
      currency: { name: eco.currencyName || 'points', emoji: eco.currencyEmoji || '', image: eco.currencyImage || '' },
      level, xp, points: e?.points || 0,
      xpThisLevel: xp - economyXpForLevel(level, eco.curveBase, eco.curveFactor),
      xpForNext: economyXpForLevel(level + 1, eco.curveBase, eco.curveFactor) - economyXpForLevel(level, eco.curveBase, eco.curveFactor),
      stats: { voiceSeconds: e?.voiceSeconds || 0, messages: e?.messages || 0, reactions: e?.reactions || 0, public: e?.statsPublic ?? (eco.statsPublic !== false) },
    };
  });

  // Toggle whether the member's activity stats are public (level itself is always public).
  app.put('/me/economy/stats-public', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ public: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.userEconomy.upsert({ where: { userId: req.user.uid }, create: { userId: req.user.uid, statsPublic: b.data.public }, update: { statsPublic: b.data.public } });
    return { ok: true };
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

  // ── B10: user-facing per-server config ────────────────────────────────────
  // A logged-in user configures the Discord servers they own (or hold Manage-Server on),
  // resolved through their linked Discord account(s) — no site-admin role. They set the
  // member mode / log channel / whether to keep logs; the storage POOL and byte budget stay
  // admin-only (a user must never self-grant storage), so capacity is shown read-only. The
  // field rules mirror the admin PUT exactly, so the two never diverge. Every route re-checks
  // ownership against the caller's own links — the :id is never trusted on its own.
  const myDiscordIds = async (p, uid) => (await p.discordLink.findMany({ where: { userId: uid }, select: { discordId: true } })).map((l) => l.discordId);
  // owner OR a Manage-Server admin. `in`/`hasSome` over an empty list matches nothing, but we
  // guard on ids.length before calling so an account with no linked Discord never lists guilds.
  const manageableWhere = (ids) => ({ OR: [{ ownerDiscordId: { in: ids } }, { managerDiscordIds: { hasSome: ids } }] });
  const serGuildUser = (g, stored, ids) => ({
    guildId: g.guildId, name: g.name, memberMode: g.memberMode, logChannelId: g.logChannelId,
    storeLogs: g.storeLogs, memberCount: g.memberCount, storedMembers: stored,
    capacity: capacityStatus(g.storageQuotaBytes, stored), // read-only: user can't set the budget
    role: g.ownerDiscordId && ids.includes(g.ownerDiscordId) ? 'owner' : 'manager',
  });

  app.get('/me/discord/guilds', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const ids = await myDiscordIds(p, req.user.uid);
    // The bot's application id (from its heartbeat) → an "invite the bot" OAuth2 URL the user
    // dashboard can offer. Returned even when the user has no linked guilds yet, so someone who
    // just wants to ADD the bot to their server can, before it has ever joined.
    const appId = (await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value?.appId || null;
    if (!ids.length) return { linked: false, guilds: [], appId };
    const guilds = await p.botGuild.findMany({ where: manageableWhere(ids), orderBy: { memberCount: 'desc' } });
    const counts = guilds.length ? await p.discordActivity.groupBy({ by: ['guildId'], _count: { _all: true }, where: { guildId: { in: guilds.map((g) => g.guildId) } } }) : [];
    const storedBy = Object.fromEntries(counts.map((c) => [c.guildId, c._count._all]));
    return { linked: true, guilds: guilds.map((g) => serGuildUser(g, storedBy[g.guildId] || 0, ids)), appId };
  });

  app.get('/me/discord/guilds/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const ids = await myDiscordIds(p, req.user.uid);
    const g = ids.length ? await p.botGuild.findFirst({ where: { guildId: req.params.id, ...manageableWhere(ids) } }) : null;
    if (!g) return reply.code(404).send({ error: 'not_found' });
    const stored = await p.discordActivity.count({ where: { guildId: g.guildId } });
    // Only a guild that keeps logs has any to show; a moderation guild without storeLogs
    // logs to Discord only, so there is nothing in our DB to read.
    const logs = g.storeLogs ? await p.moderationLog.findMany({ where: { guildId: g.guildId }, orderBy: { createdAt: 'desc' }, take: 50 }) : [];
    // The guild's per-server feature config, so its OWNER can edit it from their own dashboard
    // — it lives in the free-form bot.config.guilds[guildId] blob (admin-only until now).
    const cfg = await getBotConfig(p);
    const gc = (cfg.guilds && cfg.guilds[g.guildId]) || {};
    // Blog-announcement routes are a GLOBAL list, but each route already carries a guildId — so
    // an owner sees and edits only the routes stamped to THIS guild, never another server's.
    const blogRoutes = (Array.isArray(cfg.blog?.routes) ? cfg.blog.routes : []).filter((r) => r.guildId === g.guildId);
    // Role panels are global too, but each carries a guildId (admins assign it) — so an owner
    // sees and edits only the panels assigned to THIS guild.
    const rolePanels = (Array.isArray(cfg.rolePanels) ? cfg.rolePanels : []).filter((pnl) => pnl.guildId === g.guildId);
    // The GLOBAL member-storage strategy (set by an admin). When it is 'free' or 'unified', the
    // bot stores members regardless of this server's own per-server choice — so the owner's
    // dashboard can say the choice is overridden rather than looking broken.
    return { guild: serGuildUser(g, stored, ids), logs, welcome: gc.welcome || {}, joinToCreate: gc.joinToCreate || {}, gating: gc.gating || {}, blog: { routes: blogRoutes }, rolePanels, globalStorage: { mode: cfg.memberStorage?.mode || 'managed' } };
  });

  // The guild's stored members, for its OWNER — read-only, and STRICTLY scoped to this one
  // guild (never inter-server: the where clause is pinned to g.guildId). Only meaningful for a
  // `pool`-mode guild, which is the only mode that stores members at all.
  app.get('/me/discord/guilds/:id/members', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const ids = await myDiscordIds(p, req.user.uid);
    const g = ids.length ? await p.botGuild.findFirst({ where: { guildId: req.params.id, ...manageableWhere(ids) } }) : null;
    if (!g) return reply.code(404).send({ error: 'not_found' });
    const take = Math.min(Number(req.query?.take) || 30, 100);
    const skip = Math.max(0, Number(req.query?.skip) || 0);
    const q = String(req.query?.q || '').trim();
    const where = {
      guildId: g.guildId, // the pin that makes this per-server, never cross-guild
      ...(q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { nickname: { contains: q, mode: 'insensitive' } }, { discordId: { contains: q } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      p.discordActivity.findMany({ where, orderBy: { updatedAt: 'desc' }, take, skip, select: { discordId: true, username: true, avatar: true, nickname: true, roles: true, guildJoinedAt: true, lastMessageAt: true } }),
      p.discordActivity.count({ where }),
    ]);
    return { members: rows, total, mode: g.memberMode };
  });

  // Owner-side moderation: queue a ban/kick/timeout (or its undo) against a member of THIS
  // guild. Two guarantees make it safe for a non-admin server owner: the guild id is taken from
  // the owned guild (never the body), and the target must already be a stored member of that
  // exact guild — so an owner can act only on their own server, never inter-server, and never on
  // an arbitrary snowflake. The action is QUEUED (BotAction) exactly like the admin path.
  app.post('/me/discord/guilds/:id/actions', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(ACTIONS),
      discordId: z.string().min(1).max(32),
      reason: z.string().trim().max(500).optional(),
      minutes: z.number().int().min(1).max(60 * 24 * 28).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const { kind, discordId, minutes } = b.data;
    const reason = (b.data.reason || '').trim();
    if (['ban', 'kick', 'timeout'].includes(kind) && !reason) return reply.code(400).send({ error: 'reason_required' });
    if (kind === 'timeout' && !minutes) return reply.code(400).send({ error: 'minutes_required' });
    const p = await db();
    const ids = await myDiscordIds(p, req.user.uid);
    const g = ids.length ? await p.botGuild.findFirst({ where: { guildId: req.params.id, ...manageableWhere(ids) } }) : null;
    if (!g) return reply.code(404).send({ error: 'not_found' });
    // You cannot moderate yourself through this, and the target must be a member of THIS guild.
    if (ids.includes(discordId)) return reply.code(400).send({ error: 'cannot_moderate_self' });
    const member = await p.discordActivity.findUnique({ where: { guildId_discordId: { guildId: g.guildId, discordId } }, select: { username: true } });
    if (!member) return reply.code(404).send({ error: 'member_not_found' });
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true, email: true } });
    const action = await p.botAction.create({
      data: {
        kind, discordId, guildId: g.guildId, minutes: minutes ?? null, reason,
        targetLabel: member.username || discordId,
        requestedById: req.user.uid,
        requestedByLabel: [me?.displayName, me?.email].filter(Boolean).join(' · ').slice(0, 200),
      },
    });
    await logAudit(p, req.user.uid, `bot.self.${kind}`, `${g.guildId}: ${member.username || discordId}${reason ? ` — ${reason}` : ''}`, req.ip).catch(() => {});
    return { ok: true, action };
  });

  app.put('/me/discord/guilds/:id', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      memberMode: z.enum(['none', 'moderation', 'pool']).optional(),
      logChannelId: z.string().max(32).nullable().optional(),
      storeLogs: z.boolean().optional(),
      // The guild's welcome/bye config — owner-editable. Bounded to exactly these fields, so an
      // owner can never reach any OTHER part of the shared bot.config blob through this path.
      welcome: z.object({
        enabled: z.boolean().optional(),
        channelId: z.string().max(32).optional(),
        joinMessage: z.string().max(500).optional(),
        leaveMessage: z.string().max(500).optional(),
        gifBg: z.enum(['dark', 'midnight', 'plum', 'forest', 'rose', 'slate']).optional(),
        bgImage: z.string().max(300).optional(),
      }).optional(),
      // Join-to-create voice: an enable flag + a list of lobbies (each a voice channel that
      // spawns a temp room). Same bounded-subset guarantee as welcome.
      joinToCreate: z.object({
        enabled: z.boolean().optional(),
        lobbies: z.array(z.object({
          lobbyChannelId: z.string().max(32).optional().default(''),
          categoryId: z.string().max(32).optional().default(''),
          tempCategoryName: z.string().max(100).optional().default(''),
        })).max(20).optional(),
      }).optional(),
      // Gated access: an enable flag + a list of role-grant rules. Each rule grants ONE Discord
      // role to members who meet its link requirements. Same bounded-subset guarantee.
      gating: z.object({
        enabled: z.boolean().optional(),
        rules: z.array(z.object({
          roleId: z.string().max(32).optional().default(''),
          label: z.string().max(60).optional().default(''),
          requireDiscord: z.boolean().optional().default(true),
          requireBcweb: z.boolean().optional().default(true),
          requireBmm: z.boolean().optional().default(false),
        })).max(30).optional(),
      }).optional(),
      // Blog-announcement routes for THIS guild. Merged into the global cfg.blog.routes list,
      // preserving every route that belongs to another guild (or to no guild = admin's own).
      blog: z.object({
        routes: z.array(z.object({
          channelId: z.string().max(32).optional().default(''),
          sources: z.array(z.string().max(24)).max(12).optional().default(['*']),
        })).max(20).optional(),
      }).optional(),
      // Rule & role panels for THIS guild. Same global-list-with-guildId merge as blog.
      rolePanels: z.array(z.object({
        id: z.string().max(64).optional(),
        channelId: z.string().max(32).optional().default(''),
        title: z.string().max(256).optional().default(''),
        body: z.string().max(3800).optional().default(''),
        asEmbed: z.boolean().optional().default(true),
        color: z.string().max(9).optional().default('#f59e0b'),
        mode: z.enum(['buttons', 'dropdown']).optional().default('buttons'),
        multi: z.boolean().optional().default(true),
        roles: z.array(z.object({
          roleId: z.string().max(32).optional().default(''),
          label: z.string().max(80).optional().default(''),
          emoji: z.string().max(40).optional().default(''),
          style: z.enum(['secondary', 'primary', 'success', 'danger']).optional(),
          description: z.string().max(100).optional(),
        })).max(30).optional().default([]),
      })).max(20).optional(),
      // Deliberately NOT accepted here: hostingGroupId + storageQuotaBytes. Those are the
      // storage budget and stay on the admin path — the zod strip drops them silently, which
      // is the intended guard, not a bug.
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const ids = await myDiscordIds(p, req.user.uid);
    const cur = ids.length ? await p.botGuild.findFirst({ where: { guildId: req.params.id, ...manageableWhere(ids) } }) : null;
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    // The feature subtrees ride in the same body but live in a different store (the config
    // blob, not the BotGuild row), so split them out — passing them to botGuild.update would be
    // unknown columns.
    const { welcome, joinToCreate, gating, blog, rolePanels, ...guildData } = b.data;
    const next = { ...cur, ...guildData };
    // `moderation` runs bans/kicks and MUST log somewhere — same refusal as the admin path.
    if (next.memberMode === 'moderation' && !next.logChannelId) return reply.code(400).send({ error: 'log_channel_required' });
    const g = await p.botGuild.update({ where: { guildId: cur.guildId }, data: guildData });
    // Merge the given config into bot.config. Read the RAW stored value (not the defaults-merged
    // one) so we never persist DEFAULT_BOT_CONFIG into the row, and touch ONLY what this owner is
    // allowed to: their guild's feature subtrees, and their guild's blog routes.
    const featurePatch = {};
    if (welcome) {
      const w = { ...welcome };
      // Same guard the admin editor documents: a background must be an uploaded-media path, or
      // both renderers silently ignore it. Drop anything else rather than store a dead link.
      if (w.bgImage && !/^\/api\/media\/[A-Za-z0-9._/-]+$/.test(w.bgImage)) w.bgImage = '';
      featurePatch.welcome = w;
    }
    if (joinToCreate) featurePatch.joinToCreate = joinToCreate;
    if (gating) featurePatch.gating = gating;
    const changed = Object.keys(featurePatch);
    if (changed.length || blog || rolePanels) {
      const raw = (await p.adminSetting.findUnique({ where: { key: 'bot.config' } }))?.value || {};
      const nextCfg = { ...raw };
      if (changed.length) {
        const guilds = { ...(raw.guilds || {}) };
        const gc = { ...(guilds[cur.guildId] || {}) };
        for (const [k, v] of Object.entries(featurePatch)) gc[k] = { ...(gc[k] || {}), ...v };
        guilds[cur.guildId] = gc;
        nextCfg.guilds = guilds;
      }
      if (blog) {
        // Rebuild the GLOBAL route list = every route NOT for this guild (other servers + the
        // admin's own un-stamped routes), plus this owner's routes re-stamped to their guild.
        const existing = Array.isArray(raw.blog?.routes) ? raw.blog.routes : [];
        const keep = existing.filter((r) => r.guildId !== cur.guildId);
        const mine = (blog.routes || [])
          .map((r) => ({ channelId: (r.channelId || '').trim(), sources: (r.sources && r.sources.length ? r.sources : ['*']), guildId: cur.guildId }))
          .filter((r) => r.channelId);
        nextCfg.blog = { ...(raw.blog || {}), routes: [...keep, ...mine] };
      }
      if (rolePanels) {
        // Same global-list-with-guildId merge as blog. Keep panels for other guilds / the admin's
        // own un-assigned ones; replace this guild's with the owner's. Each panel keeps a stable
        // id (the bot uses it to remember which posted message is this panel) — generate one if
        // missing. A panel with no channel is dropped.
        const existing = Array.isArray(raw.rolePanels) ? raw.rolePanels : [];
        const keep = existing.filter((pnl) => pnl.guildId !== cur.guildId);
        const mine = (rolePanels || [])
          .filter((pnl) => (pnl.channelId || '').trim())
          .map((pnl) => ({ ...pnl, id: pnl.id || (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2, 8)), channelId: pnl.channelId.trim(), guildId: cur.guildId }));
        nextCfg.rolePanels = [...keep, ...mine];
      }
      await p.adminSetting.upsert({ where: { key: 'bot.config' }, create: { key: 'bot.config', value: nextCfg }, update: { value: nextCfg } });
    }
    await logAudit(p, req.user.uid, 'bot.guild.self', `${g.guildId} mode=${g.memberMode}${changed.length ? ' +' + changed.join('+') : ''}${blog ? ' +blog' : ''}${rolePanels ? ' +panels' : ''}`);
    const stored = await p.discordActivity.count({ where: { guildId: g.guildId } });
    const cfg = await getBotConfig(p);
    const outGc = (cfg.guilds && cfg.guilds[g.guildId]) || {};
    const outBlog = (Array.isArray(cfg.blog?.routes) ? cfg.blog.routes : []).filter((r) => r.guildId === g.guildId);
    const outPanels = (Array.isArray(cfg.rolePanels) ? cfg.rolePanels : []).filter((pnl) => pnl.guildId === g.guildId);
    return { ok: true, guild: serGuildUser(g, stored, ids), welcome: outGc.welcome || {}, joinToCreate: outGc.joinToCreate || {}, gating: outGc.gating || {}, blog: { routes: outBlog }, rolePanels: outPanels };
  });
}
