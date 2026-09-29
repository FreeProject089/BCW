// hosting2 (agent-hosting): the term and loyalty routes, handlers and all, against Postgres.
//
// The capability matrix proves the doors with stubbed handlers; this runs the real handlers,
// so the Prisma queries they build (a relation select, a JSON-path filter on CatalogItem.meta,
// a three-row transaction) are checked by the database and not only by reading them. The
// JSON-path queries matter most: the route swallows a failure into an empty list, so a
// malformed filter would have looked like "no catalogue files" for ever.
//
// Writes only what it restores: the three term settings are saved to the values they already
// read as, and put back exactly as they were found (rows present or absent) at the end.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the hosting route checks';
process.env.JWT_SECRET ||= 'hosting2-routes-test-secret';

const TAG = `hs2-${Date.now().toString(36)}-`;
const TERM_KEYS = ['hosting.termMinMonths', 'hosting.termMaxMonths', 'hosting.termStepMonths'];
let p, app, admin, member, saved = [];
const cookie = (u) => `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: u.sid }, process.env.JWT_SECRET)}`;

async function mkUser(role) {
  const u = await p.user.create({ data: { email: `${TAG}${role}@bettercommunity.invalid`, displayName: `${TAG}${role}`, role, totpEnabled: true, emailVerified: true } });
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return { ...u, sid: s.id };
}

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  saved = await p.adminSetting.findMany({ where: { key: { in: TERM_KEYS } } });
  const Fastify = (await import('fastify')).default;
  app = Fastify({ logger: false });
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/hosting.mjs')).default);
  await app.ready();
  admin = await mkUser('SUPERADMIN');
  member = await mkUser('USER');
});

after(async () => {
  if (!RUN) return;
  try {
    // The settings exactly as found: rows that existed get their value back, rows that did
    // not are removed again.
    for (const k of TERM_KEYS) {
      const was = saved.find((r) => r.key === k);
      if (was) await p.adminSetting.update({ where: { key: k }, data: { value: was.value } });
      else await p.adminSetting.deleteMany({ where: { key: k } });
    }
    const ids = [admin?.id, member?.id].filter(Boolean);
    await p.subscription.deleteMany({ where: { userId: { in: ids } } });
    await p.hostingGroup.deleteMany({ where: { ownerId: { in: ids } } });
    await p.hostingPlan.deleteMany({ where: { name: { startsWith: TAG } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: ids } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await app?.close();
  }
});

describe('prepaid duration: PUT /admin/hosting/term', { skip }, () => {
  test('a member is refused', async () => {
    const r = await app.inject({ method: 'PUT', url: '/admin/hosting/term', headers: { cookie: cookie(member) }, payload: { min: 1, max: 12, step: 1 } });
    assert.equal(r.statusCode, 403);
  });
  test('above 12 months is refused, and nothing is written', async () => {
    const before = await p.adminSetting.findMany({ where: { key: { in: TERM_KEYS } } });
    const r = await app.inject({ method: 'PUT', url: '/admin/hosting/term', headers: { cookie: cookie(admin) }, payload: { min: 1, max: 24, step: 1 } });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'term_above_legal_cap');
    assert.deepEqual(await p.adminSetting.findMany({ where: { key: { in: TERM_KEYS } } }), before);
  });
  test('a minimum above the maximum is refused', async () => {
    const r = await app.inject({ method: 'PUT', url: '/admin/hosting/term', headers: { cookie: cookie(admin) }, payload: { min: 12, max: 6, step: 1 } });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'term_min_above_max');
  });
  test('the three bounds are written together and read back by the page', async () => {
    // The values every other suite already reads (the defaults), so a concurrent test file
    // sees no change while this one proves the write.
    const r = await app.inject({ method: 'PUT', url: '/admin/hosting/term', headers: { cookie: cookie(admin) }, payload: { min: 1, max: 12, step: 1 } });
    assert.equal(r.statusCode, 200, r.body);
    const rows = Object.fromEntries((await p.adminSetting.findMany({ where: { key: { in: TERM_KEYS } } })).map((x) => [x.key, x.value]));
    assert.deepEqual(rows, { 'hosting.termMinMonths': 1, 'hosting.termMaxMonths': 12, 'hosting.termStepMonths': 1 });
    const g = await app.inject({ method: 'GET', url: '/admin/hosting/term', headers: { cookie: cookie(admin) } });
    assert.deepEqual({ min: g.json().term.min, max: g.json().term.max, step: g.json().term.step, limit: g.json().limit }, { min: 1, max: 12, step: 1, limit: 12 });
  });
});

