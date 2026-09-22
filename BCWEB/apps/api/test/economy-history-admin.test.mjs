// Three things the economy admin could not do: see the seasons that already ended, work
// through the purchases waiting to be delivered, and manage the point history.
//
// What each test pins:
//
//   Seasons   the state row keeps the last SEASON_HISTORY_MAX (24) resets and nothing older —
//             so `total` is "seasons still kept", never "seasons that ever ran". A season is
//             the span BETWEEN two resets: its start is the previous reset, and the oldest
//             entry we hold has no previous one, which is reported (`startEstimated`) rather
//             than guessed.
//
//   Purchases sorting and filtering happen in the DATABASE. The route used to take the 100
//             newest rows: past 100 purchases the oldest undelivered one — the person who has
//             been waiting longest — was not on the page, and no client-side sort brings back
//             a row the server never sent. `sort` is a key into a closed map, so a caller
//             cannot order by a column the page does not show.
//
//   History   a balance is UserEconomy.points, a column; the ledger is history. Clearing it,
//             by hand or by the sweeper's age/cap limits, must leave every balance exactly as
//             it was. That is asserted by reading the balances back after a full clear.
//
// Fixtures are tagged and removed; the bot.config and economy.seasonState rows are snapshotted
// and put back. The real ledger is never touched: every clear/sweep here is scoped to the
// fixture users, except the two sweeps, which run against a table this test has to own — so
// those are asserted on fixture rows and skipped when the dev database holds other ledger rows.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { lockRow, unlockRow } from './row-lock.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the economy admin tests';
process.env.JWT_SECRET ||= 'economy-history-test-secret';

const TAG = `ecohist-${Date.now()}-`;
const CONFIG_KEY = 'bot.config';
let p, app, admin, cookie, savedConfig, savedSeason, season, shop;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  season = await import('../src/lib/economy-season.mjs');
  shop = await import('../src/lib/economy-shop.mjs');
  p = await lib.db();
  // economy-season-db.test.mjs resets EVERY UserEconomy row and rewrites the same season
  // state singleton; the two files take turns (row-lock.mjs).
  await lockRow(p, 'economy.global');
  savedConfig = await p.adminSetting.findUnique({ where: { key: CONFIG_KEY } });
  savedSeason = await p.adminSetting.findUnique({ where: { key: season.SEASON_STATE_KEY } });
  // A staff fixture needs totpEnabled: every admin write goes through ensure2fa, and a
  // SUPERADMIN without it 403s on every call (which looks exactly like a broken cookie).
  admin = await p.user.create({ data: { email: `${TAG}admin@bettercommunity.invalid`, displayName: 'Eco Admin', role: 'SUPERADMIN', totpEnabled: true, emailVerified: true } });
  // A token with no `sid` is refused as a revoked session (lib.mjs tokenAcceptable), so the
  // fixture needs a real Session row like every other staff fixture here.
  const sess = await p.session.create({ data: { userId: admin.id }, select: { id: true } });
  cookie = `bcw_session=${jwt.sign({ uid: admin.id, role: admin.role, sid: sess.id }, process.env.JWT_SECRET)}`;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/economy-admin.mjs')).default);
  await app.register((await import('../src/routes/bot.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const users = await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await p.economyLedger.deleteMany({ where: { userId: { in: ids } } });
    await p.economyPurchase.deleteMany({ where: { userId: { in: ids } } });
    await p.userEconomy.deleteMany({ where: { userId: { in: ids } } });
  }
  await p.auditLogEntry.deleteMany({ where: { actorId: { in: ids.length ? ids : ['-'] } } });
  await p.session.deleteMany({ where: { userId: { in: ids.length ? ids : ['-'] } } });
  await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
  const put = async (key, saved) => {
    if (saved) await p.adminSetting.upsert({ where: { key }, create: saved, update: { value: saved.value } });
    else await p.adminSetting.deleteMany({ where: { key } });
  };
  await put(CONFIG_KEY, savedConfig);
  await put(season.SEASON_STATE_KEY, savedSeason);
  await unlockRow(p, 'economy.global');
  await app?.close();
  await p?.$disconnect?.();
});

const get = (url) => app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url, payload) => app.inject({ method: 'POST', url, headers: { cookie }, payload: payload || {} });
const put = (url, payload) => app.inject({ method: 'PUT', url, headers: { cookie }, payload });
const ok = (r) => { assert.equal(r.statusCode, 200, r.body); return r.json(); };

