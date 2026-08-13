// Shared client-origin helpers: who the request came from (IP), where from (geo) and
// on what (device/browser/OS).
//
// These lived inside routes/analytics.mjs and were private to it. The Sessions panel
// needs exactly the same answers for exactly the same reason, and a second
// implementation would drift: two notions of "the client IP behind our proxy" is one
// too many, and the dev-machine geo fallback in particular is subtle enough that a
// re-derivation would get it wrong. Moved here VERBATIM and imported by both.
import { createHash } from 'node:crypto';

// Real client IP as seen by our trusted proxy (Caddy appends it last on X-Forwarded-For).
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip || '0.0.0.0';
}
// Daily-rotating anonymous visitor hash — no persistent cookie, no PII stored.
export function visitorHash(req) {
  const day = new Date().toISOString().slice(0, 10);
  const ua = req.headers['user-agent'] || '';
  return createHash('sha256').update(`${clientIp(req)}|${ua}|${day}|${process.env.JWT_SECRET || 'salt'}`).digest('hex').slice(0, 24);
}
// Country resolution: CDN/proxy header first (Cloudflare / Vercel / custom), then a
// LOCAL geoip lookup on the real client IP (geoip-lite, offline MaxMind-lite DB) —
// so Countries works when self-hosted without any CDN. Private/loopback IPs (local
// dev) resolve to null: still real data only, never faked.
let _geoip = null, _geoipTried = false;
async function loadGeoip() {
  if (_geoipTried) return _geoip;
  _geoipTried = true;
  try { _geoip = (await import('geoip-lite')).default; } catch { _geoip = null; }
  return _geoip;
}
// Full geo (country + region + city). CDN country header is authoritative for the
// country when present; region/city always come from the local offline GeoIP DB (the
// CDN header only carries a country). Private/loopback IPs (local dev) → nulls.
// Is this a private / loopback / link-local address? Such IPs never geolocate — in
// production only internal traffic uses them (real visitors have public IPs behind the
// proxy), so a dev-only sample geo for them can't pollute real-user data.
function isPrivateIp(ip) {
  return !ip || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::$|fc|fd)/i.test(ip) || ip === 'localhost' || ip === '0.0.0.0';
}
// Dev fallback: deterministically place a private/loopback visitor in one real city
// (by their anonymous hash, so a given visitor stays put). Lets Countries/Regions/Cities
// /Map/Globe all populate on a local machine. OFF only if ANALYTICS_DEV_GEO=0.
const DEV_CITIES = [
  { country: 'US', region: 'California', city: 'San Francisco', lat: 37.77, lng: -122.42 },
  { country: 'US', region: 'New York', city: 'New York', lat: 40.71, lng: -74.01 },
  { country: 'GB', region: 'England', city: 'London', lat: 51.51, lng: -0.13 },
  { country: 'FR', region: 'Île-de-France', city: 'Paris', lat: 48.86, lng: 2.35 },
  { country: 'DE', region: 'Berlin', city: 'Berlin', lat: 52.52, lng: 13.40 },
  { country: 'ES', region: 'Madrid', city: 'Madrid', lat: 40.42, lng: -3.70 },
  { country: 'CA', region: 'Ontario', city: 'Toronto', lat: 43.65, lng: -79.38 },
  { country: 'BR', region: 'São Paulo', city: 'São Paulo', lat: -23.55, lng: -46.63 },
  { country: 'IN', region: 'Maharashtra', city: 'Mumbai', lat: 19.08, lng: 72.88 },
  { country: 'JP', region: 'Tokyo', city: 'Tokyo', lat: 35.68, lng: 139.69 },
  { country: 'AU', region: 'New South Wales', city: 'Sydney', lat: -33.87, lng: 151.21 },
  { country: 'CH', region: 'Vaud', city: 'Lausanne', lat: 46.52, lng: 6.63 },
];
function devGeoSample(seed) {
  let h = 0; const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DEV_CITIES[h % DEV_CITIES.length];
}
// In local dev the client IP is loopback, so we can't geolocate the visitor. Resolve the
// DEV MACHINE's own public IP once (cached 1h) and geolocate THAT — so localhost traffic
// shows the developer's real location (real data), not a made-up sample city.
let _devPubGeo = { at: 0, val: undefined };
let _devGeoInflight = null;
function devRealGeo() {
  // Keep a successful lookup for an hour; retry a failed one after 5 min (so a cold-start
  // timeout doesn't wedge us on the sample fallback for a whole hour).
  const ttl = _devPubGeo.val ? 3600e3 : 5 * 60e3;
  if (_devPubGeo.val !== undefined && Date.now() - _devPubGeo.at < ttl) return Promise.resolve(_devPubGeo.val);
  // Collapse concurrent callers onto ONE outbound lookup (no thundering herd of fetches).
  if (_devGeoInflight) return _devGeoInflight;
  _devGeoInflight = (async () => {
  let val = null;
  for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip']) {
    try {
      const ctrl = AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined;
      const ip = (await fetch(url, ctrl ? { signal: ctrl } : {}).then((r) => r.text())).trim();
      const geo = await loadGeoip();
      const hit = geo && /^[0-9.]+$/.test(ip) ? geo.lookup(ip) : null;
      if (hit?.country && /^[A-Z]{2}$/.test(hit.country)) {
        val = { country: hit.country, region: hit.region || null, city: hit.city || null, lat: Array.isArray(hit.ll) ? hit.ll[0] : null, lng: Array.isArray(hit.ll) ? hit.ll[1] : null };
        break;
      }
    } catch { /* try the next resolver, else fall back to the sample */ }
  }
  _devPubGeo = { at: Date.now(), val };
  return val;
  })().finally(() => { _devGeoInflight = null; });
  return _devGeoInflight;
}

