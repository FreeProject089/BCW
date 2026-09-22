// The bot's Discord status (presence): the coloured dot and the activity line under its name.
//
// It showed nothing at all — no activity, the default online dot — and nothing configured it.
// Now it is `presence` in the bot config, edited from Admin → Discord bot (see the API's
// DEFAULT_BOT_CONFIG for the shape), picked up within 30 s like everything else:
//   status / type / text  → the dot and the line ("Watching 12 servers"), with {guilds}
//                           {members} {status} {stripe}; `rotate` adds lines shown in turn.
//   health                → while the site's status page is not all green, the line says what
//                           is affected and the dot turns idle (partial) or dnd (major).
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

const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));

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

  const lines = [p.text, ...(Array.isArray(p.rotate) ? p.rotate : [])].map((x) => String(x || '').trim()).filter(Boolean);
  let text = lines.length ? lines[Math.abs(Math.floor(tick)) % lines.length] : '';

  // Health first: the site being down matters more than anything the line normally says.
  const hurt = (site?.services || []).filter((s) => s.state === 'down').map((s) => s.label);
  if (p.health !== false && (siteState === 'partial' || siteState === 'major') && hurt.length) {
    status = siteState === 'major' ? 'dnd' : 'idle';
    text = fill(p.healthText || 'Incident: {services}', { ...vars, services: hurt.join(', ') });
  } else if (p.stripe !== false && stripe && !['operational', 'unknown'].includes(stripe.state)) {
    // Stripe degraded or in maintenance: worth saying, not worth a red dot of our own.
    if (status === 'online') status = 'idle';
    text = fill(p.stripeText || 'Stripe: {stripe}', vars);
  } else {
    text = fill(text, vars);
  }

  text = text.slice(0, MAX_TEXT);
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
