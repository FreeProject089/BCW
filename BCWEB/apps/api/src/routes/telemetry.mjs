import { z } from 'zod';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db, requireRole, logAudit, safeEqual, clientIp } from '../lib/lib.mjs';
import { boundedSet } from '../lib/boundedmap.mjs';
import { sendMail, mailShell, emailEnabled, escapeHtml } from '../lib/mail.mjs';

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

  // ── Server-to-server (the telemetry service): GDPR identity + notification ──
  // The telemetry payload carries NO account id: an install is only its creator id (the
  // hex of its ed25519 public key). Which account that id is linked to is OUR knowledge
  // (CreatorLink), so the telemetry service asks here when a person requests their data
  // or its erasure, and hands the mail back here so the address never leaves BCWEB.
  // Same shared secret as /link/lookup (LINK_LOOKUP_SECRET = the service's BC_LINK_SECRET).
  const linkSecretOk = (req, reply) => {
    const secret = process.env.LINK_LOOKUP_SECRET || process.env.JWT_SECRET;
    if (!secret || !safeEqual(req.headers['x-link-secret'] || '', secret)) { reply.code(401).send({ error: 'unauthorized' }); return false; }
    return true;
  };

  // GET /internal/telemetry/identity?creatorId= → { linked, userId, email, displayName,
  // locale, creatorIds } — creatorIds is every id linked to the same account (one
  // account may pair several installs; a request for one covers all of them).
  app.get('/internal/telemetry/identity', async (req, reply) => {
    if (!linkSecretOk(req, reply)) return;
    const q = z.object({ creatorId: z.string().min(1).max(200) }).safeParse(req.query || {});
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const link = await p.creatorLink.findUnique({
      where: { creatorId: q.data.creatorId },
      include: { user: { select: { id: true, email: true, displayName: true, locale: true, creatorLinks: { select: { creatorId: true } } } } },
    }).catch(() => null);
    if (!link?.user) return { linked: false };
    return {
      linked: true,
      userId: link.user.id,
      email: link.user.email,
      displayName: link.user.displayName,
      locale: link.user.locale || null,
      creatorIds: link.user.creatorLinks.map((l) => l.creatorId),
    };
  });

  // POST /internal/telemetry/notify — send the GDPR confirmation mail.
  // Body: { kind: export|delete, outcome: done|rejected, requestId, creatorId, creatorIds?,
  //         to: { userId } | { email }, counts?, erased?, attachment?: { filename, base64 }, tooLarge? }
  // `to.userId` is resolved to the account's CURRENT address here; `to.email` is the
  // address an unlinked install typed. Answers { ok, sent } — ok:false with a reason when
  // mail is off, so the telemetry side records "not notified" instead of guessing.
  app.post('/internal/telemetry/notify', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    if (!linkSecretOk(req, reply)) return;
    const b = z.object({
      kind: z.enum(['export', 'delete']),
      outcome: z.enum(['done', 'rejected']).default('done'),
      requestId: z.number().int().optional(),
      creatorId: z.string().max(200),
      creatorIds: z.array(z.string().max(200)).max(50).optional(),
      to: z.union([z.object({ userId: z.string().min(1) }), z.object({ email: z.string().email().max(254) })]),
      counts: z.record(z.number()).optional(),
      erased: z.record(z.number()).optional(),
      attachment: z.object({ filename: z.string().max(120).regex(/^[\w.-]+\.zip$/), base64: z.string().max(18 * 1024 * 1024) }).optional(),
      tooLarge: z.boolean().optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;
    let to = d.to.email || null;
    let locale = null;
    if (d.to.userId) {
      const p = await db();
      const u = await p.user.findUnique({ where: { id: d.to.userId }, select: { email: true, locale: true } }).catch(() => null);
      if (!u?.email) return reply.code(404).send({ ok: false, reason: 'account_not_found' });
      to = u.email; locale = u.locale;
    }
    if (!emailEnabled()) return { ok: false, reason: 'email_disabled' };
    const fr = String(locale || '').toLowerCase().startsWith('fr');
    const site = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/+$/, '');
    const short = escapeHtml(d.creatorId.slice(0, 12)) + '…';
    const rows = (obj) => Object.entries(obj || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `<li>${escapeHtml(k)}: ${Number(v)}</li>`).join('');
    let subject, title, body;
    if (d.outcome === 'rejected') {
      subject = fr ? 'BMM telemetry — demande non traitée' : 'BMM telemetry — request not processed';
      title = fr ? 'Votre demande n’a pas pu être traitée' : 'Your request could not be processed';
      body = fr
        ? `<p>Votre demande (${d.kind === 'delete' ? 'effacement' : 'export'}) concernant l’installation BMM <code>${short}</code> a été refusée par un administrateur. Si vous pensez qu’il s’agit d’une erreur, répondez à ce message.</p>`
        : `<p>Your ${d.kind === 'delete' ? 'erasure' : 'export'} request for the BMM install <code>${short}</code> was declined by an administrator. If you believe this is a mistake, reply to this message.</p>`;
    } else if (d.kind === 'delete') {
      subject = fr ? 'BMM telemetry — vos données ont été effacées' : 'BMM telemetry — your data has been erased';
      title = fr ? 'Effacement effectué' : 'Erasure completed';
      const list = rows(d.erased);
      body = fr
        ? `<p>Toutes les données de télémétrie liées à l’installation BMM <code>${short}</code>${(d.creatorIds || []).length > 1 ? ` (et ${d.creatorIds.length - 1} autre(s) installation(s) liée(s) à votre compte)` : ''} ont été supprimées de notre collecteur.</p>${list ? `<p>Lignes supprimées :</p><ul>${list}</ul>` : ''}<p>Seule une trace anonymisée de cette demande est conservée (journal d’audit).</p>`
        : `<p>Every telemetry row tied to the BMM install <code>${short}</code>${(d.creatorIds || []).length > 1 ? ` (and ${d.creatorIds.length - 1} other install(s) linked to your account)` : ''} has been deleted from our collector.</p>${list ? `<p>Rows removed:</p><ul>${list}</ul>` : ''}<p>Only an anonymised trace of this request is kept (audit log).</p>`;
    } else {
      subject = fr ? 'BMM telemetry — votre export de données' : 'BMM telemetry — your data export';
      title = fr ? 'Votre export est prêt' : 'Your export is ready';
      const list = rows(d.counts);
      const attached = d.attachment ? (fr ? '<p>Le paquet (zip : un JSON par table, vos replays, un README) est joint à ce message.</p>' : '<p>The package (zip: one JSON per table, your replays, a README) is attached to this message.</p>')
        : (fr ? '<p>Le paquet est trop volumineux pour être joint ; un administrateur vous le transmettra par un autre canal.</p>' : '<p>The package is too large to attach; an administrator will hand it to you through another channel.</p>');
      body = fr
        ? `<p>Voici les données de télémétrie que nous détenons pour l’installation BMM <code>${short}</code>.</p>${list ? `<ul>${list}</ul>` : ''}${attached}`
        : `<p>Here is the telemetry data we hold for the BMM install <code>${short}</code>.</p>${list ? `<ul>${list}</ul>` : ''}${attached}`;
    }
    const attachments = d.attachment ? [{ filename: d.attachment.filename, content: Buffer.from(d.attachment.base64, 'base64'), contentType: 'application/zip' }] : undefined;
    const text = `${title}\n\n${body.replace(/<[^>]+>/g, '')}\n\n${site}/legal/privacy`;
    try {
      await sendMail({ to, mailId: `telemetry-${d.kind}`, subject, html: mailShell(title, body, { url: `${site}/legal/privacy`, label: fr ? 'Politique de confidentialité' : 'Privacy policy' }, { mailId: `telemetry-${d.kind}` }), text, attachments });
      return { ok: true, sent: true };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  });

  // ── Website side (logged in): file a GDPR request for one of MY creator ids ──
  // Proxies to the telemetry service with the public ingest key and source=bcweb. The
  // creator id must be linked to the caller's account — that is the proof; the service
  // then mails the account's address, so no e-mail is typed here.
  const teleBase = () => (process.env.TELEMETRY_INTERNAL_URL || '').replace(/\/+$/, '');
  app.post('/me/telemetry/data-request', { preHandler: requireRole(), config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({ creatorId: z.string().min(1).max(200), kind: z.enum(['export', 'delete']) }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!teleBase()) return reply.code(503).send({ error: 'telemetry_not_configured' });
    const p = await db();
    const mine = await p.creatorLink.findFirst({ where: { creatorId: b.data.creatorId, userId: req.user.uid }, select: { id: true } });
    if (!mine) return reply.code(403).send({ error: 'not_your_creator_id' });
    try {
      const r = await fetch(`${teleBase()}/data-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: process.env.TELEMETRY_API_KEY || '', creator_id: b.data.creatorId, kind: b.data.kind, source: 'bcweb' }),
        signal: AbortSignal.timeout(8000),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) return reply.code(502).send({ error: 'telemetry_error', status: r.status, detail: out?.error });
      await logAudit(p, req.user.uid, 'telemetry.data_request', `${b.data.kind} for creator ${b.data.creatorId.slice(0, 12)}…`, clientIp(req)).catch(() => {});
      return { ok: true, id: out.id, duplicate: !!out.duplicate, kind: b.data.kind };
    } catch (e) {
      return reply.code(502).send({ error: 'telemetry_unreachable', detail: String(e?.message || e) });
    }
  });
}
