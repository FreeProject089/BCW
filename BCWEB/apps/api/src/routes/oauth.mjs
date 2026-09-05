import crypto from 'node:crypto';
import argon2 from 'argon2';
import { db, issueSession, requireRole, optionalAuth, safeEqual, notify } from '../lib/lib.mjs';
import { sendMail, mailShell, emailEnabled } from '../lib/mail.mjs';
import { mergeShadowEconomy } from '../lib/economy-curve.mjs';
import { verifyConnectState, exchangeConnect, OAUTH as CONNECT_OAUTH } from './connections.mjs';
import { grantAutoBadges } from './social.mjs';
import { flagEnabled, disabledReply } from '../lib/flags.mjs';

// GitHub/Discord "Continue with…" login + signup. No library — both providers'
// authorization-code flow is a handful of fetches, and pulling in a whole OAuth
// framework for two providers would be more code than this file.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const SITE_URL = process.env.SITE_URL || 'http://localhost';
const STATE_TTL_MS = 10 * 60 * 1000;
/** How long a "link this provider to your existing account?" proposal stays answerable. */
const LINK_TTL_MS = 15 * 60 * 1000;
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const LABEL = { github: 'GitHub', discord: 'Discord', google: 'Google' };
const maskEmail = (e) => { const [l, d] = String(e).split('@'); return `${l.slice(0, 2)}${'*'.repeat(Math.max(1, l.length - 2))}@${d}`; };

/** Signing in with Discord links the account to the bot directly (no manual code): upsert a
 *  DiscordLink for this account and flag it so the bot buffer picks it up and refreshes the
 *  member's roles. Skip if that Discord id is already linked elsewhere (a Discord identity
 *  maps to at most one BCWEB account). Shared by the three places a provider gets attached. */
async function attachDiscord(p, name, profile, user) {
  if (name !== 'discord') return;
  const owner = await p.discordLink.findUnique({ where: { discordId: profile.id } });
  if (!owner) {
    await p.discordLink.create({ data: { userId: user.id, discordId: profile.id, username: profile.username, pendingSync: true } }).catch(() => {});
    mergeShadowEconomy(p, profile.id, user.id, ((await p.adminSetting.findUnique({ where: { key: 'bot.config' } }))?.value || {}).economy || {}).catch(() => {});
    grantAutoBadges(p, { event: 'discord', user }).catch(() => {});
  } else if (owner.userId === user.id) {
    await p.discordLink.update({ where: { discordId: profile.id }, data: { username: profile.username, pendingSync: true } }).catch(() => {});
  }
}

/** An account that was just created through a provider has no password. It gets one offered
 *  right away — a mail with a 24-hour set-a-password link and an in-app notification — so
 *  the account is reachable with e-mail + password from day one and never hostage to the
 *  provider it happened to be created with. */
async function sendPasswordSetup(p, user, label) {
  const token = crypto.randomBytes(24).toString('hex');
  await p.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600e3) } });
  const url = `${SITE_URL}/auth?reset=${token}`;
  await notify(p, user.id, 'account_password_setup',
    `Your account was created with ${label}. Set a password to also sign in with your e-mail — a link was mailed to you (valid 24 h), or set one from Profile → Security.`,
    { bodyFr: `Ton compte a été créé avec ${label}. Définis un mot de passe pour aussi te connecter par e-mail — un lien t’a été envoyé (valable 24 h), ou fais-le depuis Profil → Sécurité.`, href: '/profile?tab=security' });
  await sendMail({
    to: user.email,
    subject: 'Set a password for your BetterCommunity account',
    html: mailShell('Welcome to BetterCommunity', `Your account was created with ${label}. You can keep signing in that way — and if you set a password, your e-mail address works too, whatever happens to the ${label} account. This link is valid for 24 hours.`, { url, label: 'Set my password' }),
    text: `Set a password for your BetterCommunity account: ${url}`,
  }).catch(() => {});
}

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
/**
 * Where the callback may send somebody afterwards.
 *
 * Checked on the way IN, not on the way out. The state is signed, so a value that gets in here
 * cannot be tampered with afterwards — which makes this the only place the check can happen,
 * and makes a permissive check here a permanent one.
 *
 * A single leading slash and nothing else: `//evil.com` and `https://evil.com` are both
 * absolute destinations, and a sign-in page that forwards to one the moment a password has been
 * typed is the textbook open redirect.
 */
const safeNext = (n) => (typeof n === 'string' && /^\/[^/\\]/.test(n) && n.length <= 512 ? n : null);

function signState(provider, next) {
  const claims = { provider, nonce: crypto.randomBytes(12).toString('hex'), ts: Date.now() };
  const ok = safeNext(next);
  if (ok) claims.next = ok;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}
function verifyState(state, provider) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return false;
  const [payload, sig] = state.split('.');
  if (!safeEqual(crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex').slice(0, 32), sig)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (claims.provider !== provider || Date.now() - claims.ts > STATE_TTL_MS) return false;
    // The CLAIMS, not just true — the callback needs `next` out of them. Still falsy on
    // failure, so every existing `if (!verifyState(...))` keeps meaning what it meant.
    return claims;
  } catch { return false; }
}

