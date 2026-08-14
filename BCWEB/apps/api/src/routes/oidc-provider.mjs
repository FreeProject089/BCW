import { z } from 'zod';
import crypto from 'node:crypto';
import querystring from 'node:querystring';
import jwt from 'jsonwebtoken';
import { db, requireRole, optionalAuth, clearSession, logAudit, clientIp, notify, safeEqual } from '../lib/lib.mjs';
import { jwks, issuer, signRs256, verifyRs256, verifyPkce, validateAuthorizeRequest } from '../lib/oidc.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Every scope here unlocks a resource below. A scope with nothing behind it is a promise
// the provider does not keep, and it survives review because it reads perfectly well in a
// consent screen.
const SCOPES = ['openid', 'profile', 'email', 'items', 'repos', 'pools', 'catalogs', 'payments', 'polls',
  'favorites', 'transfers', 'notifications', 'badges', 'stats'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sep = (u) => (u.includes('?') ? '&' : '?');
const backTo = (redir, params) => `${redir}${sep(redir)}${new URLSearchParams(params).toString()}`;
const parseBasicAuth = (h) => {
  const m = /^Basic\s+(.+)$/i.exec(h || ''); if (!m) return null;
  try { const [id, secret] = Buffer.from(m[1], 'base64').toString('utf8').split(':'); return { id, secret }; } catch { return null; }
};
async function issueCode(p, { client, userId, redirectUri, scope, nonce, codeChallenge, authTime }) {
  const code = crypto.randomBytes(32).toString('base64url');
  await p.oAuthCode.create({ data: { code, clientId: client.id, userId, redirectUri, scope, nonce: nonce || '', codeChallenge: codeChallenge || '', authTime: authTime || null, expiresAt: new Date(Date.now() + 5 * 60000) } });
  return code;
}
// Mint the token set for a user+client+scope (shared by the code and refresh grants).
// The refresh token is opaque; only its sha256 is stored (rotated on each refresh).
// The `sub` this client should see for this user.
//
// 'public' hands out the BetterCommunity user id — the same string every client gets, so
// two of them comparing their user tables can tell they have the same person. 'pairwise'
// hands out an opaque id unique to the client, which is the only way to stop that.
//
// The pairwise value is stored on first use and reused forever after: it IS the user's
// identity at that client, so regenerating it would not "rotate a token", it would make
// them a stranger with an empty account.
async function subjectFor(p, client, userId) {
  if (client.subjectType !== 'pairwise') return userId;
  const existing = await p.oAuthPairwiseSub.findUnique({ where: { userId_clientId: { userId, clientId: client.id } } }).catch(() => null);
  if (existing) return existing.sub;
  const sub = `p_${crypto.randomBytes(24).toString('base64url')}`;
  try {
    await p.oAuthPairwiseSub.create({ data: { sub, userId, clientId: client.id } });
    return sub;
  } catch {
    // Lost a race with a concurrent first login — read the winner rather than minting a
    // second identity for the same person.
    const again = await p.oAuthPairwiseSub.findUnique({ where: { userId_clientId: { userId, clientId: client.id } } }).catch(() => null);
    return again?.sub || userId;
  }
}

// The reverse: turn whatever is in a token's `sub` back into a real user id. Every place
// that reads `sub` must go through this, or a pairwise client's tokens resolve to nobody.
async function userIdFromSub(p, sub) {
  if (!sub) return null;
  if (!String(sub).startsWith('p_')) return sub;
  const row = await p.oAuthPairwiseSub.findUnique({ where: { sub: String(sub) } }).catch(() => null);
  return row?.userId || null;
}

// `at_hash` (OIDC core §3.1.3.6): left half of SHA-256 over the access token, base64url.
// Lets a client prove the ID token and the access token were issued together, instead of
// trusting that whatever arrived alongside belongs to it. Strict validators warn without it.
const halfHash = (value) => {
  const d = crypto.createHash('sha256').update(String(value)).digest();
  return d.subarray(0, d.length / 2).toString('base64url');
};

async function mintTokens(p, { client, user, scope, nonce, authTime }) {
  const scopes = scope.split(' ');
  const sub = await subjectFor(p, client, user.id);
  const idClaims = { sub, aud: client.id };
  if (nonce) idClaims.nonce = nonce;
  // When the user actually authenticated. Required whenever the client asked for it, and
  // the only thing that makes `max_age` verifiable at the other end.
  if (authTime) idClaims.auth_time = authTime;
  if (scopes.includes('profile')) idClaims.name = user.displayName || '';
  if (scopes.includes('email')) { idClaims.email = user.email || ''; idClaims.email_verified = true; }
  const access_token = await signRs256({ sub, aud: client.id, scope, token_use: 'access' }, 3600);
  // Signed AFTER the access token, since at_hash is computed over it.
  idClaims.at_hash = halfHash(access_token);
  const id_token = await signRs256(idClaims, 3600);
  const refresh = crypto.randomBytes(32).toString('base64url');
  // The refresh row keeps the REAL user id: it is our own bookkeeping, and storing the
  // pairwise alias here would mean resolving it on every refresh for no benefit.
  await p.oAuthRefreshToken.create({ data: { token: sha256(refresh), clientId: client.id, userId: user.id, scope, expiresAt: new Date(Date.now() + 30 * 864e5) } });
  return { access_token, token_type: 'Bearer', expires_in: 3600, id_token, refresh_token: refresh, scope };
}
// Minimal, self-contained HTML pages (no SPA dependency) — brand-tinted.
const shell = (title, inner) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  body{margin:0;background:#0e0c09;color:#f3efe9;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;min-height:100vh}
  .card{background:#15120d;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:28px;max-width:420px;width:92%;box-shadow:0 20px 60px -12px rgba(0,0,0,.6)}
  h1{font-size:19px;margin:0 0 6px} p{color:#a39b8f;font-size:14px;margin:.4em 0}
  .brand{color:#f97316;font-weight:700} ul{list-style:none;padding:0;margin:14px 0}
  li{display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid rgba(255,255,255,.08);font-size:14px}
  .dot{width:6px;height:6px;border-radius:99px;background:#f59e0b;flex:none}
  .row{display:flex;gap:10px;margin-top:18px} button{flex:1;padding:11px;border-radius:11px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid transparent}
  .approve{background:linear-gradient(120deg,#f97316,#f59e0b);color:#fff} .deny{background:transparent;border-color:rgba(255,255,255,.16);color:#a39b8f}
</style></head><body><div class="card">${inner}</div></body></html>`;
const errPage = (msg) => shell('Error', `<h1>Authorization error</h1><p>${esc(msg)}</p>`);

export default async function oidcProviderRoutes(app) {
  // ── Discovery + JWKS (public; the whole point is that anyone can fetch these) ──
  app.get('/.well-known/openid-configuration', { config: { rateLimit: false } }, async () => {
    const iss = issuer();
    return {
      issuer: iss,
      authorization_endpoint: `${iss}/oauth2/authorize`,
      token_endpoint: `${iss}/oauth2/token`,
      userinfo_endpoint: `${iss}/oauth2/userinfo`,
      revocation_endpoint: `${iss}/oauth2/revoke`,
      introspection_endpoint: `${iss}/oauth2/introspect`,
      end_session_endpoint: `${iss}/oauth2/logout`,
      jwks_uri: `${iss}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      subject_types_supported: ['public', 'pairwise'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: SCOPES,
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256'],
      // Advertised because a client library reads this to decide whether silent renewal
      // is even possible. Claiming support it does not have is worse than claiming none:
      // the client builds the iframe, waits, and times out with nothing to report.
      prompt_values_supported: ['none', 'login', 'consent'],
      response_modes_supported: ['query'],
      claims_supported: ['sub', 'name', 'email', 'email_verified', 'picture', 'auth_time', 'at_hash', 'nonce'],
      // Advertised so a client library knows it may ask. Claiming it and ignoring it is
      // the failure mode that looks like success until an RP validates auth_time.
      request_parameter_supported: false,
      claims_parameter_supported: false,
    };
  });
  app.get('/.well-known/jwks.json', { config: { rateLimit: false } }, async () => jwks());

  // The token endpoint receives application/x-www-form-urlencoded (per OAuth2). Add a
  // parser scoped to this plugin so req.body is an object there (JSON still works too).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    try { done(null, querystring.parse(body)); } catch (e) { done(e); }
  });

  // ── Authorization endpoint (browser flow) ──
  app.get('/oauth2/authorize', { preHandler: optionalAuth() }, async (req, reply) => {
    const q = req.query || {};
    const p = await db();
    const client = q.client_id ? await p.oAuthClient.findUnique({ where: { id: String(q.client_id) } }) : null;
    // client_id + redirect_uri must be valid BEFORE we may redirect back anywhere.
    if (!client || !client.active) return reply.code(400).type('text/html').send(errPage('Unknown or disabled client.'));
    const redir = String(q.redirect_uri || '');
    if (!redir || !client.redirectUris.includes(redir)) return reply.code(400).type('text/html').send(errPage('Invalid redirect_uri (not registered for this client).'));
    const state = q.state ? String(q.state) : '';
    const bad = (error) => reply.redirect(backTo(redir, { error, ...(state ? { state } : {}) }));
    const check = validateAuthorizeRequest(client, q);
    if (check.error) return bad(check.error);
    const { scopes, challenge } = check;
    // `prompt` (OIDC core §3.1.2.1). Space-delimited; only these three mean anything here.
    const prompts = new Set(String(q.prompt || '').split(' ').filter(Boolean));
    // `none` is the silent-renewal case: a client refreshing in a hidden iframe MUST get
    // an immediate error rather than a login page it cannot show. Returning HTML here is
    // the classic failure — the iframe renders a sign-in form nobody can see and the
    // client hangs until it times out.
    if (prompts.has('none')) {
      if (!req.user?.uid) return bad('login_required');
    } else if (!req.user?.uid || prompts.has('login')) {
      // `login` forces re-authentication even for a signed-in user.
      return reply.redirect(`${issuer()}/auth?next=${encodeURIComponent(req.raw.url)}${prompts.has('login') ? '&reauth=1' : ''}`);
    }
    // `max_age` (OIDC core §3.1.2.1): the client will not accept an authentication older
    // than N seconds. Honoured against the CURRENT session's start, and it forces a fresh
    // login rather than silently issuing a token the client is about to reject — a
    // provider that ignores max_age looks fine right up to the moment the RP validates
    // auth_time and rejects everything.
    const maxAge = Number(q.max_age);
    let authTime = null;
    if (req.user?.sid) {
      const sess = await p.session.findUnique({ where: { id: req.user.sid }, select: { createdAt: true } }).catch(() => null);
      if (sess) authTime = Math.floor(sess.createdAt.getTime() / 1000);
    }
    if (Number.isFinite(maxAge) && maxAge >= 0) {
      const tooOld = !authTime || (Date.now() / 1000 - authTime) > maxAge;
      if (tooOld) {
        // With prompt=none there is no way to re-authenticate, so say so instead of
        // sending an iframe somewhere it cannot go.
        if (prompts.has('none')) return bad('login_required');
        return reply.redirect(`${issuer()}/auth?next=${encodeURIComponent(req.raw.url)}&reauth=1`);
      }
    }

    // Skip the prompt if this user already consented to (at least) these scopes.
    const consent = await p.oAuthConsent.findUnique({ where: { userId_clientId: { userId: req.user.uid, clientId: client.id } } }).catch(() => null);
    const scopeStr = scopes.join(' ');
    const alreadyConsented = !!consent && scopes.every((s) => consent.scope.split(' ').includes(s));
    // `none` must never show a consent screen either — same reason.
    if (prompts.has('none') && !alreadyConsented) return bad('consent_required');
    // `consent` forces the screen even when they have said yes before, which is how a
    // client asks the user to re-confirm after a scope change.
    if (alreadyConsented && !prompts.has('consent')) {
      const code = await issueCode(p, { client, userId: req.user.uid, redirectUri: redir, scope: scopeStr, nonce: String(q.nonce || ''), codeChallenge: challenge, authTime });
      return reply.redirect(backTo(redir, { code, ...(state ? { state } : {}) }));
    }
    const reqToken = jwt.sign({ purpose: 'oauth-consent', uid: req.user.uid, clientId: client.id, redirectUri: redir, scope: scopeStr, state, nonce: String(q.nonce || ''), codeChallenge: challenge, authTime }, JWT_SECRET, { expiresIn: 600 });
    // Hand off to the branded SPA consent screen; the signed reqToken carries the
    // validated request so the decision endpoint can trust it.
    return reply.redirect(`${issuer()}/authorize?rt=${encodeURIComponent(reqToken)}`);
  });

  // Consent details for the SPA screen (verifies the signed request token).
  app.get('/oauth2/consent-info', async (req, reply) => {
    let c;
    try { c = jwt.verify(String(req.query?.rt || ''), JWT_SECRET); } catch { return reply.code(400).send({ error: 'invalid' }); }
    if (c.purpose !== 'oauth-consent') return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    const client = await p.oAuthClient.findUnique({ where: { id: c.clientId } });
    if (!client) return reply.code(404).send({ error: 'not_found' });
    // Everything the screen needs to answer "which app is this, really" — the question it
    // exists for. An unverified client is not blocked; it is labelled, and its owner is
    // named, so the decision is made with the same facts we have.
    const owner = client.ownerId
      ? await p.user.findUnique({ where: { id: client.ownerId }, select: { displayName: true } }).catch(() => null)
      : null;
    return {
      clientName: client.name, scopes: c.scope.split(' '),
      verified: client.verified,
      description: client.description || '',
      homepageUrl: client.homepageUrl || null,
      ownerName: owner?.displayName || null,
      firstParty: !client.ownerId,
    };
  });

  // Consent decision (POST from the consent page).
  app.post('/oauth2/authorize/decision', { preHandler: optionalAuth() }, async (req, reply) => {
    let c;
    try { c = jwt.verify((req.body || {}).request_token, JWT_SECRET); } catch { return reply.code(400).type('text/html').send(errPage('This authorization request expired — please start again.')); }
    if (c.purpose !== 'oauth-consent') return reply.code(400).type('text/html').send(errPage('Bad request.'));
    if (!req.user?.uid || req.user.uid !== c.uid) return reply.code(403).type('text/html').send(errPage('Session mismatch — please start again.'));
    const redir = c.redirectUri, state = c.state || '';
    if ((req.body || {}).decision !== 'approve') return reply.redirect(backTo(redir, { error: 'access_denied', ...(state ? { state } : {}) }));
    const p = await db();
    const client = await p.oAuthClient.findUnique({ where: { id: c.clientId } });
    if (!client || !client.active) return reply.code(400).type('text/html').send(errPage('Client no longer available.'));
    await p.oAuthConsent.upsert({ where: { userId_clientId: { userId: c.uid, clientId: client.id } }, create: { userId: c.uid, clientId: client.id, scope: c.scope }, update: { scope: c.scope } });
    const code = await issueCode(p, { client, userId: c.uid, redirectUri: redir, scope: c.scope, nonce: c.nonce, codeChallenge: c.codeChallenge, authTime: c.authTime });
    return reply.redirect(backTo(redir, { code, ...(state ? { state } : {}) }));
  });

  // Shared token-endpoint client authentication (client_secret_post/basic, or public).
  async function authClient(p, req, b) {
    const basic = parseBasicAuth(req.headers['authorization']);
    const clientId = String(b.client_id || basic?.id || '');
    const clientSecret = b.client_secret || basic?.secret || '';
    const client = clientId ? await p.oAuthClient.findUnique({ where: { id: clientId } }) : null;
    if (!client || !client.active) return { error: 'invalid_client' };
    // safeEqual, not `!==`: this compares a SECRET, and `!==` on strings returns as soon as
    // two bytes differ, which leaks how much of a guess was right. It is also the rule this
    // repo already wrote down for itself and then broke here.
    if (client.confidential && (!clientSecret || !safeEqual(sha256(String(clientSecret)), client.secretHash))) return { error: 'invalid_client' };
    return { client };
  }

  // ── Token endpoint (authorization_code + refresh_token grants) ──
  app.post('/oauth2/token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body || {};
    reply.header('Cache-Control', 'no-store');
    const p = await db();
    const auth = await authClient(p, req, b);
    if (auth.error) {
      // RFC 6749 §5.2: a 401 answering Basic credentials must say so, or a client that
      // authenticated the wrong way has no idea which way was expected.
      if (/^Basic\s/i.test(req.headers['authorization'] || '')) reply.header('WWW-Authenticate', 'Basic realm="oauth2"');
      return reply.code(401).send({ error: auth.error });
    }
    const client = auth.client;

    if (b.grant_type === 'authorization_code') {
      const code = await p.oAuthCode.findUnique({ where: { code: String(b.code || '') } });
      if (!code || code.clientId !== client.id || code.usedAt || code.expiresAt < new Date() || code.redirectUri !== String(b.redirect_uri || '')) return reply.code(400).send({ error: 'invalid_grant' });
      if (code.codeChallenge) { // PKCE
        if (!verifyPkce(code.codeChallenge, b.code_verifier)) return reply.code(400).send({ error: 'invalid_grant' });
      }
      // Single-use: atomically claim the code (loser of a race → invalid_grant).
      const claimed = await p.oAuthCode.updateMany({ where: { code: code.code, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count === 0) return reply.code(400).send({ error: 'invalid_grant' });
      const user = await p.user.findUnique({ where: { id: code.userId }, select: { id: true, displayName: true, email: true } });
      if (!user) return reply.code(400).send({ error: 'invalid_grant' });
      return mintTokens(p, { client, user, scope: code.scope, nonce: code.nonce, authTime: code.authTime || null });
    }

    if (b.grant_type === 'refresh_token') {
      const rt = await p.oAuthRefreshToken.findUnique({ where: { token: sha256(String(b.refresh_token || '')) } });
      if (!rt || rt.clientId !== client.id) return reply.code(400).send({ error: 'invalid_grant' });
      if (rt.revokedAt) {
        // Reuse of an already-rotated token = likely theft → revoke the WHOLE family for
        // this user+client (OAuth security BCP reuse-detection), forcing a re-login.
        await p.oAuthRefreshToken.updateMany({ where: { userId: rt.userId, clientId: client.id, revokedAt: null }, data: { revokedAt: new Date() } });
        return reply.code(400).send({ error: 'invalid_grant' });
      }
      if (rt.expiresAt < new Date()) return reply.code(400).send({ error: 'invalid_grant' });
      // Rotate: revoke the presented token before issuing a fresh set.
      await p.oAuthRefreshToken.update({ where: { token: rt.token }, data: { revokedAt: new Date() } });
      const user = await p.user.findUnique({ where: { id: rt.userId }, select: { id: true, displayName: true, email: true, status: true, closedAt: true, closureScheduledFor: true } });
      if (!user) return reply.code(400).send({ error: 'invalid_grant' });

      // The account is re-checked on every refresh, and this is the point of the whole
      // change: an access token lives an hour, but a refresh token renews itself for as long
      // as the client keeps asking. Without this, banning somebody ended their SESSIONS and
      // left every app they had connected signed in indefinitely — moderation that the
      // moderator could not see failing.
      if (user.closedAt || (user.status && user.status !== 'active')) {
        await p.oAuthRefreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});
        return reply.code(400).send({ error: 'invalid_grant', error_description: 'The account is no longer active.' });
      }

      // RFC 6749 §6: a refresh MAY narrow the scope, never widen it. Ignoring the parameter
      // handed back more than the client asked for, which is the wrong direction to be
      // generous in — a client dropping a scope is trying to hold less.
      let scope = rt.scope;
      if (b.scope != null && String(b.scope).trim()) {
        const had = new Set(rt.scope.split(' ').filter(Boolean));
        const want = String(b.scope).trim().split(/\s+/);
        if (want.some((x) => !had.has(x))) {
          return reply.code(400).send({ error: 'invalid_scope', error_description: 'A refresh cannot ask for more than was granted.' });
        }
        scope = want.join(' ');
      }
      return mintTokens(p, { client, user, scope });
    }

    return reply.code(400).send({ error: 'unsupported_grant_type' });
  });

  // ── UserInfo (Bearer access token → claims for the granted scopes) ──
  const userinfo = async (req, reply) => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
    if (!m) { reply.header('WWW-Authenticate', 'Bearer'); return reply.code(401).send({ error: 'invalid_token' }); }
    let claims;
    try { claims = await verifyRs256(m[1]); } catch { reply.header('WWW-Authenticate', 'Bearer error="invalid_token"'); return reply.code(401).send({ error: 'invalid_token' }); }
    if (claims.token_use !== 'access') return reply.code(401).send({ error: 'invalid_token' });
    const p = await db();
    // A pairwise `sub` is an alias, not a user id — look the real one up before touching
    // the user table, or every pairwise client's userinfo call 401s for no visible reason.
    const uid = await userIdFromSub(p, claims.sub);
    const user = uid ? await p.user.findUnique({ where: { id: uid }, select: { id: true, displayName: true, email: true } }) : null;
    if (!user) return reply.code(401).send({ error: 'invalid_token' });
    const scopes = String(claims.scope || '').split(' ');
    // Echo the sub the CLIENT knows, never the internal id: handing back the real one
    // would undo the whole point of pairwise in the one response clients read most.
    const out = { sub: claims.sub };
    if (scopes.includes('profile')) {
      out.name = user.displayName || '';
      // `picture` has been in claims_supported since this provider shipped and was never
      // returned — a client following our own discovery document asked for a claim it could
      // not get. The avatar endpoint renders for any account id, so there is always one.
      out.picture = `${issuer()}/api/avatar/${user.id}`;
    }
    if (scopes.includes('email')) { out.email = user.email || ''; out.email_verified = true; }
    return out;
  };
  app.get('/oauth2/userinfo', userinfo);
  app.post('/oauth2/userinfo', userinfo);

  // ── OAuth-scoped resources: a client with the granted scope can read these with the
  // Bearer access token (verified against our JWKS). Read-only. ──
  const oauthBearer = (scope) => async (req, reply) => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
    if (!m) { reply.header('WWW-Authenticate', 'Bearer'); return reply.code(401).send({ error: 'invalid_token' }); }
    let c; try { c = await verifyRs256(m[1]); } catch { return reply.code(401).send({ error: 'invalid_token' }); }
    if (c.token_use !== 'access') return reply.code(401).send({ error: 'invalid_token' });
    if (scope && !String(c.scope || '').split(' ').includes(scope)) return reply.code(403).send({ error: 'insufficient_scope', scope });
    const uid = await userIdFromSub(await db(), c.sub);
    if (!uid) return reply.code(401).send({ error: 'invalid_token' });
    // `sub` stays as the client knows it; `userId` is what our own queries need. Keeping
    // both under distinct names is what stops a pairwise alias being used as a foreign key.
    req.oauthUser = { sub: c.sub, userId: uid, scope: c.scope };
  };
  app.get('/oauth2/me/items', { preHandler: oauthBearer('items') }, async (req) => {
    const p = await db();
    const items = await p.catalogItem.findMany({ where: { ownerId: req.oauthUser.userId }, select: { id: true, name: true, slug: true, kind: true, status: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { items };
  });
  app.get('/oauth2/me/repos', { preHandler: oauthBearer('repos') }, async (req) => {
    const p = await db();
    const repos = await p.serverRepo.findMany({ where: { ownerId: req.oauthUser.userId }, select: { id: true, name: true, hosted: true, listed: true, status: true, publicUrl: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { repos };
  });

  app.get('/oauth2/me/pools', { preHandler: oauthBearer('pools') }, async (req) => {
    const p = await db();
    const pools = await p.hostingGroup.findMany({
      where: { ownerId: req.oauthUser.userId },
      select: { id: true, name: true, freePlan: true, poolBytes: true, createdAt: true, repos: { select: { storageUsedBytes: true } } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    // BigInt does not survive JSON.stringify.
    return { pools: pools.map((g) => {
      const used = g.repos.reduce((n, r) => n + Number(r.storageUsedBytes ?? 0), 0);
      return { id: g.id, name: g.name, freePlan: g.freePlan, poolBytes: Number(g.poolBytes ?? 0), usedBytes: used, createdAt: g.createdAt };
    }) };
  });

  app.get('/oauth2/me/catalogs', { preHandler: oauthBearer('catalogs') }, async (req) => {
    const p = await db();
    const catalogs = await p.communityCatalog.findMany({
      where: { ownerId: req.oauthUser.userId },
      select: { id: true, name: true, slug: true, kinds: true, status: true, visibility: true, listed: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return { catalogs };
  });

  app.get('/oauth2/me/payments', { preHandler: oauthBearer('payments') }, async (req) => {
    const p = await db();
    // No Stripe session id: it identifies a record in somebody else's system and reading
    // your own invoices does not need it.
    const payments = await p.payment.findMany({
      where: { userId: req.oauthUser.userId },
      select: { id: true, kind: true, description: true, amountCents: true, currency: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return { payments };
  });

  // Starred repos and catalogs. The most-asked-for read after the profile itself: it is what
  // a launcher or a companion app needs to show "your stuff" without asking you to pick again.
  app.get('/oauth2/me/favorites', { preHandler: oauthBearer('favorites') }, async (req) => {
    const p = await db();
    const [repos, catalogs] = await Promise.all([
      p.repoFavorite.findMany({ where: { userId: req.oauthUser.userId }, select: { serverRepoId: true, createdAt: true } }).catch(() => []),
      p.catalogFavorite.findMany({ where: { userId: req.oauthUser.userId }, select: { catalogId: true, createdAt: true } }).catch(() => []),
    ]);
    return { repos, catalogs };
  });

  app.get('/oauth2/me/transfers', { preHandler: oauthBearer('transfers') }, async (req) => {
    const p = await db();
    const rows = await p.ownershipTransfer.findMany({
      where: { OR: [{ fromUserId: req.oauthUser.userId }, { toUserId: req.oauthUser.userId }] },
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, kind: true, status: true, createdAt: true, respondedAt: true },
    }).catch(() => []);
    return { transfers: rows };
  });

  // Read-only on purpose: an app may see what you were told, never mark it read on your
  // behalf. Writing needs an API key, which acts as YOU rather than for you.
  app.get('/oauth2/me/notifications', { preHandler: oauthBearer('notifications') }, async (req) => {
    const p = await db();
    const rows = await p.notification.findMany({
      where: { userId: req.oauthUser.userId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, kind: true, body: true, readAt: true, createdAt: true },
    }).catch(() => []);
    return { notifications: rows };
  });

  app.get('/oauth2/me/badges', { preHandler: oauthBearer('badges') }, async (req) => {
    const p = await db();
    const rows = await p.userBadge.findMany({
      where: { userId: req.oauthUser.userId },
      select: { grantedAt: true, badge: { select: { slug: true, name: true, color: true, icon: true } } },
    }).catch(() => []);
    return { badges: rows.map((b) => ({ ...b.badge, grantedAt: b.grantedAt })) };
  });

  // The numbers behind what they own. Aggregated, never per-visitor: a scope that handed over
  // who downloaded what would be handing over somebody else's behaviour, not the grantor's.
  app.get('/oauth2/me/stats', { preHandler: oauthBearer('stats') }, async (req) => {
    const p = await db();
    // Repos carry no download counter of their own — only catalog items and catalogs do — so
    // this reports what exists rather than inventing a zero that would read as "nobody came".
    const [items, catalogs] = await Promise.all([
      p.catalogItem.findMany({ where: { ownerId: req.oauthUser.userId }, select: { id: true, slug: true, name: true, downloads: true, views: true } }).catch(() => []),
      p.communityCatalog.findMany({ where: { ownerId: req.oauthUser.userId }, select: { id: true, name: true, downloads: true, views: true } }).catch(() => []),
    ]);
    return {
      items, catalogs,
      totals: {
        downloads: items.reduce((a, i) => a + (i.downloads || 0), 0) + catalogs.reduce((a, c) => a + (c.downloads || 0), 0),
        views: items.reduce((a, i) => a + (i.views || 0), 0) + catalogs.reduce((a, c) => a + (c.views || 0), 0),
      },
    };
  });

  app.get('/oauth2/me/polls', { preHandler: oauthBearer('polls') }, async (req) => {
    const p = await db();
    const votes = await p.pollVote.findMany({
      where: { userId: req.oauthUser.userId },
      orderBy: { createdAt: 'desc' }, take: 100,
      include: { option: { select: { label: true } }, poll: { select: { id: true, question: true, status: true } } },
    });
    return { votes: votes.map((v) => ({ pollId: v.poll.id, question: v.poll.question, status: v.poll.status, option: v.option.label, at: v.createdAt })) };
  });

  // ── Revocation (RFC 7009) — revokes a refresh token; always 200 for a valid client. ──
  app.post('/oauth2/revoke', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body || {};
    const p = await db();
    const auth = await authClient(p, req, b);
    if (auth.error) {
      // RFC 6749 §5.2: a 401 answering Basic credentials must say so, or a client that
      // authenticated the wrong way has no idea which way was expected.
      if (/^Basic\s/i.test(req.headers['authorization'] || '')) reply.header('WWW-Authenticate', 'Basic realm="oauth2"');
      return reply.code(401).send({ error: auth.error });
    }
    const tok = String(b.token || '');
    if (tok) await p.oAuthRefreshToken.updateMany({ where: { token: sha256(tok), clientId: auth.client.id }, data: { revokedAt: new Date() } }).catch(() => {});
    return reply.code(200).send({});
  });

  // ── Token introspection (RFC 7662) ──────────────────────────────────────────
  //
  // What a RESOURCE server calls to ask "is this token still good, and what does it
  // cover". Without it a third party holding one of our access tokens has only two
  // options: verify the JWT itself (fine, but it cannot see a refresh token that has been
  // revoked since) or call userinfo and infer. The spec's answer is this endpoint, and
  // its contract is unusual on purpose: an invalid token is NOT an error, it is
  // `{ active: false }` — so a caller cannot tell "revoked" from "never existed" from
  // "malformed", which is exactly the distinction an attacker would probe for.
  app.post('/oauth2/introspect', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body || {};
    reply.header('Cache-Control', 'no-store');
    const p = await db();
    // Client authentication is required — introspection tells you about somebody's token,
    // so an open endpoint would be a token oracle for the whole internet.
    const auth = await authClient(p, req, b);
    if (auth.error) {
      // RFC 6749 §5.2: a 401 answering Basic credentials must say so, or a client that
      // authenticated the wrong way has no idea which way was expected.
      if (/^Basic\s/i.test(req.headers['authorization'] || '')) reply.header('WWW-Authenticate', 'Basic realm="oauth2"');
      return reply.code(401).send({ error: auth.error });
    }
    const token = String(b.token || '');
    if (!token) return { active: false };

    // A refresh token is opaque (stored hashed); an access/ID token is a JWT.
    const rt = await p.oAuthRefreshToken.findUnique({ where: { token: sha256(token) } }).catch(() => null);
    if (rt) {
      const live = !rt.revokedAt && rt.expiresAt > new Date() && rt.clientId === auth.client.id;
      if (!live) return { active: false };
      // The refresh row stores the real user id, so the pairwise alias has to be put back
      // on the way out — a client must never learn the internal id through introspection.
      const client = auth.client;
      const sub = await subjectFor(p, client, rt.userId);
      return { active: true, token_type: 'refresh_token', client_id: rt.clientId, sub, scope: rt.scope, exp: Math.floor(rt.expiresAt.getTime() / 1000) };
    }
    let c;
    try { c = await verifyRs256(token); } catch { return { active: false }; }
    // Only ever answer about the caller's OWN tokens: one client must not be able to
    // inspect another's, which would leak both the subject and the granted scopes.
    if (c.aud !== auth.client.id) return { active: false };
    return {
      active: true,
      token_type: c.token_use === 'access' ? 'access_token' : 'id_token',
      client_id: c.aud, sub: c.sub, scope: c.scope || '', iss: c.iss, exp: c.exp, iat: c.iat,
    };
  });

  // ── RP-initiated logout (OIDC session management) ───────────────────────────
  //
  // A client sends the user here to end the session. Deliberately NOT a silent redirect:
  // the request arrives with no proof it came from the user rather than from any page
  // that can host an <img> tag, so signing somebody out on GET alone is a CSRF with a
  // friendly name. The user sees a page and confirms.
  //
  // post_logout_redirect_uri is honoured only when it is one of the client's REGISTERED
  // redirect URIs — an unvalidated one turns this into an open redirect with our domain
  // on it, which is a phishing primitive.
  app.get('/oauth2/logout', { preHandler: optionalAuth() }, async (req, reply) => {
    const q = req.query || {};
    const p = await db();
    let client = null;
    if (q.client_id) client = await p.oAuthClient.findUnique({ where: { id: String(q.client_id) } }).catch(() => null);
    const want = String(q.post_logout_redirect_uri || '');
    const allowed = !!want && !!client && client.redirectUris.includes(want);
    const back = allowed ? want : '';
    const state = q.state ? String(q.state) : '';
    const target = back ? `${back}${back.includes('?') ? '&' : '?'}${state ? `state=${encodeURIComponent(state)}` : ''}` : `${issuer()}/`;
    return reply.type('text/html').send(shell('Sign out', `
      <h1>Sign out of <span class="brand">BetterCommunity</span>?</h1>
      <p>${client ? `${esc(client.name)} asked to end your session.` : 'This will end your session on this site.'}</p>
      ${want && !allowed ? '<p>The return address it supplied is not registered, so you will be returned here instead.</p>' : ''}
      <form method="POST" action="${issuer()}/oauth2/logout">
        <input type="hidden" name="redirect" value="${esc(target)}">
        <div class="row"><button class="approve" type="submit">Sign out</button>
        <button class="deny" type="button" onclick="history.back()">Cancel</button></div>
      </form>`));
  });

  app.post('/oauth2/logout', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    if (req.user?.uid) {
      // End the BCWEB session AND every OAuth refresh token the user holds: "sign out"
      // that leaves a 30-day refresh token alive has not signed anyone out of anything.
      await p.oAuthRefreshToken.updateMany({ where: { userId: req.user.uid, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});
      await p.session.updateMany({ where: { userId: req.user.uid, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});
    }
    clearSession(reply);
    const to = String((req.body || {}).redirect || `${issuer()}/`);
    // Re-validated rather than trusted from the form: the GET built it, but a POST body
    // is just as forgeable as a query string.
    return reply.redirect(to.startsWith(issuer()) || /^https?:\/\//i.test(to) ? to : `${issuer()}/`);
  });

  // ── The user's own view: which apps can reach their account ─────────────────
  //
  // Every provider that people actually trust has this screen. Without it a consent is a
  // one-way door: the user grants access once and has no way to see it again, let alone
  // take it back.
  app.get('/me/connected-apps', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const consents = await p.oAuthConsent.findMany({ where: { userId: req.user.uid } });
    const ids = consents.map((c) => c.clientId);
    const clients = ids.length ? await p.oAuthClient.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, active: true } }) : [];
    const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
    const live = await p.oAuthRefreshToken.groupBy({ by: ['clientId'], where: { userId: req.user.uid, revokedAt: null }, _count: { _all: true } }).catch(() => []);
    const liveBy = Object.fromEntries(live.map((r) => [r.clientId, r._count._all]));
    return {
      apps: consents.map((c) => ({
        clientId: c.clientId,
        name: byId[c.clientId]?.name || '(removed app)',
        scope: c.scope,
        grantedAt: c.createdAt,
        activeTokens: liveBy[c.clientId] || 0,
      })),
    };
  });

  app.delete('/me/connected-apps/:clientId', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const clientId = String(req.params.clientId);
    // Both halves, or "revoke" is a lie: dropping the consent alone leaves every issued
    // refresh token working until it expires, so the app keeps its access for a month.
    await p.oAuthRefreshToken.updateMany({ where: { userId: req.user.uid, clientId, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});
    await p.oAuthConsent.deleteMany({ where: { userId: req.user.uid, clientId } }).catch(() => {});
    return { ok: true };
  });


  // ── Admin: who is connected to what ─────────────────────────────────────────
  //
  // Two different things live under the word "SSO" and this endpoint keeps them apart,
  // because conflating them is the easy mistake and it points the wrong way:
  //
  //   · SIGN-IN LINKS (OAuthAccount) — the user signs in to US with GitHub or Discord.
  //     We are the client. Removing one costs the user a way in.
  //   · GRANTS (OAuthConsent + refresh tokens) — an outside app signs its users in with
  //     US. We are the identity provider. Revoking one cuts that app's access.
  //
  // Same screen, never the same list.

  app.get('/admin/sso/grants', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const clientId = String(req.query?.clientId || '').trim();

    const consents = await p.oAuthConsent.findMany({
      where: clientId ? { clientId } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const userIds = [...new Set(consents.map((c) => c.userId))];
    const clientIds = [...new Set(consents.map((c) => c.clientId))];
    const [users, clients, live] = await Promise.all([
      userIds.length ? p.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, email: true } }) : [],
      clientIds.length ? p.oAuthClient.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, active: true } }) : [],
      p.oAuthRefreshToken.groupBy({ by: ['clientId', 'userId'], where: { revokedAt: null, expiresAt: { gt: new Date() } }, _count: { _all: true } }).catch(() => []),
    ]);
    const uBy = Object.fromEntries(users.map((u) => [u.id, u]));
    const cBy = Object.fromEntries(clients.map((c) => [c.id, c]));
    const liveBy = Object.fromEntries(live.map((r) => [`${r.userId}|${r.clientId}`, r._count._all]));

    const rows = consents.map((c) => ({
      userId: c.userId, clientId: c.clientId, scope: c.scope, grantedAt: c.createdAt,
      user: uBy[c.userId] || null,
      // A grant whose client has been deleted still exists and still needs to be visible:
      // it is the row somebody has to clean up, and hiding it is how it never gets cleaned.
      client: cBy[c.clientId] || { id: c.clientId, name: '(removed app)', active: false },
      activeTokens: liveBy[`${c.userId}|${c.clientId}`] || 0,
    }));

    const needle = q.toLowerCase();
    return {
      grants: q ? rows.filter((r) => `${r.user?.displayName || ''} ${r.user?.email || ''} ${r.client.name}`.toLowerCase().includes(needle)) : rows,
      total: rows.length,
    };
  });

  /** Cut one person's grant to one app. */
  app.delete('/admin/sso/grants/:userId/:clientId', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const { userId, clientId } = req.params;
    // Both halves, same reason as the self-service route: dropping the consent alone leaves
    // every issued refresh token working until it expires, so "revoked" would mean "still
    // has access for a month".
    const tokens = await p.oAuthRefreshToken.updateMany({ where: { userId, clientId, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => ({ count: 0 }));
    await p.oAuthConsent.deleteMany({ where: { userId, clientId } }).catch(() => {});
    const client = await p.oAuthClient.findUnique({ where: { id: clientId }, select: { name: true } });
    await logAudit(p, req.user.uid, 'sso.grant_revoked', `${clientId} for user ${userId}`, clientIp(req));
    // The user is told: their next sign-in to that app will ask for consent again, and an
    // unexplained re-prompt reads as a bug in the app, not as a staff action here.
    await notify(p, userId, 'sso_revoked', `Your connection to “${client?.name || clientId}” was removed by staff. Signing in there again will ask for your permission afresh.`);
    return { ok: true, tokensRevoked: tokens.count };
  });

  /** Everything SSO about ONE user — for the admin User details panel. */
  app.get('/admin/sso/users/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const userId = req.params.id;
    const [links, discord, consents, tokens] = await Promise.all([
      p.oAuthAccount.findMany({ where: { userId }, select: { provider: true, username: true, providerAccountId: true, linkedAt: true } }),
      p.discordLink.findUnique({ where: { userId } }).catch(() => null),
      p.oAuthConsent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      p.oAuthRefreshToken.findMany({ where: { userId }, select: { clientId: true, revokedAt: true, expiresAt: true, createdAt: true } }),
    ]);
    const clientIds = [...new Set(consents.map((c) => c.clientId))];
    const clients = clientIds.length ? await p.oAuthClient.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, active: true, subjectType: true } }) : [];
    const cBy = Object.fromEntries(clients.map((c) => [c.id, c]));
    const now = Date.now();
    return {
      // We are the client here.
      signInLinks: links,
      discord: discord ? { discordId: discord.discordId, username: discord.username, linkedAt: discord.linkedAt } : null,
      // We are the identity provider here.
      grants: consents.map((c) => ({
        clientId: c.clientId, scope: c.scope, grantedAt: c.createdAt,
        client: cBy[c.clientId] || { id: c.clientId, name: '(removed app)', active: false },
        activeTokens: tokens.filter((tk) => tk.clientId === c.clientId && !tk.revokedAt && new Date(tk.expiresAt).getTime() > now).length,
      })),
    };
  });

  /** Per-client rollup for the SSO tab: how many people, how many live sessions. */
  app.get('/admin/sso/clients/stats', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const [byClient, liveByClient] = await Promise.all([
      p.oAuthConsent.groupBy({ by: ['clientId'], _count: { _all: true } }).catch(() => []),
      p.oAuthRefreshToken.groupBy({ by: ['clientId'], where: { revokedAt: null, expiresAt: { gt: new Date() } }, _count: { _all: true } }).catch(() => []),
    ]);
    const users = Object.fromEntries(byClient.map((r) => [r.clientId, r._count._all]));
    const live = Object.fromEntries(liveByClient.map((r) => [r.clientId, r._count._all]));
    return { users, live };
  });


  // ── Self-service client registration ────────────────────────────────────────
  //
  // Anyone signed in can register an app. What that does NOT mean: dynamic registration
  // (RFC 7591) is still off — an unauthenticated endpoint that mints client_ids is a spam
  // surface with no owner to hold responsible. Every client here belongs to an account.
  //
  // The redirect_uri policy is the security of this whole feature. An authorization code
  // is delivered to whatever URI the client registers, so a loose policy is not a
  // convenience, it is a way to have codes delivered somewhere else.

  const MAX_CLIENTS_PER_USER = 5;

  /** https everywhere, plus loopback for local development, and nothing clever. */
  function badRedirect(uri) {
    let u;
    try { u = new URL(uri); } catch { return 'not a URL'; }
    if (u.hash) return 'must not contain a #fragment';
    if (u.username || u.password) return 'must not contain credentials';
    const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol === 'http:' && !loopback) return 'must be https (http is only allowed on localhost)';
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'must be an http(s) URL';
    // A wildcard host would let anyone who can register a subdomain receive the codes.
    if (u.hostname.includes('*')) return 'must not use a wildcard host';
    return null;
  }

  const publicClientView = (c) => ({
    id: c.id, name: c.name, description: c.description, homepageUrl: c.homepageUrl,
    confidential: c.confidential, redirectUris: c.redirectUris, scopes: c.scopes,
    active: c.active, verified: c.verified, subjectType: c.subjectType, createdAt: c.createdAt,
  });

  app.get('/me/oauth-clients', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const clients = await p.oAuthClient.findMany({ where: { ownerId: req.user.uid }, orderBy: { createdAt: 'desc' } });
    // How many people have actually connected each one — the number an app author wants,
    // and the one that makes an abandoned registration obvious.
    const consents = clients.length
      ? await p.oAuthConsent.groupBy({ by: ['clientId'], where: { clientId: { in: clients.map((c) => c.id) } }, _count: { _all: true } }).catch(() => [])
      : [];
    const users = Object.fromEntries(consents.map((r) => [r.clientId, r._count._all]));
    return {
      clients: clients.map((c) => ({ ...publicClientView(c), users: users[c.id] || 0 })),
      max: MAX_CLIENTS_PER_USER,
      scopes: SCOPES,
    };
  });

  app.post('/me/oauth-clients', { preHandler: requireRole(), config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(2).max(120),
      description: z.string().max(300).default(''),
      homepageUrl: z.string().url().max(300).optional().or(z.literal('')),
      confidential: z.boolean().optional(),
      redirectUris: z.array(z.string().max(500)).min(1).max(10),
      scopes: z.array(z.enum(SCOPES)).optional(),
      subjectType: z.enum(['public', 'pairwise']).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;

    for (const uri of d.redirectUris) {
      const why = badRedirect(uri);
      // The reason is returned, not swallowed: "invalid redirect URI" with no explanation
      // is how somebody spends twenty minutes on a missing s in https.
      if (why) return reply.code(400).send({ error: 'bad_redirect_uri', uri, detail: why });
    }

    const p = await db();
    const mine = await p.oAuthClient.count({ where: { ownerId: req.user.uid } });
    if (mine >= MAX_CLIENTS_PER_USER) return reply.code(409).send({ error: 'too_many', max: MAX_CLIENTS_PER_USER });

    const confidential = d.confidential !== false;
    const secret = confidential ? crypto.randomBytes(32).toString('base64url') : '';
    const c = await p.oAuthClient.create({ data: {
      name: d.name.trim(), description: d.description.trim(), homepageUrl: d.homepageUrl || null,
      confidential, secretHash: secret ? sha256(secret) : '',
      redirectUris: d.redirectUris, scopes: d.scopes?.length ? d.scopes : SCOPES,
      subjectType: d.subjectType || 'public',
      ownerId: req.user.uid, verified: false,
    } });
    await logAudit(p, req.user.uid, 'oauth.client_registered', `${c.name} (${c.id})`, clientIp(req));
    return reply.code(201).send({ client: publicClientView(c), clientSecret: secret || null });
  });

  /** Edit your own client. Not the subject type: changing it re-identifies every user of
   *  the client at once, orphaning their accounts instead of migrating them. */
  app.patch('/me/oauth-clients/:id', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(2).max(120).optional(),
      description: z.string().max(300).optional(),
      homepageUrl: z.string().url().max(300).optional().or(z.literal('')),
      redirectUris: z.array(z.string().max(500)).min(1).max(10).optional(),
      scopes: z.array(z.enum(SCOPES)).optional(),
      active: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    for (const uri of b.data.redirectUris || []) {
      const why = badRedirect(uri);
      if (why) return reply.code(400).send({ error: 'bad_redirect_uri', uri, detail: why });
    }
    const p = await db();
    const own = await p.oAuthClient.findFirst({ where: { id: req.params.id, ownerId: req.user.uid }, select: { id: true, verified: true, name: true, redirectUris: true } });
    if (!own) return reply.code(404).send({ error: 'not_found' });

    const data = {};
    for (const k of ['name', 'description', 'redirectUris', 'scopes', 'active']) if (b.data[k] !== undefined) data[k] = b.data[k];
    if (b.data.homepageUrl !== undefined) data.homepageUrl = b.data.homepageUrl || null;
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'nothing_to_update' });

    // Editing what the consent screen vouches for drops the verification. A review that
    // survived a rename and a change of redirect target would be a review of nothing.
    const identityChanged = ('name' in data) || ('redirectUris' in data);
    if (identityChanged && own.verified) data.verified = false;

    const c = await p.oAuthClient.update({ where: { id: own.id }, data });
    return { ok: true, client: publicClientView(c), verificationLost: !!(identityChanged && own.verified) };
  });

  app.post('/me/oauth-clients/:id/rotate', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const own = await p.oAuthClient.findFirst({ where: { id: req.params.id, ownerId: req.user.uid }, select: { id: true, confidential: true } });
    if (!own) return reply.code(404).send({ error: 'not_found' });
    if (!own.confidential) return reply.code(400).send({ error: 'public_client' });
    const secret = crypto.randomBytes(32).toString('base64url');
    await p.oAuthClient.update({ where: { id: own.id }, data: { secretHash: sha256(secret) } });
    await logAudit(p, req.user.uid, 'oauth.client_secret_rotated', own.id, clientIp(req));
    return { clientSecret: secret };
  });

  app.delete('/me/oauth-clients/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const own = await p.oAuthClient.findFirst({ where: { id: req.params.id, ownerId: req.user.uid }, select: { id: true, name: true } });
    if (!own) return reply.code(404).send({ error: 'not_found' });
    // Everything issued in this client's name goes with it. Leaving live refresh tokens
    // behind would mean an app the owner deleted keeps its access until they expire.
    await p.oAuthRefreshToken.updateMany({ where: { clientId: own.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});
    await p.oAuthConsent.deleteMany({ where: { clientId: own.id } }).catch(() => {});
    await p.oAuthClient.delete({ where: { id: own.id } });
    await logAudit(p, req.user.uid, 'oauth.client_deleted', `${own.name} (${own.id})`, clientIp(req));
    return { ok: true };
  });

  // ── Admin: OAuth client registry ──
  app.get('/admin/oauth-clients', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const clients = await p.oAuthClient.findMany({ orderBy: { createdAt: 'desc' } });
    // Never return secretHash.
    const ownerIds = [...new Set(clients.map((c) => c.ownerId).filter(Boolean))];
    const owners = ownerIds.length ? await p.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, displayName: true, email: true } }) : [];
    const byId = Object.fromEntries(owners.map((u) => [u.id, u]));
    // Never return secretHash.
    return { clients: clients.map((c) => ({
      id: c.id, name: c.name, description: c.description, homepageUrl: c.homepageUrl,
      confidential: c.confidential, redirectUris: c.redirectUris, scopes: c.scopes,
      active: c.active, verified: c.verified, createdAt: c.createdAt,
      owner: c.ownerId ? (byId[c.ownerId] || { id: c.ownerId, displayName: '(deleted)' }) : null,
    })) };
  });

  app.post('/admin/oauth-clients', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(1).max(120),
      confidential: z.boolean().optional(),
      redirectUris: z.array(z.string().url()).min(1).max(20),
      scopes: z.array(z.enum(SCOPES)).optional(),
      // Chosen at creation and never changed: switching an existing client to pairwise
      // re-identifies every one of its users at once, orphaning their accounts rather
      // than migrating them.
      subjectType: z.enum(['public', 'pairwise']).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;
    const confidential = d.confidential !== false; // default confidential
    // A confidential client gets a secret shown ONCE; only its sha256 is stored.
    const secret = confidential ? crypto.randomBytes(32).toString('base64url') : '';
    const p = await db();
    const c = await p.oAuthClient.create({ data: {
      name: d.name, confidential, secretHash: secret ? sha256(secret) : '',
      redirectUris: d.redirectUris, scopes: d.scopes?.length ? d.scopes : SCOPES,
      subjectType: d.subjectType || 'public',
    } });
    return reply.code(201).send({
      client: { id: c.id, name: c.name, confidential: c.confidential, redirectUris: c.redirectUris, scopes: c.scopes, active: c.active },
      clientSecret: secret || null, // shown once, never retrievable again
    });
  });

  app.patch('/admin/oauth-clients/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      active: z.boolean().optional(),
      redirectUris: z.array(z.string().url()).min(1).max(20).optional(),
      scopes: z.array(z.enum(SCOPES)).optional(),
      // Staff vouching for a self-registered app. It changes what the consent screen says,
      // not whether the client works.
      verified: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const data = {};
    for (const k of ['active', 'redirectUris', 'scopes', 'verified']) if (b.data[k] !== undefined) data[k] = b.data[k];
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'nothing_to_update' });
    const p = await db();
    const c = await p.oAuthClient.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // Rotate the secret (returns a new one once). Only for confidential clients.
  app.post('/admin/oauth-clients/:id/rotate', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const cur = await p.oAuthClient.findUnique({ where: { id: req.params.id } });
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    if (!cur.confidential) return reply.code(400).send({ error: 'public_client' });
    const secret = crypto.randomBytes(32).toString('base64url');
    await p.oAuthClient.update({ where: { id: cur.id }, data: { secretHash: sha256(secret) } });
    return { clientSecret: secret };
  });

  app.delete('/admin/oauth-clients/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.oAuthClient.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });
}
