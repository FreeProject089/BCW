// A closed account stays closed.
//
// Pentest 2026-09-22, card 2 — "can a closed one be revived?". `anonymiseAccount`
// (routes/closure.mjs) says it removes "everything that could still let somebody in", and it
// removes a great deal: the password hash, the sessions, the refresh tokens, the API keys, the
// consents, the provider links. It does NOT remove PasswordReset rows, and `/auth/reset/confirm`
// never asked whose account a token belonged to — so a token issued in the hour before the
// closure sweep (or a 24-hour "set a password" link from an OAuth signup, oauth.mjs
// `sendPasswordSetup`) wrote a fresh hash onto the closed row. `/auth/login` had no `closedAt`
// check of its own, and the closed address is the predictable `closed+<userId>@account.invalid`.
//
// Two refusals, because either alone leaves the other as the rule: the reset burns the token,
// and the login refuses the row. The test drives real HTTP through the real handlers.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the closed-account revival test';
process.env.JWT_SECRET ||= 'closed-account-test-secret';

const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const EMAIL = 'pentest-closed-revival@example.invalid';

let p, app, anonymiseAccount;

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  ({ anonymiseAccount } = await import('../src/routes/closure.mjs'));
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/auth.mjs')).default);
  await app.ready();
});

async function wipe() {
  const ids = (await p.user.findMany({ where: { OR: [{ email: EMAIL }, { closedEmailHash: sha256(EMAIL) }] }, select: { id: true } })).map((u) => u.id);
  if (!ids.length) return;
  for (const model of ['passwordReset', 'emailVerification', 'session', 'notification', 'loginAlert', 'loginAttempt']) {
    await p[model]?.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  }
  await p.loginAttempt?.deleteMany({ where: { email: { contains: 'pentest-closed-revival' } } }).catch(() => {});
  await p.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
}

after(async () => {
  if (!RUN) return;
  try { await wipe(); } finally { await app?.close(); await p?.$disconnect?.(); }
});

describe('a closed account cannot be reopened with a leftover token', { skip }, () => {
  test('the reset token is refused and burned, and the closed row never gets a password', async () => {
    await wipe();
    const argon2 = (await import('argon2')).default;
    const user = await p.user.create({ data: { email: EMAIL, displayName: 'revival probe', emailVerified: true, passwordHash: await argon2.hash('Correct-Horse-9!') } });
    const token = crypto.randomBytes(24).toString('hex');
    await p.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600e3) } });

    await anonymiseAccount(p, user);
    const closed = await p.user.findUnique({ where: { id: user.id }, select: { email: true, passwordHash: true, closedAt: true } });
    assert.ok(closed.closedAt, 'the fixture did not actually close');
    assert.equal(closed.passwordHash, null);

    const r = await app.inject({ method: 'POST', url: '/auth/reset/confirm', payload: { token, password: 'Another-Horse-42!' } });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().error, 'invalid_token');
    assert.equal((await p.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } })).passwordHash, null,
      'the closed account was given a password');

    // Burned, not merely refused: a token that still works is one that is tried again.
    const row = await p.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    assert.ok(row.usedAt, 'the token survived its own refusal');
  });

  test('and the login route refuses a closed row on its own, in the same words as a wrong password', async () => {
    // Belt and braces, and the reason it is not redundant: "it has no password" is a property
    // of anonymiseAccount, not a rule of this route. If a password ever reaches a closed row by
    // some other path, the session must still not be issued — and the refusal must not be
    // distinguishable, or the closed address of a real person becomes confirmable from here.
    await wipe();
    const argon2 = (await import('argon2')).default;
    const user = await p.user.create({ data: { email: EMAIL, displayName: 'revival probe', emailVerified: true, passwordHash: await argon2.hash('Correct-Horse-9!') } });
    await p.user.update({ where: { id: user.id }, data: { closedAt: new Date() } });

    const mine = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: EMAIL, password: 'Correct-Horse-9!' } });
    assert.equal(mine.statusCode, 401, mine.body);
    assert.equal(mine.json().error, 'invalid_credentials');
    assert.ok(!mine.headers['set-cookie'], 'a session cookie was issued for a closed account');

    const wrong = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: EMAIL, password: 'not-the-password' } });
    assert.deepEqual(mine.json(), wrong.json(), 'the right password on a closed account must look like the wrong one');
  });
});
