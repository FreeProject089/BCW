// M11 member reviews, pentest round 2 (Sept 24 2026), through the real routes.
//
//  · mass assignment: a member cannot publish by sending `status` / `enabled` (held already;
//    pinned so it stays held);
//  · approve-what-you-saw: "Approve" sent only `{ status }`, so it published whatever the body
//    was AT THAT MOMENT. A member who edits between the moderator reading the queue and
//    clicking Approve (the click is also deferred by the undo toast) got text published that
//    no moderator ever read. Approving a member's review now names the version that was read
//    (`seenUpdatedAt`), and a stale or missing one is refused with 409;
//  · a suspended or banned member's approved review leaves the landing while the account is
//    not active (closing the account already deleted it).
//
// Real Postgres (skipped without DATABASE_URL). Fixtures are tagged and removed; the
// `reviews.enabled` setting is not touched.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const JWT = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the review moderation tests';
const TAG = `pentestc-rev-${Date.now()}-`;
let p, app, member, admin, mCookie, aCookie;

const BODY1 = 'A calm, honest review of the site written for the test suite.';
const BODY2 = 'Swapped after the moderator read the queue: this text nobody approved.';

describe('member review moderation (db)', { skip }, () => {
  before(async () => {
    const lib = await import('../src/lib/lib.mjs');
    p = await lib.db();
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000); // past the one-day account age
    member = await p.user.create({ data: { email: `${TAG}m@bettercommunity.invalid`, displayName: `${TAG}member`, emailVerified: true, createdAt: old } });
    admin = await p.user.create({ data: { email: `${TAG}a@bettercommunity.invalid`, displayName: `${TAG}admin`, emailVerified: true, role: 'SUPERADMIN', totpEnabled: true, createdAt: old } });
    const ms = await p.session.create({ data: { userId: member.id }, select: { id: true } });
    const as = await p.session.create({ data: { userId: admin.id }, select: { id: true } });
    mCookie = `bcw_session=${jwt.sign({ uid: member.id, role: 'USER', sid: ms.id }, JWT)}`;
    aCookie = `bcw_session=${jwt.sign({ uid: admin.id, role: 'SUPERADMIN', sid: as.id }, JWT)}`;
    const Fastify = (await import('fastify')).default;
    app = Fastify();
    await app.register((await import('@fastify/cookie')).default);
    await app.register((await import('../src/routes/misc.mjs')).default);
    await app.ready();
  });
  after(async () => {
    await p.review.deleteMany({ where: { userId: { in: [member?.id || '-', admin?.id || '-'] } } });
    for (const t of ['notification', 'auditLogEntry']) await p[t].deleteMany({ where: t === 'notification' ? { userId: { in: [member?.id || '-', admin?.id || '-'] } } : { actorId: { in: [member?.id || '-', admin?.id || '-'] } } }).catch(() => {});
    await p.session.deleteMany({ where: { userId: { in: [member?.id || '-', admin?.id || '-'] } } });
    await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
    await app?.close();
    await p?.$disconnect?.();
  });

  const call = (method, url, cookie, payload) => app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });
  const onLanding = async () => (await call('GET', '/reviews')).json().reviews.some((r) => r.body === BODY1 || r.body === BODY2);
  const mine = async () => p.review.findUnique({ where: { userId: member.id } });

  test('a member cannot publish through extra fields', async () => {
    const r = await call('PUT', '/me/review', mCookie, { body: BODY1, rating: 5, status: 'approved', enabled: true, order: 0, author: 'Staff' });
    assert.equal(r.statusCode, 200, r.body);
    const row = await mine();
    assert.equal(row.status, 'pending');
    assert.equal(row.enabled, false);
    assert.equal(row.author, `${TAG}member`);
    assert.equal(await onLanding(), false);
  });

  test('approving publishes only the version the moderator read', async () => {
    const seen = (await call('GET', '/admin/reviews', aCookie)).json().reviews.find((r) => r.userId === member.id);
    assert.equal(seen.body, BODY1);
    // The member edits after the queue was read.
    assert.equal((await call('PUT', '/me/review', mCookie, { body: BODY2 })).statusCode, 200);

    let r = await call('PATCH', `/admin/reviews/${seen.id}`, aCookie, { status: 'approved', seenUpdatedAt: seen.updatedAt });
    assert.equal(r.statusCode, 409, `a stale approval published unread text: ${r.body}`);
    r = await call('PATCH', `/admin/reviews/${seen.id}`, aCookie, { status: 'approved' });
    assert.equal(r.statusCode, 409, 'an approval naming no version published unread text');
    assert.equal(await onLanding(), false);

    // Control: approving what is actually there works, and it reaches the landing.
    const fresh = (await call('GET', '/admin/reviews', aCookie)).json().reviews.find((x) => x.userId === member.id);
    r = await call('PATCH', `/admin/reviews/${seen.id}`, aCookie, { status: 'approved', seenUpdatedAt: fresh.updatedAt });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(await onLanding(), true);
  });

  test('a staff-written review still toggles and approves without a version (control)', async () => {
    const r = await call('POST', '/admin/reviews', aCookie, { author: `${TAG}staff`, body: 'Staff quote.' });
    assert.equal(r.statusCode, 200, r.body);
    const id = r.json().review.id;
    assert.equal((await call('PATCH', `/admin/reviews/${id}`, aCookie, { status: 'approved' })).statusCode, 200);
    await p.review.delete({ where: { id } });
  });

  test('a suspended member\'s review leaves the landing, and returns with the account', async () => {
    assert.equal(await onLanding(), true);
    await p.user.update({ where: { id: member.id }, data: { status: 'suspended' } });
    assert.equal(await onLanding(), false, 'a suspended account is still quoted on the landing');
    await p.user.update({ where: { id: member.id }, data: { status: 'active' } });
    assert.equal(await onLanding(), true);
  });
});
