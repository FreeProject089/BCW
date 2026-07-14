// Integration tests for the pool-billing INVARIANT — `recomputePoolBytes`, the single
// source of truth that merge / split / consolidation / lapse / renewal all reduce to
// (audit P1). Needs a throwaway Postgres: set DATABASE_URL to it and `prisma db push`
// first. Without DATABASE_URL these are skipped (so `npm test` still runs the pure
// pricing tests on a machine with no DB). CI provisions a Postgres service for them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run pool-billing tests';

const GiB = 1024n ** 3n;
let p, recomputePoolBytes;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  ({ recomputePoolBytes } = await import('../src/routes/hosting.mjs'));
});
after(async () => { if (RUN) await p?.$disconnect?.(); });

// Fresh owner + plan + pool per test (unique email/slug so tests don't collide).
async function scaffold({ poolBytes = 0n } = {}) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await p.user.create({ data: { email: `t-${uid}@test.local`, displayName: 'Test' } });
  const plan = await p.hostingPlan.create({ data: { name: 'Test', storageGB: 5, uploadLimitKbps: 1000, priceMonthlyCents: 500 } });
  const group = await p.hostingGroup.create({ data: { ownerId: user.id, name: 'pool', poolBytes } });
  return { uid, user, plan, group };
}
const sub = (u, pl, g, bytes, status = 'active') =>
  p.subscription.create({ data: { user: { connect: { id: u.id } }, plan: { connect: { id: pl.id } }, hostingGroup: { connect: { id: g.id } }, poolContribBytes: bytes, status } });
const mkRepo = (u, g, data) => p.serverRepo.create({ data: { owner: { connect: { id: u.id } }, group: { connect: { id: g.id } }, name: 'r', hosted: true, ...data } });
const mkCat = (u, g, slug, data) => p.communityCatalog.create({ data: { owner: { connect: { id: u.id } }, group: { connect: { id: g.id } }, name: 'c', slug, ...data } });

test('poolBytes = sum of ACTIVE subs only (cancelled ones are ignored)', { skip }, async () => {
  const { user, plan, group } = await scaffold();
  await sub(user, plan, group, 5n * GiB);
  await sub(user, plan, group, 10n * GiB);
  await sub(user, plan, group, 99n * GiB, 'cancelled'); // must NOT count
  await recomputePoolBytes(p, group.id);
  const g = await p.hostingGroup.findUnique({ where: { id: group.id } });
  assert.equal(g.poolBytes, 15n * GiB);
});

test('all subs lapse → pool empties, repos SUSPENDED + catalogs HIDDEN with a 72h delete grace', { skip }, async () => {
  const { uid, user, plan, group } = await scaffold({ poolBytes: 5n * GiB });
  const s = await sub(user, plan, group, 5n * GiB);
  const repo = await mkRepo(user, group, { status: 'ONLINE' });
  const cat = await mkCat(user, group, `c-${uid}`, { status: 'ACTIVE', listed: true });
  await p.subscription.update({ where: { id: s.id }, data: { status: 'cancelled' } });
  await recomputePoolBytes(p, group.id);
  const g = await p.hostingGroup.findUnique({ where: { id: group.id } });
  const r = await p.serverRepo.findUnique({ where: { id: repo.id } });
  const c = await p.communityCatalog.findUnique({ where: { id: cat.id } });
  assert.equal(g.poolBytes, 0n);
  assert.equal(r.status, 'SUSPENDED');
  assert.ok(r.deleteAt instanceof Date, 'repo got a scheduled deletion');
  assert.equal(c.status, 'HIDDEN');
  assert.equal(c.listed, false);
});

test('renewal from empty → repos restored to ONLINE + catalogs back to ACTIVE, delete cancelled', { skip }, async () => {
  const { uid, user, plan, group } = await scaffold({ poolBytes: 0n });
  const s = await sub(user, plan, group, 5n * GiB, 'cancelled');
  const repo = await mkRepo(user, group, { status: 'SUSPENDED', deleteAt: new Date() });
  const cat = await mkCat(user, group, `c-${uid}`, { status: 'HIDDEN', listed: false });
  await p.subscription.update({ where: { id: s.id }, data: { status: 'active' } });
  await recomputePoolBytes(p, group.id);
  const r = await p.serverRepo.findUnique({ where: { id: repo.id } });
  const c = await p.communityCatalog.findUnique({ where: { id: cat.id } });
  assert.equal(r.status, 'ONLINE');
  assert.equal(r.deleteAt, null);
  assert.equal(c.status, 'ACTIVE');
});

test('INVARIANT: a PARTIAL lapse shrinks the pool but keeps content online (the merged-pool guarantee)', { skip }, async () => {
  const { user, plan, group } = await scaffold({ poolBytes: 15n * GiB });
  const a = await sub(user, plan, group, 5n * GiB);
  await sub(user, plan, group, 10n * GiB);
  const repo = await mkRepo(user, group, { status: 'ONLINE' });
  await p.subscription.update({ where: { id: a.id }, data: { status: 'cancelled' } }); // one of two lapses
  await recomputePoolBytes(p, group.id);
  const g = await p.hostingGroup.findUnique({ where: { id: group.id } });
  const r = await p.serverRepo.findUnique({ where: { id: repo.id } });
  assert.equal(g.poolBytes, 10n * GiB, 'pool shrinks to the still-active sub');
  assert.equal(r.status, 'ONLINE', 'content stays up because the pool is not empty');
});

test('no-op when the byte total is unchanged (idempotent recompute does not thrash content)', { skip }, async () => {
  const { user, plan, group } = await scaffold({ poolBytes: 5n * GiB });
  await sub(user, plan, group, 5n * GiB);
  const repo = await mkRepo(user, group, { status: 'ONLINE' });
  await recomputePoolBytes(p, group.id);       // total already equals poolBytes → early return
  const r = await p.serverRepo.findUnique({ where: { id: repo.id } });
  assert.equal(r.status, 'ONLINE');
  assert.equal(r.deleteAt, null);
});
