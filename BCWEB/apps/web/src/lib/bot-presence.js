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
// More incident lines, beyond healthText, and whether an incident REPLACES the rotation
// ('replace', the takeover) or is mixed INTO it ('alternate'). The bot's INCIDENT_MODES.
export const PRESENCE_INCIDENT_MODES = ['replace', 'alternate'];
export const PRESENCE_MAX_INCIDENT = 5;
export const PRESENCE_MIN_ROTATE_SEC = 30;
export const PRESENCE_DEFAULTS = Object.freeze({
  enabled: false, status: 'online', type: 'watching', text: '{guilds} servers', rotate: [], rotateSec: 60,
  health: true, healthText: 'Incident: {services}', incidentLines: [], incidentMode: 'replace', stripe: true, stripeText: 'Stripe: {stripe}',
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
    rotateSec: Number.isFinite(sec) ? Math.min(3600, Math.max(PRESENCE_MIN_ROTATE_SEC, sec)) : d.rotateSec,
    health: r.health !== false,
    healthText: str(r.healthText, d.healthText),
    incidentLines: Array.isArray(r.incidentLines) ? r.incidentLines.slice(0, PRESENCE_MAX_INCIDENT).map((x) => String(x ?? '').slice(0, PRESENCE_MAX_TEXT)) : [],
    incidentMode: PRESENCE_INCIDENT_MODES.includes(r.incidentMode) ? r.incidentMode : d.incidentMode,
    stripe: r.stripe !== false,
    stripeText: str(r.stripeText, d.stripeText),
  };
}

/** What is saved: the normalised shape without the empty rotation rows. */
export const presenceForSave = (p) => {
  const n = normPresence(p);
  return { ...n, rotate: n.rotate.map((x) => x.trim()).filter(Boolean), incidentLines: n.incidentLines.map((x) => x.trim()).filter(Boolean) };
};

// The ONLY placeholders a line may use (the bot's PLACEHOLDERS): an allowlist looked up with
// Object.hasOwn, so `{constructor}` stays literal text, and one pass, so a value holding
// `{members}` is printed as is. Control characters become spaces.
export const PRESENCE_PLACEHOLDERS = Object.freeze(['guilds', 'members', 'status', 'stripe', 'services']);
export const fill = (s, vars) => String(s || '').replace(/\{([a-z]+)\}/g, (m, k) => (PRESENCE_PLACEHOLDERS.includes(k) && Object.hasOwn(vars, k) && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ');
const lineList = (a) => (Array.isArray(a) ? a : []).map((x) => String(x || '').trim()).filter(Boolean);

/** rotationLine() in the bot: which line at `tick`, and whether an incident picked it. */
export function rotationLine(lines, incidentLines, { incident = false, mode = 'replace', tick = 0 } = {}) {
  const k = Math.abs(Math.floor(Number(tick) || 0));
  const normal = lineList(lines);
  if (!incident) return { text: normal.length ? normal[k % normal.length] : '', incident: false };
  const inc = lineList(incidentLines);
  if (!inc.length) inc.push('Incident: {services}');
  if (mode !== 'alternate' || !normal.length) return { text: inc[k % inc.length], incident: true };
  return k % 2 === 0 ? { text: inc[(k / 2) % inc.length], incident: true } : { text: normal[((k - 1) / 2) % normal.length], incident: false };
}

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
  const hurt = (site?.services || []).filter((s) => s.state === 'down').map((s) => s.label);
  const incident = p.health !== false && (siteState === 'partial' || siteState === 'major') && hurt.length > 0;
  const mode = PRESENCE_INCIDENT_MODES.includes(p.incidentMode) ? p.incidentMode : 'replace';
  const incidentLines = [p.healthText || 'Incident: {services}', ...(Array.isArray(p.incidentLines) ? p.incidentLines.slice(0, PRESENCE_MAX_INCIDENT) : [])];
  const pick = rotationLine([p.text, ...(Array.isArray(p.rotate) ? p.rotate : [])], incidentLines, { incident, mode, tick });
  let text;
  // 'health' = an incident line is showing; 'line' = a configured line (also between two
  // incident lines in the 'alternate' mode, where the dot still says there is an incident).
  let source = 'line';
  if (incident) {
    status = siteState === 'major' ? 'dnd' : 'idle';
    text = fill(pick.text, { ...vars, services: hurt.join(', ') });
    source = pick.incident ? 'health' : 'line';
  } else if (p.stripe !== false && stripe && !['operational', 'unknown'].includes(stripe.state)) {
    if (status === 'online') status = 'idle';
    text = fill(p.stripeText || 'Stripe: {stripe}', vars);
    source = 'stripe';
  } else {
    text = fill(pick.text, vars);
  }
  return { status, type, text: clean(text).slice(0, PRESENCE_MAX_TEXT), source, incident };
}
