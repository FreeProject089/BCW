import { z } from 'zod';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { db, issueSession, clearSession, requireRole, optionalAuth, safeEqual, clearAccountLockCache, projectGrants, logAudit } from '../lib/lib.mjs';
import { emailHash } from './closure.mjs';
import { generateSecret, verifyTotp, otpauthUri, generateRecoveryCodes } from '../lib/totp.mjs';
import { userBcId } from '../lib/repofingerprint.mjs';
import { grantAutoBadges } from './social.mjs';
import { sendMail, mailShell, emailEnabled } from '../lib/mail.mjs';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');

// Create + email an account-confirmation token (non-blocking; no-op if email is off).
async function sendVerificationEmail(p, user) {
  if (!emailEnabled() || user.emailVerified) return;
  const token = crypto.randomBytes(24).toString('hex');
  await p.emailVerification.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600e3) } });
  const url = `${SITE_URL}/verify-email?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Confirm your BetterCommunity email',
    html: mailShell('Confirm your email', 'Welcome to BetterCommunity! Confirm your email address to finish securing your account. This link is valid for 24 hours.', { url, label: 'Confirm my email' }),
    text: `Confirm your BetterCommunity email: ${url}`,
  }).catch(() => {});
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
// The real client IP as observed by our trusted proxy (Caddy appends it last).
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip;
}
async function logLogin(p, { email, ip, success, reason, userId }) {
  try { await p.loginAttempt.create({ data: { email: String(email || '').slice(0, 160), ip: String(ip || '').slice(0, 64), success, reason: reason || null, userId: userId || null } }); } catch { /* non-fatal */ }
}

// Passwords that a credential-stuffing list tries in its first few hundred guesses.
// Eight characters is the floor the schema enforces, and "password" is eight
// characters — argon2id makes each guess expensive, but not expensive enough to
// matter when the guess is the first one anybody makes.
//
// A blocklist rather than composition rules on purpose. "One uppercase, one digit,
// one symbol" mostly produces `Password1!`, which is on every list too; refusing the
// handful of passwords that are actually tried costs a real user nothing, because
// almost nobody who picks a genuine password lands in this set.
//
// Normalised before comparison, so `Passw0rd`, `PASSWORD` and `p@ssword` are all
// caught by the same entry — leetspeak substitution is not a defence, it is the
// first thing a cracking list expands.
const WEAK_PASSWORDS = new Set([
  'password', 'passwort', 'motdepasse', 'azerty', 'qwerty', 'qwertyuiop', 'azertyuiop',
  '12345678', '123456789', '1234567890', '11111111', '00000000', '87654321',
  'iloveyou', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'batman',
  'welcome', 'letmein', 'monkey', 'dragon', 'master', 'shadow', 'trustno1',
  'abc12345', 'a1b2c3d4', 'qazwsxedc', 'zaq12wsx', 'admin123', 'root1234',
  'bettermodsmanager', 'bettercommunity', 'minecraft', 'starwars', 'pokemon',
]);

function isWeakPassword(pw) {
  const n = String(pw).toLowerCase()
    .replace(/[@4]/g, 'a').replace(/[0]/g, 'o').replace(/[1!|]/g, 'l')
    .replace(/[3]/g, 'e').replace(/[$5]/g, 's').replace(/[7]/g, 't');
  if (WEAK_PASSWORDS.has(n)) return true;
  // A single repeated character, and simple runs, whatever the length.
  if (/^(.)+$/.test(n)) return true;
  if ('abcdefghijklmnopqrstuvwxyz'.includes(n) || '01234567890'.includes(n)) return true;
  return false;
}

// The weak-password rule belongs on the paths that SET a password, never on the one
// that checks it. zod's .pick() carries a .refine() across, so putting the rule on a
// shared schema and reusing it for login would refuse the credentials of every
// existing account whose password happens to be on the list — locking them out of
// their own account with no way back. Two schemas, and the difference is the point.
const creds = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(2).max(40).optional(),
});

/** Registration and password reset: the same shape, plus the weak-password refusal. */
const newCreds = creds.extend({
  password: z.string().min(8).max(200)
    .refine((pw) => !isWeakPassword(pw), { message: 'weak_password' }),
});

// Stricter rate limit on credential endpoints (brute-force protection).
const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

// ── Proof-of-work (anti-mass-signup) ──
// Stateless signed challenge: the client must find a nonce so sha256(challenge:nonce)
// has >= POW_BITS leading zero bits. The HMAC + timestamp make it fresh + untamperable
// without any server storage.
const POW_BITS = Number(process.env.POW_BITS || 18);
const POW_TTL_MS = 5 * 60 * 1000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(s).digest('hex').slice(0, 32);
function powChallenge() {
  const base = `${Date.now()}.${crypto.randomBytes(12).toString('hex')}`;
  return { challenge: `${base}.${hmac(base)}`, difficulty: POW_BITS };
}
function leadingZeroBits(hex) {
  let bits = 0;
  for (const ch of hex) { const v = parseInt(ch, 16); if (v === 0) { bits += 4; continue; } bits += Math.clz32(v) - 28; break; }
  return bits;
}
export function powVerify(pow) {
  if (!pow || typeof pow.challenge !== 'string' || pow.nonce == null) return false;
  const parts = pow.challenge.split('.');
  if (parts.length !== 3) return false;
  const [ts, rand, sig] = parts;
  if (!safeEqual(hmac(`${ts}.${rand}`), sig)) return false;        // tamper check (constant-time)
  if (Date.now() - Number(ts) > POW_TTL_MS) return false;          // freshness
  return leadingZeroBits(sha256(`${pow.challenge}:${pow.nonce}`)) >= POW_BITS;
}

export default async function authRoutes(app) {
  // Hand out a fresh PoW challenge for the signup form.
  app.get('/auth/pow', authLimit, async () => powChallenge());

  app.post('/auth/register', authLimit, async (req, reply) => {
    if (!powVerify(req.body?.pow)) return reply.code(400).send({ error: 'pow_required' });
    const parsed = newCreds.safeParse(req.body);  // registration: weak passwords refused
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const { email, password, displayName } = parsed.data;
    const p = await db();
    if (await p.user.findUnique({ where: { email } })) return reply.code(409).send({ error: 'email_taken' });
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    // Coming back to an address that used to have an account here.
    //
    // Closing anonymises the row, so the old address is gone — but its SHA-256 was kept
    // precisely for this moment. The new account is linked to the old one, which does two
    // things at once: a returning member keeps the history they earned, and somebody who
    // closed their account to escape a moderation record does not get a clean one. Ban
    // state is inherited for exactly that reason; anything else would make "delete my
    // account" the fastest way to undo a ban.
    const prior = await p.user.findFirst({
      where: { closedEmailHash: emailHash(email), closedAt: { not: null } },
      orderBy: { closedAt: 'desc' },
      select: { id: true, status: true, moderationReason: true, moderationUntil: true },
    });
    const carried = prior && prior.status && prior.status !== 'active'
      ? { status: prior.status, moderationReason: prior.moderationReason, moderationUntil: prior.moderationUntil }
      : {};

    const user = await p.user.create({ data: {
      email, passwordHash, displayName: displayName || email.split('@')[0],
      ...(prior ? { priorUserId: prior.id } : {}),
      ...carried,
    } });
    if (prior) {
      await logAudit(p, user.id, 'account.returned', `linked to closed account ${prior.id}${carried.status ? ` (carried ${carried.status})` : ''}`, clientIp(req)).catch(() => {});
    }
    grantAutoBadges(p, { event: 'signup', user }).catch(() => {}); // e.g. the 100th-signup badge
    sendVerificationEmail(p, user).catch(() => {}); // fire-and-forget confirmation email
    return issueSession(reply, user, req);
  });

  // Confirm an email with the token from the confirmation email.
  app.post('/auth/verify-email', authLimit, async (req, reply) => {
    const b = z.object({ token: z.string().min(10).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const ev = await p.emailVerification.findUnique({ where: { tokenHash: sha256(b.data.token) } });
    if (!ev || ev.usedAt || ev.expiresAt < new Date()) return reply.code(400).send({ error: 'invalid_token' });
    await p.user.update({ where: { id: ev.userId }, data: { emailVerified: true } });
    await p.emailVerification.update({ where: { id: ev.id }, data: { usedAt: new Date() } });
    return { ok: true };
  });

  // Resend the confirmation email to the signed-in user (rate-limited).
  app.post('/auth/verify-email/resend', { preHandler: requireRole(), config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const user = await p.user.findUnique({ where: { id: req.user.uid } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    if (user.emailVerified) return { ok: true, already: true };
    if (!emailEnabled()) return reply.code(503).send({ error: 'email_disabled' });
    await sendVerificationEmail(p, user);
    return { ok: true };
  });

  // Request a password reset. Always returns ok (never leaks whether the email exists).
  // Without an email backend the token is returned as devToken so the flow is usable.
  app.post('/auth/reset/request', authLimit, async (req, reply) => {
    const b = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.findUnique({ where: { email: b.data.email } });
    let devToken;
    if (user) {
      const token = crypto.randomBytes(24).toString('hex');
      await p.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600e3) } });
      const url = `${SITE_URL}/auth?reset=${token}`;
      const sent = await sendMail({
        to: user.email,
        subject: 'Reset your BetterCommunity password',
        html: mailShell('Reset your password', "We received a request to reset your password. This link is valid for 1 hour. If you didn't request it, you can safely ignore this email.", { url, label: 'Reset my password' }),
        text: `Reset your BetterCommunity password: ${url}`,
      }).catch(() => false);
      if (!sent) devToken = token; // no email backend → return it so the dev flow still works
    }
    return { ok: true, ...(devToken ? { devToken } : {}) };
  });

  // Complete a reset with the token + a new password.
  app.post('/auth/reset/confirm', authLimit, async (req, reply) => {
    const b = z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(200).refine((pw) => !isWeakPassword(pw), { message: 'weak_password' }) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const pr = await p.passwordReset.findUnique({ where: { tokenHash: sha256(b.data.token) } });
    if (!pr || pr.usedAt || pr.expiresAt < new Date()) return reply.code(400).send({ error: 'invalid_token' });
    await p.user.update({ where: { id: pr.userId }, data: { passwordHash: await argon2.hash(b.data.password, { type: argon2.argon2id }) } });
    await p.passwordReset.update({ where: { id: pr.id }, data: { usedAt: new Date() } });
    return { ok: true };
  });

  app.post('/auth/login', authLimit, async (req, reply) => {
    const parsed = creds.pick({ email: true, password: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const ip = clientIp(req);

    // Credential stuffing is distributed by definition, so a per-IP rate limit does
    // not see it: every request comes from a fresh address and each one is under the
    // quota. Recent failures are counted per EMAIL instead, across every IP, and past
    // a handful of them the caller must attach a proof of work.
    //
    // Deliberately not a lockout. Locking an account after N failures makes the login
    // form a denial-of-service weapon against its owner — anyone who knows the address
    // can keep it shut. A proof of work costs the attacker seconds per attempt and
    // costs the real owner a progress line, and it is never possible to lock someone
    // out with it.
    //
    // Counted on the SUBMITTED address, whether or not it belongs to an account, so
    // the response cannot be used to tell existing addresses from absent ones.
    const failWindow = new Date(Date.now() - 15 * 60_000);
    const recentFails = await p.loginAttempt.count({
      where: { email: parsed.data.email, success: false, createdAt: { gte: failWindow } },
    }).catch(() => 0);
    if (recentFails >= 3 && !powVerify(req.body?.pow)) {
      return reply.code(429).send({ error: 'pow_required', ...powChallenge() });
    }
    const user = await p.user.findUnique({ where: { email: parsed.data.email } });
    if (!user?.passwordHash) {
      // OAuth-only account (GitHub/Discord) — no password to check against.
      await logLogin(p, { email: parsed.data.email, ip, success: false, reason: user ? 'oauth_only' : 'bad_password', userId: user?.id });
      return reply.code(401).send({ error: user ? 'oauth_only_account' : 'invalid_credentials' });
    }
    if (!(await argon2.verify(user.passwordHash, parsed.data.password))) {
      await logLogin(p, { email: parsed.data.email, ip, success: false, reason: 'bad_password', userId: user.id });
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    // Account moderation gate: a suspended/banned account can't sign in — it gets the
    // reason + remaining time (permanent → contact support). An expired temporary lock
    // auto-lifts here, so the user regains access without any admin action.
    // A BAN refuses the sign-in. A suspension does not: it freezes the services, and
    // somebody who cannot sign in cannot read why they were suspended, appeal it, or get
    // their invoices — which turns a service sanction into an account lockout by accident.
    if (user.status === 'banned') {
      const until = user.moderationUntil ? new Date(user.moderationUntil) : null;
      if (!until || until.getTime() > Date.now()) {
        await logLogin(p, { email: user.email, ip, success: false, reason: `account_${user.status}`, userId: user.id });
        return reply.code(403).send({ error: `account_${user.status}`, status: user.status, reason: user.moderationReason || null, until: until ? until.toISOString() : null, permanent: !until });
      }
      await p.user.update({ where: { id: user.id }, data: { status: 'active', moderationUntil: null, moderationReason: null } }).catch(() => {});
      clearAccountLockCache(user.id);
    }
    if (user.totpEnabled) {
      // Password verified, but the session isn't issued yet — a short-lived token
      // (returned in the body, not a cookie) is all the client can use, and only
      // to complete /auth/login/2fa. Not logged as a full success yet.
      const tempToken = jwt.sign({ uid: user.id, purpose: '2fa-pending' }, JWT_SECRET, { expiresIn: 300 });
      return { twoFactorRequired: true, tempToken };
    }
    await logLogin(p, { email: user.email, ip, success: true, reason: 'ok', userId: user.id });
    return issueSession(reply, user, req);
  });

  // Step 2 of a 2FA-protected login: a TOTP code (or a one-time recovery code).
  app.post('/auth/login/2fa', authLimit, async (req, reply) => {
    const b = z.object({ tempToken: z.string().min(10), code: z.string().min(4).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    let claims;
    try { claims = jwt.verify(b.data.tempToken, JWT_SECRET); if (claims.purpose !== '2fa-pending') throw new Error('bad'); }
    catch { return reply.code(401).send({ error: 'invalid_token' }); }
    const p = await db();
    const ip = clientIp(req);
    const user = await p.user.findUnique({ where: { id: claims.uid } });
    if (!user || !user.totpEnabled) return reply.code(401).send({ error: 'invalid_token' });
    const code = b.data.code.trim();
    let ok = verifyTotp(user.totpSecret, code);
    let usedRecovery = null;
    if (!ok) {
      // Try recovery codes (argon2 hashes) — case/format-normalized the same way they were generated.
      const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      for (const hash of user.totpRecoveryCodes) { if (await argon2.verify(hash, norm).catch(() => false)) { ok = true; usedRecovery = hash; break; } }
    }
    if (!ok) {
      await logLogin(p, { email: user.email, ip, success: false, reason: '2fa_invalid', userId: user.id });
      return reply.code(401).send({ error: '2fa_invalid' });
    }
    if (usedRecovery) await p.user.update({ where: { id: user.id }, data: { totpRecoveryCodes: user.totpRecoveryCodes.filter((h) => h !== usedRecovery) } });
    await logLogin(p, { email: user.email, ip, success: true, reason: 'ok', userId: user.id });
    return issueSession(reply, user, req);
  });

  // ── 2FA enrollment (self-service — an admin can never enable/disable this FOR
  // another account, only the account owner, since it's a personal auth factor) ──
  app.post('/me/2fa/setup', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const user = await p.user.findUnique({ where: { id: req.user.uid }, select: { email: true, totpEnabled: true } });
    const secret = generateSecret();
    return { secret, otpauth: otpauthUri(secret, { account: user.email }), alreadyEnabled: user.totpEnabled };
  });

  app.post('/me/2fa/enable', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ secret: z.string().min(10).max(64), code: z.string().min(6).max(6) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!verifyTotp(b.data.secret, b.data.code)) return reply.code(400).send({ error: 'invalid_code' });
    const p = await db();
    const recoveryCodes = generateRecoveryCodes();
    const hashed = await Promise.all(recoveryCodes.map((c) => argon2.hash(c.replace('-', ''), { type: argon2.argon2id })));
    await p.user.update({ where: { id: req.user.uid }, data: { totpSecret: b.data.secret, totpEnabled: true, totpRecoveryCodes: hashed } });
    return { ok: true, recoveryCodes }; // shown to the user exactly once
  });

  app.post('/me/2fa/disable', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ password: z.string().min(1), code: z.string().min(4).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.findUnique({ where: { id: req.user.uid } });
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, b.data.password))) return reply.code(401).send({ error: 'wrong_password' });
    if (!user.totpEnabled) return reply.code(400).send({ error: 'not_enabled' });
    const norm = b.data.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let ok = verifyTotp(user.totpSecret, b.data.code);
    if (!ok) { for (const hash of user.totpRecoveryCodes) { if (await argon2.verify(hash, norm).catch(() => false)) { ok = true; break; } } }
    if (!ok) return reply.code(400).send({ error: 'invalid_code' });
    await p.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabled: false, totpRecoveryCodes: [] } });
    return { ok: true };
  });

  app.get('/me/2fa', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid }, select: { totpEnabled: true, canControlServer: true, totpRecoveryCodes: true } });
    return { enabled: !!u?.totpEnabled, canControlServer: !!u?.canControlServer, recoveryCodesLeft: u?.totpRecoveryCodes.length || 0 };
  });

  // Bump the telemetry epoch on the way out so any live telemetry SSO token / host
  // cookie the user still holds is instantly invalidated — signing out of BCWEB
  // signs you out of the (separate) BMM telemetry dashboard too.
  app.post('/auth/logout', { preHandler: optionalAuth() }, async (req, reply) => {
    if (req.user?.uid) await (await db()).user.update({ where: { id: req.user.uid }, data: { telemetryEpoch: { increment: 1 } } }).catch(() => {});
    // Mark THIS device signed out. Clearing the cookie already ends the session for this
    // browser, but the row would otherwise sit in the user's Sessions panel looking live —
    // and the panel is precisely where someone checks that a sign-out took.
    if (req.user?.sid) {
      await (await db()).session.updateMany({
        where: { id: req.user.sid, userId: req.user.uid, revokedAt: null },
        data: { revokedAt: new Date() },
      }).catch(() => {});
    }
    clearSession(reply);
    return { ok: true };
  });

  const profileSelect = { id: true, email: true, displayName: true, role: true, permissions: true, customRoleIds: true, emailVerified: true, bio: true, avatar: true, createdAt: true, totpEnabled: true, profilePublic: true, showConnections: true, website: true, badges: { include: { badge: true }, orderBy: { badge: { priority: 'desc' } } }, oauthAccounts: { select: { provider: true } }, socialConnections: { select: { provider: true } }, _count: { select: { discordLinks: true, creatorLinks: true } } };

  // Soft-authed "who am I": logged-out visitors get 200 { user: null } instead of a
  // noisy 401 in the console. The app boots this on every load.
  app.get('/me', { preHandler: optionalAuth() }, async (req) => {
    if (!req.user?.uid) return { user: null };
    const p = await db();
    const user = await p.user.findUnique({ where: { id: req.user.uid }, select: profileSelect });
    if (!user) return { user: null };
    // Resolve the assigned custom roles + per-project grants so the client can gate the
    // dashboard off EFFECTIVE capabilities (tier ∪ individual ∪ role bundles), not just the
    // raw `permissions` column. `permissions` stays the individual grants (what the Access
    // editor edits); `effectivePermissions` is the union the UI keys off.
    let customRoles = [];
    if (user.customRoleIds?.length) {
      customRoles = await p.customRole.findMany({ where: { id: { in: user.customRoleIds } }, select: { id: true, name: true, color: true, capabilities: true } });
    }
    const effectivePermissions = [...new Set([...(user.permissions || []), ...customRoles.flatMap((r) => r.capabilities || [])])];
    const g = await projectGrants(user.id);
    return { user: { ...user, bcId: userBcId(user.id), customRoles, effectivePermissions, projectGrants: { allShowcase: g.allShowcase, showcaseIds: [...g.showcaseIds], projectKeys: [...g.projectKeys] } } };
  });

  // ── Signed-in devices ────────────────────────────────────────────────────────
  // The account owner's own view of where their account is logged in. Deliberately
  // NOT an admin surface: it only ever reads the caller's own rows.
  //
  // What is returned is what makes a session recognisable — when it started, when it
  // was last active, roughly where from, and on what. `current` marks the device asking,
  // which is the one thing the list must never get wrong.
  //
  // The full IP is included because the owner is the one person entitled to see where
  // their own account was used from; it is the whole point of the screen. It never
  // leaves this route for anyone else — there is no admin view of it.
  const sessionView = (row, currentSid) => ({
    id: row.id,
    current: row.id === currentSid,
    ip: row.ip,
    device: row.device,
    browser: row.browser,
    os: row.os,
    country: row.country,
    region: row.region,
    city: row.city,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  });

  // Signing a device out is a security action taken BECAUSE something may be wrong, so it
  // is re-authenticated rather than trusted to the session cookie: a stolen cookie must not
  // be able to evict the real owner and keep the account to itself. Password, plus a TOTP
  // code whenever the account has 2FA — the same pair that protects signing in.
  //
  // An OAuth-only account has no password to check (passwordHash is null). It is not let
  // through on nothing: 2FA still applies when enabled, and when there is neither, the
  // session cookie is genuinely all the account has, so requiring more would lock the
  // owner out of a screen that exists to protect them.
  const reauth = async (p, uid, body) => {
    const b = z.object({ password: z.string().default(''), code: z.string().default('') }).safeParse(body || {});
    if (!b.success) return 'invalid_input';
    const user = await p.user.findUnique({
      where: { id: uid },
      select: { passwordHash: true, totpEnabled: true, totpSecret: true },
    });
    if (!user) return 'unauthenticated';
    if (user.passwordHash && !(await argon2.verify(user.passwordHash, b.data.password))) return 'wrong_password';
    if (user.totpEnabled) {
      if (!user.totpSecret || !verifyTotp(user.totpSecret, b.data.code.replace(/\s+/g, ''))) return 'bad_code';
    }
    return null;
  };

  app.get('/me/sessions', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.session.findMany({
      where: { userId: req.user.uid, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      // A bound rather than a page: nobody legitimately has hundreds of live devices, and
      // an unbounded list here would be the one place a stuffed table hurts the owner.
      take: 100,
      select: {
        id: true, ip: true, device: true, browser: true, os: true,
        country: true, region: true, city: true, createdAt: true, lastSeenAt: true,
      },
    });
    // WHICH proofs signing a device out will actually require, so the form can ask for
    // exactly those and nothing else. `reauth` above already skips the password check on
    // an OAuth-only account (there is no hash to verify) — but the form asked for one
    // anyway, so a Discord/GitHub user faced a mandatory-looking "Current password" box
    // they could never fill, on the one screen that exists to evict an intruder.
    const cred = await p.user.findUnique({ where: { id: req.user.uid }, select: { passwordHash: true, totpEnabled: true } });
    // Sessions issued before this feature carry no row; say so rather than implying the
    // list is exhaustive when the caller's own device is missing from it.
    return {
      sessions: rows.map((r) => sessionView(r, req.user.sid)),
      currentTracked: Boolean(req.user.sid),
      reauth: { password: !!cred?.passwordHash, totp: !!cred?.totpEnabled },
    };
  });

  // Revoke one device. Scoped by userId as well as id, so a guessed/mistyped id can only
  // ever reach the caller's own sessions; updateMany makes it idempotent (a second call
  // simply matches nothing).
  app.delete('/me/sessions/:id', { preHandler: requireRole() }, async (req, reply) => {
    const id = String(req.params.id || '');
    if (!id) return reply.code(400).send({ error: 'bad_request' });
    const p = await db();
    const bad = await reauth(p, req.user.uid, req.body);
    if (bad) return reply.code(bad === 'unauthenticated' ? 401 : 403).send({ error: bad });
    const r = await p.session.updateMany({
      where: { id, userId: req.user.uid, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count) return reply.code(404).send({ error: 'not_found' });
    // Revoking the device you are ON is a sign-out: drop the cookie too, or the browser
    // keeps sending a token whose session is dead and every call 401s with no explanation.
    if (id === req.user.sid) clearSession(reply);
    return { ok: true, self: id === req.user.sid };
  });

  // "Sign out everywhere else" — everything except the device asking. Keeping the current
  // one is what makes this safe to press: the user is not locked out by their own click.
  app.delete('/me/sessions', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const bad = await reauth(p, req.user.uid, req.body);
    if (bad) return reply.code(bad === 'unauthenticated' ? 401 : 403).send({ error: bad });
    const r = await p.session.updateMany({
      where: { userId: req.user.uid, revokedAt: null, ...(req.user.sid ? { NOT: { id: req.user.sid } } : {}) },
      data: { revokedAt: new Date() },
    });
    return { ok: true, revoked: r.count };
  });

  // Update profile (display name, bio, avatar).
  app.patch('/me', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      displayName: z.string().min(2).max(40).optional(),
      bio: z.string().max(280).optional(),
      avatar: z.object({ variant: z.string().max(20), seed: z.string().max(60), colors: z.array(z.string().max(9)).max(6).optional(), image: z.string().max(500).nullable().optional() }).nullable().optional(),
      profilePublic: z.boolean().optional(),
      showConnections: z.array(z.enum(['github', 'discord', 'bmm', 'website', 'youtube', 'twitch', 'steam', 'kofi'])).max(8).optional(),
      // Only http(s) — zod .url() otherwise accepts javascript:/data: URIs, which would
      // become an XSS sink when the website is rendered as an <a href> on the public profile.
      website: z.union([z.literal(''), z.string().max(200).url().refine((v) => /^https?:\/\//i.test(v), 'http_or_https_only')]).nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.update({ where: { id: req.user.uid }, data: b.data, select: profileSelect });
    return { user };
  });

  // Change password — or, for an OAuth-only account with no password yet, SET one
  // for the first time (current can be blank in that case; there's nothing to verify).
  app.post('/me/password', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ current: z.string().default(''), next: z.string().min(8).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.findUnique({ where: { id: req.user.uid } });
    if (!user) return reply.code(401).send({ error: 'wrong_password' });
    if (user.passwordHash && !(await argon2.verify(user.passwordHash, b.data.current))) return reply.code(401).send({ error: 'wrong_password' });
    await p.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(b.data.next, { type: argon2.argon2id }) } });
    return { ok: true };
  });
}
