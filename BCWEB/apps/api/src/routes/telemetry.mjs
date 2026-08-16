import { z } from 'zod';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db, requireRole, logAudit } from '../lib/lib.mjs';
import { boundedSet } from '../lib/boundedmap.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const ADMIN_TIER = ['MOD', 'ADMIN', 'SUPERADMIN'];
// Same scheme-derived Secure flag as the main session cookie (lib.mjs).
const COOKIE_SECURE = /^https:/i.test(process.env.SITE_URL || process.env.SITE_DOMAIN || '');

// Validate the short-lived SSO token minted by /admin/telemetry/token (HMAC over a
// base64url payload with BC_LINK_SECRET). This is the RELIABLE auth path for the
// "open telemetry" button: the token rides in the URL query so the gate can see it
// even when the cross-subdomain session cookie doesn't reach telemetry.<host>
// (Firefox is picky about Domain=localhost cookies).
function validTelemetryToken(token) {
  try {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const secret = process.env.BC_LINK_SECRET || process.env.LINK_LOOKUP_SECRET || 'dev-link-secret';
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(expected), b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp <= Date.now()) return null;
    return data; // { role, uid, ep, exp }
  } catch { return null; }
}

// The gate runs on EVERY telemetry request (HTML, each /assets/*.js, the app's own
// API), so avoid a DB round-trip per asset: cache each user's current logout epoch
// for a few seconds. Logout invalidation is therefore near-instant (≤ TTL), not
// literally instant — an acceptable trade for not hammering Postgres on every asset.
const _epochCache = new Map(); // uid -> { ep, at }
const EPOCH_TTL_MS = 8000;
// Keyed by uid → capped so it can't hold an entry per user forever (the TTL only makes an
// entry stale, never frees it). See lib/boundedmap.mjs.
const EPOCH_CACHE_MAX = 5000;
async function currentEpoch(uid) {
  if (!uid) return null;
  const hit = _epochCache.get(uid);
  if (hit && Date.now() - hit.at < EPOCH_TTL_MS) return hit.ep;
  const p = await db();
  const u = await p.user.findUnique({ where: { id: uid }, select: { telemetryEpoch: true } }).catch(() => null);
  if (!u) return null;
  boundedSet(_epochCache, uid, { ep: u.telemetryEpoch || 0, at: Date.now() }, EPOCH_CACHE_MAX, EPOCH_TTL_MS);
  return u.telemetryEpoch || 0;
}
// forward_auth rewrites the path to /telemetry/authorize but preserves the ORIGINAL
// request URI (incl. query) in X-Forwarded-Uri — that's where the ?bc= token lives.
function tokenFromReq(req) {
  const fwd = req.headers['x-forwarded-uri'] || req.url || '';
  const qs = fwd.includes('?') ? fwd.slice(fwd.indexOf('?') + 1) : '';
  return new URLSearchParams(qs).get('bc') || req.query?.bc || null;
}

