// Thin BCWEB API client (server-to-server, shared secret). The bot reads its config,
// issues link codes, resolves accounts (for gating/telemetry), and posts heartbeats.
const BASE = (process.env.BCWEB_API_URL || 'http://api:3000').replace(/\/+$/, '');
const SECRET = process.env.BOT_SHARED_SECRET || 'dev-bot-secret';
export const SITE_URL = (process.env.SITE_URL || 'http://localhost').replace(/\/+$/, '');

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'x-bot-secret': SECRET, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let body = null; try { body = await res.json(); } catch { /* non-JSON */ }
    const e = new Error(`bcweb ${method} ${path} -> ${res.status}`);
    e.status = res.status; e.body = body;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // restartAt travels beside the config, not inside it (see the route). It is folded in
  // here so the 20s supervisor tick sees it without a second request.
  getConfig: () => call('GET', '/bot/config').then((r) => ({ ...r.config, restartAt: r.restartAt || null })),
  // The Discord token, managed from the admin dashboard (null when unset/disabled).
  getToken: () => call('GET', '/bot/token').then((r) => r.token).catch(() => null),
  heartbeat: (data) => call('POST', '/bot/heartbeat', data).catch(() => {}),
  // Report a failed connection (surfaced in the admin dashboard so the cause is visible).
  reportError: (error) => call('POST', '/bot/heartbeat', { online: false, error }).catch(() => {}),
  // A handler that threw: the message, its stack and where it happened (command / custom id,
  // guild, user) — one ErrorEvent on the site, so the admin Errors page, the alerts channel
  // and the "Needs attention" digest all see it. Best-effort, never awaited by the handler.
  // The language a server's manager picked in the onboarding card (auto | en | fr | de | es).
  setGuildLanguage: (guildId, language) => call('PUT', `/bot/guilds/${encodeURIComponent(guildId)}/language`, { language }).catch(() => ({})),
  // A read that fails degrades to "you may not", which shows the refusal card rather
  // than a config screen whose controls would all fail.
  guildSettings: (guildId, actorDiscordId) => call('GET', `/bot/guilds/${encodeURIComponent(guildId)}/settings?actorDiscordId=${encodeURIComponent(actorDiscordId)}`)
    .catch(() => ({ may: false, linked: false, manager: false, settings: null })),
  // The WRITE keeps its error — unlike its neighbours, which swallow theirs. A settings
  // change that fails silently tells somebody their server is configured when it is not.
  setGuildSettings: (guildId, actorDiscordId, patch) =>
    call('PUT', `/bot/guilds/${encodeURIComponent(guildId)}/settings`, { actorDiscordId, patch })
      .catch((e) => ({ ok: false, error: e?.body?.error || 'network' })),
  reportHandlerError: (message, stack, context) => call('POST', '/bot/errors', { message, stack, context }).catch(() => {}),
  // Self-serve role panels. `panels` is EVERY panel (a button press on last month's
  // message must still work), `due` names the ones whose rendered form has changed.
  rolePanels: () => call('GET', '/bot/rolepanels').catch(() => ({ panels: [], due: [] })),
  // Broadcast DMs. A failure to reach the API returns an EMPTY batch rather than
  // throwing: a broadcast that cannot be read is a broadcast that waits, not one that
  // crashes the poller and stops every other DM with it.
  dmAllPending: () => call('GET', '/bot/dm-all/pending').catch(() => ({ batch: [] })),
  dmAllResult: (id, sent, failed) => call('POST', '/bot/dm-all/result', { id, sent, failed }).catch(() => {}),
  rolePanelPosted: (id, body) => call('POST', `/bot/rolepanels/${id}/posted`, body).catch(() => {}),
  // Blog announcements (multi-route): recent published posts (each tagged with its
  // source key) + each channel's already-announced set, so the bot can post the
  // right posts to the right channels. Marking done is per channel ({channelId,ids}).
  blogSync: (channels) => call('POST', '/bot/blog/sync', { channels }).then((r) => ({ posts: r.posts || [], announcedByChannel: r.announcedByChannel || {} })).catch(() => ({ posts: [], announcedByChannel: {} })),
  blogMarkAnnounced: (marks) => call('POST', '/bot/blog/announced', { marks }).catch(() => {}),
  // Server-perf alerts (CPU/RAM/disk/service-down) not yet posted + mark them done.
  alertsUnannounced: () => call('GET', '/bot/alerts/unannounced').then((r) => r.alerts || []).catch(() => []),
  alertsMarkAnnounced: (ids) => call('POST', '/bot/alerts/announced', { ids }).catch(() => {}),
  // Ko-fi tips not yet posted (+ running totals for the embed) + mark them done.
  kofiUnannounced: () => call('GET', '/bot/kofi/unannounced').then((r) => ({ tips: r.tips || [], totals: r.totals || {} })).catch(() => ({ tips: [], totals: {} })),
  kofiMarkAnnounced: (ids) => call('POST', '/bot/kofi/announced', { ids }).catch(() => {}),
  // Stripe payments + refunds not yet posted, and marking them done.
  paymentsUnannounced: () => call('GET', '/bot/payments/unannounced').then((r) => ({ payments: r.payments || [], refunds: r.refunds || [], test: !!r.test })).catch((e) => { console.warn('[bot] paymentsUnannounced failed:', e.message); return { payments: [], refunds: [], test: false }; }),
  paymentsMarkAnnounced: (marks) => call('POST', '/bot/payments/announced', marks).catch(() => {}),
  // Pending admin DMs (message + optional gift code) and marking them delivered.
  paymentInvoice: (id) => call('GET', `/bot/payments/${id}/invoice`).catch(() => null),
  dmPending: () => call('GET', '/bot/dm/pending').then((r) => r.items || []).catch((e) => { console.warn('[bot] dmPending failed:', e.message); return []; }),
  dmSent: (ids) => call('POST', '/bot/dm/sent', { ids }).catch(() => {}),
  // Link buffer: Discord ids freshly (re)linked on the website that need a prompt role refresh.
  linksPending: () => call('GET', '/bot/links/pending').then((r) => r.discordIds || []).catch(() => []),
  linksSynced: (discordIds) => call('POST', '/bot/links/synced', { discordIds }).catch(() => {}),
  // Giveaways: fetch active ones, mark posted, record an entry, record the draw.
  giveawaysActive: () => call('GET', '/bot/giveaways/active').then((r) => r.giveaways || []).catch(() => []),
  giveawayCreate: (data) => call('POST', '/bot/giveaways/create', data),
  giveawayPosted: (id, messageId) => call('POST', `/bot/giveaways/${id}/posted`, { messageId }).catch(() => {}),
  giveawayEnter: (id, discordId) => call('POST', `/bot/giveaways/${id}/enter`, { discordId }),
  giveawayDrawn: (id, winnerIds) => call('POST', `/bot/giveaways/${id}/drawn`, { winnerIds }).catch(() => ({ gifts: {} })),
  issueLink: (discordId, username) => call('POST', '/bot/link/issue', { discordId, username }),
  account: (discordId) => call('GET', `/bot/account/${discordId}`).catch(() => ({ linked: false })),
  // Bulk-sync ONE guild's roster into the member database (startup + periodic full scan). The
  // guild is now required (B4): storage is budgeted per guild, and a guild the admin left at the
  // default `none` mode stores nothing at all.
  syncMembers: (guildId, guildName, memberCount, members) => call('POST', '/bot/members/sync', { guildId, guildName, memberCount, members }).catch(() => ({ synced: 0 })),
  // A guild's member-storage mode, so the bot can skip the expensive full-roster fetch for a
  // guild that stores nothing. Defaults to `none` on any failure — the safe, no-storage side.
  guildMode: (guildId) => call('GET', `/bot/guilds/${guildId}`).then((r) => r?.memberMode || 'none').catch(() => 'none'),
  // B-econ: report buffered activity deltas (messages / reactions / voice seconds) so the API can
  // turn them into XP + levels. Best-effort — a dropped batch just means that minute's XP is lost.
  accrueEconomy: (events) => call('POST', '/bot/economy/accrue', { events }).catch(() => ({})),
  economyConfig: () => call('GET', '/bot/economy/config').then((r) => r.economy || {}).catch(() => ({})),
  economyUser: (discordId) => call('GET', `/bot/economy/user/${encodeURIComponent(discordId)}`).catch(() => ({ linked: false })),
  economyBuy: (discordId, itemId) => call('POST', '/bot/economy/buy', { discordId, itemId }).catch(() => ({ ok: false, error: 'network' })),
  economyCasino: (discordId, bet, multiplier, game) => call('POST', '/bot/economy/casino', { discordId, bet, multiplier, game }).catch(() => ({ ok: false, error: 'network' })),
  // A whole live table at once — one round, every seat's own bet and multiplier.
  economySettle: (game, plays) => call('POST', '/bot/economy/casino/settle', { game, plays }).catch(() => ({ ok: false, error: 'network' })),
  economyReveal: (discordId, purchaseId) => call('POST', '/bot/economy/reveal', { discordId, purchaseId }).catch(() => ({ ok: false, error: 'network' })),
  economyGift: (body) => call('POST', '/bot/economy/gift', body).catch(() => ({ ok: false, error: 'network' })),
  economyHistory: (discordId, kind = '') => call('GET', `/bot/economy/history/${encodeURIComponent(discordId)}${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`).catch(() => ({ history: [] })),
  economyPurchases: (discordId) => call('GET', `/bot/economy/purchases/${encodeURIComponent(discordId)}`).catch(() => ({ purchases: [] })),
  economyLeaderboard: (discordId = '', guildId = '') => call('GET', `/bot/economy/leaderboard?discordId=${encodeURIComponent(discordId)}&guildId=${encodeURIComponent(guildId)}`).catch(() => ({ members: [] })),
  // A picture the site renders (the casino GIF, the profile card), fetched over the INTERNAL
  // API address and attached to the message — Discord never has to reach SITE_URL, which in a
  // dev or LAN deployment it cannot. Null on any failure, so the caller shows the card without.
  siteImage: async (path) => {
    try {
      const res = await fetch(BASE + path, { headers: { 'x-bot-secret': SECRET }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > 0 && buf.length < 8 * 1024 * 1024 ? buf : null;
    } catch { return null; }
  },

  // Warnings go through the site so the count, the ladder and the record are in one place —
  // a bot keeping its own tally would disagree with the admin screen the first time either
  // was used. A refusal returns null and the command says the warning was NOT recorded,
  // rather than pretending.
  warn: (discordId, reason, guildId, by) => call('POST', '/bot/warns', { discordId, reason, guildId, by })
    .catch((e) => { console.warn('[bot] warn failed:', e.message); return null; }),
  warnList: (discordId) => call('GET', `/bot/warns?discordId=${encodeURIComponent(discordId)}`)
    .catch(() => ({ warns: [], active: 0 })),
  // Moderation queued on the website. A failed poll returns an empty list rather than
  // throwing, so one bad request never stops the loop.
  pendingActions: () => call('GET', '/bot/actions/pending').catch(() => ({ actions: [] })),
  pendingAnnouncements: () => call('GET', '/bot/announcements/pending').catch(() => ({ announcements: [] })),
  announcementResult: (id, ok, error) => call('POST', `/bot/announcements/${id}/result`, { ok, error }).catch(() => null),
  actionResult: (id, ok, error) => call('POST', `/bot/actions/${id}/result`, { ok, error }).catch(() => null),
  // Report a Discord activity event (join / message / voiceJoin / voiceCreate) so the
  // telemetry dashboard can show it next to the linked creator id. Best-effort.
  activity: (guildId, discordId, event, user) => call('POST', '/bot/activity', {
    guildId, discordId, event, username: user?.username, avatar: user?.displayAvatarURL?.({ size: 128 }),
  }).catch(() => {}),
};
