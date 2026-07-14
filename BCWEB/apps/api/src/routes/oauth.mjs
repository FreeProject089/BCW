import crypto from 'node:crypto';
import { db, issueSession, requireRole, safeEqual } from '../lib/lib.mjs';
import { verifyConnectState, exchangeConnect, OAUTH as CONNECT_OAUTH } from './connections.mjs';

// GitHub/Discord "Continue with…" login + signup. No library — both providers'
// authorization-code flow is a handful of fetches, and pulling in a whole OAuth
// framework for two providers would be more code than this file.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const SITE_URL = process.env.SITE_URL || 'http://localhost';
const STATE_TTL_MS = 10 * 60 * 1000;

const PROVIDERS = {
  github: {
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async fetchProfile(accessToken) {
      const headers = { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'BetterCommunity', Accept: 'application/vnd.github+json' };
      const userRes = await fetch('https://api.github.com/user', { headers });
      if (!userRes.ok) throw new Error('profile_fetch_failed');
      const u = await userRes.json();
      // Private-email GitHub accounts return email: null on /user — the verified
      // primary address only shows up on the separate /user/emails endpoint.
      let email = u.email;
      if (!email) {
        const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
        if (emailsRes.ok) {
          const emails = await emailsRes.json();
          email = (emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified))?.email || null;
        }
      }
      return { id: String(u.id), username: u.login, displayName: u.name || u.login, email, avatar: u.avatar_url || null };
    },
  },
  discord: {
    clientId: () => process.env.DISCORD_CLIENT_ID,
    clientSecret: () => process.env.DISCORD_CLIENT_SECRET,
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    async fetchProfile(accessToken) {
      const res = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error('profile_fetch_failed');
      const u = await res.json();
      // Discord avatars: CDN URL from the hash, or a default embed avatar otherwise.
      const avatar = u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
        : `https://cdn.discordapp.com/embed/avatars/${(Number(BigInt(u.id) >> 22n) % 6)}.png`;
      return { id: u.id, username: u.username, displayName: u.global_name || u.username, email: u.verified ? u.email : null, avatar };
    },
  },
  google: {
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    async fetchProfile(accessToken) {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error('profile_fetch_failed');
      const u = await res.json();
      // Google verifies the address before returning verified_email; only trust it then.
      return { id: String(u.id), username: (u.email || '').split('@')[0], displayName: u.name || u.email, email: u.verified_email ? u.email : null, avatar: u.picture || null };
    },
  },
};

function redirectUri(provider) {
  return `${SITE_URL}/api/auth/oauth/${provider}/callback`;
}

