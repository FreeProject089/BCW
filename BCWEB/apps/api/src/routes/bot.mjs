import { z } from 'zod';
import { getObject, deleteObject } from '../lib/storage.mjs';
import { randomInt } from 'node:crypto';
import { db, requireRole, requireCap, logAudit, safeEqual, botAuth, BOT_SECRET, notify, httpUrl } from '../lib/lib.mjs';
import { canConfigureGuild, patchFromDiscord } from '../lib/bot-guild-access.mjs';
import { issueWarn } from '../lib/warns.mjs';
import { memberCapacity, capacityStatus, logModeration, memberPolicy, inactiveWhere, evictForRoom } from '../lib/discord-storage.mjs';
import { buyShopItem, listPurchases, visibleShopItems, SHOP_KINDS, soldCount, itemTag, revealPurchase, giftPurchase, giftPoints, listLedger, movePoints, ledger, resolveUser, deliverGiveawayPrize } from '../lib/economy-shop.mjs';
import { looksLikeBcId, findUserIdByBcId } from '../lib/repofingerprint.mjs';
import { betLimits, edgePctFor, payoutFor, edgeApplied, settleTable, CASINO_GAMES } from '../lib/casino-rules.mjs';
import { ICONS as BOT_ICONS, ICON_STYLE_DEFAULTS, renderEmoji, renderEmojiPack } from '../lib/bot-emoji.mjs';
import { emitWebhook } from '../lib/webhooks.mjs';
import { grantAutoBadges } from './social.mjs';
import { economyLevelFor, economyXpForLevel, economyPointsEarned, economyView, mergeShadowEconomy } from '../lib/economy-curve.mjs';

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
const SITE_URL = () => (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
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
  // Storage & retention guardrails.
  //   maxTempChannels / storageMB → the byte + channel budgets.
  //   keepLinked   → members with a LINKED site account are exempt from the storage
  //                  sweeper: hitting a limit prunes anonymous rows first and never
  //                  drops a linked person's record (so a limit can't silently delete
  //                  the tie between a Discord id and a BCWEB account).
  //   purgeUnlinks → if a linked member IS pruned anyway (limit reached, no anon rows
  //                  left), sever the site link instead of deleting silently, so the
  //                  person is asked to re-link rather than looking still-linked to a
  //                  record that no longer exists.
  //   relinkDays   → force a re-link every N days (0 = never): a link older than this
  //                  is marked stale and the member is prompted to re-authorise Discord
  //                  ↔ BCWEB, so a dashboard link can't outlive the Discord account.
  limits: { maxTempChannels: 50, storageMB: 200, keepLinked: true, purgeUnlinks: true, relinkDays: 0 },
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
  // requirePool → in 'managed' mode, whether a server must own a PAID storage pool to
  //   switch its memberMode to 'pool'. Turn it off to let every server store members for
  //   free (the bot stops gating member storage behind a purchase) without leaving the
  //   per-server budget model.
  // The member database is GLOBAL and admin-configured (2026-09-06): every server the bot is
  // in is stored, against limits.storageMB. A server no longer picks a mode. Linked members
  // are never evicted; when the cap is reached and evictInactive is on, members with no
  // message / voice activity within inactiveDays (and no site link) are removed to make room.
  memberStorage: { enabled: true, evictInactive: true, inactiveDays: 30 },
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
    // [{ id, name, desc, cost, kind, ref?, amount? }] — kind ∈ badge | role | pool | boost |
    // hosting | promo | custom. badge/pool/boost/hosting are fulfilled site-side on /buy
    // (award a badge, mint an assigned promo code); ref = badge/role id, amount = GB or days.
    shop: [],
    // maxBet 0 = no cap (like every other 0 in here). edgeByGame: per-game edge overrides in
    // percent, blank = the global houseEdgePct. live: the multiplayer tables and the two games
    // that only exist as live rounds (crash, race); pot is the stake-weighted draw.
    casino: { enabled: false, minBet: 1, maxBet: 100, houseEdgePct: 5, edgeByGame: {}, live: { multi: true, crash: true, race: true, pot: true } },
    // Members handing points to each other (/gift, the site's Boutique). A daily cap per giver
    // keeps a compromised account from draining itself into another in one go; 0 = no cap.
    gifts: { enabled: true, min: 1, maxPerDay: 0 },
    // How long the point ledger (purchases, casino, gifts, grants) is kept. 0 = forever.
    historyDays: 180,
    // Custom emoji for the bot's buttons: { [key]: '<:name:id>' } — see lib/bot-emoji.mjs.
    icons: {},
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
  app.get('/admin/bot/config', { preHandler: requireCap('manage_bot') }, async () => {
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
    const unified = cfg.memberStorage?.unified !== false; // one row per person, with their servers
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
      const allRows = await p.discordActivity.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, guildId: true, roles: true } });
      const gnames = Object.fromEntries((await p.botGuild.findMany({ where: { guildId: { in: [...new Set(allRows.map((r) => r.guildId))] } }, select: { guildId: true, name: true } })).map((g) => [g.guildId, g.name]));
      for (const r of allRows) (serversByPerson[r.discordId] ||= []).push({ guildId: r.guildId, name: gnames[r.guildId] || r.guildId, roles: r.roles || [] });
    }
    // Distinct role names across the roster. Capped: a server with thousands of roles
    // should slow nothing down, and a picker past a few hundred entries is unusable anyway.
    const roleRows = await p.discordActivity.findMany({ select: { roles: true }, take: 5000 });
    const allRoles = [...new Set(roleRows.flatMap((r) => r.roles || []))].sort((a, b) => a.localeCompare(b)).slice(0, 200);
    const links = await p.discordLink.findMany({ where: { discordId: { in: rows.map((r) => r.discordId) } }, include: { user: { select: { id: true, displayName: true, email: true, economy: { select: { level: true, xp: true, points: true } } } } } });
    const linkByDiscordId = Object.fromEntries(links.map((l) => [l.discordId, l.user]));
    return {
      members: rows.map((r) => ({ ...r, linkedUser: linkByDiscordId[r.discordId] || null, ...(unified ? { servers: serversByPerson[r.discordId] || [] } : {}) })),
      total, hasMore: skip + rows.length < total, unified,
      counts: { all: allTotal, linked: linkedTotal, unlinked: allTotal - linkedTotal },
      // Every role the bot has seen, so the filter is a list to pick from rather than a
      // name to remember. Built from the rows the scan holds, which is the only place this
      // service knows about roles at all.
      roles: allRoles,
      // Per guild: the assignable roles by id, from the last heartbeat — what the Manage
      // roles menu offers, and the map from a stored role NAME to an id it can act on.
      guildRoles: Object.fromEntries((((await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value?.guildList) || []).map((g) => [g.id, { name: g.name, roles: (g.roles || []).map((r) => ({ id: r.id, name: r.name, color: r.color || null })) }])),
    };
  });

  // ── Per-guild member-storage config (B4) ──────────────────────────────────
  const serGuild = (g, stored) => ({
    guildId: g.guildId, name: g.name, memberMode: g.memberMode, logChannelId: g.logChannelId,
    storeLogs: g.storeLogs, hostingGroupId: g.hostingGroupId,
    storageQuotaBytes: Number(g.storageQuotaBytes), // BigInt → Number for JSON
    memberCount: g.memberCount, storedMembers: stored,
  });

  // The global member database, for the admin card: policy, usage, and every server's share.
  app.get('/admin/bot/memberdb', { preHandler: requireCap('manage_bot') }, async () => {
    const p = await db();
    const cfg = await getBotConfig(p);
    const pol = memberPolicy(cfg);
    const [stored, inactive, guilds, counts, linkedIds] = await Promise.all([
      p.discordActivity.count(),
      p.discordActivity.count({ where: inactiveWhere(pol) }),
      p.botGuild.findMany({ orderBy: { memberCount: 'desc' }, select: { guildId: true, name: true, memberCount: true } }),
      p.discordActivity.groupBy({ by: ['guildId'], _count: { _all: true } }),
      p.discordLink.findMany({ select: { discordId: true } }),
    ]);
    const linkedSet = new Set(linkedIds.map((l) => l.discordId));
    const linked = await p.discordActivity.count({ where: { discordId: { in: [...linkedSet] } } });
    const storedBy = Object.fromEntries(counts.map((c) => [c.guildId, c._count._all]));
    const status = (await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value || null;
    const icons = Object.fromEntries((status?.guildList || []).map((x) => [x.id, x.icon || null]));
    // When the roster was last written (any guild) and whether a re-scan is queued but not
    // yet picked up — so the card can say "scanning…" instead of leaving a click unanswered.
    const [last, cmd] = await Promise.all([
      p.discordActivity.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }).catch(() => null),
      p.adminSetting.findUnique({ where: { key: 'bot.commands' } }).catch(() => null),
    ]);
    const lastScanAt = last?.updatedAt ? last.updatedAt.toISOString() : null;
    const rescanAt = cmd?.value?.rescanAt || null;
    return {
      policy: pol, stored, linked, inactive, capRows: pol.capRows === Infinity ? null : pol.capRows,
      lastScanAt, botOnline: !!status?.online && status?.at && (Date.now() - new Date(status.at).getTime()) < 3 * 60_000, botAt: status?.at || null,
      rescanAt, rescanPending: !!rescanAt && (!lastScanAt || new Date(lastScanAt) < new Date(rescanAt)),
      usedBytes: stored * 512, capBytes: pol.storageMB * 1024 * 1024,
      guilds: guilds.map((g) => ({ guildId: g.guildId, name: g.name, icon: icons[g.guildId] || null, memberCount: g.memberCount, stored: storedBy[g.guildId] || 0 })),
    };
  });

  app.get('/admin/bot/guilds', { preHandler: requireCap('manage_bot') }, async () => {
    const p = await db();
    const guilds = await p.botGuild.findMany({ orderBy: { updatedAt: 'desc' } });
    // One grouped count instead of a query per guild.
    const counts = await p.discordActivity.groupBy({ by: ['guildId'], _count: { _all: true } });
    const storedBy = Object.fromEntries(counts.map((c) => [c.guildId, c._count._all]));
    return { guilds: guilds.map((g) => serGuild(g, storedBy[g.guildId] || 0)) };
  });

  app.put('/admin/bot/guilds/:id', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
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

  app.put('/admin/bot/config', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const b = z.object({ config: z.record(z.any()) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_config' });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'bot.config' }, create: { key: 'bot.config', value: b.data.config }, update: { value: b.data.config } });
    return { ok: true };
  });

  // Set / clear the Discord bot token from the dashboard. Only allowed while the bot is
  // DISABLED (so a running bot's token isn't swapped under it) and when no env token is
  // set (env always wins). The idle bot polls GET /bot/token and connects once set.
  // requireRole('ADMIN'), NOT a capability. This sets the bot's credential: whoever can
  // write it can point the bot at a Discord application they control. The same rule as the
  // server terminal and /admin/users/:id/permissions — a credential is not delegable, and
  // the refactor that made this manage_bot was a per-file sweep that did not stop to ask.
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
    // The per-server language choices and the admin's string overrides ride beside the
    // config for the same reason restartAt does: the dashboard writes bot.config back whole.
    const [langRows, i18nRow] = await Promise.all([
      p.botGuild.findMany({ where: { language: { not: null } }, select: { guildId: true, language: true } }).catch(() => []),
      p.adminSetting.findUnique({ where: { key: 'bot.i18n' } }).catch(() => null),
    ]);
    const guildLanguages = Object.fromEntries(langRows.map((r) => [r.guildId, r.language]));
    const i18n = i18nRow?.value && typeof i18nRow.value === 'object' ? i18nRow.value : {};
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.restart' } });
    return { config: { ...(await getBotConfig(p)), guildLanguages, i18n }, restartAt: row?.value?.at || null };
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
  app.post('/admin/bot/restart', { preHandler: requireCap('manage_bot') }, async (req) => {
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
  app.post('/admin/bot/payments/test', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'bot.paymentsTest' }, create: { key: 'bot.paymentsTest', value: { at: Date.now() } }, update: { value: { at: Date.now() } } });
    return { ok: true };
  });

  // Diagnostic for "the bot doesn't post real payments": tells the admin whether any
  // Payment rows even EXIST. If total stays 0 after a checkout, the Stripe webhook
  // isn't reaching the API (nothing is recorded OR provisioned) — that's an infra
  // wiring issue (run `stripe listen --forward-to <api>/hosting/webhook`), not a bot
  // bug. If total > announced, the bot has new activity queued to post.
  app.get('/admin/bot/payments/status', { preHandler: requireCap('manage_bot') }, async () => {
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
  app.post('/admin/bot/dm', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
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
  app.post('/admin/bot/dm-all', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
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
  app.get('/admin/bot/dm-all', { preHandler: requireCap('manage_bot') }, async () => {
    const p = await db();
    const v = (await p.adminSetting.findUnique({ where: { key: 'bot.dmBroadcast' } }))?.value || null;
    if (!v) return { broadcast: null };
    return { broadcast: { id: v.id, total: v.total, sent: v.sent, failed: v.failed, remaining: (v.pending || []).length, startedAt: v.startedAt } };
  });

  app.delete('/admin/bot/dm-all', { preHandler: requireCap('manage_bot') }, async (req) => {
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
  app.get('/admin/bot/giveaways', { preHandler: requireCap('manage_bot') }, async () => {
    const p = await db();
    const list = await p.giveaway.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    return { giveaways: list.map((g) => ({ id: g.id, prize: g.prize, channelId: g.channelId, endsAt: g.endsAt, winnersCount: g.winnersCount, status: g.status, entryCount: g.entries.length + g.siteEntrants.length, winnerIds: g.winnerIds, hasGift: !!g.giftConfig, requirements: g.requirements || null, kind: g.kind, audience: g.audience, prizeKind: g.prizeKind, guildId: g.guildId || null, createdAt: g.createdAt })) };
  });
  app.post('/admin/bot/giveaways', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const b = z.object({
      prize: z.string().min(1).max(200),
      channelId: z.string().min(5).max(32).optional(),
      durationMinutes: z.number().int().min(1).max(60 * 24 * 60),
      winnersCount: z.number().int().min(1).max(50).default(1),
      gift: giftShape.optional(),
      winnerMessage: z.string().max(1500).optional(),
      // Where it can be entered: Discord, the site, or both. A site-only giveaway needs no
      // channel and is drawn by the server, not the bot.
      audience: z.enum(['discord', 'site', 'both']).default('discord'),
      // The prize: `promo` mints a code from `gift` on reveal; `custom` reveals `prizeContent`
      // (a code/link/text you type now); `none` is bragging rights. The win lands in inventory.
      prizeKind: z.enum(['promo', 'custom', 'none']).default('promo'),
      prizeContent: z.string().max(4000).optional(),
      // Entry gate: require a linked BetterCommunity account (Discord ⇄ BCWEB) and/or
      // a linked BMM creator id. Enforced server-side when a user clicks Enter.
      requirements: z.object({ linked: z.boolean().optional(), creator: z.boolean().optional() }).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const needsChannel = b.data.audience !== 'site';
    if (needsChannel && !b.data.channelId) return reply.code(400).send({ error: 'channel_required' });
    if (b.data.prizeKind === 'custom' && !b.data.prizeContent?.trim()) return reply.code(400).send({ error: 'prize_content_required' });
    const p = await db();
    // A creator-id requirement implies a linked account (creator ids live on BCWEB accounts).
    // A site or both giveaway needs a linked account to enter (that IS the account entering).
    const rawReqs = b.data.requirements || {};
    const linked = !!(rawReqs.linked || rawReqs.creator) || b.data.audience !== 'discord';
    const reqs = (linked || rawReqs.creator) ? { linked, creator: !!rawReqs.creator } : null;
    const gw = await p.giveaway.create({ data: {
      prize: b.data.prize, channelId: needsChannel ? b.data.channelId : null, winnersCount: b.data.winnersCount,
      endsAt: new Date(Date.now() + b.data.durationMinutes * 60_000),
      kind: 'admin', audience: b.data.audience, prizeKind: b.data.prizeKind, prizeContent: b.data.prizeContent?.trim() || null,
      giftConfig: b.data.gift || null, requirements: reqs,
      winnerMessage: b.data.winnerMessage?.trim() || null, createdBy: req.user.uid,
    } });
    return { ok: true, id: gw.id };
  });
  app.post('/admin/bot/giveaways/:id/end', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const p = await db();
    // Bring the end forward to now → the bot draws on its next poll (≤30s).
    const gw = await p.giveaway.updateMany({ where: { id: req.params.id, status: 'active' }, data: { endsAt: new Date() } });
    if (!gw.count) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
  app.delete('/admin/bot/giveaways/:id', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const p = await db();
    await p.giveaway.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });

  // ── Site giveaways: a logged-in member lists and enters the ones whose audience includes the
  // site. The entry is the ACCOUNT (userId) in `siteEntrants`; the server sweeper draws them. ──
  app.get('/me/giveaways', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const list = await p.giveaway.findMany({ where: { status: 'active', audience: { in: ['site', 'both'] } }, orderBy: { endsAt: 'asc' }, take: 50 });
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { _count: { select: { creatorLinks: true } } } });
    const meetsCreator = (me?._count?.creatorLinks || 0) > 0;
    return { giveaways: list.map((g) => ({
      id: g.id, prize: g.prize, endsAt: g.endsAt, winnersCount: g.winnersCount, prizeKind: g.prizeKind,
      entrantCount: g.siteEntrants.length + g.entries.length, entered: g.siteEntrants.includes(req.user.uid),
      requiresCreator: !!g.requirements?.creator, meetsCreator,
    })) };
  });
  app.post('/me/giveaways/:id/enter', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const p = await db();
    const gw = await p.giveaway.findUnique({ where: { id: req.params.id } });
    if (!gw || gw.status !== 'active' || !['site', 'both'].includes(gw.audience)) return reply.code(409).send({ error: 'not_active' });
    if (gw.requirements?.creator) {
      const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { _count: { select: { creatorLinks: true } } } });
      if (!(me?._count?.creatorLinks > 0)) return reply.code(403).send({ error: 'need_creator' });
    }
    if (gw.siteEntrants.includes(req.user.uid)) return { ok: true, already: true, count: gw.siteEntrants.length };
    await p.giveaway.update({ where: { id: gw.id }, data: { siteEntrants: { push: req.user.uid } } });
    return { ok: true, count: gw.siteEntrants.length + 1 };
  });

  // Bot-facing giveaway sync
  app.get('/bot/giveaways/active', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    // Only the giveaways the bot owns: those with a Discord channel (audience discord|both).
    // A site-only giveaway has no channel and is posted/drawn by the server, never the bot.
    const list = await p.giveaway.findMany({ where: { status: 'active', audience: { in: ['discord', 'both'] }, channelId: { not: null } }, take: 100 });
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
    const b = z.object({ prize: z.string().min(1).max(200), channelId: z.string().min(5).max(32), guildId: z.string().min(5).max(32), hostDiscordId: z.string().min(5).max(32).optional(), durationMinutes: z.number().int().min(1).max(60 * 24 * 60), winnersCount: z.number().int().min(1).max(50).default(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // A member's own giveaway (Discord-only, no inventory prize — the host hands the prize over):
    // at most 5 active per server, so one member can't paper the channel with them.
    const active = await p.giveaway.count({ where: { guildId: b.data.guildId, kind: 'user', status: 'active' } });
    if (active >= 5) return reply.code(409).send({ error: 'guild_giveaway_cap' });
    const gw = await p.giveaway.create({ data: {
      prize: b.data.prize, channelId: b.data.channelId, winnersCount: b.data.winnersCount,
      endsAt: new Date(Date.now() + b.data.durationMinutes * 60_000),
      kind: 'user', audience: 'discord', prizeKind: 'none', guildId: b.data.guildId, hostDiscordId: b.data.hostDiscordId || null,
    } });
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
    // Each winner with a linked account gets the prize in their BCWEB INVENTORY (sealed) plus a
    // dashboard notification; they reveal it there to mint the promo code, or to read the custom
    // content the creator typed. The bot DMs them too (pointing at the inventory). A winner with
    // no linked account gets only the DM — there is no inventory to deliver to.
    const delivered = [];
    for (const did of b.data.winnerIds) {
      const link = await p.discordLink.findUnique({ where: { discordId: did } });
      if (!link) continue;
      const row = await deliverGiveawayPrize(p, { userId: link.userId, giveaway: gw, via: 'discord' }).catch(() => null);
      if (!row) continue; // prizeKind=none — nothing to put in the inventory
      notify(p, link.userId, 'giveaway_win', `You won “${gw.prize}” — it’s in your inventory; reveal it to claim.`, { bodyFr: `Tu as gagné « ${gw.prize} » — c’est dans ton inventaire ; révèle-le pour le récupérer.`, href: '/dashboard?s=economy' }).catch(() => {});
      delivered.push(did);
    }
    // `gifts` kept (empty) for the bot's DM code path — codes are now minted on reveal, not here.
    return { ok: true, delivered, gifts: {} };
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
  // The bot's handler errors, as ErrorEvent rows (source 'bot'): what the admin Errors page
  // lists, what the monitor's error alerts count, what the digest surfaces. The context
  // travels in the stack text so the page shows it with the trace. Deduplicated per message
  // and minute — a button spammed while broken is one error, not a hundred rows.
  // ── Configuring the bot from inside Discord ───────────────────────────────────
  //
  // Every per-guild setting used to live on the site behind a login, so the person who
  // actually runs the server had to leave Discord, find the dashboard, and come back to
  // set a log channel. These two let them stay.
  //
  // botAuth first — only the bot may call these at all — and then the ACTOR is checked,
  // because the bot is trusted to report who pressed the button and nothing more.

  /** What this guild's settings are, and whether this person may change them. */
  app.get('/bot/guilds/:id/settings', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const actor = String(req.query?.actorDiscordId || '');
    const p = await db();
    const [g, link] = await Promise.all([
      p.botGuild.findUnique({ where: { guildId: req.params.id } }),
      actor ? p.discordLink.findUnique({ where: { discordId: actor } }).catch(() => null) : null,
    ]);
    const linked = !!link?.userId;
    return {
      linked,
      // Reported apart from `may`, because the two refusals are different sentences: not
      // being the owner is final, and not having linked an account is a thing to go and
      // do. Collapsing them tells an owner they lack permission, which is untrue.
      manager: canConfigureGuild(g, actor, true),
      may: canConfigureGuild(g, actor, linked),
      settings: g ? {
        language: g.language || 'auto',
        memberMode: g.memberMode,
        logChannelId: g.logChannelId,
        storeLogs: g.storeLogs,
      } : null,
    };
  });

  /** Change them. Only what patchFromDiscord allows; the rest is named back, not ignored. */
  app.put('/bot/guilds/:id/settings', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      actorDiscordId: z.string().min(1).max(32),
      patch: z.record(z.any()),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const [g, link] = await Promise.all([
      p.botGuild.findUnique({ where: { guildId: req.params.id } }),
      p.discordLink.findUnique({ where: { discordId: b.data.actorDiscordId } }).catch(() => null),
    ]);
    if (!canConfigureGuild(g, b.data.actorDiscordId, !!link?.userId)) {
      // One code, two meanings distinguished by `linked` so the bot can say the right
      // thing without this route guessing which message the person needs.
      return reply.code(403).send({ error: 'not_allowed', linked: !!link?.userId });
    }
    const { data, rejected, error } = patchFromDiscord(b.data.patch, g);
    if (error) return reply.code(400).send({ error, rejected });
    if (!Object.keys(data).length) return { ok: true, changed: [], rejected, settings: { language: g.language || 'auto', memberMode: g.memberMode, logChannelId: g.logChannelId, storeLogs: g.storeLogs } };

    const next = await p.botGuild.update({ where: { guildId: g.guildId }, data });
    // Audited against the LINKED account, not the Discord id: the audit log is a record of
    // what people on this platform did, and a snowflake is not somebody it knows.
    await logAudit(p, link.userId, 'bot.guild_discord', `${g.guildId} ${Object.keys(data).join(',')}`);
    return {
      ok: true, changed: Object.keys(data), rejected,
      settings: { language: next.language || 'auto', memberMode: next.memberMode, logChannelId: next.logChannelId, storeLogs: next.storeLogs },
    };
  });

  // The onboarding card's language select. `auto` clears the choice.
  app.put('/bot/guilds/:id/language', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ language: z.string().regex(/^(auto|[a-z]{2})$/) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const language = b.data.language === 'auto' ? null : b.data.language;
    await p.botGuild.upsert({ where: { guildId: req.params.id }, create: { guildId: req.params.id, language }, update: { language } });
    return { ok: true, language };
  });
  // Admin → Languages → Discord bot: the bot's dictionary (as it reported it) and the
  // overrides, per language. An override is one key in one language; an empty string deletes.
  app.get('/admin/bot/i18n', { preHandler: requireCap('translate_site') }, async () => {
    const p = await db();
    const [base, ov] = await Promise.all([
      p.adminSetting.findUnique({ where: { key: 'bot.i18n.base' } }).catch(() => null),
      p.adminSetting.findUnique({ where: { key: 'bot.i18n' } }).catch(() => null),
    ]);
    return { base: base?.value || {}, overrides: ov?.value || {} };
  });
  app.put('/admin/bot/i18n', { preHandler: requireCap('translate_site') }, async (req, reply) => {
    const b = z.object({ lang: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/), strings: z.record(z.string().max(2000)).refine((o) => Object.keys(o).length <= 2000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.i18n' } }).catch(() => null);
    const all = row?.value && typeof row.value === 'object' ? { ...row.value } : {};
    const cur = { ...(all[b.data.lang] || {}) };
    for (const [k, v] of Object.entries(b.data.strings)) { if (String(v).trim()) cur[k] = String(v); else delete cur[k]; }
    if (Object.keys(cur).length) all[b.data.lang] = cur; else delete all[b.data.lang];
    await p.adminSetting.upsert({ where: { key: 'bot.i18n' }, create: { key: 'bot.i18n', value: all }, update: { value: all } });
    await logAudit(p, req.user.uid, 'bot.i18n', `${b.data.lang}: ${Object.keys(b.data.strings).length} key(s)`);
    return { ok: true, overrides: all };
  });

  app.post('/bot/errors', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      message: z.string().min(1).max(400),
      stack: z.string().max(6000).optional().default(''),
      context: z.object({ command: z.string().max(120).optional(), guildId: z.string().max(32).nullable().optional(), userId: z.string().max(32).nullable().optional() }).optional().default({}),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { message, stack, context } = b.data;
    const path = `bot:${context.command || 'handler'}`.slice(0, 300);
    const dup = await p.errorEvent.findFirst({ where: { source: 'bot', message, path, createdAt: { gte: new Date(Date.now() - 60_000) } }, select: { id: true } }).catch(() => null);
    if (dup) return { ok: true, deduped: true };
    const ctxLine = `context: ${JSON.stringify({ command: context.command || null, guild: context.guildId || null, member: context.userId || null })}`;
    await p.errorEvent.create({ data: { source: 'bot', message, stack: `${ctxLine}\n${stack || ''}`.slice(0, 6000), path } }).catch(() => {});
    return { ok: true };
  });

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
        // Channels for the dashboard pickers (text/voice/category/…). Zod strips unknown keys,
        // so this MUST be declared or the whole channel list vanishes before it is stored.
        channels: z.array(z.object({
          id: z.string().max(32), name: z.string().max(100),
          type: z.number().optional(), parentId: z.string().max(32).nullable().optional(),
        })).max(200).optional(),
      })).max(200).optional(),
      ping: z.number().nullable().optional(), // gateway latency (ms)
      mod: z.object({ kicks: z.number().optional(), timeouts: z.number().optional(), purged: z.number().optional() }).optional(), // since-restart moderation counters
      logs: z.array(z.object({ t: z.number(), level: z.string().max(10), msg: z.string().max(500) })).max(200).optional(), // recent bot console output → live logs tab
      i18nBase: z.record(z.record(z.string().max(2000))).optional(), // the bot's built-in dictionary, once per boot
    }).safeParse(req.body || {});
    const d = b.success ? b.data : {};
    const p = await db();
    // Logs are stored separately (they change every heartbeat and can be large) so the
    // small bot.status blob the config page reads stays lean.
    const { logs, i18nBase, ...rest } = d;
    if (i18nBase && Object.keys(i18nBase).length) await p.adminSetting.upsert({ where: { key: 'bot.i18n.base' }, create: { key: 'bot.i18n.base', value: i18nBase }, update: { value: i18nBase } }).catch(() => {});
    const value = { ...rest, at: new Date().toISOString(), online: rest.online !== false };
    await p.adminSetting.upsert({ where: { key: 'bot.status' }, create: { key: 'bot.status', value }, update: { value } });
    if (logs) await p.adminSetting.upsert({ where: { key: 'bot.logs' }, create: { key: 'bot.logs', value: { logs, at: Date.now() } }, update: { value: { logs, at: Date.now() } } });
    // Error-level lines the bot logged outside a guarded handler (a login failure, a poller,
    // the gateway) — recorded once each, so they are not lost in a scrolling log tab.
    if (logs?.length) {
      const errs = logs.filter((l) => l.level === 'error' && l.msg && !/handler error/.test(l.msg)).slice(-20);
      for (const l of errs) {
        const message = String(l.msg).slice(0, 400);
        const seen = await p.errorEvent.findFirst({ where: { source: 'bot', message, createdAt: { gte: new Date(Date.now() - 6 * 3600e3) } }, select: { id: true } }).catch(() => null);
        if (!seen) await p.errorEvent.create({ data: { source: 'bot', message, stack: '', path: 'bot:log' } }).catch(() => {});
      }
    }
    // The bot reported it could not start (a bad token, missing intents): an error the
    // dashboard must show as one, not only as "offline".
    if (rest.online === false && rest.error) {
      const message = String(rest.error).slice(0, 400);
      const seen = await p.errorEvent.findFirst({ where: { source: 'bot', message, createdAt: { gte: new Date(Date.now() - 6 * 3600e3) } }, select: { id: true } }).catch(() => null);
      if (!seen) await p.errorEvent.create({ data: { source: 'bot', message, stack: '', path: 'bot:login' } }).catch(() => {});
    }
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
    // Commands the dashboard queued for the bot ride back on the heartbeat: the only channel
    // that already exists from the API to the bot, so no new socket or poller. Today: a full
    // member re-scan requested from Admin → Member database.
    const cmd = (await p.adminSetting.findUnique({ where: { key: 'bot.commands' } }).catch(() => null))?.value || {};
    return { ok: true, commands: { rescanAt: cmd.rescanAt || null } };
  });

  // Admin: ask the bot to re-scan every server's roster NOW (instead of waiting for the
  // 30-minute cycle). Stored as a timestamp the next heartbeat (≤60 s) hands to the bot; the
  // bot reports back through the usual /bot/members/sync, which is what moves `lastScanAt`.
  // Admin: the whole member database as a file — CSV (a spreadsheet opens it) or JSON lines.
  // Streamed in pages, because a roster can be hundreds of thousands of rows and building one
  // string would hold all of it in memory. Linked accounts carry their site user id.
  app.get('/admin/bot/memberdb/export.:format', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const format = req.params.format === 'json' ? 'json' : 'csv';
    const p = await db();
    const [guilds, links] = await Promise.all([
      p.botGuild.findMany({ select: { guildId: true, name: true } }),
      p.discordLink.findMany({ select: { discordId: true, userId: true } }),
    ]);
    const guildName = Object.fromEntries(guilds.map((g) => [g.guildId, g.name || '']));
    const linked = Object.fromEntries(links.map((l) => [l.discordId, l.userId]));
    const stamp = new Date().toISOString().slice(0, 10);
    await logAudit(p, req.user.uid, 'memberdb.export', `format=${format}`).catch(() => {});
    reply.raw.writeHead(200, {
      'Content-Type': format === 'json' ? 'application/x-ndjson; charset=utf-8' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="discord-members-${stamp}.${format === 'json' ? 'jsonl' : 'csv'}"`,
      'Cache-Control': 'no-store',
    });
    reply.hijack();
    const csv = (v) => { const t = v == null ? '' : String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const cols = ['guildId', 'guildName', 'discordId', 'username', 'nickname', 'siteUserId', 'roles', 'guildJoinedAt', 'lastMessageAt', 'lastVoiceJoinAt', 'lastVoiceCreateAt', 'updatedAt'];
    const write = (line) => new Promise((res) => { if (!reply.raw.write(line)) reply.raw.once('drain', res); else res(); });
    if (format === 'csv') await write('\uFEFF' + cols.join(',') + '\n');
    let cursor = null;
    for (;;) {
      const rows = await p.discordActivity.findMany({
        take: 5000, ...(cursor ? { skip: 1, cursor } : {}),
        orderBy: [{ guildId: 'asc' }, { discordId: 'asc' }],
      });
      if (!rows.length) break;
      const chunk = rows.map((r) => {
        const o = { guildId: r.guildId, guildName: guildName[r.guildId] || '', discordId: r.discordId, username: r.username || '', nickname: r.nickname || '', siteUserId: linked[r.discordId] || '', roles: (r.roles || []).join('|'),
          guildJoinedAt: r.guildJoinedAt?.toISOString() || '', lastMessageAt: r.lastMessageAt?.toISOString() || '', lastVoiceJoinAt: r.lastVoiceJoinAt?.toISOString() || '', lastVoiceCreateAt: r.lastVoiceCreateAt?.toISOString() || '', updatedAt: r.updatedAt?.toISOString() || '' };
        return format === 'json' ? JSON.stringify(o) : cols.map((c) => csv(o[c])).join(',');
      }).join('\n') + '\n';
      await write(chunk);
      const last = rows[rows.length - 1];
      cursor = { guildId_discordId: { guildId: last.guildId, discordId: last.discordId } };
      if (rows.length < 5000) break;
    }
    reply.raw.end();
  });

  app.post('/admin/bot/memberdb/rescan', { preHandler: requireCap('manage_bot') }, async (req) => {
    const p = await db();
    const at = new Date().toISOString();
    const cur = (await p.adminSetting.findUnique({ where: { key: 'bot.commands' } }).catch(() => null))?.value || {};
    const value = { ...cur, rescanAt: at, rescanBy: req.user.uid };
    await p.adminSetting.upsert({ where: { key: 'bot.commands' }, create: { key: 'bot.commands', value }, update: { value } });
    return { ok: true, rescanAt: at };
  });

  // Admin: recent bot console logs (live logs tab).
  app.get('/admin/bot/logs', { preHandler: requireCap('manage_bot') }, async () => {
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
    const pol = memberPolicy(await getBotConfig(p));
    if (!pol.enabled) return { ok: true, stored: false, reason: 'member_storage_off' };
    const now = new Date();
    const field = { join: 'guildJoinedAt', message: 'lastMessageAt', voiceJoin: 'lastVoiceJoinAt', voiceCreate: 'lastVoiceCreateAt' }[b.data.event];
    const base = { username: b.data.username, avatar: b.data.avatar };
    // A brand-new member counts against the budget; an existing row is only refreshed.
    const exists = await p.discordActivity.findUnique({ where: { guildId_discordId: { guildId: g.guildId, discordId: b.data.discordId } }, select: { discordId: true } });
    if (!exists && pol.capRows !== Infinity && (await p.discordActivity.count()) >= pol.capRows) {
      // Somebody who just did something outranks somebody who has not in a month.
      if (!(await evictForRoom(p, pol, 1, { protect: [b.data.discordId] }))) return { ok: true, stored: false, reason: 'at_capacity' };
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
  const ACTIONS = ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'role_add', 'role_remove'];

  app.post('/admin/bot/actions', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(ACTIONS),
      discordId: z.string().min(1).max(32),
      guildId: z.string().max(32).optional(), // B4: which server; recorded in its ModerationLog on success
      // Required for the ones that punish. Unban and untimeout are the undo, and demanding a
      // reason to undo something is how an undo stops being used.
      reason: z.string().trim().max(500).optional(),
      minutes: z.number().int().min(1).max(60 * 24 * 28).optional(),
      roleId: z.string().max(32).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const { kind, discordId, minutes, guildId, roleId } = b.data;
    const reason = (b.data.reason || '').trim();
    if (['ban', 'kick', 'timeout'].includes(kind) && !reason) return reply.code(400).send({ error: 'reason_required' });
    if (kind.startsWith('role_') && (!roleId || !guildId)) return reply.code(400).send({ error: 'role_required' });
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
        kind, discordId, guildId: guildId || null, minutes: minutes ?? null, roleId: roleId || null, reason,
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
      url: httpUrl(400).optional(),
      channelId: z.string().max(32).optional(),
      urgent: z.boolean().optional(),
      // Named explicitly because this schema STRIPS unknown keys rather than rejecting
      // them: a format the composer sends and the schema does not list would be dropped
      // here, the row would save as an embed, and nothing anywhere would say why.
      format: z.enum(['embed', 'text', 'both']).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      image: httpUrl(600).optional(),
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

    // ONE database for every server (see DEFAULT_BOT_CONFIG.memberStorage). Existing rows are
    // refreshed for free; newcomers need room. A newcomer who linked a site account always gets
    // a slot — inactive unlinked members are evicted for them when the policy allows — while an
    // unknown newcomer is admitted only while there is room. The daily sweep keeps headroom.
    const cfg = await getBotConfig(p);
    const pol = memberPolicy(cfg);
    if (!pol.enabled) return { ok: true, stored: false, reason: 'member_storage_off', mode: 'global' };
    const members = b.data.members;
    const stored = await p.discordActivity.count();
    let room = pol.capRows === Infinity ? Infinity : Math.max(0, pol.capRows - stored);
    const gate = { full: room !== Infinity && room < members.length };
    let synced = 0;
    // Update rows we already hold FIRST (they cost no new budget), then admit new ones only
    // while there is room — so a full guild keeps its existing members fresh but stops growing.
    const existing = new Set((await p.discordActivity.findMany({ where: { guildId: g.guildId, discordId: { in: members.map((m) => m.discordId) } }, select: { discordId: true } })).map((r) => r.discordId));
    const linkedNew = new Set((await p.discordLink.findMany({ where: { discordId: { in: members.filter((m) => !existing.has(m.discordId)).map((m) => m.discordId) } }, select: { discordId: true } })).map((l) => l.discordId));
    if (room !== Infinity && linkedNew.size > room) room += await evictForRoom(p, pol, linkedNew.size - room, { protect: [...linkedNew] });
    // Linked newcomers first, so the room that was made goes to them.
    members.sort((a, b2) => (linkedNew.has(b2.discordId) ? 1 : 0) - (linkedNew.has(a.discordId) ? 1 : 0));
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
  // The curve itself lives in lib/economy-curve.mjs — the public /v1/economy reads it too.

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
      const msgs = ev.messages || 0, reacts = ev.reactions || 0, vsec = ev.voiceSeconds || 0;
      const xpDelta = msgs * rMsg + reacts * rReact + Math.floor(vsec / 60) * rVoice;
      if (!userId) {
        // Not linked: the activity still counts, in the member's own shadow row. Levels and
        // points grow on the same curve so nothing is lost; spending waits for the link.
        const sh = await p.discordEconomy.findUnique({ where: { discordId: ev.discordId } }).catch(() => null);
        const sXp = (sh?.xp || 0) + xpDelta;
        const sLevel = economyLevelFor(sXp, eco.curveBase, eco.curveFactor);
        const sPts = Math.max(0, economyPointsEarned(sLevel, eco.pointsEveryLevels, eco.pointsPerGrant) - economyPointsEarned(sh?.level || 0, eco.pointsEveryLevels, eco.pointsPerGrant));
        const sData = { xp: sXp, level: sLevel, points: (sh?.points || 0) + sPts, messages: (sh?.messages || 0) + msgs, reactions: (sh?.reactions || 0) + reacts, voiceSeconds: (sh?.voiceSeconds || 0) + vsec };
        await p.discordEconomy.upsert({ where: { discordId: ev.discordId }, create: { discordId: ev.discordId, ...sData }, update: sData }).catch(() => {});
        updated++;
        continue;
      }
      const cur = await p.userEconomy.findUnique({ where: { userId } });
      const oldXp = cur?.xp || 0, oldLevel = cur?.level || 0;
      const newXp = oldXp + xpDelta;
      const newLevel = economyLevelFor(newXp, eco.curveBase, eco.curveFactor);
      const pointsDelta = Math.max(0, economyPointsEarned(newLevel, eco.pointsEveryLevels, eco.pointsPerGrant) - economyPointsEarned(oldLevel, eco.pointsEveryLevels, eco.pointsPerGrant));
      const fresh = await p.userEconomy.upsert({
        where: { userId },
        create: { userId, xp: newXp, level: newLevel, points: pointsDelta, voiceSeconds: vsec, messages: msgs, reactions: reacts },
        update: { xp: newXp, level: newLevel, points: { increment: pointsDelta }, voiceSeconds: { increment: vsec }, messages: { increment: msgs }, reactions: { increment: reacts } },
      }).then((row) => { updated++; return row; }).catch(() => null);
      if (!fresh) continue;
      // A level crossed is an event people subscribe to (and a badge rule can listen for);
      // plain activity only matters to the message-count rule. Neither is awaited.
      if (newLevel > oldLevel) {
        if (pointsDelta > 0) ledger(p, { userId, kind: 'levelup', delta: pointsDelta, balance: fresh.points, meta: { level: newLevel, from: oldLevel } }).catch(() => {});
        emitWebhook(p, userId, 'economy.level_up', { level: newLevel, from: oldLevel, xp: newXp, pointsGranted: pointsDelta }).catch(() => {});
        grantAutoBadges(p, { event: 'level', user: { id: userId }, level: newLevel, economy: fresh }).catch(() => {});
      } else if (msgs > 0) {
        grantAutoBadges(p, { event: 'activity', user: { id: userId }, economy: fresh }).catch(() => {});
      }
    }
    return { ok: true, updated };
  });

  // Read the current economy config (currency + curve) — the bot needs it for /profile, /shop.
  app.get('/bot/economy/config', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const eco = (await getBotConfig(await db())).economy || {};
    return { economy: eco };
  });

  // Top members by level/points — for the bot's /leaderboard command.
  app.get('/bot/economy/leaderboard', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    // Server scope: the members the bot stored for that guild who linked an account.
    const guildId = String(req.query?.guildId || '');
    let scopeWhere = { level: { gt: 0 } };
    if (guildId) {
      const ids = (await p.discordActivity.findMany({ where: { guildId }, select: { discordId: true }, take: 20000 })).map((r) => r.discordId);
      const userIds = (await p.discordLink.findMany({ where: { discordId: { in: ids } }, select: { userId: true } })).map((l) => l.userId);
      scopeWhere = { level: { gt: 0 }, userId: { in: userIds } };
    }
    const rows = await p.userEconomy.findMany({ where: scopeWhere, include: { user: { select: { id: true, displayName: true } } }, orderBy: [{ level: 'desc' }, { xp: 'desc' }], take: 10 });
    const out = { scope: guildId ? 'server' : 'global', members: rows.map((r) => ({ userId: r.user.id, displayName: r.user.displayName, avatar: `/avatar/${encodeURIComponent(r.user.id)}`, level: r.level, xp: r.xp, points: r.points })), total: await p.userEconomy.count({ where: scopeWhere }) };
    // The caller's own place, so "/leaderboard" can say "you: #37" even when they are not in
    // the top ten — the number that makes somebody want to climb.
    const discordId = String(req.query?.discordId || '');
    if (discordId) {
      const link = await p.discordLink.findUnique({ where: { discordId }, select: { userId: true } });
      const me = link ? await p.userEconomy.findUnique({ where: { userId: link.userId } }) : null;
      if (me && me.level > 0) {
        const ahead = await p.userEconomy.count({ where: { AND: [scopeWhere, { OR: [{ level: { gt: me.level } }, { level: me.level, xp: { gt: me.xp } }] }] } });
        out.me = { rank: ahead + 1, level: me.level, xp: me.xp, points: me.points };
      }
    }
    return out;
  });

  // A member's purchases by Discord id — the bot's /inventory.
  app.get('/bot/economy/purchases/:discordId', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    const link = await p.discordLink.findUnique({ where: { discordId: req.params.discordId }, select: { userId: true } });
    if (!link) return { linked: false, purchases: [] };
    return { linked: true, purchases: await listPurchases(p, eco, link.userId, 50) };
  });
  app.post('/bot/economy/reveal', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ discordId: z.string().min(1).max(32), purchaseId: z.string().min(1).max(64) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    const link = await p.discordLink.findUnique({ where: { discordId: b.data.discordId }, select: { userId: true } });
    if (!link) return { ok: false, error: 'not_linked' };
    return revealPurchase(p, eco, { userId: link.userId, purchaseId: b.data.purchaseId });
  });
  // /gift from Discord: points, or a purchase, to another member named by Discord id or site name.
  app.post('/bot/economy/gift', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ discordId: z.string().min(1).max(32), toDiscordId: z.string().max(32).optional(), to: z.string().max(120).optional(), points: z.number().int().min(1).max(10000000).optional(), purchaseId: z.string().max(64).optional(), note: z.string().max(140).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    const from = await p.discordLink.findUnique({ where: { discordId: b.data.discordId }, select: { userId: true } });
    if (!from) return { ok: false, error: 'not_linked' };
    let toId = null;
    if (b.data.toDiscordId) toId = (await p.discordLink.findUnique({ where: { discordId: b.data.toDiscordId }, select: { userId: true } }))?.userId || null;
    else if (b.data.to) toId = (await resolveUser(p, b.data.to, { looksLikeBcId, findUserIdByBcId }))?.id || null;
    if (!toId) return { ok: false, error: b.data.toDiscordId ? 'recipient_not_linked' : 'no_such_user' };
    if (b.data.purchaseId) return giftPurchase(p, eco, { fromUserId: from.userId, purchaseId: b.data.purchaseId, toUserId: toId });
    return giftPoints(p, eco, { fromUserId: from.userId, toUserId: toId, points: b.data.points || 0, note: b.data.note, via: 'discord' });
  });
  app.get('/bot/economy/history/:discordId', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const link = await p.discordLink.findUnique({ where: { discordId: req.params.discordId }, select: { userId: true } });
    if (!link) return { linked: false, history: [] };
    return { linked: true, history: await listLedger(p, link.userId, { kind: String(req.query?.kind || '') || null, take: 25 }) };
  });

  // A member's economy by Discord id — for the bot's /level and /profile commands.
  app.get('/bot/economy/user/:discordId', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const link = await p.discordLink.findUnique({ where: { discordId: req.params.discordId }, select: { userId: true, user: { select: { displayName: true } } } });
    const eco = (await getBotConfig(p)).economy || {};
    if (!link) {
      // Unlinked: what the member has earned so far, read-only — the card can say "level 7,
      // 340 points waiting" instead of pretending nothing happened until they link.
      const sh = await p.discordEconomy.findUnique({ where: { discordId: req.params.discordId } }).catch(() => null);
      const level = sh?.level || 0, xp = sh?.xp || 0;
      return {
        linked: false,
        shadow: sh ? {
          level, xp, points: sh.points,
          xpThisLevel: xp - economyXpForLevel(level, eco.curveBase, eco.curveFactor),
          xpForNext: economyXpForLevel(level + 1, eco.curveBase, eco.curveFactor) - economyXpForLevel(level, eco.curveBase, eco.curveFactor),
          stats: { voiceSeconds: sh.voiceSeconds, messages: sh.messages, reactions: sh.reactions },
        } : null,
        currency: { name: eco.currencyName || 'points', emoji: eco.currencyEmoji || '' },
        rates: { message: Number(eco.xpPerMessage) || 0, reaction: Number(eco.xpPerReaction) || 0, voiceMinute: Number(eco.xpPerVoiceMinute) || 0 },
      };
    }
    const e = await p.userEconomy.findUnique({ where: { userId: link.userId } });
    const level = e?.level || 0, xp = e?.xp || 0;
    const badges = await p.userBadge.findMany({ where: { userId: link.userId }, include: { badge: { select: { name: true, color: true } } }, orderBy: { badge: { priority: 'desc' } }, take: 8 });
    return {
      linked: true, userId: link.userId, displayName: link.user.displayName,
      // The site's own avatar (the /avatar route draws it whether it is an upload or a
      // generated one) — what the bot shows instead of the Discord picture.
      // The PNG route: the bot attaches these bytes as a thumbnail, and Discord will not show
      // an SVG handed to it as .png — the /level and /profile thumbnails were blank for every
      // account without an uploaded photo.
      avatar: `${SITE_URL()}/avatar/${encodeURIComponent(link.userId)}/png`, avatarPath: `/avatar/${encodeURIComponent(link.userId)}/png?size=256`,
      badges: badges.map((x) => ({ name: x.badge.name, color: x.badge.color })),
      level, xp, points: e?.points || 0,
      xpThisLevel: xp - economyXpForLevel(level, eco.curveBase, eco.curveFactor),
      xpForNext: economyXpForLevel(level + 1, eco.curveBase, eco.curveFactor) - economyXpForLevel(level, eco.curveBase, eco.curveFactor),
      stats: { voiceSeconds: e?.voiceSeconds || 0, messages: e?.messages || 0, reactions: e?.reactions || 0 },
      currency: { name: eco.currencyName || 'points', emoji: eco.currencyEmoji || '' },
      rates: { message: Number(eco.xpPerMessage) || 0, reaction: Number(eco.xpPerReaction) || 0, voiceMinute: Number(eco.xpPerVoiceMinute) || 0 },
    };
  });

  // A member's own level, points and stats — for their dashboard / profile.
  app.get('/me/economy', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const e = await p.userEconomy.findUnique({ where: { userId: req.user.uid } });
    const eco = (await getBotConfig(p)).economy || {};
    // Plus the two counts the dashboard's Boutique card shows without a second request.
    const [purchases, pending] = await Promise.all([
      p.economyPurchase.count({ where: { userId: req.user.uid } }),
      p.economyPurchase.count({ where: { userId: req.user.uid, status: 'pending' } }),
    ]);
    return { ...economyView(e, eco), shopItems: visibleShopItems(eco, 'site').length, purchases, pendingDeliveries: pending };
  });

  // Toggle whether the member's activity stats are public (level itself is always public).
  app.put('/me/economy/stats-public', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ public: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.userEconomy.upsert({ where: { userId: req.user.uid }, create: { userId: req.user.uid, statsPublic: b.data.public }, update: { statsPublic: b.data.public } });
    return { ok: true };
  });

  // Admin: the economy leaderboard + totals, for the dashboard's check/give tools.
  app.get('/admin/economy', { preHandler: requireCap('manage_economy') }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const where = q ? { user: { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } } : {};
    const [rows, agg] = await Promise.all([
      p.userEconomy.findMany({ where, include: { user: { select: { id: true, displayName: true } } }, orderBy: [{ level: 'desc' }, { xp: 'desc' }], take: 50 }),
      p.userEconomy.aggregate({ _sum: { xp: true, points: true }, _count: true }),
    ]);
    return {
      members: rows.map((r) => ({ userId: r.userId, displayName: r.user.displayName, level: r.level, xp: r.xp, points: r.points, messages: r.messages, reactions: r.reactions, voiceSeconds: r.voiceSeconds })),
      totals: { members: agg._count, xp: agg._sum.xp || 0, points: agg._sum.points || 0 },
    };
  });

  // Admin: grant (positive) or take (negative) points from a member. Points never go below 0.
  app.post('/admin/economy/grant', { preHandler: requireCap('manage_economy') }, async (req, reply) => {
    const b = z.object({ userId: z.string().min(1).max(64), points: z.number().int().min(-1000000).max(1000000).optional(), xp: z.number().int().min(-10000000).max(10000000).optional(), reason: z.string().max(200).optional() }).safeParse(req.body);
    if (!b.success || (b.data.points == null && b.data.xp == null)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cur = await p.userEconomy.findUnique({ where: { userId: b.data.userId } });
    const newPts = Math.max(0, (cur?.points || 0) + (b.data.points || 0));
    // XP moves the LEVEL too — same curve as accrual, so a granted level is a real one.
    const eco = (await getBotConfig(p)).economy || {};
    const newXp = Math.max(0, (cur?.xp || 0) + (b.data.xp || 0));
    const newLevel = b.data.xp != null ? economyLevelFor(newXp, eco.curveBase, eco.curveFactor) : (cur?.level || 0);
    await p.userEconomy.upsert({ where: { userId: b.data.userId }, create: { userId: b.data.userId, points: newPts, xp: newXp, level: newLevel }, update: { points: newPts, ...(b.data.xp != null ? { xp: newXp, level: newLevel } : {}) } });
    await logAudit(p, req.user.uid, 'economy.grant', `user=${b.data.userId} delta=${b.data.points} → ${newPts}${b.data.reason ? ` (${b.data.reason})` : ''}`);
    if (b.data.points) ledger(p, { userId: b.data.userId, kind: 'grant', delta: newPts - (cur?.points || 0), balance: newPts, meta: { by: req.user.uid, reason: b.data.reason || null, xp: b.data.xp || 0 } }).catch(() => {});
    if (newLevel > (cur?.level || 0)) {
      emitWebhook(p, b.data.userId, 'economy.level_up', { level: newLevel, from: cur?.level || 0, xp: newXp, pointsGranted: 0, by: 'staff' }).catch(() => {});
      grantAutoBadges(p, { event: 'level', user: { id: b.data.userId }, level: newLevel }).catch(() => {});
    }
    return { ok: true, points: newPts, xp: newXp, level: newLevel };
  });

  // Reset points (a season reset, or fixing one member) — set to zero rather than granting a
  // negative delta, which is fiddly to get exactly right. `scope:'all'` zeroes every member;
  // `scope:'user'` one. `xp:true` also resets XP + level (a full wipe), otherwise points only.
  app.post('/admin/economy/reset', { preHandler: requireCap('manage_economy') }, async (req, reply) => {
    const b = z.object({
      scope: z.enum(['all', 'user']).default('user'),
      userId: z.string().min(1).max(64).optional(),
      xp: z.boolean().default(false),
    }).safeParse(req.body);
    if (!b.success || (b.data.scope === 'user' && !b.data.userId)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = b.data.xp ? { points: 0, xp: 0, level: 0 } : { points: 0 };
    const where = b.data.scope === 'all' ? {} : { userId: b.data.userId };
    const r = await p.userEconomy.updateMany({ where, data });
    await logAudit(p, req.user.uid, 'economy.reset', `scope=${b.data.scope}${b.data.scope === 'user' ? ` user=${b.data.userId}` : ''} ${b.data.xp ? 'points+xp+level' : 'points'} affected=${r.count}`);
    return { ok: true, affected: r.count };
  });

  // A member spends points in the bot shop. The bot posts this on a /shop purchase; the API
  // debits the balance atomically (refusing when short) and returns the item so the bot can
  // deliver it (mint a promo code, assign a role, …). Kept server-authoritative so a client
  // can never set its own price.
  app.post('/bot/economy/buy', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ discordId: z.string().min(1).max(32), itemId: z.string().min(1).max(60) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    const link = await p.discordLink.findUnique({ where: { discordId: b.data.discordId }, select: { userId: true } });
    if (!link) return { ok: false, error: 'not_linked' };
    const r = await buyShopItem(p, eco, { userId: link.userId, itemId: b.data.itemId, via: 'discord', log: req.log });
    if (r.ok) grantAutoBadges(p, { event: 'purchase', user: { id: link.userId } }).catch(() => {});
    return r;
  });

  // ── The shop and the inventory, from the site ───────────────────────────────
  // The same items the bot sells, the same purchase function. What the member sees: their
  // balance, every item with its price and what it hands over, which badges they already
  // hold (a badge is one-per-account), and everything they bought so far.
  app.get('/me/economy/shop', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    const [e, held, purchases, mine] = await Promise.all([
      p.userEconomy.findUnique({ where: { userId: req.user.uid }, select: { points: true, level: true } }),
      p.userBadge.findMany({ where: { userId: req.user.uid }, select: { badgeId: true } }),
      listPurchases(p, eco, req.user.uid, 100),
      p.economyPurchase.findMany({ where: { userId: req.user.uid, status: { not: 'refunded' } }, select: { itemId: true } }),
    ]);
    const heldIds = new Set(held.map((x) => x.badgeId));
    const mineIds = new Set(mine.map((x) => x.itemId));
    const items = await Promise.all(visibleShopItems(eco, 'site').map(async (x) => {
      const sold = x.stock != null || x.exclusive ? await soldCount(p, x.id) : 0;
      const { tag, remaining } = itemTag(x, sold);
      return {
        id: x.id, name: x.name, desc: x.desc, cost: x.cost, kind: x.kind, fulfil: SHOP_KINDS[x.kind].fulfil,
        gb: x.gb, days: x.days, months: x.months, target: x.target, codeDays: x.codeDays, availableUntil: x.availableUntil,
        giftable: x.giftable, exclusive: x.exclusive, tag, remaining, soldOut: x.stock != null && remaining <= 0,
        owned: x.kind === 'badge' ? heldIds.has(x.ref) : (x.exclusive && mineIds.has(x.id)),
      };
    }));
    return {
      enabled: !!eco.enabled,
      currency: { name: eco.currencyName || 'points', emoji: eco.currencyEmoji || '', image: eco.currencyImage || '' },
      gifts: { enabled: eco.gifts?.enabled !== false, min: Math.max(1, Number(eco.gifts?.min) || 1), maxPerDay: Number(eco.gifts?.maxPerDay) || 0 },
      points: e?.points || 0, level: e?.level || 0, items, purchases,
    };
  });
  app.post('/me/economy/buy', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({ itemId: z.string().min(1).max(60) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    const r = await buyShopItem(p, eco, { userId: req.user.uid, itemId: b.data.itemId, via: 'site', log: req.log });
    if (!r.ok) return reply.code(r.error === 'insufficient' ? 402 : r.error === 'no_such_item' ? 404 : 409).send(r);
    grantAutoBadges(p, { event: 'purchase', user: { id: req.user.uid } }).catch(() => {});
    return r;
  });
  app.get('/me/economy/purchases', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    return { purchases: await listPurchases(p, eco, req.user.uid, 200) };
  });
  // The sealed envelope opens: the code is minted now, for whoever holds the purchase.
  app.post('/me/economy/purchases/:id/reveal', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    const r = await revealPurchase(p, eco, { userId: req.user.uid, purchaseId: String(req.params.id) });
    if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : 409).send(r);
    return r;
  });
  // Hand a giftable purchase to another member (id, BC id, e-mail or exact display name).
  app.post('/me/economy/purchases/:id/gift', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({ to: z.string().trim().min(1).max(120) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    const to = await resolveUser(p, b.data.to, { looksLikeBcId, findUserIdByBcId });
    if (!to) return reply.code(404).send({ ok: false, error: 'no_such_user' });
    const r = await giftPurchase(p, eco, { fromUserId: req.user.uid, purchaseId: String(req.params.id), toUserId: to.id });
    if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : 409).send(r);
    return r;
  });
  // Points to another member.
  app.post('/me/economy/gift', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({ to: z.string().trim().min(1).max(120), points: z.number().int().min(1).max(10000000), note: z.string().max(140).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    const to = await resolveUser(p, b.data.to, { looksLikeBcId, findUserIdByBcId });
    if (!to) return reply.code(404).send({ ok: false, error: 'no_such_user' });
    const r = await giftPoints(p, eco, { fromUserId: req.user.uid, toUserId: to.id, points: b.data.points, note: b.data.note, via: 'site' });
    if (!r.ok) return reply.code(r.error === 'insufficient' ? 402 : 409).send(r);
    return r;
  });
  // Every point movement of mine — purchases, casino, gifts, grants.
  app.get('/me/economy/history', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const kind = String(req.query?.kind || '').slice(0, 30) || null;
    return { history: await listLedger(p, req.user.uid, { kind, take: Math.min(500, Number(req.query?.take) || 200) }) };
  });
  // Admin: the whole ledger, searchable by member, filterable by kind.
  app.get('/admin/economy/history', { preHandler: requireCap('manage_economy') }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const kind = String(req.query?.kind || '').slice(0, 30) || null;
    const where = { ...(kind ? { kind } : {}), ...(q ? { user: { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { id: q }] } } : {}) };
    const rows = await p.economyLedger.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(500, Number(req.query?.take) || 150), include: { user: { select: { id: true, displayName: true } } } });
    return { history: rows.map((r) => ({ id: r.id, userId: r.userId, displayName: r.user.displayName, kind: r.kind, delta: r.delta, balance: r.balance, ref: r.ref, meta: r.meta || null, createdAt: r.createdAt })) };
  });
  // The bot's own icons, as PNGs to upload to the application's Emojis page.
  // One button icon as a PNG. The saved style applies; `?icon=&color=&fg=&shape=&scale=` override
  // it for the dashboard's live preview, so an admin sees a choice before saving it.
  app.get('/admin/bot/emoji/:key', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const key = String(req.params.key || '').replace(/\.png$/i, '');
    if (!BOT_ICONS[key]) return reply.code(404).send({ error: 'not_found' });
    const p = await db();
    const cfg = await getBotConfig(p);
    const q = req.query || {};
    const override = {};
    for (const k of ['icon', 'color', 'fg', 'shape', 'scale']) if (q[k] != null && String(q[k]) !== '') override[k] = String(q[k]).slice(0, 200);
    const png = await renderEmoji(key, cfg.economy?.iconStyle || {}, override);
    if (!png) return reply.code(500).send({ error: 'render_failed' });
    return reply.header('Content-Type', 'image/png').header('Cache-Control', Object.keys(override).length ? 'no-store' : 'private, max-age=60').send(png);
  });
  app.get('/admin/bot/emoji-pack.zip', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const p = await db();
    const cfg = await getBotConfig(p);
    const zip = await renderEmojiPack(cfg.economy?.iconStyle || {});
    return reply.header('Content-Type', 'application/zip').header('Content-Disposition', 'attachment; filename="bettercommunity-bot-icons.zip"').send(zip);
  });
  app.get('/admin/bot/emoji-keys', { preHandler: requireCap('manage_bot') }, async () => ({
    icons: Object.entries(BOT_ICONS).map(([key, v]) => ({ key, label: v.label, fallback: v.fallback, color: v.color, icon: v.icon })),
    defaults: ICON_STYLE_DEFAULTS,
  }));

  // Admin: what still needs a person — roles and custom rewards bought with points — and the
  // button that says it was handed over. Newest first, pending on top.
  app.get('/admin/economy/purchases', { preHandler: requireCap('manage_economy') }, async (req) => {
    const p = await db();
    const rows = await p.economyPurchase.findMany({ orderBy: [{ status: 'desc' }, { createdAt: 'desc' }], take: 100, include: { user: { select: { id: true, displayName: true } } } });
    return { purchases: rows.map((r) => ({ id: r.id, userId: r.userId, displayName: r.user.displayName, itemId: r.itemId, name: r.itemName, kind: r.kind, cost: r.cost, via: r.via, status: r.status, delivery: r.delivery, createdAt: r.createdAt })) };
  });
  app.post('/admin/economy/purchases/:id/deliver', { preHandler: requireCap('manage_economy') }, async (req, reply) => {
    const p = await db();
    const row = await p.economyPurchase.findUnique({ where: { id: req.params.id } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    await p.economyPurchase.update({ where: { id: row.id }, data: { status: 'delivered' } });
    await logAudit(p, req.user.uid, 'economy.deliver', `purchase=${row.id} user=${row.userId} item=${row.itemId}`);
    return { ok: true };
  });

  // A member gambles points in the casino. The bot posts the bet + outcome multiplier it rolled;
  // the API validates the bet against the configured limits, applies the house edge to the
  // payout, and settles the balance. The RNG lives on the bot (per game) — the API is the ledger.
  app.post('/bot/economy/casino', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ discordId: z.string().min(1).max(32), bet: z.number().int().min(1).max(100_000_000), multiplier: z.number().min(0).max(10000), game: z.string().max(20).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    if (!eco.casino?.enabled) return { ok: false, error: 'casino_off' };
    // The limits and the edge come from casino-rules.mjs — the same functions the settlement
    // below and the admin's RTP table use. `max` is Infinity for "no cap" and travels as null.
    const { min, max } = betLimits(eco.casino);
    const maxOut = Number.isFinite(max) ? max : null;
    if (b.data.bet < min || b.data.bet > max) return { ok: false, error: 'bad_bet', min, max: maxOut };
    const link = await p.discordLink.findUnique({ where: { discordId: b.data.discordId }, select: { userId: true } });
    if (!link) return { ok: false, error: 'not_linked' };
    const cur = await p.userEconomy.findUnique({ where: { userId: link.userId } });
    if ((cur?.points || 0) < b.data.bet) return { ok: false, error: 'insufficient', points: cur?.points || 0 };
    // The house edge is a tax on the PROFIT of a winning play, never on the stake: a 1× bucket
    // gives the bet back to the point, a 0.3× bucket returns exactly 30 % of it, a 2× flip pays
    // bet + (bet · edge). Per game now, falling back to the global percentage. A crash
    // multiplier already carries its edge inside the curve it was drawn from, so it is paid
    // as-is rather than taxed twice.
    const game = b.data.game || null;
    const edgePct = edgeApplied(game) ? 0 : edgePctFor(eco.casino, game);
    const payout = payoutFor(b.data.bet, b.data.multiplier, edgePct);
    const delta = payout - b.data.bet;
    const newPts = await movePoints(p, link.userId, delta, { kind: 'casino', ref: game, meta: { game, bet: b.data.bet, multiplier: b.data.multiplier, payout } }, { clamp: true });
    return { ok: true, delta, payout, points: newPts, min, max: maxOut };
  });

  // A whole TABLE settles at once: one round, many players, each on their own bet and their
  // own multiplier — a shared coin flip, a crash round where each cashed out at a different
  // moment, a race, the pot. The bot ran the round in front of everybody; this is the ledger
  // catching up. Validated as a batch so a bad payload settles nobody, then applied one by
  // one: a player who can no longer cover their stake by the time the round ends is REPORTED
  // rather than failing the table, because the round cannot be un-played for the others.
  app.post('/bot/economy/casino/settle', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      game: z.enum(CASINO_GAMES),
      plays: z.array(z.object({
        discordId: z.string().min(1).max(32),
        bet: z.number().int().min(1).max(100_000_000),
        multiplier: z.number().min(0).max(10000),
        // Free-form, bounded: what they picked, when they cashed out — for the ledger line.
        note: z.string().max(60).optional(),
      })).min(1).max(50),
      // A POT: the seats are settled between themselves under the ZERO-LOSS rule — the
      // winners pocket the whole sum staked, split by stake, and the house takes nothing;
      // with no winner every stake comes back. Off, every seat is settled against the house.
      pot: z.boolean().optional().default(false),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const eco = (await getBotConfig(p)).economy || {};
    if (!eco.casino?.enabled) return { ok: false, error: 'casino_off' };
    const { min, max } = betLimits(eco.casino);
    const maxOut = Number.isFinite(max) ? max : null;
    // One player, one seat: a duplicate id would be settled twice on one stake.
    const seen = new Set();
    for (const pl of b.data.plays) {
      if (seen.has(pl.discordId)) return reply.code(400).send({ error: 'duplicate_player' });
      seen.add(pl.discordId);
      if (pl.bet < min || pl.bet > max) return { ok: false, error: 'bad_bet', min, max: maxOut, discordId: pl.discordId };
    }
    const edgePct = edgeApplied(b.data.game) ? 0 : edgePctFor(eco.casino, b.data.game);
    // Who can still pay is decided BEFORE the pot is split: a seat whose balance no longer
    // covers its stake is reported and left out, so the winners are paid from stakes that
    // exist rather than from one the loser never had.
    const cover = new Map();
    for (const pl of b.data.plays) {
      const link = await p.discordLink.findUnique({ where: { discordId: pl.discordId }, select: { userId: true } });
      if (!link) { cover.set(pl.discordId, { error: 'not_linked' }); continue; }
      const cur = await p.userEconomy.findUnique({ where: { userId: link.userId } });
      if ((cur?.points || 0) < pl.bet) { cover.set(pl.discordId, { error: 'insufficient', points: cur?.points || 0 }); continue; }
      cover.set(pl.discordId, { userId: link.userId });
    }
    const table = settleTable(b.data.plays, { pot: b.data.pot, edgePct: b.data.pot ? 0 : edgePct, covered: (pl) => !!cover.get(pl.discordId)?.userId });
    const results = [];
    for (const pl of table.seats) {
      const c = cover.get(pl.discordId);
      if (pl.skipped) { results.push({ discordId: pl.discordId, ok: false, error: c?.error || 'insufficient', points: c?.points }); continue; }
      const points = await movePoints(p, c.userId, pl.delta, { kind: 'casino', ref: b.data.game, meta: { game: b.data.game, bet: pl.bet, multiplier: pl.multiplier, payout: pl.payout, live: true, pot: b.data.pot || undefined, share: pl.share ?? undefined, refund: pl.refund || undefined, note: pl.note || null } }, { clamp: true });
      results.push({ discordId: pl.discordId, ok: true, delta: pl.delta, payout: pl.payout, points, share: pl.share ?? undefined, refund: pl.refund || false });
    }
    return { ok: true, results, edgePct: b.data.pot ? 0 : edgePct, pot: table.pot, refund: table.refund, winners: table.winners };
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
    mergeShadowEconomy(p, row.discordId, req.user.uid, (await getBotConfig(p)).economy || {}).catch(() => {});
    grantAutoBadges(p, { event: 'discord', user: { id: req.user.uid } }).catch(() => {});
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
  const serGuildUser = (g, stored, ids, icons = {}) => ({
    guildId: g.guildId, name: g.name, icon: icons[g.guildId] || null, memberMode: g.memberMode, logChannelId: g.logChannelId,
    storeLogs: g.storeLogs, memberCount: g.memberCount, storedMembers: stored, lastScanAt: g.updatedAt,
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
    // The server's Discord icon rides in the bot's heartbeat guild list, not in BotGuild.
    const hb = (await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value?.guildList || [];
    const icons = Object.fromEntries(hb.filter((x) => x && x.id).map((x) => [x.id, x.icon || null]));
    return { linked: true, guilds: guilds.map((g) => serGuildUser(g, storedBy[g.guildId] || 0, ids, icons)), appId };
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
    // This server's live roles + channels (from the bot's last heartbeat) so the owner can PICK
    // a channel/role instead of pasting a snowflake. Absent (bot offline / old heartbeat) → the
    // dashboard falls back to the id inputs it already had.
    const status = (await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value || null;
    const gEntry = (status?.guildList || []).find((x) => x.id === g.guildId) || null;
    return {
      guild: serGuildUser(g, stored, ids, Object.fromEntries((((await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value?.guildList) || []).filter((x) => x && x.id).map((x) => [x.id, x.icon || null]))), logs, welcome: gc.welcome || {}, joinToCreate: gc.joinToCreate || {}, gating: gc.gating || {}, blog: { routes: blogRoutes }, rolePanels,
      globalStorage: { enabled: memberPolicy(cfg).enabled, inactiveDays: memberPolicy(cfg).inactiveDays },
      // Custom welcome-banner policy so the owner UI can show the gate (off / free / paid) and,
      // when paid, whether THIS guild is unlocked and at what price.
      bannerPolicy: (() => { const b = { allowed: true, paid: false, priceCents: 0, unlocked: [], ...(cfg.welcomeBanner || {}) }; return { allowed: !!b.allowed, paid: !!b.paid, priceCents: b.priceCents || 0, unlocked: (b.unlocked || []).map(String).includes(String(g.guildId)) }; })(),
      roles: gEntry?.roles || [], channels: gEntry?.channels || [],
    };
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
    // What a linked member IS on the site: their level and badges. Read-only here — the
    // owner sees it, and manages Discord roles, never the site account.
    const links = await p.discordLink.findMany({ where: { discordId: { in: rows.map((r) => r.discordId) } }, select: { discordId: true, user: { select: { id: true, displayName: true, economy: { select: { level: true, points: true } }, badges: { include: { badge: { select: { name: true, color: true, icon: true, iconType: true } } }, orderBy: { badge: { priority: 'desc' } }, take: 6 } } } } });
    const byId = Object.fromEntries(links.map((l) => [l.discordId, { userId: l.user.id, displayName: l.user.displayName, level: l.user.economy?.level || 0, points: l.user.economy?.points || 0, badges: l.user.badges.map((b) => b.badge) }]));
    // The guild's role list (id → name/colour) so the page can show and edit roles by name.
    const status = (await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value || null;
    const roles = status?.guildList?.find((x) => x.id === g.guildId)?.roles || [];
    return { members: rows.map((r) => ({ ...r, linked: byId[r.discordId] || null })), total, mode: 'global', roles };
  });

  // Buy the custom welcome banner for a server you manage.
  //
  // The paid state existed and the gate below (402 `banner_locked`) refused the upload, but
  // there was no way to pay: the dashboard's own copy said "ask an admin to unlock it for your
  // server". A price with no till is not a paid feature, it is a wall.
  //
  // One-time payment, per guild. The unlock is written by the webhook, never here — a session
  // created is not a payment taken.
  app.post('/me/discord/guilds/:id/banner/checkout', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const ids = await myDiscordIds(p, req.user.uid);
    const cur = ids.length ? await p.botGuild.findFirst({ where: { guildId: req.params.id, ...manageableWhere(ids) } }) : null;
    if (!cur) return reply.code(404).send({ error: 'not_found' });

    const raw = (await p.adminSetting.findUnique({ where: { key: 'bot.config' } }))?.value || {};
    const pol = { allowed: true, paid: false, priceCents: 0, unlocked: [], ...(raw.welcomeBanner || {}) };
    // Every refusal is its own reason: turned off, not a paid feature at all, already bought,
    // or priced at nothing. One generic error would leave the buyer guessing which.
    if (!pol.allowed) return reply.code(403).send({ error: 'banner_disabled' });
    if (!pol.paid) return reply.code(400).send({ error: 'banner_free' });
    if ((pol.unlocked || []).map(String).includes(String(cur.guildId))) return reply.code(409).send({ error: 'already_unlocked' });
    if (!(pol.priceCents > 0)) return reply.code(400).send({ error: 'no_price' });

    const { stripe, ensureCustomer } = await import('./hosting.mjs');
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'payments_unavailable' });
    const siteUrl = process.env.SITE_URL || 'http://localhost:5176';
    const customer = await ensureCustomer(p, sk, req.user.uid);
    const session = await sk.checkout.sessions.create({
      mode: 'payment',
      customer,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (raw.currency || 'usd').toLowerCase(),
          unit_amount: pol.priceCents,
          product_data: { name: `Custom welcome banner — ${cur.name || cur.guildId}` },
        },
      }],
      invoice_creation: { enabled: true },
      metadata: { type: 'banner_unlock', guildId: String(cur.guildId), userId: String(req.user.uid) },
      success_url: `${siteUrl}/dashboard?banner=ok`,
      cancel_url: `${siteUrl}/dashboard?banner=cancel`,
    });
    return { url: session.url };
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
      roleId: z.string().max(32).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const { kind, discordId, minutes, roleId } = b.data;
    const reason = (b.data.reason || '').trim();
    if (['ban', 'kick', 'timeout'].includes(kind) && !reason) return reply.code(400).send({ error: 'reason_required' });
    if (kind === 'timeout' && !minutes) return reply.code(400).send({ error: 'minutes_required' });
    const p = await db();
    const ids = await myDiscordIds(p, req.user.uid);
    const g = ids.length ? await p.botGuild.findFirst({ where: { guildId: req.params.id, ...manageableWhere(ids) } }) : null;
    if (!g) return reply.code(404).send({ error: 'not_found' });
    // A role must be one of THIS guild's assignable roles (the bot's heartbeat lists them —
    // @everyone and managed roles are already dropped there), so an owner can never name a
    // role from another server or one the bot cannot hand out.
    if (kind.startsWith('role_')) {
      const status = (await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value || null;
      const roles = status?.guildList?.find((x) => x.id === g.guildId)?.roles || [];
      if (!roleId || !roles.some((r) => r.id === roleId)) return reply.code(400).send({ error: 'role_required' });
    }
    // You cannot moderate yourself through this, and the target must be a member of THIS guild.
    if (ids.includes(discordId)) return reply.code(400).send({ error: 'cannot_moderate_self' });
    const member = await p.discordActivity.findUnique({ where: { guildId_discordId: { guildId: g.guildId, discordId } }, select: { username: true } });
    if (!member) return reply.code(404).send({ error: 'member_not_found' });
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true, email: true } });
    const action = await p.botAction.create({
      data: {
        kind, discordId, guildId: g.guildId, minutes: minutes ?? null, roleId: roleId || null, reason,
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
    // Custom welcome-banner policy (admin-set) + this guild's CURRENT banner, read once so the
    // save can (a) refuse a NEW banner when uploads aren't free, and (b) delete the previous
    // file when it's replaced — one banner per guild, never an orphan left in the store.
    const rawCfg0 = (await p.adminSetting.findUnique({ where: { key: 'bot.config' } }))?.value || {};
    const bannerPol = { allowed: true, paid: false, priceCents: 0, unlocked: [], ...(rawCfg0.welcomeBanner || {}) };
    const oldBg = isMediaPath(rawCfg0.guilds?.[cur.guildId]?.welcome?.bgImage) ? rawCfg0.guilds[cur.guildId].welcome.bgImage : '';
    let oldBgToDelete = null;
    // `moderation` runs bans/kicks and MUST log somewhere — same refusal as the admin path.
    // memberMode is not a choice a server makes any more (the database is global) — it is
    // accepted for old clients and dropped.
    delete guildData.memberMode;
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
      // Gate a NEW/CHANGED custom banner. Free upload is only allowed when the admin permits it;
      // when it is a paid feature, only a guild that has been unlocked (bought it / admin-granted)
      // may set one. An unchanged banner, or clearing it, is always allowed.
      if (w.bgImage !== undefined && w.bgImage && w.bgImage !== oldBg) {
        if (!bannerPol.allowed) return reply.code(403).send({ error: 'banner_disabled' });
        if (bannerPol.paid && !(bannerPol.unlocked || []).map(String).includes(String(cur.guildId))) {
          return reply.code(402).send({ error: 'banner_locked', priceCents: bannerPol.priceCents || 0 });
        }
      }
      // One banner per guild: a change (to another image, or to none) drops the previous file.
      if (w.bgImage !== undefined && oldBg && w.bgImage !== oldBg) oldBgToDelete = oldBg;
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
    // The replaced banner is removed from the store now the new config is committed (best effort).
    if (oldBgToDelete) { try { await deleteObject(oldBgToDelete.replace('/api/media/', '')); } catch { /* the file may already be gone */ } }
    await logAudit(p, req.user.uid, 'bot.guild.self', `${g.guildId} mode=${g.memberMode}${changed.length ? ' +' + changed.join('+') : ''}${blog ? ' +blog' : ''}${rolePanels ? ' +panels' : ''}`);
    const stored = await p.discordActivity.count({ where: { guildId: g.guildId } });
    const cfg = await getBotConfig(p);
    const outGc = (cfg.guilds && cfg.guilds[g.guildId]) || {};
    const outBlog = (Array.isArray(cfg.blog?.routes) ? cfg.blog.routes : []).filter((r) => r.guildId === g.guildId);
    const outPanels = (Array.isArray(cfg.rolePanels) ? cfg.rolePanels : []).filter((pnl) => pnl.guildId === g.guildId);
    return { ok: true, guild: serGuildUser(g, stored, ids, Object.fromEntries((((await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value?.guildList) || []).filter((x) => x && x.id).map((x) => [x.id, x.icon || null]))), welcome: outGc.welcome || {}, joinToCreate: outGc.joinToCreate || {}, gating: outGc.gating || {}, blog: { routes: outBlog }, rolePanels: outPanels };
  });
}
