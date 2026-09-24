// Staff on somebody else's repo dashboard (SECURITY_SUMMARY §9, "Staff hold owner rights on
// every repo dashboard").
//
// Every MOD, ADMIN and SUPERADMIN reached every repo's dashboard as its OWNER: upload, delete,
// publish, settings, bans, the access list. Reading it is moderation; changing it is an
// administrator's act. Now a MOD reads (and may download the zip) and every write answers
// 403 `admin_only`; an ADMIN keeps the owner's hand.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the repo dashboard staff test';
process.env.JWT_SECRET ||= 'repo-dashboard-staff-secret';

const MAIL = '@repo-dashboard-staff.test';
let p, app, jwt, repo, owner, mod, admin;

async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  const mk = (role, n) => p.user.create({ data: { email: `${n}-${Date.now()}${MAIL}`, displayName: n, role, totpEnabled: role !== 'USER', emailVerified: true, status: 'active' } });
  owner = await mk('USER', 'owner'); mod = await mk('MOD', 'mod'); admin = await mk('ADMIN', 'admin');
  repo = await p.serverRepo.create({ data: { name: `rds repo ${Date.now()}`, ownerId: owner.id, hosted: false, status: 'OFFLINE', repoUrl: 'https://example.org/repo.json' } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/repo-dashboard.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  await p.serverRepo.deleteMany({ where: { id: repo?.id || '-' } });
  const ids = [owner, mod, admin].filter(Boolean).map((u) => u.id);
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.user.deleteMany({ where: { email: { endsWith: MAIL } } });
  await app?.close();
});

describe('a moderator reads a repo dashboard; an administrator may change it', { skip }, () => {
  test('MOD: the dashboard opens, flagged read-only', async () => {
    const r = await app.inject({ method: 'GET', url: `/repos/${repo.id}/dashboard`, headers: { cookie: await cookieFor(mod) } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().readOnly, true);
  });

  test('MOD: every write is refused before it runs', async () => {
    const cookie = await cookieFor(mod);
    const writes = [
      ['POST', `/repos/${repo.id}/dashboard/publish`],
      ['POST', `/repos/${repo.id}/dashboard/unpublish`],
      ['PUT', `/repos/${repo.id}/dashboard/settings`, {}],
      ['POST', `/repos/${repo.id}/dashboard/ban`, { value: '203.0.113.5', kind: 'ip' }],
      ['PUT', `/repos/${repo.id}/dashboard/access`, { emails: [] }],
      ['POST', `/repos/${repo.id}/dashboard/files/presign`, { path: 'x.zip', size: 1, contentType: 'application/zip' }],
      ['DELETE', `/repos/${repo.id}/dashboard/files/nope`],
    ];
    for (const [method, url, payload] of writes) {
      const r = await app.inject({ method, url, payload, headers: { cookie } });
      assert.equal(r.statusCode, 403, `${method} ${url.replace(repo.id, ':id')} answered ${r.statusCode}: ${r.body.slice(0, 120)}`);
      assert.equal(r.json().error, 'admin_only');
    }
    assert.equal((await p.serverRepo.findUnique({ where: { id: repo.id } })).status, 'OFFLINE');
  });

  test('ADMIN: the same write reaches the route (and is judged on its merits)', async () => {
    const cookie = await cookieFor(admin);
    const dash = await app.inject({ method: 'GET', url: `/repos/${repo.id}/dashboard`, headers: { cookie } });
    assert.equal(dash.json().readOnly, false);
    const r = await app.inject({ method: 'POST', url: `/repos/${repo.id}/dashboard/publish`, headers: { cookie } });
    // Not hosted here, so the route itself refuses — past the staff gate, which is the point.
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().error, 'not_hosted');
  });

  test('the owner is not staff and is never read-only', async () => {
    const r = await app.inject({ method: 'GET', url: `/repos/${repo.id}/dashboard`, headers: { cookie: await cookieFor(owner) } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().readOnly, false);
  });
});
