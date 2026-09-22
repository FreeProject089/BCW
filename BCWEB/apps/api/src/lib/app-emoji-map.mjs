// The bot's application emojis, as a map the site keeps: `name → id`.
//
// Discord holds the real list (GET /applications/{app}/emojis). The site cannot ask for it —
// that takes the bot token, which never leaves the bot's host — so the owner's script
// (apps/bot/scripts/sync-app-emojis.mjs) uploads what is missing and hands the resulting map
// back: pushed with the bot's shared secret (PUT /bot/emoji/map), or pasted / imported in the
// dashboard (PUT /admin/bot/emoji-map). Stored in AdminSetting `bot.appEmojis`, NOT inside
// bot.config: the dashboard writes bot.config back whole on every save, and a map that rode
// inside it would be clobbered by the next unrelated edit.
//
// What is accepted is deliberately narrow. A name is `^[a-z0-9_]+$` (2-32 chars, the shape
// the bot's own `bc_<key>_<version>` names have) and an id is a Discord snowflake (17-20
// digits). Anything else is refused with the offending entry named, not silently dropped:
// this map becomes `<:name:id>` tokens inside messages the bot sends.
import { z } from 'zod';

export const SETTING_KEY = 'bot.appEmojis';
export const MAX_EMOJIS = 2000; // Discord's ceiling on application emojis
export const EMOJI_NAME = z.string().min(2).max(32).regex(/^[a-z0-9_]+$/, 'name must match ^[a-z0-9_]+$');
export const SNOWFLAKE = z.string().regex(/^\d{17,20}$/, 'id must be a Discord snowflake');

const ENTRY = z.object({ name: EMOJI_NAME, id: SNOWFLAKE, animated: z.boolean().optional() }).strip();
// Three spellings of the same thing, so whatever the owner has in hand can be pasted:
//   { emojis: { name: id } }            the script's own output file
//   { emojis: [{ name, id, animated }] } a list
//   { items: [{ name, id, animated }] }  Discord's raw GET /applications/{app}/emojis answer
export const EMOJI_MAP_BODY = z.object({
  emojis: z.union([z.record(EMOJI_NAME, SNOWFLAKE), z.array(ENTRY).max(MAX_EMOJIS)]).optional(),
  items: z.array(ENTRY).max(MAX_EMOJIS).optional(),
  animated: z.array(EMOJI_NAME).max(MAX_EMOJIS).optional(),
  appId: SNOWFLAKE.optional(),
  // replace: this IS the list now (what the script sends: it just read Discord's whole list).
  // merge: add these to what is stored (a single emoji added by hand).
  mode: z.enum(['replace', 'merge']).default('replace'),
}).strip().refine((b) => b.emojis || b.items, { message: 'emojis or items is required' });

/**
 * Parse a request body into `{ ok: true, emojis, animated, appId, mode }` or
 * `{ ok: false, error, issues }` naming the first bad entries.
 */
export function parseEmojiMapBody(body) {
  const r = EMOJI_MAP_BODY.safeParse(body);
  if (!r.success) {
    return { ok: false, error: 'invalid_emoji_map', issues: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`) };
  }
  const b = r.data;
  const emojis = {};
  const animated = new Set(b.animated || []);
  const list = Array.isArray(b.emojis) ? b.emojis : b.items || null;
  if (list) for (const e of list) { emojis[e.name] = e.id; if (e.animated) animated.add(e.name); }
  else Object.assign(emojis, b.emojis);
  const n = Object.keys(emojis).length;
  if (n > MAX_EMOJIS) return { ok: false, error: 'invalid_emoji_map', issues: [`${n} entries, Discord allows ${MAX_EMOJIS}`] };
  return { ok: true, emojis, animated: [...animated].filter((x) => emojis[x]), appId: b.appId || null, mode: b.mode };
}

/** The stored row value after applying a parsed body. */
export function nextEmojiMap(prev, parsed, source) {
  const base = parsed.mode === 'merge' && prev && typeof prev === 'object' ? prev : {};
  const emojis = { ...(base.emojis || {}), ...parsed.emojis };
  const animated = [...new Set([...(base.animated || []), ...parsed.animated])].filter((x) => emojis[x]);
  return { emojis, animated, appId: parsed.appId || base.appId || null, source, updatedAt: new Date().toISOString() };
}
