// B3 — MYO auto-archive. A request that never pays the consultation fee (stuck at
// `pending_payment`, untouched for the window) is swept into the archive; a paid/live one,
// or a recently-touched unpaid one, is left alone. Needs a throwaway Postgres (DATABASE_URL),
// like the pool-billing suite; skipped without it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { track, cleanupFixtures } from './helpers/fixtures.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run MYO tests';

let p, sweepStaleMyoRequests;
const DAY = 864e5;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  ({ sweepStaleMyoRequests } = await import('../src/routes/myo.mjs'));
});
after(async () => { if (RUN) { await cleanupFixtures(p); await p?.$disconnect?.(); } });

async function owner() {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return track('user', await p.user.create({ data: { email: `t-${uid}@test.local`, displayName: 'T' } }));
}
const mkReq = (userId, over = {}) =>
  p.myoRequest.create({ data: { userId, name: 'Req', ...over } });
const isArchived = async (id) => !!(await p.myoRequest.findUnique({ where: { id }, select: { archivedAt: true } }))?.archivedAt;

test('archives an unpaid request untouched past the window', { skip }, async () => {
  const u = await owner();
  const stale = await mkReq(u.id, { status: 'pending_payment', consultationPaid: false, lastActivityAt: new Date(Date.now() - 30 * DAY) });
  const n = await sweepStaleMyoRequests(p);
  assert.ok(n >= 1);
  assert.equal(await isArchived(stale.id), true);
});

test('leaves a recently-touched unpaid request alone', { skip }, async () => {
  const u = await owner();
  const fresh = await mkReq(u.id, { status: 'pending_payment', consultationPaid: false, lastActivityAt: new Date(Date.now() - 2 * DAY) });
  await sweepStaleMyoRequests(p);
  assert.equal(await isArchived(fresh.id), false);
});

test('never archives a paid/live request, however old (mid-conversation protection)', { skip }, async () => {
  const u = await owner();
  const live = await mkReq(u.id, { status: 'open', consultationPaid: true, lastActivityAt: new Date(Date.now() - 90 * DAY) });
  const quoted = await mkReq(u.id, { status: 'quoted', consultationPaid: true, lastActivityAt: new Date(Date.now() - 90 * DAY) });
  await sweepStaleMyoRequests(p);
  assert.equal(await isArchived(live.id), false);
  assert.equal(await isArchived(quoted.id), false);
});

test('respects the disabled config', { skip }, async () => {
  const u = await owner();
  const stale = await mkReq(u.id, { status: 'pending_payment', consultationPaid: false, lastActivityAt: new Date(Date.now() - 30 * DAY) });
  await p.adminSetting.upsert({ where: { key: 'myo.autoArchive' }, create: { key: 'myo.autoArchive', value: { enabled: false } }, update: { value: { enabled: false } } });
  try {
    const n = await sweepStaleMyoRequests(p);
    assert.equal(n, 0);
    assert.equal(await isArchived(stale.id), false);
  } finally {
    await p.adminSetting.delete({ where: { key: 'myo.autoArchive' } }).catch(() => {});
  }
});
