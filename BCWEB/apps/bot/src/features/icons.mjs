// The bot's icons as APPLICATION emojis.
//
// The site draws one PNG per icon key (apps/api/src/lib/bot-emoji.mjs); this uploads each of
// them to the application's emoji list once (names `bc_<key>`, no server needed: application
// emojis work in every guild and in DMs), re-uploads a key whose drawing changed (the version
// in the name's suffix), and hands the whole `<:name:id>` map to ui.setAutoIcons. From then
// on `ui.ic('casino')` is a real emoji and the bot never needs a unicode fallback.
//
// One flight at a time, retried at most every 10 minutes after a failure, so a slow site
// never blocks an interaction: callers fire it and go on (`void ensureAppIcons(client)`).
import { api } from '../api.mjs';
import * as ui from '../ui.mjs';

const PREFIX = 'bc_';
const RETRY_MS = 10 * 60_000;
const MAX_EMOJIS = 2000; // Discord's ceiling on application emojis

let inflight = null;
let doneAt = 0;
let failedAt = 0;

/** `bc_casino_a1b2c3d4` → { key: 'casino', version: 'a1b2c3d4' } — or null for a stranger. */
export function parseName(name) {
  const m = /^bc_([a-z0-9_]+?)_([0-9a-f]{8})$/.exec(String(name || ''));
  return m ? { key: m[1], version: m[2] } : null;
}
export const emojiName = (key, version) => `${PREFIX}${key}_${version}`;
/** The token a message uses. */
export const tokenOf = (e) => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;

/**
 * Pure planning: given the site's keys and the application's current emojis, what to upload,
 * what to delete (stale versions of our own keys), and the map of what already serves.
 */
export function plan(keys, existing) {
  const want = new Map(keys.map((k) => [k.key, k.version]));
  const have = new Map(); // key → emoji (current version)
  const stale = [];
  for (const e of existing) {
    const p = parseName(e.name);
    if (!p) continue; // somebody else's application emoji: never touched
    if (want.get(p.key) === p.version) have.set(p.key, e);
    else stale.push(e);
  }
  const upload = keys.filter((k) => !have.has(k.key));
  return { have, upload, stale };
}

export async function ensureAppIcons(client, { force = false } = {}) {
  if (inflight) return inflight;
  if (!force && (doneAt || (failedAt && Date.now() - failedAt < RETRY_MS))) return null;
  inflight = run(client).catch((e) => { failedAt = Date.now(); console.warn('[icons] sync failed:', e?.message || e); return null; }).finally(() => { inflight = null; });
  return inflight;
}

async function run(client) {
  const app = client?.application;
  if (!app?.emojis) return null;
  const keys = await api.emojiKeys();
  if (!keys.length) { failedAt = Date.now(); return null; }
  const existing = [...(await app.emojis.fetch()).values()];
  const { have, upload, stale } = plan(keys, existing);
  const map = {};
  for (const [k, e] of have) map[k] = tokenOf(e);
  // Serve what is there before uploading the rest: the first interaction after boot already
  // gets every icon that survived the previous run.
  ui.setAutoIcons(map);
  let room = MAX_EMOJIS - existing.length + stale.length;
  for (const e of stale) { try { await e.delete(); } catch { room -= 1; } }
  let uploaded = 0;
  for (const k of upload) {
    if (room <= 0) break;
    const png = await api.siteImage(`/bot/emoji/${encodeURIComponent(k.key)}.png`);
    if (!png) continue;
    try {
      const e = await app.emojis.create({ attachment: png, name: emojiName(k.key, k.version) });
      map[k.key] = tokenOf(e); uploaded += 1; room -= 1;
    } catch (err) {
      console.warn(`[icons] could not upload ${k.key}:`, err?.message || err);
    }
  }
  ui.setAutoIcons(map);
  doneAt = Date.now(); failedAt = 0;
  console.log(`[icons] ${Object.keys(map).length} icon(s) ready (${uploaded} uploaded, ${stale.length} stale removed)`);
  return map;
}

/** For tests and a bot restart: forget the "done" mark so the next call syncs again. */
export function resetIconSync() { doneAt = 0; failedAt = 0; }