let uSeq = 0;
const member = async (name, points = 0) => {
  const u = await p.user.create({ data: { email: `${TAG}m${uSeq++}@bettercommunity.invalid`, displayName: name } });
  await p.userEconomy.create({ data: { userId: u.id, points, xp: 10 * (uSeq + 1), level: 2 } });
  return u;
};

describe('past seasons (db)', { skip }, () => {
  test('a page of history, with who ended each one and what it cost', async () => {
    const t = (d) => new Date(Date.UTC(2026, 0, d)).toISOString();
    await p.adminSetting.upsert({
      where: { key: season.SEASON_STATE_KEY },
      create: { key: season.SEASON_STATE_KEY, value: {} }, update: { value: {} },
    });
    await season.writeSeasonState(p, {
      since: t(1), lastResetAt: t(20), seasonNo: 4,
      history: [
        { at: t(20), by: admin.id, affected: 7, holders: 5, points: 500, resetXp: true, seasonNo: 3 },
        { at: t(10), by: 'schedule', affected: 3, holders: 2, points: 120, resetXp: false, seasonNo: 2 },
        { at: t(5), by: 'schedule', affected: 1, holders: 1, points: 10, resetXp: false, seasonNo: 1 },
      ],
    });

    const r = ok(await get('/admin/economy/seasons?take=2'));
    assert.equal(r.total, 3);
    assert.equal(r.cap, season.SEASON_HISTORY_MAX);
    assert.equal(r.currentSeasonNo, 4);
    assert.equal(r.seasons.length, 2, 'take is honoured');

    const [s3, s2] = r.seasons;
    assert.equal(s3.seasonNo, 3);
    assert.equal(s3.end, t(20));
    assert.equal(s3.start, t(10), 'a season starts at the PREVIOUS reset');
    assert.equal(s3.startEstimated, false);
    assert.equal(s3.endedByName, 'Eco Admin', 'a user id is resolved to a name');
    assert.equal(s3.scheduled, false);
    assert.equal(s3.affected, 7); assert.equal(s3.points, 500); assert.equal(s3.resetXp, true);
    assert.equal(s2.scheduled, true);
    assert.equal(s2.endedByName, null, 'nobody ended a scheduled reset');

    const page2 = ok(await get('/admin/economy/seasons?take=2&skip=2'));
    assert.equal(page2.seasons.length, 1);
    assert.equal(page2.seasons[0].seasonNo, 1);
    assert.equal(page2.seasons[0].start, t(1), 'the oldest entry starts when the clock did');
  });

  test('the history is capped, and the view says so instead of pretending', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ at: new Date(Date.UTC(2026, 0, 30 - i)).toISOString(), by: 'schedule', affected: 1, holders: 1, points: 1, seasonNo: 30 - i }));
    const view = season.seasonHistory({ since: null, history: many.slice(0, season.SEASON_HISTORY_MAX) });
    assert.equal(view.length, season.SEASON_HISTORY_MAX);
    assert.equal(view.at(-1).start, null);
    assert.equal(view.at(-1).startEstimated, true, 'an unknown start must not be printed as a date');
  });
});

