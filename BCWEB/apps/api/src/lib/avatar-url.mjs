// Where an avatar image may point (web audit W4 card, Sept 24 2026).
//
// PATCH /me stored any string in avatar.image and GET /api/avatar/:id redirected to it, which
// made /api/avatar/<my id> an open redirect on the site's own domain (and a way to point the
// site's avatar URL at a tracking pixel). An avatar image is one of three things the site
// itself produces: an upload served at /api/media/<key>, or the picture a GitHub or Discord
// sign-in brought. Anything else is refused at write and ignored at read (the generated
// avatar is served instead), so a value stored before this rule does no harm either.
const HOSTS = new Set(['avatars.githubusercontent.com', 'cdn.discordapp.com', 'media.discordapp.net']);

/** The value if it is an allowed avatar image, else null. */
export function safeAvatarImage(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 500) return null;
  // A path on this site: exactly one leading slash and the media prefix. `//x` and `/\x` are
  // other hosts to a browser.
  if (/^\/api\/media\/[A-Za-z0-9._~\-/]+$/.test(s) && !s.includes('..')) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return HOSTS.has(u.hostname.toLowerCase()) ? u.toString() : null;
}
