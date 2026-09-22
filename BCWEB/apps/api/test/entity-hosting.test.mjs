// Hosting settings per blog (and per contact inbox): its own caps, none, or storage
// reserved from a pool, and the pool counting that reservation like a repo's quota.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the per-entity hosting tests';
process.env.JWT_SECRET ||= 'entity-hosting-secret';

let p, app, jwt, EH, blog, lib;
const MAIL = '@eh.test';
const stamp = `${Date.now()}`;
let show, owner, pool;

before(async () => {
  EH = await import('../src/lib/entity-hosting.mjs');
  if (!RUN) return;
  lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  blog = await import('../src/routes/blog.mjs');
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/entity-hosting.mjs')).default);
  await app.ready();
  owner = await p.user.create({ data: { email: `o${stamp}${MAIL}`, displayName: `eh-${stamp}`, emailVerified: true, status: 'active' } });
  show = await p.showcaseProject.create({ data: { slug: `eh-${stamp}`, name: 'EH blog', short: 'EH' } });
  for (let i = 0; i < 2; i += 1) await p.blogPost.create({ data: { authorId: owner.id, title: `eh ${i}`, slug: `eh-${stamp}-${i}`, body: 'x'.repeat(600), showcaseProjectId: show.id } });
  pool = await p.hostingGroup.create({ data: { ownerId: owner.id, name: `eh pool ${stamp}`, poolBytes: 10n * 1024n * 1024n } });
});

after(async () => {
  if (!RUN) return;
  await p.entityHostingSettings.deleteMany({ where: { ref: { in: [`sc:${show?.slug}`] } } });
  await p.blogPost.deleteMany({ where: { slug: { startsWith: `eh-${stamp}` } } });
  if (show) await p.showcaseProject.delete({ where: { id: show.id } }).catch(() => {});
  if (pool) await p.hostingGroup.delete({ where: { id: pool.id } }).catch(() => {});
  const ids = (await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })).map((u) => u.id);
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.auditLogEntry?.deleteMany?.({ where: { actorId: { in: ids } } }).catch(() => {});
  await p.user.deleteMany({ where: { id: { in: ids } } });
  await app?.close();
});

describe('the rule', () => {
  test('each mode says what it means, and inherit is the site-wide numbers', () => {
    const site = { maxItems: 50, maxBytes: 1024 };
    assert.deepEqual(EH.limitsFor({ mode: 'inherit' }, site), { ...site, source: 'inherit' });
    assert.deepEqual(EH.limitsFor({ mode: 'unlimited' }, site), { maxItems: 0, maxBytes: null, source: 'unlimited' });
    assert.deepEqual(EH.limitsFor({ mode: 'custom', maxItems: 3, maxKB: 0 }, site), { maxItems: 3, maxBytes: null, source: 'custom' });
    // "0 limit + a pool": nothing of its own, the reservation is the whole allowance.
    assert.equal(EH.limitsFor({ mode: 'pool', poolId: 'g', quotaBytes: 2048n }).maxBytes, 2048);
    assert.equal(EH.limitsFor({ mode: 'pool', poolId: null, quotaBytes: 0n }).maxBytes, 0);
  });
  test('attachments: off, always, or only once a pool pays', () => {
    const site = { attachments: 'pool_only', maxAttachmentMB: 10 };
    assert.equal(EH.attachmentPolicy({ attachments: 'inherit', mode: 'inherit' }, site).why, 'attachments_need_pool');
    assert.equal(EH.attachmentPolicy({ attachments: 'inherit', mode: 'pool', poolId: 'g', quotaBytes: 1n }, site).allowed, true);
    assert.equal(EH.attachmentPolicy({ attachments: 'always', mode: 'inherit' }, site).allowed, true);
    assert.equal(EH.attachmentPolicy({ attachments: 'off', mode: 'pool', poolId: 'g', quotaBytes: 1n }, site).why, 'attachments_off');
    assert.equal(EH.attachmentPolicy({ attachments: 'always', maxAttachmentMB: 3, mode: 'inherit' }, site).maxBytes, 3 * 1024 * 1024);
  });
});

