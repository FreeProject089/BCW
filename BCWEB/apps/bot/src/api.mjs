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
  getConfig: () => call('GET', '/bot/config').then((r) => r.config),
  // The Discord token, managed from the admin dashboard (null when unset/disabled).
  getToken: () => call('GET', '/bot/token').then((r) => r.token).catch(() => null),
  heartbeat: (data) => call('POST', '/bot/heartbeat', data).catch(() => {}),
  // Report a failed connection (surfaced in the admin dashboard so the cause is visible).
  reportError: (error) => call('POST', '/bot/heartbeat', { online: false, error }).catch(() => {}),
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
  // Bulk-sync the guild roster into the member database (startup + periodic full scan).
  syncMembers: (members) => call('POST', '/bot/members/sync', { members }).catch(() => ({ synced: 0 })),
  // Moderation queued on the website. A failed poll returns an empty list rather than
  // throwing, so one bad request never stops the loop.
  pendingActions: () => call('GET', '/bot/actions/pending').catch(() => ({ actions: [] })),
  pendingAnnouncements: () => call('GET', '/bot/announcements/pending').catch(() => ({ announcements: [] })),
  announcementResult: (id, ok, error) => call('POST', `/bot/announcements/${id}/result`, { ok, error }).catch(() => null),
  actionResult: (id, ok, error) => call('POST', `/bot/actions/${id}/result`, { ok, error }).catch(() => null),
  // Report a Discord activity event (join / message / voiceJoin / voiceCreate) so the
  // telemetry dashboard can show it next to the linked creator id. Best-effort.
  activity: (discordId, event, user) => call('POST', '/bot/activity', {
    discordId, event, username: user?.username, avatar: user?.displayAvatarURL?.({ size: 128 }),
  }).catch(() => {}),
};
