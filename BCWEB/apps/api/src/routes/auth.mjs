import { z } from 'zod';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { db, issueSession, clearSession, requireRole, optionalAuth, safeEqual } from '../lib.mjs';
import { generateSecret, verifyTotp, otpauthUri, generateRecoveryCodes } from '../totp.mjs';

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

const creds = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(2).max(40).optional(),
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
    const parsed = creds.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const { email, password, displayName } = parsed.data;
    const p = await db();
    if (await p.user.findUnique({ where: { email } })) return reply.code(409).send({ error: 'email_taken' });
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await p.user.create({ data: { email, passwordHash, displayName: displayName || email.split('@')[0] } });
    return issueSession(reply, user);
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
      if (process.env.EMAIL_ENABLED !== 'true') devToken = token; // TODO: email this in prod
    }
    return { ok: true, ...(devToken ? { devToken } : {}) };
  });

  // Complete a reset with the token + a new password.
  app.post('/auth/reset/confirm', authLimit, async (req, reply) => {
    const b = z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(200) }).safeParse(req.body);
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
    if (user.totpEnabled) {
      // Password verified, but the session isn't issued yet — a short-lived token
      // (returned in the body, not a cookie) is all the client can use, and only
      // to complete /auth/login/2fa. Not logged as a full success yet.
      const tempToken = jwt.sign({ uid: user.id, purpose: '2fa-pending' }, JWT_SECRET, { expiresIn: 300 });
      return { twoFactorRequired: true, tempToken };
    }
    await logLogin(p, { email: user.email, ip, success: true, reason: 'ok', userId: user.id });
    return issueSession(reply, user);
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
    return issueSession(reply, user);
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

  app.post('/auth/logout', async (_req, reply) => { clearSession(reply); return { ok: true }; });

  const profileSelect = { id: true, email: true, displayName: true, role: true, emailVerified: true, bio: true, avatar: true, createdAt: true, totpEnabled: true };

  // Soft-authed "who am I": logged-out visitors get 200 { user: null } instead of a
  // noisy 401 in the console. The app boots this on every load.
  app.get('/me', { preHandler: optionalAuth() }, async (req) => {
    if (!req.user?.uid) return { user: null };
    const p = await db();
    const user = await p.user.findUnique({ where: { id: req.user.uid }, select: profileSelect });
    return { user };
  });

  // Update profile (display name, bio, avatar).
  app.patch('/me', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      displayName: z.string().min(2).max(40).optional(),
      bio: z.string().max(280).optional(),
      avatar: z.object({ variant: z.string().max(20), seed: z.string().max(60), colors: z.array(z.string().max(9)).max(6).optional(), image: z.string().max(500).nullable().optional() }).nullable().optional(),
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