describe('per-blog limits against the database', { skip }, () => {
  const scope = () => ({ projectId: null, showcaseProjectId: show.id, showcaseConfig: {} });
  test('custom: this blog has its own count cap, whatever the site says', async () => {
    await EH.saveHosting(p, 'blog', `sc:${show.slug}`, { mode: 'custom', maxItems: 2, maxKB: 0 });
    const r = await blog.checkBlogLimitsForTest(p, scope(), 100);
    assert.equal(r?.error, 'blog_limit'); assert.equal(r.scope, 'blog'); assert.equal(r.kind, 'count');
    // An edit never trips the count cap.
    assert.equal(await blog.checkBlogLimitsForTest(p, scope(), 100, 'some-post-id'), null);
  });
  test('unlimited: no cap even where the old per-page config had one', async () => {
    await EH.saveHosting(p, 'blog', `sc:${show.slug}`, { mode: 'unlimited' });
    assert.equal(await blog.checkBlogLimitsForTest(p, { ...scope(), showcaseConfig: { blogMaxPosts: 1 } }, 100), null);
  });
  test('pool: the reservation is the size cap, it must fit the pool, and the pool counts it', async () => {
    const before = await lib.poolFreeBytes(p, await p.hostingGroup.findUnique({ where: { id: pool.id } }));
    assert.equal((await EH.saveHosting(p, 'blog', `sc:${show.slug}`, { mode: 'pool', poolId: pool.id, quotaMB: 11 })).error, 'pool_exceeded');
    assert.equal((await EH.saveHosting(p, 'blog', `sc:${show.slug}`, { mode: 'pool', poolId: null })).error, 'pool_required');
    const ok = await EH.saveHosting(p, 'blog', `sc:${show.slug}`, { mode: 'pool', poolId: pool.id, quotaMB: 1 });
    assert.ok(ok.row, ok.error);
    const after = await lib.poolFreeBytes(p, await p.hostingGroup.findUnique({ where: { id: pool.id } }));
    assert.equal(before - after, 1024n * 1024n, 'the pool lost exactly the reservation');
    // 1200 bytes stored, 1 MB reserved: a 1 MB post does not fit, a small one does.
    const big = await blog.checkBlogLimitsForTest(p, scope(), 1024 * 1024);
    assert.equal(big?.scope, 'pool'); assert.equal(big.kind, 'size');
    assert.equal(await blog.checkBlogLimitsForTest(p, scope(), 1000), null);
  });
  test('the admin screen needs manage_hosting', async () => {
    const s = await p.session.create({ data: { userId: owner.id }, select: { id: true } });
    const cookie = `bcw_session=${jwt.sign({ uid: owner.id, role: owner.role, sid: s.id }, process.env.JWT_SECRET)}`;
    const r = await app.inject({ method: 'PUT', url: `/admin/hosting/entities/blog/sc:${show.slug}`, headers: { cookie }, payload: { mode: 'unlimited' } });
    assert.equal(r.statusCode, 403);
    const admin = await p.user.create({ data: { email: `a${stamp}${MAIL}`, displayName: `eh-a-${stamp}`, role: 'SUPERADMIN', totpEnabled: true, emailVerified: true, status: 'active' } });
    const sa = await p.session.create({ data: { userId: admin.id }, select: { id: true } });
    const ca = `bcw_session=${jwt.sign({ uid: admin.id, role: admin.role, sid: sa.id }, process.env.JWT_SECRET)}`;
    const list = await app.inject({ method: 'GET', url: '/admin/hosting/entities?kind=blog', headers: { cookie: ca } });
    assert.equal(list.statusCode, 200, list.body);
    const mine = list.json().items.find((x) => x.ref === `sc:${show.slug}`);
    assert.equal(mine.settings.mode, 'pool'); assert.equal(mine.usage.count, 2);
    const put = await app.inject({ method: 'PUT', url: `/admin/hosting/entities/blog/sc:${show.slug}`, headers: { cookie: ca }, payload: { mode: 'custom', maxItems: 5, maxKB: 0 } });
    assert.equal(put.statusCode, 200, put.body);
    assert.equal(put.json().settings.poolId, null, 'leaving pool mode releases the reservation');
  });
});
