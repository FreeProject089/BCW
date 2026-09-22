#!/usr/bin/env node
// Upload the bot's whole icon set as APPLICATION emojis, then tell the site what is there.
//
// Run by the OWNER, on a machine that has the bot token. Never by the site, never by CI:
//
//   cd apps/bot
//   node scripts/sync-app-emojis.mjs                 # dry run: prints what it would do, writes nothing
//   node scripts/sync-app-emojis.mjs --apply         # uploads what is missing, writes app-emojis.json,
//                                                    # and sends the map to the site
//
// Environment (the bot's own variables, read from the environment only):
//   DISCORD_TOKEN       the bot token. Used in the Authorization header and nowhere else: it is
//                       never printed, and every line this script prints is scrubbed of it.
//   BCWEB_API_URL       the API (default http://localhost:3000; in the compose network
//                       http://api:3000). The icons are drawn there.
//   BOT_SHARED_SECRET   the bot's shared secret, to read the icon list and to send the map.
//
// Options:
//   --apply        actually upload, write the map file and send it (default: dry run)
//   --prune        with --apply, also delete OUR stale emojis (bc_<key>_<old version>)
//   --no-push      with --apply, write the map file but do not send it to the site
//   --out <file>   where the map is written (default ./app-emojis.json); the dashboard can
//                  import this file (Admin -> Discord bot -> Economy -> Icons on Discord)
//   --api <url>    overrides BCWEB_API_URL
//   --only a,b     limit the upload to these icon keys
//
// Idempotent: an icon already on Discord at its current version (the name carries the version,
// bc_<key>_<version>) is skipped, so a second run uploads nothing. Rate-limit aware: it waits
// out Discord's 429s and its per-route bucket instead of failing half-way. Exit code 0 = done,
// 1 = could not start, 2 = finished with some uploads refused.
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DISCORD = 'https://discord.com/api/v10';
const NAME_RE = /^[a-z0-9_]+$/;
const MAX_EMOJIS = 2000;

// The naming rule of apps/bot/src/features/icons.mjs (parseName / emojiName) and of the API's
// lib/bot-emoji.mjs. Written here rather than imported so this script loads without discord.js.
export const emojiName = (key, version) => `bc_${key}_${version}`;
export function parseName(name) {
  const m = /^bc_([a-z0-9_]+?)_([0-9a-f]{8})$/.exec(String(name || ''));
  return m ? { key: m[1], version: m[2] } : null;
}

