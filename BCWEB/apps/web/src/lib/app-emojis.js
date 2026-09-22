// Reading what the owner pastes into the "Icons on Discord" card (pages/discord-emojis.jsx).
// Pure, so node --test can load it.
//
// The server (apps/api/src/lib/app-emoji-map.mjs) refuses a whole map over one bad entry, which
// is right for the server and wrong for a paste of Discord's raw emoji list, where the owner's
// other emojis ("PartyParrot") sit beside ours. So the page filters here, says how many it left
// out, and sends only what the server accepts: names ^[a-z0-9_]+$, snowflake ids.
export const EMOJI_NAME_RE = /^[a-z0-9_]{2,32}$/;
export const EMOJI_KEY_RE = /^[a-z0-9_]{2,32}$/;
const SNOWFLAKE_RE = /^\d{17,20}$/;
const OURS_RE = /^bc_[a-z0-9_]+?_[0-9a-f]{8}$/;

/**
 * The script's file ({ emojis: { name: id } }), a list ({ emojis: [...] } or a bare array), or
 * Discord's answer ({ items: [...] }) → { ok, emojis, animated, appId, ours, ignored } or
 * { ok: false, error: 'json' | 'empty' }.
 */
export function parseEmojiPaste(text) {
  let raw;
  try { raw = JSON.parse(String(text || '')); } catch { return { ok: false, error: 'json' }; }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.emojis) ? raw.emojis
    : raw?.emojis && typeof raw.emojis === 'object' ? Object.entries(raw.emojis).map(([name, id]) => ({ name, id })) : [];
  const emojis = {}, animated = [];
  let ignored = 0;
  for (const e of list) {
    const name = String(e?.name ?? ''), id = String(e?.id ?? '');
    if (!EMOJI_NAME_RE.test(name) || !SNOWFLAKE_RE.test(id)) { ignored += 1; continue; }
    emojis[name] = id;
    if (e.animated === true || (Array.isArray(raw?.animated) && raw.animated.includes(name))) animated.push(name);
  }
  const n = Object.keys(emojis).length;
  if (!n) return { ok: false, error: 'empty', ignored };
  const appId = SNOWFLAKE_RE.test(String(raw?.appId ?? '')) ? String(raw.appId) : null;
  return { ok: true, emojis, animated, appId, ours: Object.keys(emojis).filter((x) => OURS_RE.test(x)).length, ignored };
}

/** `<:name:id>` / `<a:name:id>` (what the bot's ui.mjs accepts) → { token, name, id, animated }, else null. */
export function parseEmojiToken(s) {
  const m = /^<(a?):(\w{2,32}):(\d{15,22})>$/.exec(String(s || '').trim());
  return m ? { token: `<${m[1]}:${m[2]}:${m[3]}>`, name: m[2], id: m[3], animated: m[1] === 'a' } : null;
}
