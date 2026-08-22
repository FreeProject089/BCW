// SSRF-safe fetch. Used everywhere the server fetches a URL that could be
// influenced by a user (a plugin download_url, a repo.json URL, admin-set project
// sources). It only allows http/https, blocks private / loopback / link-local /
// reserved addresses (resolved via DNS), and re-checks every redirect hop so a
// public URL can't 30x-bounce into the internal network / cloud metadata.
import dns from 'node:dns/promises';
import net from 'node:net';

/** The first 16 bits of an IPv6 address, as a number.
 *
 *  Needed because the ranges below are defined by BIT length, and matching them as text
 *  prefixes gets them wrong: `fe80::/10` is fe80 through febf, so a `startsWith('fe80')`
 *  test misses fe81 through fe8f, and a hand-written `fe9`/`fea`/`feb` list beside it
 *  covers the rest by accident rather than by rule. Both were true here.
 */
function firstHextet(s) {
  if (s.startsWith('::')) return 0;
  const head = s.split(':')[0];
  const n = parseInt(head, 16);
  return Number.isFinite(n) ? n : NaN;
}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||            // link-local incl. 169.254.169.254 metadata
      (a === 100 && b >= 64 && b <= 127) ||  // CGNAT (100.64/10)
      a >= 224;                              // multicast / reserved
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7)); // IPv4-mapped
    if (s === '::1' || s === '::') return true;
    const h = firstHextet(s);
    if (!Number.isFinite(h)) return true;                 // unparseable → block
    if (h >= 0xfc00 && h <= 0xfdff) return true;          // unique-local  fc00::/7
    // fe80::/10 (link-local) and fec0::/10 (site-local, deprecated but still routed on
    // some networks) are adjacent, so one range covers both: fe80 through feff.
    if (h >= 0xfe80 && h <= 0xfeff) return true;
    if (h >= 0xff00) return true;                         // multicast ff00::/8
    return false;
  }
  return true; // unknown format → block
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('ssrf_bad_url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('ssrf_bad_scheme');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('ssrf_blocked_ip'); return; }
  if (/^(localhost|(.*\.)?(local|internal|localdomain))$/i.test(host)) throw new Error('ssrf_blocked_host');
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error('ssrf_dns_fail'); }
  if (!addrs.length) throw new Error('ssrf_dns_empty');
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('ssrf_blocked_resolved');
}

// Drop-in replacement for fetch() that enforces the rules above. Callers should
// still pass a timeout signal. Redirects are followed manually (max 5).
export async function safeFetch(url, opts = {}, maxRedirects = 5) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...opts, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return res;
    current = new URL(loc, current).toString();
  }
  throw new Error('ssrf_too_many_redirects');
}
