// Per-project reviews and release announcements (agent-prerelease, Sept 25 2026):
// routes/project-reviews.mjs, routes/release-announce.mjs, lib/review-rules.mjs.
//
// Reviews:
//   · OFF by default: no row, no reviews, a write is refused `reviews_off`;
//   · the switch is a RESERVED control: the project's manager (manage_projects / manage_showcase)
//     flips it, a plain page grantee cannot;
//   · the landing rules, shared: pending until approved, approve against the version read,
//     no links, a day-old account, public/private, anonymous;
//   · one per account PER PROJECT (a review of A and one of B are two rows), and the landing's
//     /reviews feed never shows a project review;
//   · the project's editors read every review of their project (private ones too), the name
//     hidden when anonymous; only a moderator (manage_announcements) decides;
//   · closing an account deletes its project reviews.
// Announcements:
//   · a manager announces once: a blog post in the project's blog, a notification to every
//     account through notifyAll (stubbed here: a real one writes to every account in the DB),
//     the release marked; a grantee cannot.
//
// BORN RED, checked 2026-09-26 by a mutation script, 4 of 4 red then green again (mutation made, test watched fail, reverted):
//   · reviewsOn() -> `return true`                            => "off by default" red
//   · settings route: canManageTarget -> canEditTarget        => "a page grantee cannot switch it on" red
//   · closure.mjs: removing the projectReview.deleteMany line => "closing an account" red
//   · announce: dropping the `already_announced` check         => "announces once" red
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the project review routes';
process.env.JWT_SECRET ||= 'project-reviews-test-secret';

const DAY = 24 * 3600_000;
const STAMP = Date.now().toString(36);
const TAG = `prrv-${STAMP}-`;
const KA = `rva${STAMP}`;
const KB = `rvb${STAMP}`;
let p, app, seq = 0;
const A = {};
const broadcasts = [];
const BODY = 'The early build fixed my load order problems in one evening, thank you.';

