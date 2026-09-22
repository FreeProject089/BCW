// The Ko-fi funding goal's "raised X of Y", measured against a real Postgres.
//
// The bug this pins: GET /kofi/stats summed EVERY KofiDonation ever logged, in ANY currency,
// and labelled the result with the goal's currency. A goal set today in EUR therefore started
// at "raised 1 234 of 500 EUR" if the site had ever received dollar tips last year.
//
// The contract now: the goal counts tips received since the goal was set (or last reset), in
// the goal's currency only. Tips in another currency are NOT converted (there is no honest
// rate to use) and are reported apart, per currency, so a page can mention them.
//
// Fixtures use the ISO 4217 test currency XTS (and XXX, "no currency") so the user's real tips,
// whatever their currency, can never enter the sums asserted here. The real kofi.goal row is
// snapshotted and put back.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the Ko-fi goal tests';
process.env.JWT_SECRET ||= 'kofi-goal-test-secret';

const TAG = 'kofigoal-fixture-';
let p, app, cache, savedGoal;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  cache = await import('../src/lib/cache.mjs');
  p = await lib.db();
  savedGoal = await p.adminSetting.findUnique({ where: { key: 'kofi.goal' } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/kofi.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  await p.kofiDonation.deleteMany({ where: { messageId: { startsWith: TAG } } });
  if (savedGoal) await p.adminSetting.upsert({ where: { key: 'kofi.goal' }, create: savedGoal, update: { value: savedGoal.value } });
  else await p.adminSetting.deleteMany({ where: { key: 'kofi.goal' } });
  cache.invalidate('kofi.stats');
  await app?.close();
  await p?.$disconnect?.();
});

let seq = 0;
const tip = (amount, currency, createdAt) => p.kofiDonation.create({
  data: { messageId: `${TAG}${Date.now()}-${seq++}`, fromName: 'fixture', amount, currency, createdAt },
});
const setGoal = (value) => p.adminSetting.upsert({ where: { key: 'kofi.goal' }, create: { key: 'kofi.goal', value }, update: { value } });
const stats = async () => {
  cache.invalidate('kofi.stats');
  const r = await app.inject({ method: 'GET', url: '/kofi/stats' });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

describe('Ko-fi goal total (db)', { skip }, () => {
  test('counts only tips since the goal was set, in the goal currency', async () => {
    const DAY = 864e5;
    const since = new Date(Date.now() - 10 * DAY);
    await tip(100, 'XTS', new Date(since.getTime() - DAY));     // before the goal: out
    await tip(7.5, 'XTS', new Date(since.getTime() + DAY));     // in
    await tip(2.5, 'xts', new Date(since.getTime() + 2 * DAY)); // in (currency case is Ko-fi's, not ours)
    await tip(40, 'XXX', new Date(since.getTime() + DAY));      // other currency: reported apart
    await setGoal({ title: 'fixture goal', targetAmount: 50, currency: 'XTS', since: since.toISOString() });

    const s = await stats();
    assert.equal(s.currency, 'XTS');
    assert.equal(s.totalAmount, 10, 'raised = the two XTS tips after the goal was set, nothing else');
    assert.equal(s.tipCount, 2);
    assert.equal(s.since, since.toISOString());
    assert.deepEqual(s.otherCurrencies, [{ currency: 'XXX', amount: 40, count: 1 }]);
  });

  test('without a goal, nothing is summed across currencies', async () => {
    await p.adminSetting.deleteMany({ where: { key: 'kofi.goal' } });
    const s = await stats();
    assert.equal(s.goal, null);
    // Default currency USD: the XTS/XXX fixtures must not be in it.
    const usd = await p.kofiDonation.aggregate({ where: { currency: { equals: 'USD', mode: 'insensitive' } }, _sum: { amount: true } });
    assert.equal(s.totalAmount, usd._sum.amount || 0);
  });

  test('saving a goal stamps `since`; editing keeps it; a currency change or reset restarts it', async () => {
    const { nextGoalValue } = await import('../src/routes/kofi.mjs');
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-02-01T00:00:00.000Z');
    const created = nextGoalValue(null, { title: 'a', targetAmount: 10, currency: 'EUR' }, t0);
    assert.equal(created.since, t0.toISOString());
    const edited = nextGoalValue(created, { title: 'b', targetAmount: 20, currency: 'eur' }, t1);
    assert.equal(edited.since, t0.toISOString(), 'raising the target must not zero the bar');
    assert.equal(nextGoalValue(created, { title: 'b', targetAmount: 20, currency: 'USD' }, t1).since, t1.toISOString());
    assert.equal(nextGoalValue(created, { title: 'b', targetAmount: 20, currency: 'EUR', reset: true }, t1).since, t1.toISOString());
    assert.equal('reset' in nextGoalValue(created, { title: 'b', targetAmount: 20, currency: 'EUR', reset: true }, t1), false);
  });
});