describe('GET /hosting/plans: everything the page prices with', { skip }, () => {
  test('bounds, the scarcity multiplier, the grace windows and the loyalty policy', async () => {
    const r = await app.inject({ method: 'GET', url: '/hosting/plans' });
    assert.equal(r.statusCode, 200);
    const b = r.json();
    assert.equal(b.term.limit, 12);
    assert.ok(b.priceMult >= 1);
    assert.ok(b.grace.lapseHours >= 72 && b.grace.unpaidHours >= 72);
    assert.ok(['repos', 'catalogs', 'both'].includes(b.loyalty.appliesTo));
    assert.equal(typeof b.loyalty.lapseResets, 'boolean');
  });
});

describe('GET /me/hosting/loyalty', { skip }, () => {
  test('signed out: refused', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/me/hosting/loyalty' })).statusCode, 401);
  });
  test('lists my pool with its status; the admin grant plan and free pools are left out', async () => {
    const plan = await p.hostingPlan.create({ data: { name: `${TAG}plan`, storageGB: 5, uploadLimitKbps: 8192, cpuShare: 0.5, priceMonthlyCents: 500, active: false } });
    const g = await p.hostingGroup.create({ data: { ownerId: member.id, name: `${TAG}pool`, poolBytes: 5n * 1024n ** 3n, uploadLimitKbps: 8192, cpuShare: 0.5 } });
    const free = await p.hostingGroup.create({ data: { ownerId: member.id, name: `${TAG}free`, poolBytes: 1024n ** 3n, uploadLimitKbps: 2048, cpuShare: 0.5, freePlan: true } });
    await p.subscription.create({ data: { userId: member.id, hostingGroupId: g.id, planId: plan.id, status: 'active', stripeSubId: `${TAG}sub`, poolContribBytes: 5n * 1024n ** 3n, currentPeriodEnd: new Date(Date.now() + 20 * 864e5) } });
    await p.subscription.create({ data: { userId: member.id, hostingGroupId: free.id, planId: plan.id, status: 'active', poolContribBytes: 1024n ** 3n, currentPeriodEnd: new Date(Date.now() + 20 * 864e5) } });
    const r = await app.inject({ method: 'GET', url: '/me/hosting/loyalty', headers: { cookie: cookie(member) } });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.equal(b.items.length, 1);
    assert.equal(b.items[0].kind, 'pool');
    assert.equal(b.items[0].name, `${TAG}pool`);
    assert.equal(b.items[0].autoRenew, true);
    assert.equal(typeof b.items[0].tenureMonths, 'number');
    assert.ok('nextTier' in b.items[0] && 'covered' in b.items[0]);
  });
  test('the JSON-path filters the route and the sweep use are valid Postgres queries', async () => {
    // Without the route's catch: a malformed filter must fail HERE, not read as "none".
    await p.catalogItem.findMany({ where: { ownerId: member.id, meta: { path: ['_hostingSubId'], string_starts_with: 'sub' } }, select: { id: true } });
    await p.catalogItem.findMany({ where: { meta: { path: ['_loyaltyPct'], gt: 0 } }, select: { id: true }, take: 1 });
    await p.catalogItem.findFirst({ where: { meta: { path: ['_hostingSubId'], equals: `${TAG}none` } } });
  });
});
