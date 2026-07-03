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
  if (!res.ok) throw new Error(`bcweb ${method} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const api = {
  getConfig: () => call('GET', '/bot/config').then((r) => r.config),
  // The Discord token, managed from the admin dashboard (null when unset/disabled).
  getToken: () => call('GET', '/bot/token').then((r) => r.token).catch(() => null),
  heartbeat: (data) => call('POST', '/bot/heartbeat', data).catch(() => {}),
  // Report a failed connection (surfaced in the admin dashboard so the cause is visible).
  reportError: (error) => call('POST', '/bot/heartbeat', { online: false, error }).catch(() => {}),
  // Blog announcements: published posts not yet announced + mark them done.
  blogUnannounced: () => call('GET', '/bot/blog/unannounced').then((r) => r.posts || []).catch(() => []),
  blogMarkAnnounced: (ids) => call('POST', '/bot/blog/announced', { ids }).catch(() => {}),
  // Server-perf alerts (CPU/RAM/disk/service-down) not yet posted + mark them done.
  alertsUnannounced: () => call('GET', '/bot/alerts/unannounced').then((r) => r.alerts || []).catch(() => []),
  alertsMarkAnnounced: (ids) => call('POST', '/bot/alerts/announced', { ids }).catch(() => {}),
  // Ko-fi tips not yet posted (+ running totals for the embed) + mark them done.
  kofiUnannounced: () => call('GET', '/bot/kofi/unannounced').then((r) => ({ tips: r.tips || [], totals: r.totals || {} })).catch(() => ({ tips: [], totals: {} })),
  kofiMarkAnnounced: (ids) => call('POST', '/bot/kofi/announced', { ids }).catch(() => {}),
  issueLink: (discordId, username) => call('POST', '/bot/link/issue', { discordId, username }),
  account: (discordId) => call('GET', `/bot/account/${discordId}`).catch(() => ({ linked: false })),
  // Report a Discord activity event (join / message / voiceJoin / voiceCreate) so the
  // telemetry dashboard can show it next to the linked creator id. Best-effort.
  activity: (discordId, event, user) => call('POST', '/bot/activity', {
    discordId, event, username: user?.username, avatar: user?.displayAvatarURL?.({ size: 128 }),
  }).catch(() => {}),
};