async function actor(name, data = {}, grants = []) {
  const u = await p.user.create({ data: {
    email: `${TAG}${name}-${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true,
    emailVerified: true, createdAt: new Date(Date.now() - 10 * DAY), ...data,
  } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  for (const g of grants) await p.projectPermission.create({ data: { userId: u.id, rights: ['pages'], grantedBy: u.id, ...g } });
  A[name] = { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}` };
}
async function call(name, method, url, payload) {
  const res = await app.inject({ method, url, headers: name ? { cookie: A[name].cookie } : {}, payload });
  let body = null; try { body = res.json(); } catch { /* not json */ }
  return { status: res.statusCode, body, raw: res.body };
}
const seenAt = async (id) => (await p.projectReview.findUnique({ where: { id } })).updatedAt.toISOString();

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  for (const k of [KA, KB]) {
    await p.project.create({ data: { key: k, name: `${TAG}${k}` } });
    await p.adminSetting.create({ data: { key: `project.${k}`, value: { name: `Proj ${k}` } } });
  }
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  await actor('ADMIN', { role: 'ADMIN' });
  await actor('manager', {}, []);
  await p.user.update({ where: { id: A.manager.user.id }, data: { permissions: ['manage_projects'] } });
  await actor('mod', { permissions: ['manage_announcements'] });
  await actor('editorA', {}, [{ projectKey: KA }]);
  await actor('USER');
  await actor('member');
  await actor('other');
  await actor('fresh', { createdAt: new Date() });
  await actor('leaver');
  await actor('muted', { notifPrefs: { releases: false } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.register((await import('../src/routes/project-reviews.mjs')).default);
  const ann = await import('../src/routes/release-announce.mjs');
  // A real broadcast writes to every account in the database, including the ones other suites
  // are creating and deleting in parallel. The stub records the call; notifyAll itself (the
  // mute, the retry) is covered by journeys.test.mjs.
  ann.setAnnounceBroadcaster(async (...args) => { broadcasts.push(args); return 42; });
  await app.register(ann.default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    const ids = (await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    const none = ids.length ? ids : ['-'];
    await p.projectReview.deleteMany({ where: { target: { in: [KA, KB] } } });
    await p.projectReviewSettings.deleteMany({ where: { target: { in: [KA, KB] } } });
    await p.projectRelease.deleteMany({ where: { target: { in: [KA, KB] } } });
    await p.blogPost.deleteMany({ where: { authorId: { in: none } } });
    await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
    await p.adminSetting.deleteMany({ where: { key: { in: [`project.${KA}`, `project.${KB}`] } } });
    await p.project.deleteMany({ where: { key: { in: [KA, KB] } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } }).catch(() => null);
    await p.notification.deleteMany({ where: { userId: { in: none } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: none } } });
    await p.user.deleteMany({ where: { id: { in: none } } });
    (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  } finally { await app?.close(); }
});

describe('project reviews: the switch', { skip }, () => {
  test('off by default: nothing shown, a write refused', async () => {
    const g = await call(null, 'GET', `/projects-reviews/${KA}`);
    assert.equal(g.status, 200);
    assert.equal(g.body.enabled, false);
    const w = await call('member', 'PUT', `/projects-reviews/${KA}/mine`, { body: BODY });
    assert.equal(w.status, 403); assert.equal(w.body.error, 'reviews_off');
  });

  test('a page grantee cannot switch it on; a member neither; the manager can', async () => {
    assert.equal((await call(null, 'PUT', `/projects-reviews/${KA}/settings`, { enabled: true })).status, 401);
    assert.equal((await call('USER', 'PUT', `/projects-reviews/${KA}/settings`, { enabled: true })).status, 403);
    assert.equal((await call('editorA', 'PUT', `/projects-reviews/${KA}/settings`, { enabled: true })).status, 403);
    assert.equal((await call('mod', 'PUT', `/projects-reviews/${KA}/settings`, { enabled: true })).status, 403, 'moderating is not managing the project');
    const ok = await call('manager', 'PUT', `/projects-reviews/${KA}/settings`, { enabled: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await call(null, 'GET', `/projects-reviews/${KA}`)).body.enabled, true);
    assert.equal((await call(null, 'GET', `/projects-reviews/${KB}`)).body.enabled, false, 'switching A switched B');
  });
});

describe('project reviews: the landing rules, scoped', { skip }, () => {
  let id;
  test('the shared refusals: links, too short, a day-old account', async () => {
    assert.equal((await call('member', 'PUT', `/projects-reviews/${KA}/mine`, { body: `${BODY} www.example.com` })).body.error, 'no_links');
    assert.equal((await call('member', 'PUT', `/projects-reviews/${KA}/mine`, { body: 'short' })).status, 400);
    assert.equal((await call('fresh', 'PUT', `/projects-reviews/${KA}/mine`, { body: BODY })).body.error, 'account_too_new');
    assert.equal((await call(null, 'PUT', `/projects-reviews/${KA}/mine`, { body: BODY })).status, 401);
  });

  test('a review is pending and hidden; one per account per project', async () => {
    const r = await call('member', 'PUT', `/projects-reviews/${KA}/mine`, { body: BODY, rating: 5 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    id = r.body.review.id;
    assert.equal(r.body.review.status, 'pending');
    assert.equal((await call(null, 'GET', `/projects-reviews/${KA}`)).body.reviews.length, 0);
    assert.equal((await call('member', 'PUT', `/projects-reviews/${KA}/mine`, { body: `${BODY} Edited.`, rating: 5 })).body.review.id, id, 'a second PUT added a row');
    // B, once on, takes its own review from the same account.
    await call('manager', 'PUT', `/projects-reviews/${KB}/settings`, { enabled: true });
    const b = await call('member', 'PUT', `/projects-reviews/${KB}/mine`, { body: BODY });
    assert.notEqual(b.body.review.id, id);
    assert.equal(await p.projectReview.count({ where: { userId: A.member.user.id } }), 2);
  });

  test('only a moderator decides, against the version read; the landing never shows it', async () => {
    assert.equal((await call('editorA', 'PATCH', `/admin/project-reviews/${id}`, { status: 'approved' })).status, 403, 'an editor approved a review of their own project');
    assert.equal((await call('USER', 'GET', '/admin/project-reviews')).status, 403);
    const stale = await call('mod', 'PATCH', `/admin/project-reviews/${id}`, { status: 'approved', seenUpdatedAt: new Date(0).toISOString() });
    assert.equal(stale.status, 409);
    const q = await call('mod', 'GET', '/admin/project-reviews?status=pending');
    assert.ok(q.body.reviews.some((x) => x.id === id && x.author === A.member.user.displayName));
    const ok = await call('mod', 'PATCH', `/admin/project-reviews/${id}`, { status: 'approved', seenUpdatedAt: await seenAt(id) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const pub = (await call(null, 'GET', `/projects-reviews/${KA}`)).body;
    assert.deepEqual(pub.reviews.map((x) => x.id), [id]);
    assert.equal(pub.count, 1); assert.equal(pub.average, 5);
    const landing = (await call(null, 'GET', '/reviews')).body.reviews || [];
    assert.ok(!landing.some((x) => x.id === id), 'a project review reached the landing');
    // Editing sends it back.
    await call('member', 'PUT', `/projects-reviews/${KA}/mine`, { body: `${BODY} Again.`, rating: 4 });
    assert.equal((await call(null, 'GET', `/projects-reviews/${KA}`)).body.reviews.length, 0);
  });

  test('private and anonymous: the team reads it, the public never does, the name stays hidden', async () => {
    const r = await call('other', 'PUT', `/projects-reviews/${KA}/mine`, { body: BODY, visibility: 'private', anonymous: true });
    const rid = r.body.review.id;
    await call('mod', 'PATCH', `/admin/project-reviews/${rid}`, { status: 'approved', seenUpdatedAt: await seenAt(rid) });
    assert.ok(!(await call(null, 'GET', `/projects-reviews/${KA}`)).body.reviews.some((x) => x.id === rid), 'a private review was published');
    const team = (await call('editorA', 'GET', `/projects-reviews/${KA}`)).body.team;
    const row = team.find((x) => x.id === rid);
    assert.ok(row, 'the project team cannot read a review of its project');
    assert.equal(row.author, ''); assert.ok(!JSON.stringify(row).includes(A.other.user.id));
    assert.equal((await call('USER', 'GET', `/projects-reviews/${KA}`)).body.team, undefined, 'a member read the team list');
  });

  test('closing an account deletes its project reviews', async () => {
    const r = await call('leaver', 'PUT', `/projects-reviews/${KA}/mine`, { body: BODY });
    assert.equal(r.status, 200);
    const { anonymiseAccount } = await import('../src/routes/closure.mjs');
    await anonymiseAccount(p, await p.user.findUnique({ where: { id: A.leaver.user.id } }), { removeObject: async () => {} });
    assert.equal(await p.projectReview.count({ where: { userId: A.leaver.user.id } }), 0);
  });
});

describe('release announcements', { skip }, () => {
  before(async () => {
    if (!RUN) return;
    await p.projectRelease.create({ data: { target: KA, version: '2.0.0', content: { en: { title: `Big one ${STAMP}`, highlights: ['Faster', 'Smaller'], notes: 'Notes.', breaking: [] }, fr: { title: 'Le gros', highlights: ['Plus rapide'], notes: '', breaking: [] } } } });
  });

  test('a page grantee cannot announce; a member neither', async () => {
    assert.equal((await call('editorA', 'POST', `/projects-releases/${KA}/2.0.0/announce`, { notify: true })).status, 403);
    assert.equal((await call('USER', 'POST', `/projects-releases/${KA}/2.0.0/announce`, { notify: true })).status, 403);
    assert.equal((await call(null, 'POST', `/projects-releases/${KA}/2.0.0/announce`, { notify: true })).status, 401);
  });

  test('the manager announces once: a blog post and one broadcast in the releases category', async () => {
    const r = await call('manager', 'POST', `/projects-releases/${KA}/2.0.0/announce`, { blog: true, notify: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const post = await p.blogPost.findUnique({ where: { slug: r.body.announcement.blogSlug } });
    assert.ok(post, 'no blog post');
    assert.equal(post.status, 'PUBLISHED');
    assert.match(post.body, /- Faster/);
    assert.ok(post.titleFr && post.bodyFr, 'the French notes were not used');
    const rel = await p.projectRelease.findUnique({ where: { target_version: { target: KA, version: '2.0.0' } } });
    assert.ok(rel.announcedAt);
    assert.equal(rel.links.blog, `/blog/${post.slug}`);
    assert.equal(broadcasts.length, 1, 'no broadcast');
    const [, kind, body, bodyFr, opts] = broadcasts[0];
    assert.equal(kind, 'release_published', 'the kind is what puts it in the mutable "Releases" category');
    assert.match(body, new RegExp(STAMP));
    assert.ok(bodyFr, 'no French body');
    assert.equal(opts.href, `/p/${KA}?tab=versions`);
    assert.equal(r.body.announcement.notified, 42);
    // The category really is mutable, and releases are in it.
    const { notifCategory, NOTIF_CATEGORIES } = await import('../src/lib/lib.mjs');
    assert.equal(notifCategory('release_published'), 'releases');
    assert.equal(notifCategory('prerelease_not_selected'), 'releases');
    assert.ok(!NOTIF_CATEGORIES.releases.locked);
    const again = await call('manager', 'POST', `/projects-releases/${KA}/2.0.0/announce`, { notify: true });
    assert.equal(again.status, 409); assert.equal(again.body.error, 'already_announced');
  });

  test('an unknown or unpublished release is not announced', async () => {
    assert.equal((await call('manager', 'POST', `/projects-releases/${KA}/9.9.9/announce`, { notify: true })).status, 404);
  });
});
