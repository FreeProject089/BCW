// Which hosts a live B.MD block may fetch from, besides the site itself (SECURITY_SUMMARY §9,
// "apiUrl() has no host allowlist").
//
// `:counter`, `::live`, `::chart`, `::include` and their siblings fetch JSON or text in the
// VISITOR's browser, from an address the document's author wrote. With no list, any https host
// was fine: every reader of a page became a request to wherever its author pointed, carrying
// the reader's IP and Referer-less timing to a third party, and a place to feed the page
// content from outside the review that published it. The rule now is the site's own origin
// plus this list, EMPTY by default: an admin adds a host on purpose.
//
// The browser enforces it a second time: the site CSP's connect-src only names the site and the
// fixed hosts (infra/caddy/Caddyfile), so a host added here must also go in CSP_CONNECT_SRC_EXTRA
// or the request is refused there. The admin card says so.
//
// Stored in AdminSetting under KEY, same shape as the studio's link policy (studio.links).

export const KEY = 'bmd.fetchHosts';
export const MAX_HOSTS = 50;

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** One typed host as stored: lower case, no scheme, path, port or trailing dot. '' if not a host. */
export function normalizeHost(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  if (/^https?:\/\//.test(s)) {
    try { s = new URL(s).hostname; } catch { return ''; }
  }
  if (s.endsWith('.')) s = s.slice(0, -1);
  return HOST.test(s) ? s : '';
}

/** Whatever is stored, as a list: bad entries dropped, deduplicated, capped. Never throws. */
export function readHosts(value) {
  const list = Array.isArray(value?.hosts) ? value.hosts : [];
  return [...new Set(list.map(normalizeHost).filter(Boolean))].slice(0, MAX_HOSTS);
}

/**
 * A body the admin sent, checked strictly: a line that is not a host is refused with its index
 * rather than dropped, so what is saved is what was typed.
 * @returns {{ ok: true, hosts: string[] } | { ok: false, error: string, index?: number }}
 */
export function parseHosts(body) {
  const list = body?.hosts;
  if (!Array.isArray(list)) return { ok: false, error: 'invalid_input' };
  if (list.length > MAX_HOSTS) return { ok: false, error: 'too_many' };
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const h = normalizeHost(list[i]);
    if (!h) return { ok: false, error: 'bad_host', index: i };
    if (!out.includes(h)) out.push(h);
  }
  return { ok: true, hosts: out };
}