describe('pending deliveries, sorted and filtered server-side (db)', { skip }, () => {
  let anna, zoe;
  before(async () => {
    if (!RUN) return;
    anna = await member('Anna Fixture');
    zoe = await member('Zoe Fixture');
    const buy = (u, name, kind, status, cost, daysAgo) => p.economyPurchase.create({
      data: { userId: u.id, itemId: `${TAG}${name}`, itemName: name, kind, cost, via: 'discord', status, createdAt: new Date(Date.now() - daysAgo * 864e5) },
    });
    await buy(anna, 'Old Role', 'role', 'pending', 50, 30);   // the longest wait
    await buy(zoe, 'New Role', 'role', 'pending', 10, 1);
    await buy(zoe, 'Handed over', 'custom', 'delivered', 5, 2);
  });

  test('filters by status, and the oldest waiting purchase is reachable', async () => {
    const r = ok(await get(`/admin/economy/purchases?status=pending&sort=oldest&q=${encodeURIComponent('Fixture')}`));
    assert.equal(r.sort, 'oldest');
    assert.equal(r.total, 2, 'only the pending fixtures');
    assert.equal(r.purchases[0].name, 'Old Role', 'oldest first — the person who has waited longest');
    assert.ok(r.purchases.every((x) => x.status === 'pending'));
    assert.ok(r.pending >= 2, 'the unfiltered pending badge');
  });

  test('filters by member, by item kind and by date; sorts by member and by item', async () => {
    const byMember = ok(await get(`/admin/economy/purchases?q=${zoe.id}`));
    assert.equal(byMember.total, 2);
    assert.ok(byMember.purchases.every((x) => x.userId === zoe.id));

    const byName = ok(await get('/admin/economy/purchases?q=Anna%20Fixture&sort=member'));
    assert.equal(byName.total, 1);
    assert.equal(byName.purchases[0].displayName, 'Anna Fixture');

    const byKind = ok(await get('/admin/economy/purchases?kind=custom&q=Fixture'));
    assert.equal(byKind.total, 1);
    assert.equal(byKind.purchases[0].kind, 'custom');

    const recent = ok(await get('/admin/economy/purchases?q=Fixture&from=' + new Date(Date.now() - 3 * 864e5).toISOString()));
    assert.equal(recent.total, 2, 'the 30-day-old one is outside the window');

    const byItem = ok(await get('/admin/economy/purchases?q=Fixture&sort=item'));
    assert.deepEqual(byItem.purchases.map((x) => x.name), ['Handed over', 'New Role', 'Old Role']);
  });

  test('paging is real, and an unknown sort falls back instead of reaching the orderBy', async () => {
    const one = ok(await get('/admin/economy/purchases?q=Fixture&take=1&skip=1&sort=oldest'));
    assert.equal(one.purchases.length, 1);
    assert.equal(one.total, 3, 'total counts the whole filter, not the page');

    const evil = ok(await get('/admin/economy/purchases?q=Fixture&sort=user.email'));
    assert.equal(evil.sort, 'status', 'a sort key is a key into a closed map, never a column name');
    assert.ok(evil.sorts.includes('member'));
  });
});

