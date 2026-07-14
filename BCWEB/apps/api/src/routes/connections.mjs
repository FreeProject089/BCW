import crypto from 'node:crypto';
import { db, requireRole } from '../lib/lib.mjs';

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

function providerStatus() {
  return {
    github: !!(env('GITHUB_CLIENT_ID') && env('GITHUB_CLIENT_SECRET')),
    twitch: !!(env('TWITCH_CLIENT_ID') && env('TWITCH_CLIENT_SECRET')),
    youtube: !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
    steam: !!env('STEAM_API_KEY'),
  };
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
    const rows = await p.socialConnection.findMany({ where: { userId: req.user.uid }, select: { provider: true, handle: true, url: true } });
    return { connections: rows };
  });

  app.delete('/me/connections/:provider', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    await p.socialConnection.deleteMany({ where: { userId: req.user.uid, provider: req.params.provider } });
    return { ok: true };
  });

  // ── OAuth2 connect (github / twitch / youtube) ──
  app.get('/auth/connect/:provider/start', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const name = req.params.provider;
    if (name === 'steam') return steamStart(req, reply);
    const prov = OAUTH[name];
    if (!prov) return reply.code(404).send({ error: 'unknown_provider' });
    if (!prov.id() || !prov.secret()) return reply.code(503).send({ error: 'not_configured' });
    const url = new URL(prov.authUrl);
    url.searchParams.set('client_id', prov.id());
    // Reuse the already-registered login callback where possible (avoids requiring a second
    // redirect URI to be registered — the cause of the redirect_uri_mismatch error).
    url.searchParams.set('redirect_uri', connectRedirect(name));
    url.searchParams.set('response_type', 'code');
    if (prov.scope) url.searchParams.set('scope', prov.scope);
    for (const [k, v] of Object.entries(prov.extraAuth || {})) url.searchParams.set(k, v);
    // `connect: name` marks this as a connect (not login) state — the shared callback keys off it.
    url.searchParams.set('state', sign({ uid: req.user.uid, connect: name }));
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
    if (!req.query?.code) return fail(reply, 'no_code');
    try {
      await exchangeConnect(await db(), { name, code: req.query.code, uid: claims.uid });
      return ok(reply, name);
    } catch (e) { req.log?.warn({ e: String(e) }, 'connect callback failed'); return fail(reply, e?.message === 'token_failed' ? 'token_failed' : 'unexpected'); }
  });

  // ── Steam (OpenID 2.0) ──
  async function steamStart(req, reply) {
    if (!env('STEAM_API_KEY')) return reply.code(503).send({ error: 'not_configured' });
    const returnTo = `${redirectUri('steam')}?s=${encodeURIComponent(sign({ uid: req.user.uid, connect: 'steam' }))}`;
    const url = new URL('https://steamcommunity.com/openid/login');
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
    const claimed = String(req.query?.['openid.claimed_id'] || '');
    const m = claimed.match(/\/id\/(\d+)$/) || claimed.match(/\/openid\/id\/(\d+)$/);
    if (!m) return fail(reply, 'no_steamid');
    // Verify the assertion with Steam (check_authentication).
    try {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) if (k.startsWith('openid.')) body.set(k, String(v));
      body.set('openid.mode', 'check_authentication');
      const vres = await fetch('https://steamcommunity.com/openid/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const vtext = await vres.text();
      if (!/is_valid\s*:\s*true/i.test(vtext)) return fail(reply, 'not_verified');
      const steamId = m[1];
      let handle = steamId, url = `https://steamcommunity.com/profiles/${steamId}`;
      try {
        const s = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env('STEAM_API_KEY')}&steamids=${steamId}`);
        const player = (await s.json())?.response?.players?.[0];
        if (player) { handle = player.personaname || steamId; url = player.profileurl || url; }
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
