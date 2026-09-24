// SSRF-safe fetch. Used everywhere the server fetches a URL that could be
// influenced by a user (a plugin download_url, a repo.json URL, admin-set project
// sources). It only allows http/https, blocks private / loopback / link-local /
// reserved addresses (resolved via DNS), and re-checks every redirect hop so a
// public URL can't 30x-bounce into the internal network / cloud metadata.
import dns from 'node:dns/promises';
import net from 'node:net';
import { fetch as undiciFetch, Agent } from 'undici';

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

/** An IPv6 address as its eight 16-bit groups, or null. A trailing dotted quad is two groups. */
function hextets(s) {
  let t = String(s).split('%')[0];
  const dotted = t.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    if (!net.isIPv4(dotted[2])) return null;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    t = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const part = (h) => (h ? h.split(':') : []);
  const head = part(halves[0]), tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
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
    // IPv6 forms that CARRY an IPv4 address are judged by that address (pentest R11, Sept 24
    // 2026). WHATWG URL writes them in hex (`[::127.0.0.1]` → `::7f00:1`), so a dotted-quad
    // test alone never saw them, and `::7f00:1`, `64:ff9b::a9fe:a9fe` and `2002:a9fe:a9fe::1`
    // all passed as public.
    const x = hextets(s);
    if (!x) return true;                                  // unparseable → block
    const v4 = (hi, lo) => `${x[hi] >> 8}.${x[hi] & 255}.${x[lo] >> 8}.${x[lo] & 255}`;
    const zeros = (from, to) => x.slice(from, to).every((n) => n === 0);
    if (zeros(0, 5) && x[5] === 0xffff) return isPrivateIp(v4(6, 7));        // ::ffff:0:0/96 mapped
    if (zeros(0, 4) && x[4] === 0xffff && x[5] === 0) return isPrivateIp(v4(6, 7)); // ::ffff:0:0:0/96 translated
    if (zeros(0, 6)) return isPrivateIp(v4(6, 7));                            // ::/96 compatible, incl. :: and ::1
    if (x[0] === 0x64 && x[1] === 0xff9b) {                                   // NAT64
      return zeros(2, 6) ? isPrivateIp(v4(6, 7)) : true;                      // 64:ff9b::/96, else 64:ff9b:1::/48 local-use
    }
    if (x[0] === 0x2002) return isPrivateIp(v4(1, 2));                        // 6to4 2002::/16
    if (x[0] === 0x2001 && x[1] === 0) return true;                           // Teredo 2001::/32
    if (x[0] === 0x2001 && x[1] === 0xdb8) return true;                       // documentation 2001:db8::/32
    if (x[0] === 0x100 && zeros(1, 4)) return true;                           // discard-only 100::/64
    if (s === '::1' || s === '::') return true;
    const h = firstHextet(s);
    // Global unicast is 2000::/3 and nothing else; the ranges checked below sit above it, and
    // everything under it that is not an embedding handled above is reserved.
    if (h < 0x2000) return true;
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

/** The default resolver. Injectable so a test can drive it; nothing else passes one. */
const realResolver = (host) => dns.lookup(host, { all: true });

/**
 * Check a URL, and return the ONE address the caller must then connect to.
 *
 * Returning the address is the whole point. Checking a hostname and then letting the HTTP
 * client resolve it again is two separate DNS answers, and an attacker who controls the
 * name can make them differ: the first answers a public address and passes the check, the
 * second answers 169.254.169.254 and is the one actually dialled. The check was never
 * wrong — it just described a different lookup from the one that mattered.
 *
 * Returns null for a literal IP (nothing to pin: the URL already names the address).
 */
async function assertPublicUrl(raw, resolve = realResolver) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('ssrf_bad_url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('ssrf_bad_scheme');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('ssrf_blocked_ip'); return null; }
  if (/^(localhost|(.*\.)?(local|internal|localdomain))$/i.test(host)) throw new Error('ssrf_blocked_host');
  let addrs;
  try { addrs = await resolve(host); } catch { throw new Error('ssrf_dns_fail'); }
  if (!addrs.length) throw new Error('ssrf_dns_empty');
  // Every answer must be public, not just the one we pick: a name that resolves to both a
  // public and a private address is an attempt, not a coincidence.
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('ssrf_blocked_resolved');
  return { address: addrs[0].address, family: addrs[0].family };
}

/**
 * An Agent that connects to `pinned` no matter what DNS says next.
 *
 * The hostname is NOT rewritten to the IP. Rewriting it is the obvious way to pin an
 * address and it silently breaks HTTPS: the certificate is issued for the name, so
 * connecting to `https://93.184.216.34/` fails validation, and the usual next step is to
 * disable the check — trading an SSRF for something worse. Overriding `lookup` instead
 * leaves the URL, the SNI and the certificate check on the real hostname, and changes only
 * which address the socket dials.
 */
function pinnedAgent(pinned) {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const family = pinned.family === 6 ? 6 : 4;
        if (options && options.all) callback(null, [{ address: pinned.address, family }]);
        else callback(null, pinned.address, family);
      },
    },
  });
}

// Drop-in replacement for fetch() that enforces the rules above. Callers should
// still pass a timeout signal. Redirects are followed manually (max 5), and each hop is
// checked and pinned on its own — a 302 is a new URL, so it is a new decision.
export async function safeFetch(url, opts = {}, maxRedirects = 5, resolve = realResolver) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const pinned = await assertPublicUrl(current, resolve);
    const agent = pinned ? pinnedAgent(pinned) : null;
    let res;
    try {
      res = await undiciFetch(current, {
        ...opts,
        redirect: 'manual',
        ...(agent ? { dispatcher: agent } : {}),
      });
    } catch (e) {
      if (agent) await agent.close().catch(() => {});
      throw e;
    }
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) {
      // close(), NOT awaited and NOT destroy(): one agent per request would otherwise leak a
      // socket pool per call. close() is graceful — it waits for the in-flight response to
      // finish, so the caller still reads the whole body afterwards. Measured, because
      // "probably fine" is how a security fix acquires a resource leak.
      if (agent) agent.close().catch(() => {});
      return res;
    }
    await res.body?.cancel().catch(() => {});
    if (agent) await agent.close().catch(() => {});
    current = new URL(loc, current).toString();
  }
  throw new Error('ssrf_too_many_redirects');
}

// Exported for the tests only: they need to assert what was verified, not just what came back.
export { assertPublicUrl as _assertPublicUrl, pinnedAgent as _pinnedAgent };
// The same check, for a caller that must refuse a URL BEFORE storing it (the status page's
// admin-configured monitors, lib/status-monitors.mjs): the admin is told at save time, and
// safeFetch still re-checks at every fetch because DNS can change after the save.
export { assertPublicUrl as checkPublicUrl };
