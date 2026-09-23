// The bot's Discord status (presence): the coloured dot and the activity line under its name.
//
// It showed nothing at all — no activity, the default online dot — and nothing configured it.
// Now it is `presence` in the bot config, edited from Admin → Discord bot (see the API's
// DEFAULT_BOT_CONFIG for the shape), picked up within 30 s like everything else:
//   status / type / text  → the dot and the line ("Watching 12 servers"), with {guilds}
//                           {members} {status} {stripe}; `rotate` adds lines shown in turn.
//   health                → while the site's status page is not all green, the line says what
//                           is affected and the dot turns idle (partial) or dnd (major).
//                           `incidentLines` adds more incident lines, shown in turn; with
//                           `incidentMode: 'alternate'` they are mixed into the normal rotation
//                           instead of replacing it (rotationLine below).
//   stripe                → while STRIPE's own published status is not operational, the line
//                           says so, in Stripe's words. Read by the API from stripestatus.com
//                           (cached there), never by the bot, and never fatal: no answer = no
//                           Stripe line, not a red one.
// The decision is pure (presenceFor) and tested; the Discord side only applies it when it
// changed, because Discord rate-limits presence updates.
import { ActivityType } from 'discord.js';
import { config } from '../config.mjs';
import { api } from '../api.mjs';
import { makeT, localeOf } from '../i18n.mjs';

export const STATUSES = ['online', 'idle', 'dnd', 'invisible'];
export const TYPES = { playing: ActivityType.Playing, listening: ActivityType.Listening, watching: ActivityType.Watching, competing: ActivityType.Competing, custom: ActivityType.Custom };
const MAX_TEXT = 128;

// The ONLY placeholders a line may use. A line is admin text, and the values come from
// elsewhere (Stripe's published words, the status page's service labels), so the rule is
// narrow on purpose:
//   · a fixed allowlist, looked up with Object.hasOwn: `{constructor}` or `{__proto__}` stays
//     literal text instead of printing a function's source (the old `vars[k] !== undefined`
//     read Object.prototype);
//   · one pass: a VALUE that contains `{members}` is printed as is, never expanded again;
//   · control characters become spaces, so no value can break the line.
export const PLACEHOLDERS = Object.freeze(['guilds', 'members', 'status', 'stripe', 'services']);
export const INCIDENT_MODES = Object.freeze(['replace', 'alternate']);
export const MAX_INCIDENT_LINES = 5;
export function fill(s, vars) {
  return String(s || '').replace(/\{([a-z]+)\}/g, (m, k) => (PLACEHOLDERS.includes(k) && Object.hasOwn(vars, k) && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}
const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ');
const lineList = (a) => (Array.isArray(a) ? a : []).map((x) => String(x || '').trim()).filter(Boolean);

/**
 * Which line to show at `tick`. Pure: the rotation the owner configured, and what an incident
 * does to it.
 *   no incident            → lines[tick % n]
 *   incident, 'replace'    → the incident lines only, in turn (the takeover)
 *   incident, 'alternate'  → an incident line, then a normal one, and so on: the incident is
 *                            ADDED to the rotation rather than replacing it (it starts on the
 *                            incident line, so the first update after it opens says so)
 * @returns { text, incident } where `incident` says the picked line is an incident line.
 */
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
 * The presence to show, or null when the feature is off.
 * @param p     cfg.presence (any shape; defaults filled)
 * @param ctx   { guilds, members, site: /bot/status answer | null, tick, t }
 * @returns { status, activities: [{ name, type, state? }] }
 */
export function presenceFor(p, { guilds = 0, members = 0, site = null, tick = 0, t = (k) => k } = {}) {
  if (!p || p.enabled !== true) return null;
  let status = STATUSES.includes(p.status) ? p.status : 'online';
  const typeKey = Object.hasOwn(TYPES, p.type) ? p.type : 'watching';
  const siteState = site?.state || 'unknown';
  const stripe = site?.stripe || null;
  const vars = {
    guilds, members,
    status: t(`pr.status.${['operational', 'partial', 'major'].includes(siteState) ? siteState : 'unknown'}`),
    stripe: stripe?.description || stripe?.state || '',
  };

  // Health first: the site being down matters more than anything the line normally says.
  const hurt = (site?.services || []).filter((s) => s.state === 'down').map((s) => s.label);
  const incident = p.health !== false && (siteState === 'partial' || siteState === 'major') && hurt.length > 0;
  const mode = INCIDENT_MODES.includes(p.incidentMode) ? p.incidentMode : 'replace';
  const incidentLines = [p.healthText || 'Incident: {services}', ...(Array.isArray(p.incidentLines) ? p.incidentLines.slice(0, MAX_INCIDENT_LINES) : [])];
  const pick = rotationLine([p.text, ...(Array.isArray(p.rotate) ? p.rotate : [])], incidentLines, { incident, mode, tick });
  let text;
  if (incident) {
    status = siteState === 'major' ? 'dnd' : 'idle';
    text = fill(pick.text, { ...vars, services: hurt.join(', ') });
  } else if (p.stripe !== false && stripe && !['operational', 'unknown'].includes(stripe.state)) {
    // Stripe degraded or in maintenance: worth saying, not worth a red dot of our own.
    if (status === 'online') status = 'idle';
    text = fill(p.stripeText || 'Stripe: {stripe}', vars);
  } else {
    text = fill(pick.text, vars);
  }

  text = clean(text).slice(0, MAX_TEXT);
  if (!text) return { status, activities: [] };
  // A custom status is the text alone ("state"); the other types read "Watching <name>".
  const activity = typeKey === 'custom' ? { name: 'Custom Status', type: TYPES.custom, state: text } : { name: text, type: TYPES[typeKey] };
  return { status, activities: [activity] };
}

// ── Discord side ──────────────────────────────────────────────────────────────────────────
let _last = null, _tick = 0, _site = null, _siteAt = 0, _timer = null;
const SITE_TTL = 2 * 60_000;

async function applyPresence(client) {
  const cfg = await config();
  const p = cfg?.presence;
  if (!p?.enabled) {
    // Turned off after having been on: put the plain dot back once, then stay out of the way.
    if (_last) { client.user?.setPresence({ status: 'online', activities: [] }); _last = null; }
    return;
  }
  if ((p.health !== false || p.stripe !== false) && Date.now() - _siteAt > SITE_TTL) {
    _siteAt = Date.now();
    _site = (await api.siteStatus()) || _site; // a failed read keeps the last answer
  }
  const members = client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0);
  const t = makeT(localeOf({}, cfg), cfg.i18n);
  const every = Math.max(30, Number(p.rotateSec) || 60);
  const next = presenceFor(p, { guilds: client.guilds.cache.size, members, site: _site, tick: Math.floor((_tick * 30) / every), t });
  _tick += 1;
  const key = JSON.stringify(next);
  if (key === _last) return;
  _last = key;
  client.user?.setPresence(next);
}

/** Start (or restart, on a reconnect) the 30-second presence loop for this client. */
export function startPresence(client) {
  if (_timer) clearInterval(_timer);
  _last = null;
  const run = () => applyPresence(client).catch((e) => console.warn('[bot] presence failed:', e?.message || e));
  run();
  _timer = setInterval(run, 30_000);
  return _timer;
}
