// The bot fetches its own icon set from here and uploads it as APPLICATION emojis on boot
// (features/icons.mjs in the bot), so no admin has to download a zip and paste ids: the
// buttons carry the site's icons from the first start, and a new key drawn here appears on
// Discord at the next boot. The admin's manual mapping (economy.icons) still wins per key.
//
//   GET  /bot/emoji/keys            { icons: [{ key, label, version }] }
//   GET  /bot/emoji/:key.png        the 128×128 tile, in the configured style
//   PUT  /bot/emoji/map             the owner's upload script hands back { emojis: { name: id } }
//   GET  /admin/bot/emoji-status    per icon: present / outdated / missing on Discord
//   PUT  /admin/bot/emoji-map       the same map, pasted or imported in the dashboard
//   GET  /admin/bot/emoji-icon/:key the tile for ANY key, built-in or admin-added (preview)
//   GET  /admin/bot/custom-icons    the admin-added part of the set, + what is already on the app
//   POST /admin/bot/custom-icons    add or replace one (an uploaded image, or a glyph)
//   DELETE /admin/bot/custom-icons/:key
//   POST /admin/bot/emoji-sync/check read the application's emojis ON DISCORD (bot token, REST)
//   POST /admin/bot/emoji-sync       upload one batch of the missing icons (bot token, REST)
//   GET  /admin/bot/emoji-kit.zip    the offline kit: every icon + the two fixed scripts
//   GET  /admin/bot/emoji-kit/:file  one fixed script (sync-icons.bat / sync-icons.sh / README.txt)
//
// The map (lib/app-emoji-map.mjs) is what lets the dashboard say which icons are really on
// Discord, and what lets the bot use an icon the script uploaded without waiting for its own
// next boot (it rides in /bot/config as `appIcons`, current versions only).
//
// THE SET IS NO LONGER ONLY THE SOURCE. `keysFor` below is built-ins + AdminSetting
// `bot.customIcons` (lib/bot-custom-icons.mjs), so an icon an admin adds in the dashboard is
// in the list the bot syncs and the PNG the bot downloads, with no code change and no deploy.
import { db, botAuth, requireCap, logAudit } from '../lib/lib.mjs';
import { z } from 'zod';
import { ICONS, renderEmoji, iconVersion, iconEmojiStatus, iconEmojiName } from '../lib/bot-emoji.mjs';
import { SETTING_KEY, parseEmojiMapBody, nextEmojiMap } from '../lib/app-emoji-map.mjs';
import {
  SETTING_KEY as CUSTOM_KEY, MAX_CUSTOM_ICONS, MAX_SOURCE_BYTES, DISCORD_MAX_EMOJI_BYTES,
  ICON_KEY_RE, prepareCustomIcon, readStore, storeFits, customKeys, renderCustomIcon,
} from '../lib/bot-custom-icons.mjs';
import { getBotConfig, storedToken } from './bot.mjs';
import { discordClient, scrubber, readApplication, mapFromDiscord, syncIconBatch, SYNC_BATCH_MAX } from '../lib/app-emoji-sync.mjs';
import { KIT_FILES, buildEmojiKit } from '../lib/emoji-kit.mjs';

const builtinKeys = (iconStyle) => Object.entries(ICONS).map(([key, v]) => ({ key, label: v.label, version: iconVersion(key, iconStyle) }));
/** The whole set the bot is asked to put on Discord: the source's icons, then the admin's. */
const keysFor = (iconStyle, custom = {}) => [...builtinKeys(iconStyle), ...customKeys(custom, iconStyle)];

async function setting(p, key) {
  const row = await p.adminSetting.findUnique({ where: { key } });
  return row?.value && typeof row.value === 'object' ? row.value : null;
}
const storedMap = (p) => setting(p, SETTING_KEY);
const storedCustom = async (p) => readStore(await setting(p, CUSTOM_KEY));

async function saveMap(p, body, source) {
  const parsed = parseEmojiMapBody(body);
  if (!parsed.ok) return parsed;
  const value = nextEmojiMap(await storedMap(p), parsed, source);
  await p.adminSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
  return { ok: true, value };
}