describe('point-history retention (db)', { skip }, () => {
  const ledger = (u, daysAgo, delta = 5) => p.economyLedger.create({
    data: { userId: u.id, kind: 'grant', delta, balance: 0, ref: `${TAG}ref`, createdAt: new Date(Date.now() - daysAgo * 864e5) },
  });
  const balances = async (ids) => Object.fromEntries((await p.userEconomy.findMany({ where: { userId: { in: ids } }, select: { userId: true, points: true, xp: true, level: true } })).map((e) => [e.userId, e]));

  test('clearing the history is audited and moves nobody’s points', async () => {
    const a = await member('Clear A', 137);
    const b = await member('Clear B', 42);
    for (let i = 0; i < 3; i++) await ledger(a, i);
    await ledger(b, 1);
    const before = await balances([a.id, b.id]);

    const r = ok(await post('/admin/economy/history/clear', { userId: a.id }));
    assert.equal(r.removed, 3);
    assert.equal(await p.economyLedger.count({ where: { userId: a.id } }), 0);
    assert.equal(await p.economyLedger.count({ where: { userId: b.id } }), 1, 'scoped to one member');

    const after = await balances([a.id, b.id]);
    assert.deepEqual(after, before, 'a balance is a column, not a sum of the ledger');
    const audit = await p.auditLogEntry.findFirst({ where: { actorId: admin.id, action: 'economy.history.clear' }, orderBy: { createdAt: 'desc' } });
    assert.ok(audit, 'an unaudited mass delete is the thing nobody can explain afterwards');
    assert.match(audit.detail, new RegExp(a.id));
  });

  test('olderThanDays keeps the recent tail', async () => {
    const u = await member('Tail', 9);
    await ledger(u, 0); await ledger(u, 40); await ledger(u, 100);
    const r = ok(await post('/admin/economy/history/clear', { userId: u.id, olderThanDays: 30 }));
    assert.equal(r.removed, 2);
    assert.equal(await p.economyLedger.count({ where: { userId: u.id } }), 1);
    assert.equal((await balances([u.id]))[u.id].points, 9);
  });

  test('the config round-trips through PUT /admin/economy/history/retention and is audited', async () => {
    const r = ok(await put('/admin/economy/history/retention', { historyDays: 45, historyMax: 1000 }));
    assert.equal(r.historyDays, 45);
    assert.equal(r.historyMax, 1000);
    const cfg = (await p.adminSetting.findUnique({ where: { key: CONFIG_KEY } }))?.value?.economy || {};
    assert.equal(cfg.historyDays, 45);
    assert.equal(cfg.historyMax, 1000, 'it must land in bot.config.economy, where the sweeper reads it');
    assert.equal((await put('/admin/economy/history/retention', { historyDays: -1 })).statusCode, 400);
    assert.ok(await p.auditLogEntry.findFirst({ where: { actorId: admin.id, action: 'economy.history.config' } }));
  });

  // The retention sweep is TABLE-WIDE by design (the thing being bounded is the table), so it
  // cannot be scoped to fixtures and must not be run for real against the user's dev database —
  // and a test that silently returns when the table is not empty is a test that measures the
  // environment. So the semantics are pinned against a stub holding exactly the rows in
  // question, and the wiring is proved separately against the real route.
  const stubLedger = (rows) => {
    const state = rows.map((r, i) => ({ id: `r${i}`, createdAt: r }));
    const match = (w, r) => {
      if (w.OR) return w.OR.some((c) => match(c, r));
      if (w.createdAt?.lt && !(r.createdAt < w.createdAt.lt)) return false;
      if (w.createdAt instanceof Date && r.createdAt.getTime() !== w.createdAt.getTime()) return false;
      if (w.id?.lt && !(r.id < w.id.lt)) return false;
      return true;
    };
    return {
      state,
      economyLedger: {
        async deleteMany({ where }) {
          const keep = state.filter((r) => !match(where, r));
          const n = state.length - keep.length;
          state.length = 0; state.push(...keep);
          return { count: n };
        },
        async findMany({ orderBy, skip = 0, take }) {
          const dir = orderBy[0].createdAt === 'desc' ? -1 : 1;
          const sorted = [...state].sort((a, b) => dir * (a.createdAt - b.createdAt) || dir * (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          return sorted.slice(skip, skip + take);
        },
      },
    };
  };
  const ago = (d) => new Date(Date.now() - d * 864e5);

  test('the age limit forgets rows past historyDays, and only those', async () => {
    const db0 = stubLedger([ago(0), ago(1), ago(2), ago(200), ago(400)]);
    const r = await shop.sweepEconomyHistory(db0, { historyDays: 90, historyMax: 0 });
    assert.deepEqual(r, { aged: 2, capped: 0, total: 2 });
    assert.equal(db0.state.length, 3);
  });

  test('the row cap keeps the newest N, whatever their age', async () => {
    const db0 = stubLedger([ago(0), ago(1), ago(2), ago(3)]);
    const r = await shop.sweepEconomyHistory(db0, { historyDays: 0, historyMax: 2 });
    assert.deepEqual(r, { aged: 0, capped: 2, total: 2 }, 'no age limit means no age deletions, not "delete everything"');
    assert.equal(db0.state.length, 2);
    assert.deepEqual(db0.state.map((x) => x.id), ['r0', 'r1'], 'the two newest rows, in the order they were seeded');
  });

  test('both limits at once, and 0 means no limit — never "keep nothing"', async () => {
    const both = stubLedger([ago(0), ago(1), ago(120), ago(300)]);
    assert.deepEqual(await shop.sweepEconomyHistory(both, { historyDays: 90, historyMax: 1 }), { aged: 2, capped: 1, total: 3 });
    assert.equal(both.state.length, 1);
    const off = stubLedger([ago(0), ago(5000)]);
    assert.deepEqual(await shop.sweepEconomyHistory(off, { historyDays: 0, historyMax: 0 }), { aged: 0, capped: 0, total: 0 });
    assert.equal(off.state.length, 2, '0 means no limit, everywhere in this config');
  });

  test('the admin sweep endpoint runs the configured retention, and moves nobody’s points', async () => {
    const u = await member('Sweep', 500);
    await ledger(u, 1);
    // Retention off: the call must be a real no-op on the user's ledger, not "delete nothing
    // because it failed". `historyDays: 0` is the configuration, not an absent one.
    ok(await put('/admin/economy/history/retention', { historyDays: 0, historyMax: 0 }));
    const before = (await balances([u.id]))[u.id];
    const r = ok(await post('/admin/economy/history/sweep'));
    assert.deepEqual({ aged: r.aged, capped: r.capped }, { aged: 0, capped: 0 });
    assert.equal(r.historyDays, 0, 'the endpoint reports the configuration it just applied');
    assert.equal(await p.economyLedger.count({ where: { userId: u.id } }), 1);
    assert.deepEqual((await balances([u.id]))[u.id], before, 'retention touches history, never points');
    assert.ok(await p.auditLogEntry.findFirst({ where: { actorId: admin.id, action: 'economy.history.sweep' } }));
  });
});
