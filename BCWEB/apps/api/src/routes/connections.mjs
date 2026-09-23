import crypto from 'node:crypto';
import { z } from 'zod';
import { db, requireRole, safeEqual } from '../lib/lib.mjs';

// Social CONNECTIONS (shown on the public profile), distinct from OAuth login. Each
// provider is only offered if its credentials are configured in .env. OAuth2 providers
// (github / twitch / youtube-via-google) share one authorization-code flow; Steam uses
// OpenID 2.0. The signed `state`/`return_to` carries the linking user's id so the callback
// attaches the connection to the right account.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const SITE_URL = (process.env.SITE_URL || 'http://localhost').replace(/\/+$/, '');
const STATE_TTL_MS = 10 * 60 * 1000;
const env = (k) => process.env[k];

// `reuseLogin` = reuse the provider's already-registered LOGIN callback URL
// (/api/auth/oauth/<loginKey>/callback) instead of a dedicated connect callback, so an
// admin who already set up "Sign in with GitHub/Google" doesn't have to register a second
// redirect URI (which was causing redirect_uri_mismatch). oauth.mjs's login callback
// detects the connect-state and delegates back here.
export const OAUTH = {
  github: {
    reuseLogin: 'github',
    id: () => env('GITHUB_CLIENT_ID'), secret: () => env('GITHUB_CLIENT_SECRET'),
    authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', scope: 'read:user',
    async profile(token) {
      const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'BetterCommunity', Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error('profile_failed'); const u = await r.json();
      return { externalId: String(u.id), handle: u.login, url: u.html_url || `https://github.com/${u.login}` };
    },
  },
  twitch: {
    id: () => env('TWITCH_CLIENT_ID'), secret: () => env('TWITCH_CLIENT_SECRET'),
    authUrl: 'https://id.twitch.tv/oauth2/authorize', tokenUrl: 'https://id.twitch.tv/oauth2/token', scope: '',
    // Ask every time which Twitch account: a browser signed in to an alt would otherwise link
    // the alt silently, and the person only finds out from their public profile.
    extraAuth: { force_verify: 'true' },
    async profile(token) {
      const r = await fetch('https://api.twitch.tv/helix/users', { headers: { Authorization: `Bearer ${token}`, 'Client-Id': env('TWITCH_CLIENT_ID') } });
      if (!r.ok) throw new Error('profile_failed'); const u = (await r.json())?.data?.[0];
      if (!u) throw new Error('profile_failed');
      return { externalId: u.id, handle: u.display_name || u.login, url: `https://twitch.tv/${u.login}` };
    },
  },
  youtube: {
    reuseLogin: 'google',
    id: () => env('GOOGLE_CLIENT_ID'), secret: () => env('GOOGLE_CLIENT_SECRET'),
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.readonly', extraAuth: { access_type: 'online', prompt: 'consent' },
    async profile(token) {
      const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('profile_failed'); const c = (await r.json())?.items?.[0];
      if (!c) throw new Error('no_channel');
      const handle = c.snippet?.customUrl ? c.snippet.customUrl.replace(/^@?/, '') : (c.snippet?.title || c.id);
      return { externalId: c.id, handle: c.snippet?.title || handle, url: c.snippet?.customUrl ? `https://youtube.com/${c.snippet.customUrl}` : `https://youtube.com/channel/${c.id}` };
    },
  },
};

const sign = (obj) => { const p = Buffer.from(JSON.stringify({ ...obj, ts: Date.now() })).toString('base64url'); const sig = crypto.createHmac('sha256', JWT_SECRET).update(p).digest('base64url'); return `${p}.${sig}`; };
// Exported so the shared login callback (oauth.mjs) can recognise a connect-state and
// delegate here instead of running the login flow.
export const verifyConnectState = (state) => {
  try {
    const [p, sig] = String(state || '').split('.');
    const exp = crypto.createHmac('sha256', JWT_SECRET).update(p).digest('base64url');
    if (!sig || sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!claims.connect || Date.now() - claims.ts > STATE_TTL_MS) return null;
    return claims;
  } catch { return null; }
};
const verify = verifyConnectState;

