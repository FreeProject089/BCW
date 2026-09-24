// Two doors read the session cookie for themselves, and asked only "does it verify?"
// (full audit, Sept 24 2026).
//
// Every guard in lib.mjs goes through `authenticated()`: the account lock, the Session row,
// `tokenAcceptable` (a token with no `sid` is not a session), the LIVE role. The Aug 22 audit
// proved that a `2fa-pending` token presented as `bcw_session` is refused — by those guards.
// Two routes never call them:
//
//   · the repo dashboard (`routes/repo-dashboard.mjs`, `accessLevel`), a login-optional door
//     that decides owner / staff / collaborator from `jwt.verify` alone;
//   · the telemetry forward-auth gate (`routes/telemetry.mjs`, its third path).
//
// So the half-token `/auth/login` hands out after the PASSWORD and before the second factor
// opened both: the owner's dashboard (private files, uploads, the access list) and, for a
// SUPERADMIN, the telemetry dashboard. Two-factor authentication was optional there, which is
// the exact outcome the Aug 22 audit wrote down as prevented. A revoked device, a banned
// account and a demoted moderator (the role baked into a seven-day token) went through too, and
// a MOD with no 2FA was the owner of every repo on the site.
//
// Plus two holes in the dashboard's own rules:
//   · the password cookie outlived the password: removing or changing the dashboard password
//     left every issued `bcw_rd_<id>` cookie working for its twelve hours;
//   · a collaborator is matched by e-mail, and the address was never required to be confirmed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the session side-door tests';
process.env.JWT_SECRET ||= 'session-side-doors-secret';

