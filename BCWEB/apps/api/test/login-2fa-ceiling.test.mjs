// The second step of a 2FA sign-in stops checking codes after TWOFA_MAX_FAILS wrong ones on
// the same ACCOUNT inside the failure window (full audit, Sept 24 2026).
//
// Before, the only bound on /auth/login/2fa was the per-IP rate limit: failures were recorded
// but never read back at this step, and every wrong code also ran the argon2 recovery-code
// loop. Now the account's recent `2fa_invalid` rows are counted first, whatever IP or
// half-token they came from.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the 2FA ceiling tests';
process.env.JWT_SECRET ||= 'login-2fa-ceiling-secret';

let p, app, jwt, auth, totp;
const MAIL = '@twofaceil.test';
let seq = 0;

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  totp = await import('../src/lib/totp.mjs');
  auth = await import('../src/routes/auth.mjs');
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register(auth.default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const ids = (await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })).map((u) => u.id);
  await p.loginAttempt.deleteMany({ where: { OR: [{ userId: { in: ids } }, { email: { endsWith: MAIL } }] } }).catch(() => {});
  await p.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await p.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await app?.close();
});

// RFC 6238, written here rather than imported: the module keeps its generator private.
function codeNow(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const bytes = [];
  for (const ch of secret) { value = (value << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  const buf = Buffer.alloc(8); buf.writeBigInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

async function account(priorFails) {
  const secret = totp.generateSecret();
  const u = await p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `tf-${seq}`, emailVerified: true, status: 'active', totpEnabled: true, totpSecret: secret } });
  if (priorFails) {
    await p.loginAttempt.createMany({ data: Array.from({ length: priorFails }, () => ({ email: u.email, ip: '198.51.100.9', success: false, reason: '2fa_invalid', userId: u.id })) });
  }
  const tempToken = jwt.sign({ uid: u.id, purpose: '2fa-pending' }, process.env.JWT_SECRET, { expiresIn: 300 });
  return { u, secret, tempToken };
}
const step2 = (tempToken, code) => app.inject({ method: 'POST', url: '/auth/login/2fa', payload: { tempToken, code } });

describe('/auth/login/2fa has a per-account ceiling', { skip }, () => {
  test('controls: under the ceiling a right code signs in and a wrong one is 2fa_invalid', async () => {
    const a = await account(auth.TWOFA_MAX_FAILS - 1);
    assert.equal((await step2(a.tempToken, '000000' === codeNow(a.secret) ? '111111' : '000000')).json().error, '2fa_invalid');
    const b = await account(0);
    const ok = await step2(b.tempToken, codeNow(b.secret));
    assert.equal(ok.statusCode, 200, ok.body);
  });

  test('at the ceiling no code is checked, not even the right one', async () => {
    const a = await account(auth.TWOFA_MAX_FAILS);
    const r = await step2(a.tempToken, codeNow(a.secret));
    assert.equal(r.statusCode, 429, `the ${auth.TWOFA_MAX_FAILS + 1}th code in the window was still checked: ${r.body}`);
    assert.equal(r.json().error, '2fa_locked');
  });
});