// The browser binding, same idea as the sign-in flow's `bcw_oauth` (SECURITY_AUDIT.md, Sept
// pentest finding 1). The state names the account to attach to, so a lured callback could not
// touch the VICTIM's account; but it could attach the victim's Twitch / Steam to the ATTACKER's
// public profile, which is a claim to be somebody. The attacker can mint a state and hold an
// assertion, but cannot plant this cookie in the victim's browser.
const CONNECT_BIND_COOKIE = 'bcw_connect';
const CONNECT_COOKIE_SECURE = /^https:/i.test(process.env.SITE_URL || process.env.SITE_DOMAIN || '');
const sha256 = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
function bindConnect(reply) {
  const nonce = crypto.randomBytes(16).toString('hex');
  reply.setCookie(CONNECT_BIND_COOKIE, nonce, { httpOnly: true, sameSite: 'lax', path: '/', secure: CONNECT_COOKIE_SECURE, maxAge: Math.floor(STATE_TTL_MS / 1000) });
  return sha256(nonce);
}
/** True when this callback comes back to the browser that started it. Single use. Exported
 *  for oauth.mjs, whose login callback finishes the GitHub / YouTube connects. */
export function connectBound(req, reply, claims) {
  const c = req.cookies?.[CONNECT_BIND_COOKIE];
  reply.clearCookie(CONNECT_BIND_COOKIE, { path: '/' });
  return !!(claims?.bind && c && safeEqual(sha256(c), claims.bind));
}

// ── Steam OpenID 2.0 ──
// The query string that comes back from Steam is the attacker's to write; nothing in it is
// believed until Steam itself has said so (check_authentication), and even then only the
// fields Steam SIGNED, pointing where we asked, for an id of Steam's own shape.
export const STEAM_OP = 'https://steamcommunity.com/openid/login';
const STEAM_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const STEAM_MUST_SIGN = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'];
/**
 * Everything that can be checked BEFORE asking Steam. Returns { steamId } or { error }.
 * `expectedReturnTo` is the exact return_to this server sent at /start (the query carries the
 * signed state, so it is recomputable from what came back).
 */
export function steamAssertionShape(q, expectedReturnTo) {
  const g = (k) => (typeof q?.[`openid.${k}`] === 'string' ? q[`openid.${k}`] : '');
  if (g('ns') !== 'http://specs.openid.net/auth/2.0') return { error: 'bad_ns' };
  if (g('mode') !== 'id_res') return { error: g('mode') === 'cancel' ? 'cancelled' : 'bad_mode' };
  if (g('op_endpoint') !== STEAM_OP) return { error: 'bad_op' };
  if (g('return_to') !== expectedReturnTo) return { error: 'bad_return_to' };
  const claimed = g('claimed_id');
  const m = STEAM_ID_RE.exec(claimed);
  if (!m || g('identity') !== claimed) return { error: 'no_steamid' };
  const signed = new Set(g('signed').split(','));
  if (!STEAM_MUST_SIGN.every((f) => signed.has(f))) return { error: 'unsigned_fields' };
  if (!g('sig') || !g('response_nonce')) return { error: 'unsigned_fields' };
  return { steamId: m[1] };
}
/** Steam's own verdict on the assertion, parsed strictly (key:value lines, per the spec). */
export function steamSaysValid(text) {
  return String(text || '').split('\n').some((l) => l.trim() === 'is_valid:true');
}
// A verified assertion is good once. Steam should refuse a replayed nonce itself; this does not
// bet on it. Bounded: entries die with the state that carried them.
const steamNonces = new Map();
function steamNonceFresh(nonce) {
  const now = Date.now();
  for (const [k, t] of steamNonces) if (now - t > STATE_TTL_MS) steamNonces.delete(k); else break;
  if (steamNonces.has(nonce)) return false;
  if (steamNonces.size > 5000) steamNonces.delete(steamNonces.keys().next().value);
  steamNonces.set(nonce, now);
  return true;
}

const redirectUri = (provider) => `${SITE_URL}/api/auth/connect/${provider}/callback`;
const loginCallback = (key) => `${SITE_URL}/api/auth/oauth/${key}/callback`;
// The redirect URI an OAuth2 connect provider uses — the reused login callback when set.
const connectRedirect = (name) => { const prov = OAUTH[name]; return prov?.reuseLogin ? loginCallback(prov.reuseLogin) : redirectUri(name); };

// Exchange the code for a token, fetch the provider profile, and upsert the connection.
// Used by our own connect callback (twitch/…) AND by oauth.mjs's reused login callback.
export async function exchangeConnect(p, { name, code, uid }) {
  const prov = OAUTH[name];
  if (!prov) throw new Error('unknown_provider');
  const tokenRes = await fetch(prov.tokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: prov.id(), client_secret: prov.secret(), code, grant_type: 'authorization_code', redirect_uri: connectRedirect(name) }),
  });
  const tok = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tok.access_token) throw new Error('token_failed');
  const prof = await prov.profile(tok.access_token);
  await p.socialConnection.upsert({
    where: { userId_provider: { userId: uid, provider: name } },
    create: { userId: uid, provider: name, handle: String(prof.handle).slice(0, 80), url: String(prof.url).slice(0, 300), externalId: prof.externalId },
    update: { handle: String(prof.handle).slice(0, 80), url: String(prof.url).slice(0, 300), externalId: prof.externalId },
  });
}

