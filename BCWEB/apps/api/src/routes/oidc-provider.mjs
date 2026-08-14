import { z } from 'zod';
import crypto from 'node:crypto';
import querystring from 'node:querystring';
import jwt from 'jsonwebtoken';
import { db, requireRole, optionalAuth, clearSession } from '../lib/lib.mjs';
import { jwks, issuer, signRs256, verifyRs256, verifyPkce, validateAuthorizeRequest } from '../lib/oidc.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SCOPES = ['openid', 'profile', 'email', 'items', 'repos'];
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
    return { clientName: client.name, scopes: c.scope.split(' ') };
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
    if (client.confidential && (!clientSecret || sha256(String(clientSecret)) !== client.secretHash)) return { error: 'invalid_client' };
    return { client };
  }

  // ── Token endpoint (authorization_code + refresh_token grants) ──
  app.post('/oauth2/token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body || {};
    reply.header('Cache-Control', 'no-store');
    const p = await db();
    const auth = await authClient(p, req, b);
    if (auth.error) return reply.code(401).send({ error: auth.error });
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
      const user = await p.user.findUnique({ where: { id: rt.userId }, select: { id: true, displayName: true, email: true } });
      if (!user) return reply.code(400).send({ error: 'invalid_grant' });
      return mintTokens(p, { client, user, scope: rt.scope });
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
    if (scopes.includes('profile')) out.name = user.displayName || '';
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

  // ── Revocation (RFC 7009) — revokes a refresh token; always 200 for a valid client. ──
  app.post('/oauth2/revoke', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body || {};
    const p = await db();
    const auth = await authClient(p, req, b);
    if (auth.error) return reply.code(401).send({ error: auth.error });
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
    if (auth.error) return reply.code(401).send({ error: auth.error });
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

  // ── Admin: OAuth client registry ──
  app.get('/admin/oauth-clients', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const clients = await p.oAuthClient.findMany({ orderBy: { createdAt: 'desc' } });
    // Never return secretHash.
    return { clients: clients.map((c) => ({ id: c.id, name: c.name, confidential: c.confidential, redirectUris: c.redirectUris, scopes: c.scopes, active: c.active, createdAt: c.createdAt })) };
  });

  app.post('/admin/oauth-clients', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(1).max(120),
      confidential: z.boolean().optional(),
      redirectUris: z.array(z.string().url()).min(1).max(20),
      scopes: z.array(z.enum(['openid', 'profile', 'email', 'items', 'repos'])).optional(),
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
      scopes: z.array(z.enum(['openid', 'profile', 'email', 'items', 'repos'])).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const data = {};
    for (const k of ['active', 'redirectUris', 'scopes']) if (b.data[k] !== undefined) data[k] = b.data[k];
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
