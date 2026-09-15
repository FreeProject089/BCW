// The bot fetches its own icon set from here and uploads it as APPLICATION emojis on boot
// (features/icons.mjs in the bot), so no admin has to download a zip and paste ids: the
// buttons carry the site's icons from the first start, and a new key drawn here appears on
// Discord at the next boot. The admin's manual mapping (economy.icons) still wins per key.
//
//   GET /bot/emoji/keys        { icons: [{ key, label, version }] }
//   GET /bot/emoji/:key.png    the 128×128 tile, in the configured style
import { db, botAuth } from '../lib/lib.mjs';
import { ICONS, renderEmoji, iconStyleFor } from '../lib/bot-emoji.mjs';
import { getBotConfig } from './bot.mjs';
import crypto from 'node:crypto';

/** A short fingerprint of how a key currently draws — the bot re-uploads when it changes. */
function versionOf(key, iconStyle) {
  const st = iconStyleFor(key, iconStyle) || {};
  return crypto.createHash('sha1').update(JSON.stringify([st.icon, st.color, st.fg, st.shape, st.scale])).digest('hex').slice(0, 8);
}

export default async function botEmojiRoutes(app) {
  app.get('/bot/emoji/keys', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const cfg = await getBotConfig(await db());
    const style = cfg.economy?.iconStyle || {};
    return { icons: Object.entries(ICONS).map(([key, v]) => ({ key, label: v.label, version: versionOf(key, style) })) };
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
}
