// The bot's shared secret, after SECURITY_SUMMARY §9 #4.
//
// Three things one unscoped secret used to buy, each pinned here:
//
//   · WHO: the bot routes accepted BOT_SHARED_SECRET *or* LINK_LOOKUP_SECRET — the secret the
//     telemetry service's link lookup also holds, so a second service could speak as the bot.
//     Now BOT_SHARED_SECRET only.
//   · THE TOKEN: `GET /bot/token` handed the Discord token to whoever held that secret. The
//     route is gone; the bot reads DISCORD_TOKEN from its own environment.
//   · THE DRAW: `/bot/economy/casino` paid whatever `multiplier` the caller sent (0–10 000×),
//     so the secret minted points. The API draws now; a body carrying a multiplier is refused.
//
// The casino half needs Postgres (it moves points): fixtures are tagged and removed, and the
// bot.config singleton is snapshotted and put back under the lock the other economy files use.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lockRow, unlockRow } from './row-lock.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the bot secret test';
process.env.JWT_SECRET ||= 'bot-secret-test-jwt';
process.env.BOT_SHARED_SECRET = 'bot-secret-test-the-bot-one';
const BOT = process.env.BOT_SHARED_SECRET;

const TAG = 'botsecret-fixture-';
const D1 = `7${String(Date.now()).slice(-12)}11`;
const D2 = `7${String(Date.now()).slice(-12)}22`;
const START = 1_000_000;
let p, app, u1, u2, savedConfig;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  await lockRow(p, 'economy.global');
  savedConfig = await p.adminSetting.findUnique({ where: { key: 'bot.config' } });
  const cfg = { ...(savedConfig?.value || {}) };
  cfg.economy = { ...(cfg.economy || {}), casino: { enabled: true, minBet: 1, maxBet: 0, houseEdgePct: 0, edgeByGame: {} } };
  await p.adminSetting.upsert({ where: { key: 'bot.config' }, create: { key: 'bot.config', value: cfg }, update: { value: cfg } });
  u1 = await p.user.create({ data: { email: `${TAG}1@bettercommunity.invalid`, displayName: 'Casino One', emailVerified: true } });
  u2 = await p.user.create({ data: { email: `${TAG}2@bettercommunity.invalid`, displayName: 'Casino Two', emailVerified: true } });
  await p.discordLink.create({ data: { userId: u1.id, discordId: D1, username: `${TAG}d1` } });
  await p.discordLink.create({ data: { userId: u2.id, discordId: D2, username: `${TAG}d2` } });
  await p.userEconomy.create({ data: { userId: u1.id, points: START } });
  await p.userEconomy.create({ data: { userId: u2.id, points: START } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/bot.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  await p.discordLink.deleteMany({ where: { discordId: { in: [D1, D2] } } });
  // UserEconomy and EconomyLedger cascade with the user.
  await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
  if (savedConfig) await p.adminSetting.upsert({ where: { key: 'bot.config' }, create: savedConfig, update: { value: savedConfig.value } });
  else await p.adminSetting.deleteMany({ where: { key: 'bot.config' } });
  await unlockRow(p, 'economy.global');
  await app?.close();
  await p?.$disconnect?.();
});

const post = (url, payload, secret = BOT) => app.inject({ method: 'POST', url, headers: { 'x-bot-secret': secret }, payload });
const balance = async (u) => (await p.userEconomy.findUnique({ where: { userId: u.id } })).points;

describe('bot shared secret (§9 #4)', { skip }, () => {
  test('LINK_LOOKUP_SECRET is not a bot credential, even with BOT_SHARED_SECRET unset', async () => {
    const saved = process.env.BOT_SHARED_SECRET;
    const savedLink = process.env.LINK_LOOKUP_SECRET;
    try {
      delete process.env.BOT_SHARED_SECRET;
      process.env.LINK_LOOKUP_SECRET = 'bot-secret-test-link-only';
      const r = await app.inject({ method: 'GET', url: '/bot/config', headers: { 'x-bot-secret': 'bot-secret-test-link-only' } });
      assert.equal(r.statusCode, 401, 'the telemetry link secret must not open /bot/*');
    } finally {
      process.env.BOT_SHARED_SECRET = saved;
      if (savedLink === undefined) delete process.env.LINK_LOOKUP_SECRET; else process.env.LINK_LOOKUP_SECRET = savedLink;
    }
  });

  test('BOT_SHARED_SECRET opens the bot routes; the link secret beside it does not', async () => {
    const savedLink = process.env.LINK_LOOKUP_SECRET;
    try {
      process.env.LINK_LOOKUP_SECRET = 'bot-secret-test-link-only';
      assert.equal((await app.inject({ method: 'GET', url: '/bot/config', headers: { 'x-bot-secret': BOT } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: '/bot/config', headers: { 'x-bot-secret': 'bot-secret-test-link-only' } })).statusCode, 401);
    } finally {
      if (savedLink === undefined) delete process.env.LINK_LOOKUP_SECRET; else process.env.LINK_LOOKUP_SECRET = savedLink;
    }
  });

  test('GET /bot/token no longer exists: the secret does not buy the Discord token', async () => {
    const r = await app.inject({ method: 'GET', url: '/bot/token', headers: { 'x-bot-secret': BOT } });
    assert.equal(r.statusCode, 404);
    assert.ok(!/"token"/.test(r.body));
  });
});

