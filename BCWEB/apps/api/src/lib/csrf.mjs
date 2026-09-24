// Cross-site request forgery: ONE onRequest hook for the whole API (SECURITY_SUMMARY §9,
// "No CSRF token on cookie-authenticated routes").
//
// The session is a cookie (`bcw_session`, SameSite=Lax), and no route carries a CSRF token.
// Lax already keeps the cookie off a cross-site POST in current browsers, so this is the
// second layer, for the cases Lax does not cover: an older browser, a same-site sibling
// (another subdomain of the site's domain), a cookie set with a different SameSite by a
// future change. It is one rule, written once, so no route can be forgotten:
//
//   A STATE-CHANGING request (anything but GET / HEAD / OPTIONS) that is authenticated by
//   one of our cookies is REFUSED when the browser says it is cross-site:
//     · `Sec-Fetch-Site: cross-site`, or
//     · no `Sec-Fetch-Site` at all (an older browser) and an `Origin` that is not the site.
//
// Exempt, because a page on another site cannot forge them:
//   · requests carrying `Authorization`, `X-API-Key` or `X-Bot-Secret` — a cross-site form
//     cannot set a header, and a script that tries triggers a CORS preflight this API
//     refuses for every origin it does not list;
//   · origins the CORS allowlist trusts (the BMM desktop app, CORS_ORIGINS): they are
//     cross-origin by nature and already allowed to send credentials;
//   · requests with no cookie of ours: webhooks (Stripe, Ko-fi, code), the OAuth2 token /
//     revoke / introspect endpoints and every server-to-server caller carry none, so they
//     are not "cookie-authenticated" and pass untouched;
//   · GET / HEAD / OPTIONS: the OAuth sign-in callbacks are GET redirects from the
//     provider, cross-site by definition, and must keep working.
//
// test/csrf.test.mjs walks every case, including the webhook and callback paths.

/** The cookies that authenticate a request here. A request with none of them is not a CSRF target. */
export const AUTH_COOKIES = ['bcw_session', 'bcw_elevated', 'tele_session'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The origin of a URL string, or '' when it is not one. */
export function originOf(url) {
  try { return new URL(String(url)).origin; } catch { return ''; }
}

/**
 * Why this request must be refused, or null when it may proceed. Pure: the hook and the
 * tests call the same function.
 *
 * `trusted` is a Set of origins that count as "the site" (SITE_URL's origin plus the CORS
 * allowlist).
 */
export function csrfVerdict(req, trusted) {
  if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) return null;
  const cookies = req.cookies || {};
  if (!AUTH_COOKIES.some((c) => cookies[c])) return null;
  const h = req.headers || {};
  if (h.authorization || h['x-api-key'] || h['x-bot-secret']) return null;
  const origin = typeof h.origin === 'string' ? h.origin : '';
  if (origin && origin !== 'null' && trusted.has(origin)) return null;
  const site = typeof h['sec-fetch-site'] === 'string' ? h['sec-fetch-site'].toLowerCase() : '';
  if (site) return site === 'cross-site' ? 'cross_site' : null;
  // An older browser: no Fetch Metadata, so the Origin decides. `null` is an opaque origin
  // (a sandboxed frame, a data: URL) and is never the site. No Origin at all is a
  // same-origin form in those browsers or a non-browser client: nothing to judge.
  if (!origin) return null;
  return 'cross_site';
}

/**
 * Register the hook. Must run AFTER @fastify/cookie is registered (it reads `req.cookies`).
 * `trustedOrigins` is an iterable of origins; SITE_URL's is added here.
 */
export function installCsrfGuard(app, { trustedOrigins = [], siteUrl = process.env.SITE_URL } = {}) {
  // `tauri://localhost` is not a special scheme, so `new URL(…).origin` is the string 'null'
  // for it: only http(s) values are normalised, the rest are kept as written.
  const norm = (o) => { const s = String(o || '').trim().replace(/\/+$/, ''); return /^https?:\/\//i.test(s) ? originOf(s) : s; };
  const trusted = new Set([...trustedOrigins].map(norm).filter((o) => o && o !== 'null'));
  const own = originOf(siteUrl || '');
  if (own) trusted.add(own);
  app.addHook('onRequest', async (req, reply) => {
    const why = csrfVerdict(req, trusted);
    if (!why) return;
    reply.code(403).send({ error: 'csrf_refused' });
    return reply;
  });
  return trusted;
}