// Gate the (separate) BMM telemetry dashboard behind a BCWEB login + an explicit
// `canViewTelemetry` grant, WITHOUT modifying the telemetry app: Caddy's forward_auth
// hits GET /api/telemetry/authorize before proxying telemetry.<domain>. A 2xx lets the
// request through; anything else is returned to the browser (we 302 to /auth so an
// unauthenticated visitor lands on the login page instead of a bare 401).
//
// Cross-subdomain note: the bcw_session cookie must reach the telemetry subdomain, so
// set COOKIE_DOMAIN=.your-domain in production (see issueSession in lib.mjs).
export default async function telemetryRoutes(app) {
  app.get('/telemetry/authorize', async (req, reply) => {
    const site = process.env.SITE_URL || '';
    // `next` is a real PATH back to this gate, not the token `telemetry` it used to be.
    //
    // The sign-in page honours next only when it starts with a slash — which is also its
    // open-redirect guard — so a bare token failed that test and dropped the person on
    // /profile. The SSO worked and looked broken.
    //
    // A path back here is the right target rather than the dashboard's own URL: the dashboard
    // is on another HOST, and this route is what mints the cross-domain token. Sending the
    // absolute URL instead would need the SPA to learn TELEMETRY_PUBLIC_URL and would hand the
    // sign-in page an off-site destination to trust.
    const deny = () => reply.code(302).header('Location', `${site}/auth?next=/api/telemetry/authorize`).header('Cache-Control', 'no-store').send();

    // Mint the telemetry-host session cookie bound to a user + their current logout
    // epoch. It rides EVERY telemetry request (HTML, /assets/*.js, the app's own /api)
    // so the whole app loads — and because it carries the epoch, logging out of BCWEB
    // (which bumps the epoch) instantly stops it validating.
    const mint = (uid, ep) => {
      const sess = jwt.sign({ purpose: 'telemetry', uid, ep }, JWT_SECRET, { expiresIn: '4h' });
      reply.setCookie('tele_session', sess, { httpOnly: true, sameSite: 'lax', path: '/', secure: COOKIE_SECURE, maxAge: 4 * 3600 });
    };

    // 1. Steady state: a valid `tele_session` whose baked epoch still matches the user's
    //    current epoch. A logout bumped the epoch → mismatch → fall through to re-auth.
    try {
      const c = jwt.verify(req.cookies?.tele_session, JWT_SECRET);
      if (c.purpose === 'telemetry' && c.uid && c.ep === await currentEpoch(c.uid)) {
        return reply.code(204).header('Cache-Control', 'no-store').send();
      }
    } catch { /* fall through */ }

    // 2. First entry via the SSO button: a valid `?bc=` token whose baked epoch still
    //    matches → mint the host cookie, then 302 back to the app WITHOUT the ?bc query
    //    but KEEPING the #bc fragment (the telemetry app's own client auth reads the
    //    hash). The 302 + Set-Cookie is non-2xx, so forward_auth returns it to the
    //    browser (which stores the cookie and follows the redirect — now cookie-backed).
    const tok = tokenFromReq(req);
    const td = tok && validTelemetryToken(tok);
    if (td && td.uid && (td.ep ?? 0) === await currentEpoch(td.uid)) {
      mint(td.uid, td.ep ?? 0);
      const base = (process.env.TELEMETRY_PUBLIC_URL || '').replace(/\/+$/, '');
      return reply.code(302).header('Location', `${base}/#bc=${encodeURIComponent(tok)}`).header('Cache-Control', 'no-store').send();
    }

    // 3. Fall back to the BCWEB session cookie + canViewTelemetry (direct navigation,
    //    only works when the cross-subdomain cookie actually reaches this host).
    let claims;
    try { claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET); } catch { return deny(); }
    const p = await db();
    const u = await p.user.findUnique({ where: { id: claims.uid }, select: { role: true, canViewTelemetry: true, telemetryEpoch: true } }).catch(() => null);
    if (!u) return deny();
    const allowed = u.role === 'SUPERADMIN' || (u.canViewTelemetry && ADMIN_TIER.includes(u.role));
    if (!allowed) return reply.code(403).header('Cache-Control', 'no-store').type('text/plain').send('Forbidden — you do not have BMM telemetry access. Ask a SUPERADMIN to grant it.');
    // Establish the telemetry-host session cookie here too, so cookie-based direct nav
    // also loads assets/API cleanly.
    mint(claims.uid, u.telemetryEpoch || 0);
    return reply.code(204).header('Cache-Control', 'no-store').send();
  });

  // SUPERADMIN: who can view telemetry.
  app.get('/admin/telemetry-access/users', { preHandler: requireRole('SUPERADMIN') }, async () => {
    const p = await db();
    const users = await p.user.findMany({ where: { canViewTelemetry: true }, select: { id: true, displayName: true, email: true, role: true } });
    return { users };
  });

  app.put('/admin/telemetry-access/:userId', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = z.object({ granted: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const target = await p.user.update({ where: { id: req.params.userId }, data: { canViewTelemetry: b.data.granted } }).catch(() => null);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'telemetry-access.grant', `${b.data.granted ? 'Granted' : 'Revoked'} telemetry access for ${target.displayName}`);
    return { ok: true };
  });
}