let p, app, jwt, argon2;
const MAIL = '@sidedoor.test';
let seq = 0;
const madeRepos = [];

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  argon2 = (await import('argon2')).default;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/repo-dashboard.mjs')).default);
  await app.register((await import('../src/routes/telemetry.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const ids = (await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })).map((u) => u.id);
  await p.repoAuditLog.deleteMany({ where: { serverRepoId: { in: madeRepos } } }).catch(() => {});
  await p.serverRepo.deleteMany({ where: { OR: [{ id: { in: madeRepos } }, { ownerId: { in: ids } }] } }).catch(() => {});
  await p.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await p.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await p.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await app?.close();
});

const S = () => process.env.JWT_SECRET;
const mkUser = (over = {}) => p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `sd-${seq}`, emailVerified: true, status: 'active', ...over } });
async function sessionCookie(u, { role = u.role, revoked = false } = {}) {
  const s = await p.session.create({ data: { userId: u.id, ...(revoked ? { revokedAt: new Date() } : {}) }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role, sid: s.id }, S())}`;
}
// Exactly what POST /auth/login returns to somebody who has the password and not the TOTP.
const pendingCookie = (u) => `bcw_session=${jwt.sign({ uid: u.id, purpose: '2fa-pending' }, S(), { expiresIn: 300 })}`;
async function mkRepo(owner, over = {}) {
  const r = await p.serverRepo.create({ data: {
    name: `sd repo ${seq++}`, ownerId: owner.id, hosted: true, status: 'ONLINE',
    repoUrl: 'https://example.org/r.json', contactEmail: `c${MAIL}`, listed: false, published: false, ...over,
  } });
  madeRepos.push(r.id);
  return r;
}
const dash = (repo, cookie) => app.inject({ method: 'GET', url: `/repos/${repo.id}/dashboard`, headers: cookie ? { cookie } : {} });

describe('the repo dashboard asks the session the way the guards do', { skip }, () => {
  test('controls: the owner, a live staff account with 2FA, and nobody', async () => {
    const owner = await mkUser();
    const repo = await mkRepo(owner);
    const r = await dash(repo, await sessionCookie(owner));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().level, 'owner');
    const admin = await mkUser({ role: 'ADMIN', totpEnabled: true });
    const a = await dash(repo, await sessionCookie(admin));
    assert.equal(a.statusCode, 200, 'staff keep the admin view of the dashboard (a functional choice)');
    assert.equal(a.json().level, 'owner');
    assert.equal((await dash(repo, null)).statusCode, 401);
  });

  test('the 2fa-pending half-token is not a session', async () => {
    const owner = await mkUser({ totpEnabled: true });
    const repo = await mkRepo(owner);
    const r = await dash(repo, pendingCookie(owner));
    assert.notEqual(r.statusCode, 200, 'password without the second factor opened the owner dashboard');
  });

  test('a revoked device and a banned account are refused', async () => {
    const owner = await mkUser();
    const repo = await mkRepo(owner);
    assert.notEqual((await dash(repo, await sessionCookie(owner, { revoked: true }))).statusCode, 200, 'a signed-out device still managed the repo');
    const banned = await mkUser({ status: 'banned' });
    const repo2 = await mkRepo(banned);
    assert.notEqual((await dash(repo2, await sessionCookie(banned))).statusCode, 200, 'a banned account still managed its repo');
  });

  test('staff access follows the LIVE role, 2FA and the service lock', async () => {
    const owner = await mkUser();
    const repo = await mkRepo(owner);
    // Demoted: the row says USER, the seven-day token still says MOD.
    const demoted = await mkUser({ role: 'USER' });
    assert.notEqual((await dash(repo, await sessionCookie(demoted, { role: 'MOD' }))).statusCode, 200, 'a demoted moderator kept owner access to every repo');
    const noTotp = await mkUser({ role: 'MOD', totpEnabled: false });
    assert.notEqual((await dash(repo, await sessionCookie(noTotp))).statusCode, 200, 'a MOD without 2FA was the owner of every repo');
    const suspended = await mkUser({ role: 'MOD', totpEnabled: true, status: 'suspended' });
    assert.notEqual((await dash(repo, await sessionCookie(suspended))).statusCode, 200, 'a suspended MOD kept owner access to every repo');
  });

  test('a collaborator must have CONFIRMED the address the owner listed', async () => {
    const owner = await mkUser();
    const verified = await mkUser();
    const squatter = await mkUser({ emailVerified: false });
    const repo = await mkRepo(owner, { accessEmails: [verified.email.toLowerCase(), squatter.email.toLowerCase()] });
    const ok = await dash(repo, await sessionCookie(verified));
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().level, 'collab');
    assert.notEqual((await dash(repo, await sessionCookie(squatter))).statusCode, 200, 'an unconfirmed address was accepted as the collaborator');
  });

  test('the password cookie dies with the password', async () => {
    const owner = await mkUser();
    const repo = await mkRepo(owner, { dashPassword: await argon2.hash('first-password-1') });
    const u = await app.inject({ method: 'POST', url: `/repos/${repo.id}/dashboard/unlock`, payload: { password: 'first-password-1' } });
    assert.equal(u.statusCode, 200, u.body);
    const set = [].concat(u.headers['set-cookie'])[0];
    const rd = set.split(';')[0];
    const before = await dash(repo, rd);
    assert.equal(before.statusCode, 200, 'control: the unlock cookie opens the dashboard');
    assert.equal(before.json().level, 'password');
    // The owner changes it...
    await p.serverRepo.update({ where: { id: repo.id }, data: { dashPassword: await argon2.hash('second-password-2') } });
    assert.notEqual((await dash(repo, rd)).statusCode, 200, 'the old password cookie survived a password change');
    // ...or removes it.
    await p.serverRepo.update({ where: { id: repo.id }, data: { dashPassword: null } });
    assert.notEqual((await dash(repo, rd)).statusCode, 200, 'the password cookie survived the password being removed');
  });
});

describe('soft auth and the e-mail gate read the LIVE role', { skip }, () => {
  test('optionalAuth: a demoted moderator is a USER, not the role in the token', async () => {
    const lib = await import('../src/lib/lib.mjs');
    const Fastify = (await import('fastify')).default;
    const a = Fastify();
    await a.register((await import('@fastify/cookie')).default);
    a.get('/who', { preHandler: lib.optionalAuth() }, async (req) => ({ role: req.user?.role ?? null, perms: req.user?.perms ?? null }));
    await a.ready();
    try {
      const demoted = await mkUser({ role: 'USER' });
      const r = await a.inject({ method: 'GET', url: '/who', headers: { cookie: await sessionCookie(demoted, { role: 'MOD' }) } });
      assert.equal(r.json().role, 'USER', 'soft auth served the seven-day token role');
      assert.ok(Array.isArray(r.json().perms), 'soft auth carries the live permissions, like the strict guards');
      const pending = await a.inject({ method: 'GET', url: '/who', headers: { cookie: pendingCookie(demoted) } });
      assert.equal(pending.json().role, null, 'control: the half-token is logged-out here too');
    } finally { await a.close(); }
  });
});

describe('the session cookie is read in one place', () => {
  test('no route verifies bcw_session by itself', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'src');
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.mjs')) files.push(f); } };
    walk(root);
    // lib.mjs is the one reader. verify-gate and the per-account rate limiter only ever REFUSE
    // or COUNT on a verified uid, they never grant; both are allowed on that basis.
    const allowed = new Set(['lib/lib.mjs', 'lib/verify-gate.mjs', 'server.mjs']);
    const offenders = [];
    for (const f of files) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (allowed.has(rel)) continue;
      const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      // Any spelling of a verify call (`jwt.verify(`, `(await import(…)).default.verify(`) in a
      // file that names the cookie: the mutation that found the narrower pattern used the second.
      if (/bcw_session/.test(code) && /\bverify\(/.test(code)) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `these read the session cookie with jwt.verify instead of sessionUser(): ${offenders.join(', ')}`);
  });
});

describe('the telemetry gate asks the session the way the guards do', { skip }, () => {
  const gate = (cookie) => app.inject({ method: 'GET', url: '/telemetry/authorize', headers: cookie ? { cookie } : {} });

  test('control: a SUPERADMIN with a live session and 2FA passes', async () => {
    const sa = await mkUser({ role: 'SUPERADMIN', totpEnabled: true });
    assert.equal((await gate(await sessionCookie(sa))).statusCode, 204);
    assert.equal((await gate(null)).statusCode, 302);
  });

  test('the 2fa-pending half-token does not open telemetry', async () => {
    const sa = await mkUser({ role: 'SUPERADMIN', totpEnabled: true });
    assert.notEqual((await gate(pendingCookie(sa))).statusCode, 204, 'a SUPERADMIN password alone opened the telemetry dashboard');
  });

  test('a revoked session, a banned account and an account without 2FA are refused', async () => {
    const sa = await mkUser({ role: 'SUPERADMIN', totpEnabled: true });
    assert.notEqual((await gate(await sessionCookie(sa, { revoked: true }))).statusCode, 204, 'a signed-out device reopened telemetry');
    const banned = await mkUser({ role: 'ADMIN', totpEnabled: true, canViewTelemetry: true, status: 'banned' });
    assert.notEqual((await gate(await sessionCookie(banned))).statusCode, 204, 'a banned admin reached telemetry');
    const noTotp = await mkUser({ role: 'ADMIN', totpEnabled: false, canViewTelemetry: true });
    assert.notEqual((await gate(await sessionCookie(noTotp))).statusCode, 204, 'an admin without 2FA reached telemetry');
  });
});
