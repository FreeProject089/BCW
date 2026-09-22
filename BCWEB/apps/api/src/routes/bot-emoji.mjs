// The bot fetches its own icon set from here and uploads it as APPLICATION emojis on boot
// (features/icons.mjs in the bot), so no admin has to download a zip and paste ids: the
// buttons carry the site's icons from the first start, and a new key drawn here appears on
// Discord at the next boot. The admin's manual mapping (economy.icons) still wins per key.
//
//   GET /bot/emoji/keys           { icons: [{ key, label, version }] }
//   GET /bot/emoji/:key.png       the 128×128 tile, in the configured style
//   PUT /bot/emoji/map            the owner's upload script hands back { emojis: { name: id } }
//   GET /admin/bot/emoji-status   per icon: present / outdated / missing on Discord
//   PUT /admin/bot/emoji-map      the same map, pasted or imported in the dashboard
//
// The map (lib/app-emoji-map.mjs) is what lets the dashboard say which icons are really on
// Discord, and what lets the bot use an icon the script uploaded without waiting for its own
// next boot (it rides in /bot/config as `appIcons`, current versions only).
import { db, botAuth, requireCap, logAudit } from '../lib/lib.mjs';
import { ICONS, renderEmoji, iconVersion, iconEmojiStatus } from '../lib/bot-emoji.mjs';
import { SETTING_KEY, parseEmojiMapBody, nextEmojiMap } from '../lib/app-emoji-map.mjs';
import { getBotConfig } from './bot.mjs';

const keysFor = (iconStyle) => Object.entries(ICONS).map(([key, v]) => ({ key, label: v.label, version: iconVersion(key, iconStyle) }));

async function storedMap(p) {
  const row = await p.adminSetting.findUnique({ where: { key: SETTING_KEY } });
  return row?.value && typeof row.value === 'object' ? row.value : null;
}

async function saveMap(p, body, source) {
  const parsed = parseEmojiMapBody(body);
  if (!parsed.ok) return parsed;
  const value = nextEmojiMap(await storedMap(p), parsed, source);
  await p.adminSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
  return { ok: true, value };
}

function statusView(cfg, map) {
  const style = cfg.economy?.iconStyle || {};
  const overrides = cfg.economy?.icons && typeof cfg.economy.icons === 'object' ? cfg.economy.icons : {};
  const keys = keysFor(style);
  const labels = Object.fromEntries(keys.map((k) => [k.key, k.label]));
  const icons = iconEmojiStatus(keys, map?.emojis || {}).map((s) => ({ ...s, label: labels[s.key], override: typeof overrides[s.key] === 'string' && overrides[s.key].trim() ? overrides[s.key].trim() : null }));
  const counts = { present: 0, outdated: 0, missing: 0 };
  for (const s of icons) counts[s.status] += 1;
  // Keys the admin mapped by hand that are not in the icon set: custom emojis added for
  // {ic:key} tokens of their own.
  const custom = Object.entries(overrides).filter(([k, v]) => !ICONS[k] && typeof v === 'string' && v.trim()).map(([key, token]) => ({ key, token: token.trim() }));
  return { icons, counts, custom, total: Object.keys(map?.emojis || {}).length, appId: map?.appId || null, updatedAt: map?.updatedAt || null, source: map?.source || null };
}

export default async function botEmojiRoutes(app) {
  app.get('/bot/emoji/keys', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const cfg = await getBotConfig(await db());
    return { icons: keysFor(cfg.economy?.iconStyle || {}) };
  });

  app.get('/bot/emoji/:key', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const key = String(req.params.key || '').replace(/\.png$/i, '');
    if (!ICONS[key]) return reply.code(404).send({ error: 'not_found' });
    const cfg = await getBotConfig(await db());
    const png = await renderEmoji(key, cfg.economy?.iconStyle || {});
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
    const view = statusView(await getBotConfig(p), r.value);
    return { ok: true, total: view.total, counts: view.counts };
  });

  app.get('/admin/bot/emoji-status', { preHandler: requireCap('manage_bot') }, async () => {
    const p = await db();
    return statusView(await getBotConfig(p), await storedMap(p));
  });

  app.put('/admin/bot/emoji-map', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const p = await db();
    const r = await saveMap(p, req.body, 'dashboard');
    if (!r.ok) return reply.code(400).send({ error: r.error, issues: r.issues });
    await logAudit(p, req.user.uid, 'bot.emoji_map', `${Object.keys(r.value.emojis).length} emoji(s), ${req.body?.mode === 'merge' ? 'merge' : 'replace'}`);
    return { ok: true, ...statusView(await getBotConfig(p), r.value) };
  });
}
