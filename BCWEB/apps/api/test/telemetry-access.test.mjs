// GET /telemetry/access (agent-bcw-os): the admin's OS mode asks it before drawing the BMM
// telemetry app. It must say yes to exactly the accounts POST /admin/telemetry/token mints a
// token for: a SUPERADMIN, or an ADMIN with the grant, both with 2FA and a live session.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the telemetry access tests';
process.env.JWT_SECRET ||= 'telemetry-access-secret';

let p, app, jwt;
const MAIL = '@tele-access.test';
let seq = 0;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/telemetry.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const ids = (await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })).map((u) => u.id);
  await p.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await p.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await app?.close();
});

const mkUser = (over = {}) => p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `ta-${seq}`, emailVerified: true, status: 'active', ...over } });
async function cookieOf(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const access = async (u) => app.inject({ method: 'GET', url: '/telemetry/access', headers: u ? { cookie: await cookieOf(u) } : {} });

describe('who the OS mode shows the telemetry app to', { skip }, () => {
  test('a SUPERADMIN and a granted ADMIN, with 2FA: yes', async () => {
    const sa = await mkUser({ role: 'SUPERADMIN', totpEnabled: true });
    const r = await access(sa);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { access: true });
    const granted = await mkUser({ role: 'ADMIN', totpEnabled: true, canViewTelemetry: true });
    assert.deepEqual((await access(granted)).json(), { access: true });
  });

  test('an ADMIN without the grant: no', async () => {
    const admin = await mkUser({ role: 'ADMIN', totpEnabled: true });
    const r = await access(admin);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { access: false });
  });

  test('a MOD, a member, an admin without 2FA and nobody are refused outright', async () => {
    const mod = await mkUser({ role: 'MOD', totpEnabled: true, canViewTelemetry: true });
    assert.notEqual((await access(mod)).statusCode, 200, 'the token route is ADMIN-only; the probe must not say more');
    const user = await mkUser({ role: 'USER' });
    assert.notEqual((await access(user)).statusCode, 200);
    const noTotp = await mkUser({ role: 'ADMIN', totpEnabled: false, canViewTelemetry: true });
    assert.notEqual((await access(noTotp)).statusCode, 200, 'staff doors ask for 2FA');
    assert.equal((await access(null)).statusCode, 401);
  });
});
