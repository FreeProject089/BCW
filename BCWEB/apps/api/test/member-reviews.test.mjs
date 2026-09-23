// A member's review on the landing page (M11, Sept 23 2026).
//
// Reviews were admin-curated only. Members can now write one, and the rule that keeps the
// landing honest is that nobody reads a review a person has not looked at first:
//
//   · a submission is `pending` and hidden, whatever it says; the public feed returns only
//     `approved` rows, so `enabled: true` on a pending row (an admin's eye toggle) shows nothing;
//   · editing an approved review sends it back to pending and off the landing;
//   · one per account (Review.userId is unique): a second PUT edits, it does not add;
//   · no links (a review with a URL is an advert), and an account younger than a day is refused;
//   · approving shows it, rejecting hides it, in one PATCH.
//
// Real HTTP through the real handlers. Fixtures are tagged and removed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the member review tests';
process.env.JWT_SECRET ||= 'member-reviews-test-secret';

const TAG = `m11rev-${Date.now()}-`;
const DAY = 24 * 60 * 60 * 1000;
let p, app, member, fresh, admin, closer, cMember, cFresh, cAdmin, cCloser;

async function login(user) {
  const sess = await p.session.create({ data: { userId: user.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: user.id, role: user.role, sid: sess.id }, process.env.JWT_SECRET)}`;
}

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  member = await p.user.create({ data: { email: `${TAG}member@test.local`, displayName: 'Review Member', emailVerified: true, createdAt: new Date(Date.now() - 10 * DAY) } });
  fresh = await p.user.create({ data: { email: `${TAG}fresh@test.local`, displayName: 'Fresh Account', emailVerified: true } });
  admin = await p.user.create({ data: { email: `${TAG}admin@test.local`, displayName: 'Review Admin', role: 'SUPERADMIN', totpEnabled: true, emailVerified: true } });
  closer = await p.user.create({ data: { email: `${TAG}closer@test.local`, displayName: 'Leaving Member', emailVerified: true, createdAt: new Date(Date.now() - 10 * DAY) } });
  [cMember, cFresh, cAdmin, cCloser] = await Promise.all([login(member), login(fresh), login(admin), login(closer)]);
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    const ids = [member, fresh, admin, closer].filter(Boolean).map((u) => u.id);
    await p.review.deleteMany({ where: { userId: { in: ids } } });
    for (const m of ['notification', 'session']) await p[m]?.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await p.user.deleteMany({ where: { id: { in: ids } } });
  } finally { await app?.close(); await p?.$disconnect?.(); }
});

const put = (cookie, payload) => app.inject({ method: 'PUT', url: '/me/review', headers: { cookie }, payload });
const publicIds = async () => (await app.inject({ method: 'GET', url: '/reviews' })).json().reviews.map((r) => r.id);
const BODY = 'I moved three hundred mods between two drives in a minute and nothing broke.';

describe('a member review waits for a moderator', { skip }, () => {
  let id;

  test('signed out: refused', async () => {
    assert.equal((await app.inject({ method: 'PUT', url: '/me/review', payload: { body: BODY } })).statusCode, 401);
  });

  test('an account younger than a day is refused', async () => {
    const r = await put(cFresh, { body: BODY });
    assert.equal(r.statusCode, 403, r.body);
    assert.equal(r.json().error, 'account_too_new');
  });

  test('a link, in any common spelling, is refused', async () => {
    for (const body of [`${BODY} https://example.com`, `${BODY} www.example.com`, `${BODY} go to cheap-mods.xyz now`]) {
      const r = await put(cMember, { body });
      assert.equal(r.statusCode, 400, body);
      assert.equal(r.json().error, 'no_links');
    }
    assert.equal((await put(cMember, { body: BODY, role: 'see mysite.com' })).json().error, 'no_links', 'the role line too');
  });

  test('too short or too long is refused', async () => {
    assert.equal((await put(cMember, { body: 'great' })).statusCode, 400);
    assert.equal((await put(cMember, { body: 'x'.repeat(601) })).statusCode, 400);
  });

  test('a submission is pending, hidden, and signed with the display name', async () => {
    const r = await put(cMember, { body: BODY, rating: 5, lang: 'en' });
    assert.equal(r.statusCode, 200, r.body);
    id = r.json().review.id;
    assert.equal(r.json().review.status, 'pending');
    const row = await p.review.findUnique({ where: { id } });
    assert.equal(row.enabled, false);
    assert.equal(row.author, 'Review Member');
    assert.equal(row.userId, member.id);
    assert.ok(!(await publicIds()).includes(id), 'a pending review reached the landing');
  });

  test('an admin eye toggle alone does not publish a pending review', async () => {
    await p.review.update({ where: { id }, data: { enabled: true } });
    assert.ok(!(await publicIds()).includes(id));
  });

  test('a second PUT edits the same row: one review per account', async () => {
    const r = await put(cMember, { body: `${BODY} Edited.`, lang: 'en' });
    assert.equal(r.json().review.id, id);
    assert.equal(await p.review.count({ where: { userId: member.id } }), 1);
  });

  test('approving shows it; editing it afterwards takes it off again', async () => {
    const a = await app.inject({ method: 'PATCH', url: `/admin/reviews/${id}`, headers: { cookie: cAdmin }, payload: { status: 'approved' } });
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(a.json().review.enabled, true, 'approving did not show it');
    assert.ok((await publicIds()).includes(id));

    await put(cMember, { body: `${BODY} Edited after approval.` });
    assert.equal((await p.review.findUnique({ where: { id } })).status, 'pending');
    assert.ok(!(await publicIds()).includes(id), 'an unreviewed edit stayed on the landing');
  });

  test('rejecting hides it', async () => {
    await app.inject({ method: 'PATCH', url: `/admin/reviews/${id}`, headers: { cookie: cAdmin }, payload: { status: 'approved' } });
    const r = await app.inject({ method: 'PATCH', url: `/admin/reviews/${id}`, headers: { cookie: cAdmin }, payload: { status: 'rejected' } });
    assert.equal(r.json().review.enabled, false);
    assert.ok(!(await publicIds()).includes(id));
  });

  test('a member cannot moderate', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/admin/reviews/${id}`, headers: { cookie: cMember }, payload: { status: 'approved' } });
    assert.equal(r.statusCode, 403);
  });

  test('the member reads and deletes their own', async () => {
    const g = await app.inject({ method: 'GET', url: '/me/review', headers: { cookie: cMember } });
    assert.equal(g.json().review.id, id);
    assert.equal(typeof g.json().sectionOn, 'boolean');
    await app.inject({ method: 'DELETE', url: '/me/review', headers: { cookie: cMember } });
    assert.equal(await p.review.count({ where: { userId: member.id } }), 0);
  });
});

describe('closing an account takes its review off the home page', { skip }, () => {
  test('the review, which carries a copy of the display name, is deleted with the closure', async () => {
    const r = await put(cCloser, { body: BODY });
    assert.equal(r.statusCode, 200, r.body);
    const id = r.json().review.id;
    await app.inject({ method: 'PATCH', url: `/admin/reviews/${id}`, headers: { cookie: cAdmin }, payload: { status: 'approved' } });
    assert.ok((await publicIds()).includes(id));
    const { anonymiseAccount } = await import('../src/routes/closure.mjs');
    await anonymiseAccount(p, await p.user.findUnique({ where: { id: closer.id } }));
    assert.equal(await p.review.count({ where: { userId: closer.id } }), 0, 'an anonymised account still had its review');
    assert.ok(!(await publicIds()).includes(id), "the closed account's review stayed on the landing");
  });
});