function statusView(cfg, map, custom = {}) {
  const style = cfg.economy?.iconStyle || {};
  const overrides = cfg.economy?.icons && typeof cfg.economy.icons === 'object' ? cfg.economy.icons : {};
  const keys = keysFor(style, custom);
  const labels = Object.fromEntries(keys.map((k) => [k.key, k.label]));
  const isCustom = new Set(Object.keys(custom));
  const icons = iconEmojiStatus(keys, map?.emojis || {}).map((s) => ({
    ...s,
    label: labels[s.key],
    custom: isCustom.has(s.key),
    override: typeof overrides[s.key] === 'string' && overrides[s.key].trim() ? overrides[s.key].trim() : null,
  }));
  const counts = { present: 0, outdated: 0, missing: 0 };
  for (const s of icons) counts[s.status] += 1;
  // Keys the admin mapped by hand that are in neither part of the set: an existing Discord
  // emoji borrowed for a {ic:key} token of their own.
  const known = new Set(keys.map((k) => k.key));
  const manual = Object.entries(overrides).filter(([k, v]) => !known.has(k) && typeof v === 'string' && v.trim()).map(([key, token]) => ({ key, token: token.trim() }));
  return {
    icons, counts, custom: manual, customCount: isCustom.size, maxCustom: MAX_CUSTOM_ICONS,
    // What the application already carries that is NOT one of ours: the emojis an admin can
    // borrow for a key of their own without typing a snowflake by hand.
    available: foreignEmojis(map),
    total: Object.keys(map?.emojis || {}).length, appId: map?.appId || null, updatedAt: map?.updatedAt || null, source: map?.source || null,
  };
}

/** Application emojis already uploaded that are NOT ours, for the "pick one the bot has" list. */
function foreignEmojis(map) {
  const anim = new Set(map?.animated || []);
  return Object.entries(map?.emojis || {})
    .filter(([name]) => !/^bc_[a-z0-9_]+?_[0-9a-f]{8}$/.test(name))
    .slice(0, 400)
    .map(([name, id]) => ({ name, id, animated: anim.has(name), token: `<${anim.has(name) ? 'a' : ''}:${name}:${id}>` }));
}

