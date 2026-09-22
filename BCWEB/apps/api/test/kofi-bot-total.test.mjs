// "Total raised" in the Discord bot's Ko-fi footer.
//
// The bug this pins: GET /bot/kofi/unannounced aggregated EVERY KofiDonation ever logged, in
// any currency, and the bot printed that sum labelled with the new tip's currency. The site's
// own goal bar had already been fixed to count tips since the goal's `since`, in the goal's
// currency (see kofi-goal-total.test.mjs) — so the bot and the website showed two different
// "totals" for the same campaign.
//
// The contract: the bot gets exactly `kofiGoalTotals`, the same function the website calls,
// including its `currency` (which the bot now prints instead of the tip's).
//
// Fixtures use the ISO 4217 test currencies XTS/XXX so the user's real tips can never enter
// the sums asserted here; the kofi.goal and bot.kofiAnnounced rows are snapshotted and put back.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lockRow, unlockRow } from './row-lock.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the bot Ko-fi total test';
process.env.JWT_SECRET ||= 'kofi-bot-total-secret';
process.env.BOT_SHARED_SECRET ||= 'kofi-bot-total-bot-secret';

const TAG = 'kofibot-fixture-';
let p, app, savedGoal, savedAnnounced;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  // kofi-goal-total.test.mjs stands up the same singleton row; one at a time (row-lock.mjs).
  await lockRow(p, 'kofi.goal');
  savedGoal = await p.adminSetting.findUnique({ where: { key: 'kofi.goal' } });
  savedAnnounced = await p.adminSetting.findUnique({ where: { key: 'bot.kofiAnnounced' } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/bot.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  await p.kofiDonation.deleteMany({ where: { messageId: { startsWith: TAG } } });
  const put = async (key, saved) => {
    if (saved) await p.adminSetting.upsert({ where: { key }, create: saved, update: { value: saved.value } });
    else await p.adminSetting.deleteMany({ where: { key } });
  };
  await put('kofi.goal', savedGoal);
  await put('bot.kofiAnnounced', savedAnnounced);
  await unlockRow(p, 'kofi.goal');
  await app?.close();
  await p?.$disconnect?.();
});

let seq = 0;
const tip = (amount, currency, createdAt) => p.kofiDonation.create({
  data: { messageId: `${TAG}${Date.now()}-${seq++}`, fromName: 'fixture', amount, currency, createdAt },
});
const unannounced = async () => {
  const r = await app.inject({ method: 'GET', url: '/bot/kofi/unannounced', headers: { 'x-bot-secret': process.env.BOT_SHARED_SECRET } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

describe('bot Ko-fi totals (db)', { skip }, () => {
  test('the footer total is the goal total: since the goal, in its currency, unconverted', async () => {
    const DAY = 864e5;
    const since = new Date(Date.now() - 10 * DAY);
    await tip(100, 'XTS', new Date(since.getTime() - DAY));     // before the goal: out
    await tip(7.5, 'XTS', new Date(since.getTime() + DAY));     // in
    await tip(2.5, 'xts', new Date(since.getTime() + 2 * DAY)); // in (Ko-fi's casing, not ours)
    await tip(40, 'XXX', new Date(since.getTime() + DAY));      // another currency: never converted
    await p.adminSetting.upsert({
      where: { key: 'kofi.goal' },
      create: { key: 'kofi.goal', value: { title: 'fixture', targetAmount: 50, currency: 'XTS', since: since.toISOString() } },
      update: { value: { title: 'fixture', targetAmount: 50, currency: 'XTS', since: since.toISOString() } },
    });
    // Seed the announced set so this call is not the first-ever one (which returns no tips).
    await p.adminSetting.upsert({ where: { key: 'bot.kofiAnnounced' }, create: { key: 'bot.kofiAnnounced', value: { ids: [] } }, update: { value: { ids: [] } } });

    const { totals } = await unannounced();
    assert.equal(totals.currency, 'XTS', 'the bot must be told which currency the number is in');
    assert.equal(totals.totalAmount, 10, 'not every tip ever, in every currency');
    assert.equal(totals.tipCount, 2);
    assert.equal(totals.since, since.toISOString());
    assert.deepEqual(totals.otherCurrencies, [{ currency: 'XXX', amount: 40, count: 1 }]);
  });

  test('it is literally the website function, and the bot prints its currency', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const route = fs.readFileSync(path.join(HERE, '../src/routes/bot.mjs'), 'utf8');
    assert.match(route, /import\s*\{\s*kofiGoalTotals\s*\}\s*from\s*'\.\/kofi\.mjs'/);
    const bot = fs.readFileSync(path.join(HERE, '../../bot/src/features/kofi.mjs'), 'utf8');
    assert.match(bot, /Total raised:[^`]*totals\.currency/, 'a total labelled with the tip currency is the old bug in the other half');
  });
});