export async function geoOf(req) {
  const hdr = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country'] || req.headers['x-geo-country'] || '';
  const cc = String(hdr).trim().toUpperCase();
  const headerCountry = /^[A-Z]{2}$/.test(cc) && cc !== 'XX' ? cc : null;
  const ip = clientIp(req);
  // Dev/local traffic → use the dev machine's REAL public-IP location (so it shows the
  // developer's actual country), falling back to a sample city only if that lookup fails.
  if (!headerCountry && isPrivateIp(ip) && process.env.ANALYTICS_DEV_GEO !== '0') {
    const real = await devRealGeo();
    if (real) return real;
    const d = devGeoSample(visitorHash(req));
    return { country: d.country, region: d.region, city: d.city, lat: d.lat, lng: d.lng };
  }
  const geo = await loadGeoip();
  let hit = null;
  if (geo) { try { hit = geo.lookup(ip); } catch { hit = null; } }
  const country = headerCountry || (hit?.country && /^[A-Z]{2}$/.test(hit.country) ? hit.country : null);
  // geoip-lite returns `region` as a subdivision code (e.g. "CA") and `city` as a name.
  const region = hit?.region ? String(hit.region).slice(0, 80) || null : null;
  const city = hit?.city ? String(hit.city).slice(0, 120) || null : null;
  // `ll` = [lat, lng]; present on most geoip hits even when city/region are blank.
  const lat = Array.isArray(hit?.ll) && Number.isFinite(hit.ll[0]) ? hit.ll[0] : null;
  const lng = Array.isArray(hit?.ll) && Number.isFinite(hit.ll[1]) ? hit.ll[1] : null;
  return { country, region: region || null, city: city || null, lat, lng };
}
// OS + distro detection. Distro/edition is only reliably present in the UA for a few
// cases (Firefox exposes Ubuntu/Fedora; ChromeOS uses the "CrOS" token) — best-effort,
// falling back to the generic family. Never guesses beyond what the UA actually states.
export function parseUA(ua = '') {
  const u = ua.toLowerCase();
  const device = /ipad|tablet/.test(u) ? 'tablet' : /mobi|android|iphone|ipod/.test(u) ? 'mobile' : 'desktop';
  const browser = /edg\//.test(u) ? 'Edge' : /opr\/|opera/.test(u) ? 'Opera' : /firefox/.test(u) ? 'Firefox'
    : /samsungbrowser/.test(u) ? 'Samsung Internet' : /brave/.test(u) ? 'Brave'
    : /chrome|crios/.test(u) ? 'Chrome' : /safari/.test(u) ? 'Safari' : 'Other';
  let os;
  if (/android/.test(u)) os = 'Android';
  else if (/iphone|ipad|ipod/.test(u)) os = 'iOS';
  else if (/cros/.test(u)) os = 'ChromeOS';
  else if (/windows/.test(u)) os = 'Windows';
  else if (/mac os x|macintosh/.test(u)) os = 'macOS';
  else if (/ubuntu/.test(u)) os = 'Ubuntu';
  else if (/fedora/.test(u)) os = 'Fedora';
  else if (/debian/.test(u)) os = 'Debian';
  else if (/kali/.test(u)) os = 'Kali';
  else if (/arch/.test(u)) os = 'Arch';
  else if (/manjaro/.test(u)) os = 'Manjaro';
  else if (/mint/.test(u)) os = 'Linux Mint';
  else if (/steamos/.test(u)) os = 'SteamOS';
  else if (/linux|x11/.test(u)) os = 'Linux';
  else os = 'Other';
  return { device, browser, os };
}
