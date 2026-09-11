// The season reset and the statistics against a real database, with namespaced fixtures.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the economy DB tests';
process.env.JWT_SECRET ||= 'season-test-secret';

let p, lib, app, eco;
const MAIL = '@season.test';

before(async () => {
  if (!RUN) return;
  lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  eco = await import('../src/lib/economy-season.mjs');
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/economy-admin.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await p.economyLedger.deleteMany({ where: { userId: { in: ids } } });
    await p.userEconomy.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close();
  await p?.$disconnect?.();
});

let seq = 0;
const mkMember = async (points, xp = 0) => {
  const u = await p.user.create({ data: { email: `s${Date.now()}-${seq++}${MAIL}`, displayName: 'season', emailVerified: true, status: 'active' } });
  await p.userEconomy.create({ data: { userId: u.id, points, xp, level: xp ? 3 : 0 } });
  return u;
};

describe('economy season + stats (db)', { skip }, () => {
  test('the admin routes refuse an anonymous caller', async () => {
    for (const [method, url] of [['GET', '/admin/economy/stats'], ['GET', '/admin/economy/season'], ['PUT', '/admin/economy/season'], ['POST', '/admin/economy/season/end']]) {
      const r = await app.inject({ method, url, payload: method === 'GET' ? undefined : { every: 'never' } });
      assert.equal(r.statusCode, 401, `${method} ${url}`);
    }
  });

  test('a season reset zeroes points, writes one ledger line per holder, keeps XP unless told', async () => {
    // The reset is global by design, and this is somebody's dev database: every other
    // member's balance is snapshotted first and put back at the end, ledger lines included.
    const snapshot = await p.userEconomy.findMany({ select: { userId: true, points: true, xp: true, level: true } });
    const startedAt = new Date();
    const a = await mkMember(120, 900);
    const b = await mkMember(0, 50);
    const c = await mkMember(7);
    const stateBefore = await eco.readSeasonState(p);
    const entry = await eco.runSeasonReset(p, { every: 'weekly', resetXp: false }, { by: 'test' });
    assert.ok(entry.affected >= 3);
    const rows = await p.userEconomy.findMany({ where: { userId: { in: [a.id, b.id, c.id] } } });
    for (const r of rows) assert.equal(r.points, 0);
    assert.equal(rows.find((r) => r.userId === a.id).xp, 900, 'XP kept');
    const led = await p.economyLedger.findMany({ where: { userId: { in: [a.id, b.id, c.id] }, kind: 'season' } });
    assert.equal(led.length, 2, 'only the two who held points get a line');
    assert.equal(led.find((l) => l.userId === a.id).delta, -120);
    const state = await eco.readSeasonState(p);
    assert.equal(state.seasonNo, stateBefore.seasonNo + 1);
    assert.equal(state.history[0].by, 'test');
    assert.ok(state.lastResetAt);
    // Put the clock back so the sweeper's schedule is not affected by a test.
    await eco.writeSeasonState(p, stateBefore);
    // and every other member back to what they had
    for (const r of snapshot) await p.userEconomy.updateMany({ where: { userId: r.userId }, data: { points: r.points, xp: r.xp, level: r.level } });
    await p.economyLedger.deleteMany({ where: { kind: 'season', createdAt: { gte: startedAt }, userId: { notIn: [a.id, b.id, c.id] } } });
    // and the ledger lines are what the statistics count as "lost" today
    const st = await eco.economyStats(p, { days: 14 });
    assert.ok(st.windows.today.lost >= 127, `lost today ≥ 127, got ${st.windows.today.lost}`);
    assert.equal(st.series.length, 14);
    assert.ok(st.totals.members >= 3);
  });
});