function slugName(base) {
  return String(base || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'user';
}

export default async function oauthRoutes(app) {
  // Feature-detection — the frontend only shows a "Continue with X" button once
  // that provider actually has credentials configured server-side.
  // Keeps its shape when the switch is off - every provider reports false, which is
  // already how the sign-in page renders "not available". A `disabled` flag rides along
  // so the page can say WHY rather than just dropping the buttons, but nothing has to
  // read it for the page to behave.
  app.get('/auth/oauth/providers', async () => {
    if (!flagEnabled('features.oauthLoginEnabled')) return { github: false, discord: false, google: false, disabled: true };
    return {
      github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      discord: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    };
  });

  app.get('/auth/oauth/:provider/start', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!flagEnabled('features.oauthLoginEnabled')) return disabledReply(reply, 'oauth_login');
    const provider = PROVIDERS[req.params.provider];
    if (!provider) return reply.code(404).send({ error: 'unknown_provider' });
    const clientId = provider.clientId();
    if (!clientId) return reply.code(503).send({ error: 'not_configured' });
    const url = new URL(provider.authUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri(req.params.provider));
    url.searchParams.set('scope', provider.scope);
    url.searchParams.set('response_type', 'code');
    // Carried through the signed state, because the provider hands `state` back untouched and
    // there is nowhere else to keep it: this flow is deliberately stateless between /start and
    // /callback.
    url.searchParams.set('state', signState(req.params.provider, req.query?.next));
    return reply.redirect(url.toString());
  });

  app.get('/auth/oauth/:provider/callback', { preHandler: optionalAuth(), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    // The callback too, not just the start. A code already in flight when the switch is
    // thrown would otherwise still be exchanged for a session.
    if (!flagEnabled('features.oauthLoginEnabled')) return disabledReply(reply, 'oauth_login');
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
    const stateClaims = verifyState(state, name);
    if (!stateClaims) return fail('bad_state');
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

      // Already signed in: this is "add a sign-in method" from the profile, not a login. The
      // session is the proof of ownership — no e-mail match needed — and a provider identity
      // that already belongs to another account is refused rather than moved.
      if (req.user?.uid) {
        if (existingLink && existingLink.userId !== req.user.uid) return reply.redirect(`${SITE_URL}/profile?tab=security&link_error=already_linked`);
        const me = await p.user.findUnique({ where: { id: req.user.uid } });
        if (!me) return fail('unexpected');
        if (!existingLink) await p.oAuthAccount.create({ data: { userId: me.id, provider: name, providerAccountId: profile.id, username: profile.username } });
        await attachDiscord(p, name, profile, me);
        return reply.redirect(`${SITE_URL}/profile?tab=security&linked=${name}`);
      }

      let user;
      if (existingLink) {
        user = existingLink.user;
      } else {
        const sameEmail = await p.user.findUnique({ where: { email: profile.email } });
        if (sameEmail) {
          // An account already owns this address. It used to be linked on the spot — which
          // made "I control an e-mail at some provider" equal to "I own the BetterCommunity
          // account", a bet on every provider's verification forever. Now the person proves
          // it: the account's password, or the code mailed to the address. The proposal
          // carries everything the link needs so the provider round trip is not repeated.
          const token = crypto.randomBytes(24).toString('hex');
          const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
          await p.oAuthLinkProposal.create({ data: { tokenHash: sha256(token), userId: sameEmail.id, provider: name, providerAccountId: profile.id, username: profile.username, avatar: profile.avatar, codeHash: sha256(code), expiresAt: new Date(Date.now() + LINK_TTL_MS) } });
          const label = LABEL[name] || name;
          const sent = await sendMail({
            to: sameEmail.email,
            subject: `Link ${label} to your BetterCommunity account`,
            html: mailShell('Link a sign-in method', `Someone — most likely you — just signed in with ${label} using this address. To link it to your existing BetterCommunity account, enter this code on the page that is waiting for it:<br><br><b style="font-size:22px;letter-spacing:.25em">${code}</b><br><br>It expires in 15 minutes. If this wasn't you, ignore this e-mail: nothing is linked without the code or your password.`, null),
            text: `Your BetterCommunity link code: ${code} (valid 15 minutes). If this wasn't you, ignore this e-mail.`,
          }).catch(() => false);
          const q = new URLSearchParams({ link: token, provider: name });
          const nx = safeNext(stateClaims.next); if (nx) q.set('next', nx);
          // No mail backend at all (local dev): the code rides along, exactly as the password
          // reset hands back its devToken. Never when mail is merely failing.
          if (!sent && !emailEnabled()) q.set('devcode', code);
          return reply.redirect(`${SITE_URL}/auth?${q.toString()}`);
        }
        // New account — adopt the provider's picture as the BCWEB avatar straight away.
        user = await p.user.create({ data: { email: profile.email, displayName: profile.displayName || slugName(profile.username), emailVerified: true, avatar: profile.avatar ? { image: profile.avatar } : undefined } });
        grantAutoBadges(p, { event: 'signup', user }).catch(() => {});
        await p.oAuthAccount.create({ data: { userId: user.id, provider: name, providerAccountId: profile.id, username: profile.username } });
        sendPasswordSetup(p, user, LABEL[name] || name).catch(() => {});
      }
      await attachDiscord(p, name, profile, user);

      await issueSession(reply, user, req);
      // Re-checked coming OUT as well as going in. The signature makes tampering impossible,
      // so this is belt-and-braces — but a state minted by an older build, or by a future one
      // that relaxes the entry check, must not be the thing that turns this into a redirector.
      const back = safeNext(stateClaims.next);
      return reply.redirect(back ? `${SITE_URL}${back}` : `${SITE_URL}/dashboard?oauth=success`);
    } catch (e) {
      req.log.error(e);
      return fail('unexpected');
    }
  });

  // Profile: which providers this account has linked (for the "Connected accounts" UI).
  app.get('/me/oauth', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const [links, me] = await Promise.all([
      p.oAuthAccount.findMany({ where: { userId: req.user.uid }, select: { provider: true, username: true, linkedAt: true } }),
      p.user.findUnique({ where: { id: req.user.uid }, select: { passwordHash: true } }),
    ]);
    return { links, hasPassword: !!me?.passwordHash };
  });

  // Detach a provider. Refused when it is the account's only way in: an account with no
  // password and no other provider would be unreachable the moment this returned.
  app.delete('/me/oauth/:provider', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const [me, links] = await Promise.all([
      p.user.findUnique({ where: { id: req.user.uid }, select: { passwordHash: true } }),
      p.oAuthAccount.findMany({ where: { userId: req.user.uid }, select: { provider: true } }),
    ]);
    if (!links.some((l) => l.provider === req.params.provider)) return reply.code(404).send({ error: 'not_linked' });
    if (!me?.passwordHash && links.length <= 1) return reply.code(409).send({ error: 'last_method' });
    await p.oAuthAccount.deleteMany({ where: { userId: req.user.uid, provider: req.params.provider } });
    return { ok: true };
  });

  const liveProposal = async (p, token) => {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const row = await p.oAuthLinkProposal.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) return null;
    return row;
  };

  // What the sign-in page shows while the proposal waits: which provider, which (masked)
  // address, and whether the account has a password to confirm with.
  app.get('/auth/oauth/link/:token', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const p = await db();
    const row = await liveProposal(p, req.params.token);
    if (!row) return reply.code(404).send({ error: 'invalid_token' });
    const u = await p.user.findUnique({ where: { id: row.userId }, select: { email: true, passwordHash: true, displayName: true } });
    if (!u) return reply.code(404).send({ error: 'invalid_token' });
    return { provider: row.provider, username: row.username, email: maskEmail(u.email), displayName: u.displayName, hasPassword: !!u.passwordHash, expiresAt: row.expiresAt };
  });

  // Prove ownership, link, sign in. Password OR mailed code — whichever the person has.
  app.post('/auth/oauth/link/confirm', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const b = req.body || {};
    const p = await db();
    const row = await liveProposal(p, b.token);
    if (!row) return reply.code(404).send({ error: 'invalid_token' });
    const user = await p.user.findUnique({ where: { id: row.userId } });
    if (!user) return reply.code(404).send({ error: 'invalid_token' });
    let proven = false;
    if (typeof b.password === 'string' && b.password && user.passwordHash) proven = await argon2.verify(user.passwordHash, b.password).catch(() => false);
    if (!proven && typeof b.code === 'string' && /^\d{6}$/.test(b.code.trim()) && row.codeHash) proven = safeEqual(sha256(b.code.trim()), row.codeHash);
    if (!proven) return reply.code(401).send({ error: 'wrong_credentials' });
    const taken = await p.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: row.provider, providerAccountId: row.providerAccountId } } });
    if (taken && taken.userId !== user.id) return reply.code(409).send({ error: 'already_linked' });
    if (!taken) await p.oAuthAccount.create({ data: { userId: user.id, provider: row.provider, providerAccountId: row.providerAccountId, username: row.username } });
    // Never set an avatar → adopt the provider's picture (the deliberate-choice test is
    // `!user.avatar`, an avatar object with image:null counts as a choice).
    if (row.avatar && !user.avatar) await p.user.update({ where: { id: user.id }, data: { avatar: { image: row.avatar } } }).catch(() => {});
    await attachDiscord(p, row.provider, { id: row.providerAccountId, username: row.username }, user);
    await p.oAuthLinkProposal.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await issueSession(reply, user, req);
    return { ok: true };
  });

  // "That's not my account" — burn the proposal so the URL cannot be replayed.
  app.post('/auth/oauth/link/decline', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async (req) => {
    const p = await db();
    const row = await liveProposal(p, req.body?.token);
    if (row) await p.oAuthLinkProposal.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return { ok: true };
  });
}
