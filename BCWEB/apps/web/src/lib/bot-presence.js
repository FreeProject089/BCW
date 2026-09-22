// The bot's Discord status (`config.presence`), as data: its shape, its bounds, and the line it
// will show. Out of the .jsx so `node --test` can load it.
//
// `presencePreview()` is presenceFor() in apps/bot/src/features/presence.mjs written once more
// (the web cannot import discord.js): the same order (an incident on the status page first,
// then Stripe's own status, then the configured line), the same variables, the same 128-char
// cut. The preview's whole value is that it says what Discord will show; a copy that drifts
// prints a confident line the bot never sends. apps/bot/test/presence-parity.test.mjs runs both
// on the same inputs.
//
// The API default (DEFAULT_BOT_CONFIG.presence in routes/bot.mjs) and this one must agree.

export const PRESENCE_STATUSES = ['online', 'idle', 'dnd', 'invisible'];
export const PRESENCE_TYPES = ['playing', 'watching', 'listening', 'competing', 'custom'];
export const PRESENCE_VARS = ['{guilds}', '{members}', '{status}', '{stripe}'];
export const PRESENCE_MAX_TEXT = 128;
export const PRESENCE_MAX_ROTATE = 10;
export const PRESENCE_DEFAULTS = Object.freeze({
  enabled: false, status: 'online', type: 'watching', text: '{guilds} servers', rotate: [], rotateSec: 60,
  health: true, healthText: 'Incident: {services}', stripe: true, stripeText: 'Stripe: {stripe}',
});

const str = (v, d, max = PRESENCE_MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : d);

/** Whatever was stored under `presence` → the full shape, bounds applied. */
export function normPresence(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = PRESENCE_DEFAULTS;
  const sec = Math.floor(Number(r.rotateSec));
  return {
    enabled: r.enabled === true,
    status: PRESENCE_STATUSES.includes(r.status) ? r.status : d.status,
    type: PRESENCE_TYPES.includes(r.type) ? r.type : d.type,
    text: str(r.text, d.text),
    // Blank lines are kept while editing (a new row starts empty); the bot drops them itself.
    rotate: Array.isArray(r.rotate) ? r.rotate.slice(0, PRESENCE_MAX_ROTATE).map((x) => String(x ?? '').slice(0, PRESENCE_MAX_TEXT)) : [],
    // The bot never rotates faster than every 30 s: Discord rate-limits presence updates.
    rotateSec: Number.isFinite(sec) ? Math.min(3600, Math.max(30, sec)) : d.rotateSec,
    health: r.health !== false,
    healthText: str(r.healthText, d.healthText),
    stripe: r.stripe !== false,
    stripeText: str(r.stripeText, d.stripeText),
  };
}

/** What is saved: the normalised shape without the empty rotation rows. */
export const presenceForSave = (p) => {
  const n = normPresence(p);
  return { ...n, rotate: n.rotate.map((x) => x.trim()).filter(Boolean) };
};

const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));

/**
 * The status the bot will show, or null when the feature is off. presenceFor() in the bot.
 * @param p    the presence config (any shape)
 * @param ctx  { guilds, members, site: { state, services: [{ label, state }], stripe: { state, description } } | null,
 *               tick (which rotation line), statusLabel(state) → the words {status} becomes }
 * @returns { status, type, text, source: 'line'|'health'|'stripe' }
 */
export function presencePreview(p, { guilds = 0, members = 0, site = null, tick = 0, statusLabel = (s) => s } = {}) {
  if (!p || p.enabled !== true) return null;
  let status = PRESENCE_STATUSES.includes(p.status) ? p.status : 'online';
  const type = PRESENCE_TYPES.includes(p.type) ? p.type : 'watching';
  const siteState = site?.state || 'unknown';
  const stripe = site?.stripe || null;
  const vars = {
    guilds, members,
    status: statusLabel(['operational', 'partial', 'major'].includes(siteState) ? siteState : 'unknown'),
    stripe: stripe?.description || stripe?.state || '',
  };
  const lines = [p.text, ...(Array.isArray(p.rotate) ? p.rotate : [])].map((x) => String(x || '').trim()).filter(Boolean);
  let text = lines.length ? lines[Math.abs(Math.floor(tick)) % lines.length] : '';
  let source = 'line';
  const hurt = (site?.services || []).filter((s) => s.state === 'down').map((s) => s.label);
  if (p.health !== false && (siteState === 'partial' || siteState === 'major') && hurt.length) {
    status = siteState === 'major' ? 'dnd' : 'idle';
    text = fill(p.healthText || 'Incident: {services}', { ...vars, services: hurt.join(', ') });
    source = 'health';
  } else if (p.stripe !== false && stripe && !['operational', 'unknown'].includes(stripe.state)) {
    if (status === 'online') status = 'idle';
    text = fill(p.stripeText || 'Stripe: {stripe}', vars);
    source = 'stripe';
  } else {
    text = fill(text, vars);
  }
  return { status, type, text: text.slice(0, PRESENCE_MAX_TEXT), source };
}
