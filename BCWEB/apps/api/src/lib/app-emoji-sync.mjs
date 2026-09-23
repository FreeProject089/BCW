// Put the bot's icon set on Discord FROM THE SITE: application emojis over Discord's REST API,
// with the bot token the site already stores (AdminSetting `bot.token`, or env DISCORD_TOKEN).
//
// Why this exists: the only ways to get the icons onto the application were the bot's own
// boot-time sync and apps/bot/scripts/sync-app-emojis.mjs, run by the owner on a machine that
// has the repository, Node and three environment variables. The owner asked for everything
// to be doable from the site. This is a REST call (GET/POST /applications/{id}/emojis), not a
// gateway connection: nothing here logs the bot in or competes with the running bot.
//
// The shape is a BATCH, driven by the dashboard. One request reads Discord's list, uploads at
// most `max` of the icons it was asked for that are not already there, and returns a result per
// icon. The page calls it again for the next batch, which is how it shows progress and how a
// stop button stops. Nothing is held open for minutes, no job state lives in one process, and
// every batch re-reads Discord first, so it is idempotent by construction: an icon already
// present BY NAME (bc_<key>_<version>) is skipped, never uploaded twice, whoever put it there.
//
// The token goes into one header and nowhere else. Every string that leaves this module is
// passed through `scrub`, because an error message is text from elsewhere and "never echo the
// token" should not rest on Discord never quoting a header back.
import { parseIconEmojiName, iconEmojiName } from './bot-emoji.mjs';

export const DISCORD_API = 'https://discord.com/api/v10';
export const MAX_APP_EMOJIS = 2000;
/** Uploads per request. Small on purpose: progress stays live and a request stays short. */
export const SYNC_BATCH_MAX = 5;
const NAME_RE = /^[a-z0-9_]{2,32}$/;
const SNOWFLAKE_RE = /^\d{17,20}$/;
const UA = 'DiscordBot (https://bettercommunity.ch, 1.0) BetterCommunity-site-emoji-sync';

export function scrubber(token) {
  const t = String(token || '');
  return (s) => {
    let x = String(s ?? '');
    if (t.length >= 8) x = x.split(t).join('[token]');
    return x.replace(/\d{17,20}/g, '<id>');
  };
}

/** How long to wait after a Discord answer, in ms (0 = go on). Pure. */
export function discordWait(status, headers, body) {
  const h = (k) => (headers && typeof headers.get === 'function' ? headers.get(k) : null);
  if (status === 429) {
    const s = Number(body?.retry_after ?? h('retry-after'));
    return Math.min(60_000, Math.ceil((Number.isFinite(s) && s > 0 ? s : 1) * 1000) + 250);
  }
  if (h('x-ratelimit-remaining') === '0') {
    const s = Number(h('x-ratelimit-reset-after'));
    return Number.isFinite(s) && s > 0 ? Math.min(60_000, Math.ceil(s * 1000) + 100) : 1000;
  }
  return 0;
}

/**
 * A tiny Discord REST client: rate limits waited out, 5xx retried, errors scrubbed.
 * `fetch` and `sleep` are injected so the tests never reach Discord.
 */