export default async function botEmojiRoutes(app) {
  app.get('/bot/emoji/keys', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const cfg = await getBotConfig(p);
    return { icons: keysFor(cfg.economy?.iconStyle || {}, await storedCustom(p)) };
  });

  app.get('/bot/emoji/:key', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const key = String(req.params.key || '').replace(/\.png$/i, '');
    const p = await db();
    const cfg = await getBotConfig(p);
    const png = await iconPng(p, cfg, key);
    if (png === 404) return reply.code(404).send({ error: 'not_found' });
    if (!png) return reply.code(500).send({ error: 'render_failed' });
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=300').send(png);
  });

  // The owner's script, authenticated with the bot's shared secret (the credential it already
  // has on the bot's host). It sends the WHOLE list it just read from Discord: mode replace.
  app.put('/bot/emoji/map', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const r = await saveMap(p, req.body, 'script');
    if (!r.ok) return reply.code(400).send({ error: r.error, issues: r.issues });
    const view = statusView(await getBotConfig(p), r.value, await storedCustom(p));
    return { ok: true, total: view.total, counts: view.counts };
  });

  app.get('/admin/bot/emoji-status', { preHandler: requireCap('manage_bot') }, async () => {
    const p = await db();
    // canUpload: whether the site holds a token to upload with. A boolean, never the token.
    // botOnline: whether the bot heartbeats. Both together say WHICH process lacks the token:
    // under Docker the bot service gets DISCORD_TOKEN from compose and the api service does not
    // unless it is added there, so "the bot runs and the site says no token" is the usual case,
    // and the dashboard needs to say it is the API that is missing it, not the bot.
    const beat = (await p.adminSetting.findUnique({ where: { key: 'bot.status' } }))?.value || null;
    const botOnline = !!beat?.at && beat.online !== false && (Date.now() - new Date(beat.at).getTime()) < 120_000;
    return { ...statusView(await getBotConfig(p), await storedMap(p), await storedCustom(p)), canUpload: !!(await storedToken(p)), botOnline, batchMax: SYNC_BATCH_MAX };
  });

  app.put('/admin/bot/emoji-map', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const p = await db();
    const r = await saveMap(p, req.body, 'dashboard');
    if (!r.ok) return reply.code(400).send({ error: r.error, issues: r.issues });
    await logAudit(p, req.user.uid, 'bot.emoji_map', `${Object.keys(r.value.emojis).length} emoji(s), ${req.body?.mode === 'merge' ? 'merge' : 'replace'}`);
    return { ok: true, ...statusView(await getBotConfig(p), r.value, await storedCustom(p)) };
  });

  // ── Icons an admin adds ───────────────────────────────────────────────────────────────
  // The preview the dashboard draws. /admin/bot/emoji/:key (routes/bot.mjs) only knows the
  // built-in registry, so an admin-added key would 404 there and the card would show a broken
  // tile for the icon that was just added — this one answers for both halves of the set.
  app.get('/admin/bot/emoji-icon/:key', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const key = String(req.params.key || '').replace(/\.png$/i, '');
    const p = await db();
    const png = await iconPng(p, await getBotConfig(p), key);
    if (png === 404) return reply.code(404).send({ error: 'not_found' });
    if (!png) return reply.code(500).send({ error: 'render_failed' });
    // no-store: the tile changes the moment the icon is edited, and a cached one reads as a
    // save that did not take.
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store').send(png);
  });

  app.get('/admin/bot/custom-icons', { preHandler: requireCap('manage_bot') }, async () => {
    const p = await db();
    const custom = await storedCustom(p);
    const cfg = await getBotConfig(p);
    const style = cfg.economy?.iconStyle || {};
    const map = await storedMap(p);
    return {
      icons: customKeys(custom, style).map((k) => {
        const d = custom[k.key];
        return { ...k, source: d.source, icon: d.icon || null, color: d.color || null, bytes: d.bytes || 0, addedAt: d.addedAt || null };
      }),
      max: MAX_CUSTOM_ICONS,
      maxImageKiB: Math.round(MAX_SOURCE_BYTES / 1024),
      maxEmojiKiB: Math.round(DISCORD_MAX_EMOJI_BYTES / 1024),
      available: foreignEmojis(map),
    };
  });

  // 4 MB rather than the server default: the body carries one image as a data URL, and base64
  // is a third larger than the bytes it encodes. The real ceiling is MAX_SOURCE_BYTES, checked
  // on the string before it is decoded.
  app.post('/admin/bot/custom-icons', { preHandler: requireCap('manage_bot'), bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const p = await db();
    const existing = await storedCustom(p);
    const r = await prepareCustomIcon(req.body, { existing });
    if (!r.ok) return reply.code(r.error === 'too_many' ? 409 : 400).send({ error: r.error, issues: r.issues });
    const icons = { ...existing, [r.icon.key]: r.icon };
    const fit = storeFits(icons);
    if (!fit.ok) return reply.code(409).send({ error: 'too_big', issues: [`the whole icon set would be ${Math.round(fit.bytes / 1024)} KiB, which is over the limit`] });
    const value = { icons, updatedAt: new Date().toISOString() };
    await p.adminSetting.upsert({ where: { key: CUSTOM_KEY }, create: { key: CUSTOM_KEY, value }, update: { value } });
    await logAudit(p, req.user.uid, 'bot.custom_icon', `${existing[r.icon.key] ? 'replaced' : 'added'} ${r.icon.key} (${r.icon.source})`);
    const cfg = await getBotConfig(p);
    return { ok: true, key: r.icon.key, version: customKeys({ [r.icon.key]: r.icon }, cfg.economy?.iconStyle || {})[0].version, count: Object.keys(icons).length };
  });

  app.delete('/admin/bot/custom-icons/:key', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const key = String(req.params.key || '');
    if (!ICON_KEY_RE.test(key)) return reply.code(400).send({ error: 'invalid_icon' });
    const p = await db();
    const existing = await storedCustom(p);
    if (!existing[key]) return reply.code(404).send({ error: 'not_found' });
    const icons = { ...existing };
    delete icons[key];
    const value = { icons, updatedAt: new Date().toISOString() };
    await p.adminSetting.upsert({ where: { key: CUSTOM_KEY }, create: { key: CUSTOM_KEY, value }, update: { value } });
    await logAudit(p, req.user.uid, 'bot.custom_icon', `removed ${key}`);
    // Said plainly rather than implied: removing it here stops the site OFFERING it. The
    // emoji already uploaded stays on the application until the sync script runs with --prune.
    return { ok: true, count: Object.keys(icons).length, stillOnDiscord: true };
  });

  // ── Putting the set on Discord from the site ──────────────────────────────────────────
  // Discord's REST API with the token the site already stores (lib/app-emoji-sync.mjs): no
  // gateway connection, nothing to run on the owner's PC. The dashboard drives it in batches.
  // One sync at a time per process: two tabs clicking at once would read the same "missing"
  // list and race each other into Discord's duplicate-name refusal.
  app.post('/admin/bot/emoji-sync/check', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const p = await db();
    const token = await storedToken(p);
    if (!token) return reply.code(409).send({ error: 'no_token' });
    const call = discordClient({ token });
    let appId, items;
    try { ({ appId, items } = await readApplication(call)); } catch (e) { return discordFailure(reply, e, token); }
    const value = await saveDiscordList(p, appId, items);
    return { ok: true, ...statusView(await getBotConfig(p), value, await storedCustom(p)), canUpload: true, batchMax: SYNC_BATCH_MAX };
  });

  const SYNC_BODY = z.object({ keys: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).max(200).optional() }).strip();
  app.post('/admin/bot/emoji-sync', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const body = SYNC_BODY.safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    if (syncing) return reply.code(409).send({ error: 'sync_busy' });
    const p = await db();
    const token = await storedToken(p);
    if (!token) return reply.code(409).send({ error: 'no_token' });
    syncing = true;
    try {
      const cfg = await getBotConfig(p);
      const custom = await storedCustom(p);
      const keys = keysFor(cfg.economy?.iconStyle || {}, custom);
      const known = new Set(keys.map((k) => k.key));
      const wanted = body.data.keys ? body.data.keys.filter((k) => known.has(k)) : null;
      let batch;
      try {
        batch = await syncIconBatch({
          call: discordClient({ token }), keys, wanted, scrub: scrubber(token),
          renderPng: async (key) => { const png = await iconPng(p, cfg, key); return png === 404 ? null : png; },
        });
      } catch (e) { return discordFailure(reply, e, token); }
      const value = await saveDiscordList(p, batch.appId, batch.items);
      const uploaded = batch.results.filter((r) => r.status === 'uploaded').length;
      const failed = batch.results.filter((r) => r.status === 'failed').length;
      if (uploaded || failed) await logAudit(p, req.user.uid, 'bot.emoji_sync', `${uploaded} uploaded, ${failed} failed`);
      const view = statusView(cfg, value, custom);
      return { ok: true, results: batch.results, pending: batch.results.filter((r) => r.status === 'pending').map((r) => r.key), ...view, canUpload: true, batchMax: SYNC_BATCH_MAX };
    } finally { syncing = false; }
  });

  // The offline kit. The scripts in it are FIXED FILES (lib/emoji-kit.mjs says why); the icons
  // are the only part drawn from the site's data, and they are PNGs, not code.
  app.get('/admin/bot/emoji-kit.zip', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const p = await db();
    const cfg = await getBotConfig(p);
    const keys = keysFor(cfg.economy?.iconStyle || {}, await storedCustom(p));
    const icons = keys.map((k) => ({ key: k.key, want: iconEmojiName(k.key, k.version) }));
    const { zip } = await buildEmojiKit(icons, async (key) => { const png = await iconPng(p, cfg, key); return png === 404 ? null : png; });
    return reply.header('Content-Type', 'application/zip').header('Content-Disposition', 'attachment; filename="bettercommunity-icons.zip"').header('Cache-Control', 'no-store').send(zip);
  });

  app.get('/admin/bot/emoji-kit/:file', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const f = Object.hasOwn(KIT_FILES, req.params.file) ? KIT_FILES[req.params.file] : null;
    if (!f) return reply.code(404).send({ error: 'not_found' });
    return reply.header('Content-Type', f.type).header('Content-Disposition', `attachment; filename="${req.params.file}"`).header('X-Content-Type-Options', 'nosniff').send(f.body);
  });
}