describe('the casino draw is the API’s (§9 #4)', { skip }, () => {
  test('a single play that names its own multiplier is refused and moves nothing', async () => {
    const before = await balance(u1);
    const r = await post('/bot/economy/casino', { discordId: D1, bet: 100, multiplier: 10000, game: 'coinflip' });
    assert.equal(r.statusCode, 400);
    assert.equal(await balance(u1), before);
  });

  test('the API draws: outcomes vary, and each payout matches the outcome it reports', async () => {
    let heads = 0, tails = 0, running = await balance(u1);
    for (let k = 0; k < 60; k++) {
      const r = await post('/bot/economy/casino', { discordId: D1, bet: 10, game: 'coinflip' });
      assert.equal(r.statusCode, 200, r.body);
      const j = r.json();
      assert.equal(j.ok, true);
      assert.equal(typeof j.outcome.heads, 'boolean');
      assert.equal(j.multiplier, j.outcome.heads ? 2 : 0);
      assert.equal(j.delta, j.outcome.heads ? 10 : -10);   // edge 0 in the fixture config
      running += j.delta;
      assert.equal(j.points, running);
      if (j.outcome.heads) heads++; else tails++;
    }
    // 60 fair flips all on one side: 2^-59. A route that paid a fixed number would fail here.
    assert.ok(heads > 0 && tails > 0, `heads ${heads}, tails ${tails}`);
  });

  test('every solo game draws on the API and reports what it drew', async () => {
    const cases = [
      [{ game: 'dice' }, (o) => Number.isInteger(o.roll) && o.roll >= 1 && o.roll <= 6],
      [{ game: 'slots' }, (o) => Array.isArray(o.reels) && o.reels.length === 3],
      [{ game: 'roulette', betOn: 'number', num: 7 }, (o) => o.pocket >= 0 && o.pocket <= 36],
      [{ game: 'wheel', target: 5 }, (o) => [2, 3, 5, 10, 20, 50].includes(o.landed)],
      [{ game: 'plinko', risk: 'high' }, (o) => /^[LR]{10}$/.test(o.path)],
    ];
    for (const [opts, ok] of cases) {
      const r = await post('/bot/economy/casino', { discordId: D1, bet: 10, ...opts });
      assert.equal(r.statusCode, 200, `${opts.game}: ${r.body}`);
      assert.ok(ok(r.json().outcome), `${opts.game}: ${JSON.stringify(r.json().outcome)}`);
    }
    // A wheel target that is not a slice is refused rather than never winning.
    assert.equal((await post('/bot/economy/casino', { discordId: D1, bet: 10, game: 'wheel', target: 7 })).statusCode, 400);
  });

  test('a table seat that names its own multiplier is refused and settles nobody', async () => {
    const b1 = await balance(u1), b2 = await balance(u2);
    const r = await post('/bot/economy/casino/settle', { game: 'race', pot: true, plays: [{ discordId: D1, bet: 100, pick: 0, multiplier: 6 }, { discordId: D2, bet: 100, pick: 1 }] });
    assert.equal(r.statusCode, 400);
    assert.equal(await balance(u1), b1);
    assert.equal(await balance(u2), b2);
  });

  test('a live race is drawn by the API and settled zero-loss', async () => {
    const b1 = await balance(u1), b2 = await balance(u2);
    const r = await post('/bot/economy/casino/settle', { game: 'race', pot: true, plays: [{ discordId: D1, bet: 100, pick: 0 }, { discordId: D2, bet: 300, pick: 1 }] });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    assert.ok(j.outcome.winner >= 0 && j.outcome.winner <= 5);
    for (const x of j.results) {
      const pick = x.discordId === D1 ? 0 : 1;
      assert.equal(x.multiplier, pick === j.outcome.winner ? 6 : 0);
    }
    // The table rule: the house takes nothing, the two balances sum to what they did.
    assert.equal((await balance(u1)) + (await balance(u2)), b1 + b2);
  });

  test('a pot is drawn among the seats by the API; a pick it does not take is refused', async () => {
    const b1 = await balance(u1), b2 = await balance(u2);
    const r = await post('/bot/economy/casino/settle', { game: 'pot', pot: true, plays: [{ discordId: D1, bet: 50 }, { discordId: D2, bet: 50 }] });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    assert.ok([D1, D2].includes(j.outcome.winner));
    assert.equal((await balance(u1)) + (await balance(u2)), b1 + b2);
    assert.equal((await post('/bot/economy/casino/settle', { game: 'race', pot: true, plays: [{ discordId: D1, bet: 10, pick: 9 }] })).statusCode, 400);
  });
});