export function parseArgs(argv) {
  const o = { apply: false, prune: false, push: true, out: 'app-emojis.json', api: null, only: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--prune') o.prune = true;
    else if (a === '--no-push') o.push = false;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--api') o.api = argv[++i];
    else if (a === '--only') o.only = String(argv[++i] || '').split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown option ${a} (see --help)`);
  }
  return o;
}

/** What to upload, what is already there, what is ours and stale. Pure. */
export function planSync(keys, existing, only = null) {
  const want = new Map(keys.map((k) => [k.key, k.version]));
  const present = [], stale = [];
  const have = new Set();
  for (const e of existing) {
    const p = parseName(e.name);
    if (!p) continue; // not one of ours: never touched
    if (want.get(p.key) === p.version) { present.push(e); have.add(p.key); } else stale.push(e);
  }
  const upload = keys.filter((k) => !have.has(k.key) && (!only || only.includes(k.key)));
  return { present, stale, upload };
}

/** How long to wait after a Discord answer, in ms (0 = go on). Pure. */
export function waitFor(status, headers, body) {
  const h = (k) => (headers && typeof headers.get === 'function' ? headers.get(k) : null);
  if (status === 429) {
    const s = Number(body?.retry_after ?? h('retry-after'));
    return Math.ceil((Number.isFinite(s) && s > 0 ? s : 1) * 1000) + 250;
  }
  if (h('x-ratelimit-remaining') === '0') {
    const s = Number(h('x-ratelimit-reset-after'));
    return Number.isFinite(s) && s > 0 ? Math.ceil(s * 1000) + 100 : 1000;
  }
  return 0;
}

/**
 * The whole run, with every side effect injected so a test can drive it without a network:
 * `fetch`, `log`, `sleep`, `writeFile`. Returns the exit code.
 */
export async function run({ argv = [], env = {}, fetch = globalThis.fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), writeFile = fsWriteFile } = {}) {
  const token = String(env.DISCORD_TOKEN || '').trim();
  // Every printed line goes through this. The token is only ever put in a header, but an
  // error message is text from elsewhere, and "never log the token" should not rest on that.
  const scrub = (s) => { let x = String(s); if (token) x = x.split(token).join('[token]'); return x; };
  const say = (...a) => log(scrub(a.join(' ')));
  let o;
  try { o = parseArgs(argv); } catch (e) { say(`error: ${e.message}`); return 1; }
  if (o.help) { say('usage: node scripts/sync-app-emojis.mjs [--apply] [--prune] [--no-push] [--out file] [--api url] [--only key,key]'); return 0; }
  if (!token) { say('error: DISCORD_TOKEN is not set. Export it in this shell (it is read from the environment only).'); return 1; }
  const api = String(o.api || env.BCWEB_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const secret = env.BOT_SHARED_SECRET || env.LINK_LOOKUP_SECRET || '';
  if (!secret) say('warning: BOT_SHARED_SECRET is not set; trying the development secret.');
  const siteHeaders = { 'x-bot-secret': secret || 'dev-bot-secret' };

  // Discord, with its rate limits waited out rather than failed on.
  const discord = async (method, path, body) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await fetch(DISCORD + path, {
        method,
        headers: { authorization: `Bot ${token}`, 'user-agent': 'BetterCommunity-emoji-sync (https://bettercommunity.ch, 1.0)', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
      const wait = waitFor(res.status, res.headers, data);
      if (res.status === 429) { say(`  rate limited, waiting ${Math.round(wait / 100) / 10}s`); await sleep(wait); continue; }
      if (res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
      if (wait) await sleep(wait);
      if (!res.ok) {
        const e = new Error(`Discord ${method} ${path.replace(/\d{17,20}/g, '<id>')} -> ${res.status}${data?.message ? `: ${data.message}` : ''}${data?.errors ? ` ${JSON.stringify(data.errors).slice(0, 300)}` : ''}`);
        e.status = res.status;
        throw e;
      }
      return data;
    }
    throw new Error(`Discord ${method} ${path}: still rate limited after 6 attempts`);
  };
  const site = async (method, path, body) => {
    const res = await fetch(api + path, { method, headers: { ...siteHeaders, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      let d = null; try { d = await res.json(); } catch { /* not JSON */ }
      throw new Error(`site ${method} ${path} -> ${res.status}${d?.error ? ` ${d.error}` : ''}${d?.issues ? ` ${d.issues.join('; ')}` : ''}`);
    }
    return res.headers.get('content-type')?.includes('application/json') ? res.json() : Buffer.from(await res.arrayBuffer());
  };

  say(o.apply ? 'Mode: APPLY (uploads to Discord, writes the map).' : 'Mode: dry run. Nothing is uploaded, deleted or written. Add --apply to do it.');
  let keys, appId, existing;
  try {
    keys = (await site('GET', '/bot/emoji/keys')).icons || [];
    if (!keys.length) { say(`error: the site at ${api} returned no icon keys.`); return 1; }
    appId = (await discord('GET', '/applications/@me'))?.id;
    if (!appId) { say('error: Discord did not say which application this token belongs to.'); return 1; }
    existing = (await discord('GET', `/applications/${appId}/emojis`))?.items || [];
  } catch (e) { say(`error: ${e.message}`); return 1; }

  const { present, stale, upload } = planSync(keys, existing, o.only);
  say(`Site: ${keys.length} icons. Discord: ${existing.length} application emoji(s), ${present.length} of ours current, ${stale.length} of ours stale.`);
  say(`To upload: ${upload.length}${upload.length ? ` (${upload.map((k) => k.key).join(', ')})` : ''}`);
  if (stale.length) say(`Stale (${o.prune ? 'will be deleted' : 'kept; --prune deletes them'}): ${stale.map((e) => e.name).join(', ')}`);
  let room = MAX_EMOJIS - existing.length + (o.prune ? stale.length : 0);
  if (upload.length > room) say(`warning: only room for ${Math.max(0, room)} more emoji(s) on this application (Discord allows ${MAX_EMOJIS}).`);

  const created = [];
  let refused = 0;
  const deleted = new Set();
  if (o.apply) {
    if (o.prune) {
      for (const e of stale) {
        try { await discord('DELETE', `/applications/${appId}/emojis/${e.id}`); deleted.add(e.id); say(`  deleted ${e.name}`); } catch (err) { say(`  could not delete ${e.name}: ${err.message}`); }
      }
    }
    for (const k of upload) {
      if (room <= 0) { say(`  skipped ${k.key}: no room left`); refused += 1; continue; }
      try {
        const png = await site('GET', `/bot/emoji/${encodeURIComponent(k.key)}.png`);
        const e = await discord('POST', `/applications/${appId}/emojis`, { name: emojiName(k.key, k.version), image: `data:image/png;base64,${Buffer.from(png).toString('base64')}` });
        created.push(e); room -= 1;
        say(`  uploaded ${e.name} (${e.id})`);
      } catch (err) { refused += 1; say(`  could not upload ${k.key}: ${err.message}`); }
    }
  } else {
    for (const k of upload) say(`  would upload ${emojiName(k.key, k.version)}`);
  }

  // The map: every application emoji the site can accept, after this run.
  const after = [...existing.filter((e) => !deleted.has(e.id)), ...created];
  const emojis = {}, animated = [];
  let skipped = 0;
  for (const e of after) {
    if (!NAME_RE.test(e.name || '') || !/^\d{17,20}$/.test(String(e.id || ''))) { skipped += 1; continue; }
    emojis[e.name] = String(e.id);
    if (e.animated) animated.push(e.name);
  }
  const map = { appId: String(appId), generatedAt: new Date().toISOString(), emojis, animated };
  if (skipped) say(`${skipped} application emoji(s) left out of the map: their names are not lower-case letters, digits and _.`);

  if (!o.apply) {
    say(`Would write ${o.out} with ${Object.keys(emojis).length} emoji(s)${o.push ? ' and send it to the site' : ''}.`);
    return 0;
  }
  try { await writeFile(o.out, `${JSON.stringify(map, null, 2)}\n`); say(`Wrote ${o.out} (${Object.keys(emojis).length} emoji(s)).`); } catch (e) { say(`could not write ${o.out}: ${e.message}`); }
  if (o.push) {
    try {
      const r = await site('PUT', '/bot/emoji/map', { emojis, animated, appId: String(appId), mode: 'replace' });
      say(`Sent to the site: ${r?.counts ? `${r.counts.present} present, ${r.counts.outdated} outdated, ${r.counts.missing} missing` : 'ok'}.`);
    } catch (e) { say(`could not send the map to the site (${e.message}). Import ${o.out} from the dashboard instead.`); }
  }
  say(refused ? `Done, ${refused} upload(s) refused.` : 'Done.');
  return refused ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ argv: process.argv.slice(2), env: process.env }).then((code) => { process.exitCode = code; }, (e) => { console.error('error:', String(e?.message || e).split(String(process.env.DISCORD_TOKEN || ' ')).join('[token]')); process.exitCode = 1; });
}