export function discordClient({ token, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const scrub = scrubber(token);
  return async function call(method, path, body) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let res;
      try {
        res = await fetch(DISCORD_API + path, {
          method,
          headers: { authorization: `Bot ${token}`, 'user-agent': UA, ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        const err = new Error(scrub(`could not reach Discord (${e?.message || e})`));
        err.code = 'network';
        throw err;
      }
      let data = null;
      if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
      const wait = discordWait(res.status, res.headers, data);
      if (res.status === 429) { await sleep(wait); continue; }
      if (res.status >= 500) { await sleep(500 * (attempt + 1)); continue; }
      if (!res.ok) {
        const err = new Error(scrub(`Discord answered ${res.status}${data?.message ? `: ${data.message}` : ''}${data?.errors ? ` ${JSON.stringify(data.errors).slice(0, 200)}` : ''}`));
        err.status = res.status;
        err.code = res.status === 401 ? 'bad_token' : res.status === 403 ? 'forbidden' : 'discord_error';
        throw err;
      }
      if (wait) await sleep(wait);
      return data;
    }
    const err = new Error('Discord is still rate limiting after 5 attempts');
    err.code = 'rate_limited';
    throw err;
  };
}

/**
 * Per icon, against the list Discord really has: `present` (the current drawing is there),
 * `mismatched` (only an older drawing of that key is there), `missing`. Pure.
 * `keys` = [{ key, version, label? }], `existing` = Discord's items [{ id, name, animated }].
 */
export function planIconSync(keys, existing = []) {
  const byKey = new Map();
  for (const e of existing || []) {
    const p = parseIconEmojiName(e?.name);
    if (!p) continue; // not one of ours: never touched
    if (!byKey.has(p.key)) byKey.set(p.key, []);
    byKey.get(p.key).push({ id: String(e.id), name: e.name, version: p.version });
  }
  return keys.map(({ key, version, label }) => {
    const have = byKey.get(key) || [];
    const cur = have.find((e) => e.version === version);
    const old = have.filter((e) => e.version !== version);
    return {
      key, label: label || key, version, want: iconEmojiName(key, version),
      status: cur ? 'present' : old.length ? 'mismatched' : 'missing',
      emoji: cur ? { id: cur.id, name: cur.name } : null,
      older: old.map((e) => e.name),
    };
  });
}

/** Discord's list as the `{ emojis, animated }` body lib/app-emoji-map.mjs accepts. Pure. */
export function mapFromDiscord(items = []) {
  const emojis = {}, animated = [];
  let skipped = 0;
  for (const e of items || []) {
    const name = String(e?.name || ''), id = String(e?.id || '');
    if (!NAME_RE.test(name) || !SNOWFLAKE_RE.test(id)) { skipped += 1; continue; }
    emojis[name] = id;
    if (e.animated) animated.push(name);
  }
  return { emojis, animated, skipped };
}

/** The application this token belongs to, and its emoji list. */
export async function readApplication(call) {
  const app = await call('GET', '/applications/@me');
  const appId = String(app?.id || '');
  if (!SNOWFLAKE_RE.test(appId)) { const e = new Error('Discord did not say which application this token belongs to'); e.code = 'no_app'; throw e; }
  const list = await call('GET', `/applications/${appId}/emojis`);
  return { appId, items: Array.isArray(list?.items) ? list.items : [] };
}

/**
 * One batch. Reads Discord, uploads up to `max` of `wanted` (keys) that are not present at
 * their current drawing, and returns what happened to each, plus Discord's list afterwards.
 * `renderPng(key)` gives the 128x128 PNG. An icon already there is `skipped`, never re-sent.
 */
export async function syncIconBatch({ call, keys, wanted = null, max = SYNC_BATCH_MAX, renderPng, scrub = (s) => s }) {
  const { appId, items } = await readApplication(call);
  const plan = planIconSync(keys, items);
  const want = wanted ? new Set(wanted) : null;
  const todo = plan.filter((s) => !want || want.has(s.key));
  const results = [];
  const created = [];
  let room = MAX_APP_EMOJIS - items.length;
  let uploads = 0;
  for (const s of todo) {
    if (s.status === 'present') { results.push({ key: s.key, status: 'skipped', name: s.emoji.name }); continue; }
    if (uploads >= max) { results.push({ key: s.key, status: 'pending' }); continue; }
    if (room <= 0) { results.push({ key: s.key, status: 'failed', error: `the application already has ${MAX_APP_EMOJIS} emojis` }); continue; }
    uploads += 1;
    try {
      const png = await renderPng(s.key);
      if (!png || !png.length) throw new Error('the icon could not be drawn');
      const e = await call('POST', `/applications/${appId}/emojis`, { name: s.want, image: `data:image/png;base64,${Buffer.from(png).toString('base64')}` });
      created.push(e);
      room -= 1;
      results.push({ key: s.key, status: 'uploaded', name: e?.name || s.want });
    } catch (err) {
      // A 401 means every other upload fails the same way: stop, and say so once.
      if (err?.code === 'bad_token') throw err;
      results.push({ key: s.key, status: 'failed', error: scrub(err?.message || 'failed') });
    }
  }
  return { appId, items: [...items, ...created.filter(Boolean)], results };
}