/** Is this connect provider usable on this server? ONE rule, read by the public status list
 *  below AND by /start: the list used to spell the env names out a second time, so a provider
 *  could be listed while /start answered 503 (or the other way round) the day one side moved. */
export function connectConfigured(name) {
  if (name === 'kofi') return true; // manual link — no OAuth credentials needed
  if (name === 'steam') return !!env('STEAM_API_KEY');
  const prov = Object.hasOwn(OAUTH, name) ? OAUTH[name] : null; // not `OAUTH[name]`: '__proto__' is truthy there
  return !!(prov && prov.id() && prov.secret());
}

/** Public, non-secret: a boolean per provider, never a value. The profile hides every provider
 *  that is false here (a row a member cannot use is noise), except one they already linked. */
export function providerStatus() {
  return Object.fromEntries(['github', 'twitch', 'youtube', 'steam', 'kofi'].map((k) => [k, connectConfigured(k)]));
}

export default async function connectionRoutes(app) {
  const fail = (reply, reason) => reply.redirect(`${SITE_URL}/profile?connect_error=${encodeURIComponent(reason)}`);
  const ok = (reply, provider) => reply.redirect(`${SITE_URL}/profile?connected=${provider}`);

  // Which connection providers are configured (drives the profile UI — unconfigured
  // providers are hidden entirely).
  app.get('/auth/connect/providers', async () => providerStatus());

  // My connections (also returned inline by /me, but handy standalone).
  app.get('/me/connections', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const [rows, roster, signin] = await Promise.all([
      p.socialConnection.findMany({ where: { userId: req.user.uid }, select: { provider: true, handle: true, url: true } }),
      p.discordLink.findFirst({ where: { userId: req.user.uid }, select: { username: true, discordId: true } }),
      p.oAuthAccount.findFirst({ where: { userId: req.user.uid, provider: 'discord' }, select: { username: true, providerAccountId: true } }),
    ]);
    // Discord is not a SocialConnection: it comes from the bot's roster link or from Discord as
    // a sign-in method. Reported apart so the profile can offer "show on my profile" for it,
    // with the same precedence the public profile uses (social.mjs buildPublicProfile).
    const handle = roster?.username || signin?.username || null;
    const dc = (roster || signin) ? { handle, via: roster ? 'bot' : 'signin' } : null;
    return { connections: rows, discord: dc };
  });

  app.delete('/me/connections/:provider', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    await p.socialConnection.deleteMany({ where: { userId: req.user.uid, provider: req.params.provider } });
    return { ok: true };
  });

  // Ko-fi is a manual link (no OAuth) — the user just enters their Ko-fi handle.
  app.put('/me/connections/kofi', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ handle: z.string().trim().min(1).max(60).regex(/^[a-zA-Z0-9_.-]+$/) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_handle' });
    const p = await db();
    const handle = b.data.handle.replace(/^@/, '');
    await p.socialConnection.upsert({
      where: { userId_provider: { userId: req.user.uid, provider: 'kofi' } },
      create: { userId: req.user.uid, provider: 'kofi', handle, url: `https://ko-fi.com/${handle}` },
      update: { handle, url: `https://ko-fi.com/${handle}` },
    });
    return { ok: true };
  });

  // ── OAuth2 connect (github / twitch / youtube) ──
  app.get('/auth/connect/:provider/start', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const name = req.params.provider;
    if (name === 'steam') return steamStart(req, reply);
    const prov = OAUTH[name];
    if (!prov) return reply.code(404).send({ error: 'unknown_provider' });
    if (!connectConfigured(name)) return reply.code(503).send({ error: 'not_configured' });
    const url = new URL(prov.authUrl);
    url.searchParams.set('client_id', prov.id());
    // Reuse the already-registered login callback where possible (avoids requiring a second
    // redirect URI to be registered — the cause of the redirect_uri_mismatch error).
    url.searchParams.set('redirect_uri', connectRedirect(name));
    url.searchParams.set('response_type', 'code');
    if (prov.scope) url.searchParams.set('scope', prov.scope);
    for (const [k, v] of Object.entries(prov.extraAuth || {})) url.searchParams.set(k, v);
    // `connect: name` marks this as a connect (not login) state — the shared callback keys off it.
    url.searchParams.set('state', sign({ uid: req.user.uid, connect: name, bind: bindConnect(reply) }));
    return reply.redirect(url.toString());
  });

  // Own callback — only providers that DON'T reuse a login callback land here (twitch).
  // github/youtube come back through oauth.mjs's login callback, which delegates to exchangeConnect.
  app.get('/auth/connect/:provider/callback', { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const name = req.params.provider;
    if (name === 'steam') return steamCallback(req, reply);
    const prov = OAUTH[name];
    if (!prov) return fail(reply, 'unknown_provider');
    const claims = verify(req.query?.state);
    if (!claims || claims.connect !== name) return fail(reply, 'bad_state');
    if (!connectBound(req, reply, claims)) return fail(reply, 'bad_state');
    if (!req.query?.code) return fail(reply, 'no_code');
    try {
      await exchangeConnect(await db(), { name, code: req.query.code, uid: claims.uid });
      return ok(reply, name);
    } catch (e) { req.log?.warn({ e: String(e) }, 'connect callback failed'); return fail(reply, e?.message === 'token_failed' ? 'token_failed' : 'unexpected'); }
  });

  // ── Steam (OpenID 2.0) ──
  async function steamStart(req, reply) {
    if (!connectConfigured('steam')) return reply.code(503).send({ error: 'not_configured' });
    const returnTo = `${redirectUri('steam')}?s=${encodeURIComponent(sign({ uid: req.user.uid, connect: 'steam', bind: bindConnect(reply) }))}`;
    const url = new URL(STEAM_OP);
    url.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0');
    url.searchParams.set('openid.mode', 'checkid_setup');
    url.searchParams.set('openid.return_to', returnTo);
    url.searchParams.set('openid.realm', SITE_URL);
    url.searchParams.set('openid.identity', 'http://specs.openid.net/auth/2.0/identifier_select');
    url.searchParams.set('openid.claimed_id', 'http://specs.openid.net/auth/2.0/identifier_select');
    return reply.redirect(url.toString());
  }

  async function steamCallback(req, reply) {
    const claims = verify(req.query?.s);
    if (!claims || claims.connect !== 'steam') return fail(reply, 'bad_state');
    if (!connectBound(req, reply, claims)) return fail(reply, 'bad_state');
    if (!env('STEAM_API_KEY')) return fail(reply, 'not_configured');
    // The return_to we sent, recomputed from the signed state that came back with it. OpenID 2.0
    // §11.1: an assertion aimed at any other URL is not for us, whatever Steam says about it.
    const shape = steamAssertionShape(req.query, `${redirectUri('steam')}?s=${encodeURIComponent(String(req.query.s))}`);
    if (shape.error) return fail(reply, shape.error === 'cancelled' ? 'no_code' : 'not_verified');
    try {
      // Steam's verdict (check_authentication): the openid.* fields exactly as received, mode
      // swapped. A string-only copy, so a repeated key (an array in the parsed query) cannot
      // smuggle a second value past what was checked above.
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) if (k.startsWith('openid.') && typeof v === 'string') body.set(k, v);
      body.set('openid.mode', 'check_authentication');
      const vres = await fetch(STEAM_OP, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' }, body, signal: AbortSignal.timeout(10_000) });
      if (!vres.ok || !steamSaysValid(await vres.text())) return fail(reply, 'not_verified');
      if (!steamNonceFresh(String(req.query['openid.response_nonce']))) return fail(reply, 'not_verified');
      const steamId = shape.steamId;
      let handle = steamId, url = `https://steamcommunity.com/profiles/${steamId}`;
      try {
        const s = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(env('STEAM_API_KEY'))}&steamids=${steamId}`, { signal: AbortSignal.timeout(10_000) });
        const player = (await s.json())?.response?.players?.[0];
        if (player && String(player.steamid) === steamId) {
          handle = String(player.personaname || steamId);
          // Rendered as a link on the public profile: only ever a Steam Community URL.
          if (typeof player.profileurl === 'string' && /^https:\/\/steamcommunity\.com\/(id|profiles)\/[^\s"'<>]+$/.test(player.profileurl)) url = player.profileurl;
        }
      } catch { /* keep defaults */ }
      const p = await db();
      await p.socialConnection.upsert({
        where: { userId_provider: { userId: claims.uid, provider: 'steam' } },
        create: { userId: claims.uid, provider: 'steam', handle: handle.slice(0, 80), url: url.slice(0, 300), externalId: steamId },
        update: { handle: handle.slice(0, 80), url: url.slice(0, 300), externalId: steamId },
      });
      return ok(reply, 'steam');
    } catch (e) { req.log?.warn({ e: String(e) }, 'steam callback failed'); return fail(reply, 'unexpected'); }
  }
}