// Stateless, signed + timestamped CSRF token (same pattern as the PoW challenge
// in auth.mjs) — no server-side session storage needed between /start and /callback.
function signState(provider) {
  const payload = Buffer.from(JSON.stringify({ provider, nonce: crypto.randomBytes(12).toString('hex'), ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}
function verifyState(state, provider) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return false;
  const [payload, sig] = state.split('.');
  if (!safeEqual(crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex').slice(0, 32), sig)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return claims.provider === provider && Date.now() - claims.ts <= STATE_TTL_MS;
  } catch { return false; }
}

function slugName(base) {
  return String(base || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'user';
}

export default async function oauthRoutes(app) {
  // Feature-detection — the frontend only shows a "Continue with X" button once
  // that provider actually has credentials configured server-side.
  app.get('/auth/oauth/providers', async () => ({
    github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    discord: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  }));

  app.get('/auth/oauth/:provider/start', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const provider = PROVIDERS[req.params.provider];
    if (!provider) return reply.code(404).send({ error: 'unknown_provider' });
    const clientId = provider.clientId();
    if (!clientId) return reply.code(503).send({ error: 'not_configured' });
    const url = new URL(provider.authUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri(req.params.provider));
    url.searchParams.set('scope', provider.scope);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', signState(req.params.provider));
    return reply.redirect(url.toString());
  });

  app.get('/auth/oauth/:provider/callback', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const name = req.params.provider;
    const provider = PROVIDERS[name];
    const fail = (reason) => reply.redirect(`${SITE_URL}/auth?oauth_error=${encodeURIComponent(reason)}`);
    if (!provider) return fail('unknown_provider');
    const clientId = provider.clientId(); const clientSecret = provider.clientSecret();
    if (!clientId || !clientSecret) return fail('not_configured');
    const { code, state } = req.query;
    // A social CONNECTION reuses this registered login callback (github→github, youtube→
    // google) to avoid needing a second redirect URI. If the state is a connect-state whose
    // provider reuses THIS callback, link the account instead of logging in.
    const connect = verifyConnectState(state);
    if (connect && CONNECT_OAUTH[connect.connect]?.reuseLogin === name) {
      if (!code) return reply.redirect(`${SITE_URL}/profile?connect_error=no_code`);
      try { await exchangeConnect(await db(), { name: connect.connect, code, uid: connect.uid }); return reply.redirect(`${SITE_URL}/profile?connected=${connect.connect}`); }
      catch (e) { req.log.error(e); return reply.redirect(`${SITE_URL}/profile?connect_error=${encodeURIComponent(e?.message || 'unexpected')}`); }
    }
    if (!verifyState(state, name)) return fail('bad_state');
    if (!code) return fail('no_code');
    try {
      const tokenRes = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri(name) }),
      });
      const tokenBody = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !tokenBody.access_token) return fail('token_exchange_failed');
      const profile = await provider.fetchProfile(tokenBody.access_token);
      if (!profile.email) return fail('no_email');

      const p = await db();
      const existingLink = await p.oAuthAccount.findUnique({
        where: { provider_providerAccountId: { provider: name, providerAccountId: profile.id } },
        include: { user: true },
      });
      let user;
      if (existingLink) {
        user = existingLink.user;
      } else {
        // No link yet — attach to an existing account with the same email
        // (account linking), or create a brand-new password-less account.
        user = await p.user.findUnique({ where: { email: profile.email } });
        if (!user) {
          // New account — adopt the provider's picture as the BCWEB avatar straight away.
          user = await p.user.create({ data: { email: profile.email, displayName: profile.displayName || slugName(profile.username), emailVerified: true, avatar: profile.avatar ? { image: profile.avatar } : undefined } });
        } else if (profile.avatar && !user.avatar?.image) {
          // Linking to an existing account that has no custom photo — use the provider's.
          user = await p.user.update({ where: { id: user.id }, data: { avatar: { ...(user.avatar || {}), image: profile.avatar } } });
        }
        await p.oAuthAccount.create({ data: { userId: user.id, provider: name, providerAccountId: profile.id, username: profile.username } });
      }

      // Signing in with Discord links the account to the bot directly (no manual code):
      // upsert a DiscordLink for this account and flag it so the bot buffer picks it up
      // and refreshes the member's roles. Skip if that Discord id is already linked
      // elsewhere (a Discord identity maps to at most one BCWEB account).
      if (name === 'discord') {
        const owner = await p.discordLink.findUnique({ where: { discordId: profile.id } });
        if (!owner) {
          await p.discordLink.create({ data: { userId: user.id, discordId: profile.id, username: profile.username, pendingSync: true } }).catch(() => {});
        } else if (owner.userId === user.id) {
          await p.discordLink.update({ where: { discordId: profile.id }, data: { username: profile.username, pendingSync: true } }).catch(() => {});
        }
      }

      issueSession(reply, user);
      return reply.redirect(`${SITE_URL}/dashboard?oauth=success`);
    } catch (e) {
      req.log.error(e);
      return fail('unexpected');
    }
  });

  // Profile: which providers this account has linked (for the "Connected accounts" UI).
  app.get('/me/oauth', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const links = await p.oAuthAccount.findMany({ where: { userId: req.user.uid }, select: { provider: true, username: true, linkedAt: true } });
    return { links };
  });
}