let syncing = false;

/** Discord's list, after a read or an upload, becomes the stored map (source: the site). */
async function saveDiscordList(p, appId, items) {
  const m = mapFromDiscord(items);
  const r = await saveMap(p, { emojis: m.emojis, animated: m.animated, appId, mode: 'replace' }, 'site');
  return r.ok ? r.value : await storedMap(p);
}

/** A Discord failure as an answer the dashboard can word. The message is scrubbed of the token. */
function discordFailure(reply, e, token) {
  const msg = scrubber(token)(e?.message || 'failed');
  if (e?.code === 'bad_token') return reply.code(400).send({ error: 'bad_token', message: msg });
  if (e?.code === 'forbidden') return reply.code(400).send({ error: 'discord_forbidden', message: msg });
  if (e?.code === 'network') return reply.code(502).send({ error: 'discord_unreachable', message: msg });
  if (e?.code === 'rate_limited') return reply.code(503).send({ error: 'discord_rate_limited', message: msg });
  return reply.code(502).send({ error: 'discord_error', message: msg });
}

/** One key's PNG, whichever half of the set it belongs to. `404` when it is in neither. */
async function iconPng(p, cfg, key) {
  const style = cfg.economy?.iconStyle || {};
  if (ICONS[key]) return (await renderEmoji(key, style)) || null;
  const custom = await storedCustom(p);
  if (!custom[key]) return 404;
  return (await renderCustomIcon({ ...custom[key], key }, style)) || null;
}
