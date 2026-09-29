// notify (agent-notify): the notification engine (lib/notify.mjs).
//
// What is pinned here is what callers rely on without reading the code: the same dedupeKey
// sends once (sequentially, concurrently, and after a crash half-way), targeting reaches the
// right accounts and only them, a muted category is honoured unless the kind is locked, an
// expired notification disappears, and the read state works through the member's own routes.
//
// Never `audience: 'all'` here: a broadcast writes to EVERY account in the database, and other
// suites create and delete accounts beside this one. Wide audiences are checked with
// listRecipients, which resolves them without writing anything.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sharedBmmProject } from './helpers/shared-project.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run the notify tests';
process.env.JWT_SECRET ||= 'notify-test-secret';
process.env.SITE_URL = 'https://bettercommunity.example';

const MAIL = '@notify-engine.test';
const RUNID = Date.now().toString(36);
let p, app, jwt, N, U = {};

async function mkUser(name, data = {}) {
  return p.user.create({ data: { email: `${name}-${RUNID}${MAIL}`, displayName: `ntf ${name}`, emailVerified: true, status: 'active', ...data } });
}
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const rowsFor = (userId, sendId) => p.notification.findMany({ where: { userId, ...(sendId ? { sendId } : {}) } });

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  N = await import('../src/lib/notify.mjs');
  U.a = await mkUser('a');
  U.b = await mkUser('b', { notifPrefs: { broadcasts: false } });
  U.mod = await mkUser('mod', { role: 'MOD' });
  U.closed = await mkUser('closed', { closedAt: new Date() });
  U.c = await mkUser('c', { notifPrefs: { projects: false } });
  U.d = await mkUser('d');
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.register((await import('../src/routes/notify.mjs')).default);
  U.admin = await mkUser('admin', { role: 'ADMIN', totpEnabled: true });
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const ids = Object.values(U).map((u) => u.id);
  await p.notification.deleteMany({ where: { userId: { in: ids } } });
  await p.notificationSend.deleteMany({ where: { dedupeKey: { startsWith: `t-${RUNID}` } } });
  await p.notificationSend.deleteMany({ where: { createdById: 'notify-test' } });
  await p.projectFollow.deleteMany({ where: { userId: { in: ids } } });
  await p.blogPost.deleteMany({ where: { authorId: { in: ids } } });
  await p.auditLogEntry.deleteMany({ where: { actor: { email: { endsWith: MAIL } } } }).catch(() => {});
  await p.notificationSend.deleteMany({ where: { createdById: { in: ids } } });
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.user.deleteMany({ where: { email: { endsWith: MAIL } } });
  await app?.close();
});

describe('the message and its link', { skip }, () => {
  test('a link is an in-app path; our own absolute URL becomes its path; anything else is dropped', () => {
    assert.equal(N.notifLink('/blog/x'), '/blog/x');
    assert.equal(N.notifLink('https://bettercommunity.example/p/bmm?tab=versions'), '/p/bmm?tab=versions');
    assert.equal(N.notifLink('https://evil.example/p/bmm'), null);
    assert.equal(N.notifLink('//evil.example/x'), null);
    assert.equal(N.notifLink('javascript:alert(1)'), null);
    assert.equal(N.notifLink('/\\evil.example'), null);
  });

  test('title and body become the one line every reader shows', () => {
    assert.equal(N.composeBody('Maintenance', 'Tonight at 22:00.'), 'Maintenance: Tonight at 22:00.');
    assert.equal(N.composeBody('Done!', 'All good.'), 'Done! All good.');
    assert.equal(N.composeBody('Only a title', ''), 'Only a title');
  });

  test('bad input is refused with a reason, never thrown', async () => {
    assert.equal((await N.notify({ userIds: [U.a.id], kind: 'bad kind!', title: 'x' }, { p })).error, 'bad_kind');
    assert.equal((await N.notify({ userIds: [U.a.id], kind: 'announce' }, { p })).error, 'empty');
    assert.equal((await N.notify({ kind: 'announce', title: 'x' }, { p })).error, 'target_required');
    assert.equal((await N.notify({ userIds: [U.a.id], audience: 'all', kind: 'announce', title: 'x' }, { p })).error, 'target_required');
    assert.equal((await N.notify({ audience: 'role:KING', kind: 'announce', title: 'x' }, { p })).error, 'bad_audience');
    assert.equal((await N.notify({ audience: 'project:no-such-project-zz:followers', kind: 'announce', title: 'x' }, { p })).error, 'unknown_project');
    assert.equal((await N.notify({ userIds: [U.a.id], kind: 'announce', title: 'x', expiresAt: new Date(Date.now() - 1000) }, { p })).error, 'already_expired');
  });
});

describe('targeting', { skip }, () => {
  test('explicit ids: closed accounts skipped, a muted category honoured', async () => {
    const r = await N.notify({ userIds: [U.a.id, U.b.id, U.closed.id, U.a.id], kind: 'announce', title: 'Hello', dedupeKey: `t-${RUNID}-ids` }, { p });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.targeted, 2, 'a and b; the closed account is not an audience, the duplicate id counts once');
    assert.equal(r.muted, 1, 'b muted Site news & events');
    assert.equal(r.delivered, 1);
    assert.equal((await rowsFor(U.a.id, r.sendId)).length, 1);
    assert.equal((await rowsFor(U.b.id, r.sendId)).length, 0);
    assert.equal((await rowsFor(U.closed.id, r.sendId)).length, 0);
  });

  test('a locked kind reaches a member who muted everything mutable', async () => {
    const r = await N.notify({ userIds: [U.b.id], kind: 'admin_notice', title: 'Your account', dedupeKey: `t-${RUNID}-locked` }, { p });
    assert.equal(r.delivered, 1);
    assert.equal(r.muted, 0);
  });

  test('role:MOD and role:STAFF resolve to staff, never to a plain member', async () => {
    const mods = await N.listRecipients({ audience: 'role:MOD' }, { p });
    assert.ok(mods.ids.includes(U.mod.id));
    assert.ok(!mods.ids.includes(U.a.id));
    const staff = await N.listRecipients({ audience: 'role:staff' }, { p });
    assert.ok(staff.ids.includes(U.mod.id));
    assert.ok(!staff.ids.includes(U.a.id));
    const users = await N.listRecipients({ audience: 'role:USER' }, { p });
    assert.ok(users.ids.includes(U.a.id) && !users.ids.includes(U.mod.id) && !users.ids.includes(U.closed.id));
  });

  test('cap:<capability> reaches a MOD for its default capability, and a direct grant', async () => {
    const r = await N.listRecipients({ audience: 'cap:manage_users' }, { p });
    assert.ok(r.ids.includes(U.mod.id), 'MOD holds manage_users by default');
    assert.ok(!r.ids.includes(U.a.id));
    const granted = await mkUser('granted', { permissions: ['manage_reports'] });
    const r2 = await N.listRecipients({ audience: 'cap:manage_reports' }, { p });
    assert.ok(r2.ids.includes(granted.id));
    assert.ok(!r2.ids.includes(U.mod.id));
    U.granted = granted;
  });

  test('all: every open account, the closed one excluded', async () => {
    const r = await N.listRecipients({ audience: 'all' }, { p });
    assert.ok(r.ids.includes(U.a.id) && r.ids.includes(U.mod.id));
    assert.ok(!r.ids.includes(U.closed.id));
  });

  test("a project's followers, and only them; their own mute is honoured", async () => {
    for (const u of [U.a, U.b, U.c]) await p.projectFollow.create({ data: { userId: u.id, target: 'bmm' } });
    const r = await N.notify({ audience: 'project:bmm:followers', kind: 'project_post', title: 'New post', dedupeKey: `t-${RUNID}-proj` }, { p });
    assert.equal(r.ok, true, JSON.stringify(r));
    // At least: another suite (or a dev fixture) may follow 'bmm' too; the per-account rows below are exact.
    assert.ok(r.targeted >= 3, String(r.targeted));
    assert.ok(r.muted >= 1, 'c muted Projects you follow');
    assert.equal((await rowsFor(U.a.id, r.sendId)).length, 1);
    assert.equal((await rowsFor(U.b.id, r.sendId)).length, 1, 'b muted broadcasts, not projects');
    assert.equal((await rowsFor(U.c.id, r.sendId)).length, 0);
    assert.equal((await rowsFor(U.d.id, r.sendId)).length, 0, 'd does not follow');
  });
});

describe('idempotence on dedupeKey', { skip }, () => {
  test('the same key twice sends once', async () => {
    const key = `t-${RUNID}-twice`;
    const first = await N.notify({ userIds: [U.a.id, U.d.id], kind: 'announce', title: 'Once', dedupeKey: key }, { p });
    const second = await N.notify({ userIds: [U.a.id, U.d.id], kind: 'announce', title: 'Once', dedupeKey: key }, { p });
    assert.equal(first.deduped, false);
    assert.equal(second.deduped, true);
    assert.equal(second.sendId, first.sendId);
    assert.equal((await rowsFor(U.a.id, first.sendId)).length, 1);
    assert.equal(await p.notificationSend.count({ where: { dedupeKey: key } }), 1);
  });

  test('two concurrent calls with one key: each recipient gets exactly one row', async () => {
    const key = `t-${RUNID}-race`;
    const input = { userIds: [U.a.id, U.d.id, U.mod.id], kind: 'announce', title: 'Race', dedupeKey: key };
    const rs = await Promise.all([N.notify(input, { p }), N.notify(input, { p }), N.notify(input, { p })]);
    for (const r of rs) assert.equal(r.ok, true, JSON.stringify(r));
    const sendId = rs[0].sendId;
    for (const u of [U.a, U.d, U.mod]) assert.equal((await rowsFor(u.id, sendId)).length, 1, `${u.displayName} got it once`);
  });

  test('a send that crashed half-way is resumed, not repeated', async () => {
    const key = `t-${RUNID}-resume`;
    const send = await p.notificationSend.create({ data: { dedupeKey: key, kind: 'announce', title: 'Resume', audience: 'users:2', contentHash: 'x', status: 'pending' } });
    await p.notification.create({ data: { userId: U.a.id, kind: 'announce', body: 'Resume', sendId: send.id } });
    const r = await N.notify({ userIds: [U.a.id, U.d.id], kind: 'announce', title: 'Resume', dedupeKey: key }, { p });
    assert.equal(r.deduped, false);
    assert.equal(r.delivered, 2);
    assert.equal((await rowsFor(U.a.id, send.id)).length, 1, 'a is not sent it twice');
    assert.equal((await rowsFor(U.d.id, send.id)).length, 1);
    assert.equal((await p.notificationSend.findUnique({ where: { id: send.id } })).status, 'done');
  });
});

describe('expiry, priority and read state', { skip }, () => {
  test('priority and expiresAt land on the rows; an expired row is hidden, then swept', async () => {
    const until = new Date(Date.now() + 3600e3);
    const r = await N.notify({ userIds: [U.d.id], kind: 'announce', title: 'Soon gone', priority: 2, expiresAt: until, dedupeKey: `t-${RUNID}-exp` }, { p });
    const [row] = await rowsFor(U.d.id, r.sendId);
    assert.equal(row.priority, 2);
    assert.equal(new Date(row.expiresAt).getTime(), until.getTime());
    await p.notification.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const cookie = await cookieFor(U.d);
    const list = (await app.inject({ method: 'GET', url: '/me/notifications', headers: { cookie } })).json().notifications;
    assert.ok(!list.some((n) => n.id === row.id), 'an expired notification is not listed');
    await N.sweepNotifications(p, null);
    assert.equal(await p.notification.count({ where: { id: row.id } }), 0, 'the sweeper deleted it');
  });

  test('mark one read, then all read, through the member routes', async () => {
    const r = await N.notify({ userIds: [U.d.id], kind: 'announce', title: 'Read me', dedupeKey: `t-${RUNID}-read1` }, { p });
    await N.notify({ userIds: [U.d.id], kind: 'announce', title: 'Read me too', dedupeKey: `t-${RUNID}-read2` }, { p });
    const cookie = await cookieFor(U.d);
    const [one] = await rowsFor(U.d.id, r.sendId);
    assert.equal(one.readAt, null);
    assert.equal((await app.inject({ method: 'POST', url: `/me/notifications/${one.id}/read`, headers: { cookie } })).statusCode, 200);
    assert.notEqual((await p.notification.findUnique({ where: { id: one.id } })).readAt, null);
    assert.ok((await p.notification.count({ where: { userId: U.d.id, readAt: null } })) >= 1);
    assert.equal((await app.inject({ method: 'POST', url: '/me/notifications/read-all', headers: { cookie } })).statusCode, 200);
    assert.equal(await p.notification.count({ where: { userId: U.d.id, readAt: null } }), 0);
  });

  test("another member cannot mark my notification read", async () => {
    const r = await N.notify({ userIds: [U.a.id], kind: 'announce', title: 'Mine', dedupeKey: `t-${RUNID}-mine` }, { p });
    const [row] = await rowsFor(U.a.id, r.sendId);
    const cookie = await cookieFor(U.d);
    await app.inject({ method: 'POST', url: `/me/notifications/${row.id}/read`, headers: { cookie } });
    assert.equal((await p.notification.findUnique({ where: { id: row.id } })).readAt, null);
  });

  test('the preferences list shows the staff-only category to staff only', async () => {
    const member = (await app.inject({ method: 'GET', url: '/me/notification-prefs', headers: { cookie: await cookieFor(U.a) } })).json();
    assert.ok(member.categories.some((c) => c.key === 'projects'));
    assert.ok(!member.categories.some((c) => c.key === 'moderation'));
    const staff = (await app.inject({ method: 'GET', url: '/me/notification-prefs', headers: { cookie: await cookieFor(U.mod) } })).json();
    assert.ok(staff.categories.some((c) => c.key === 'moderation'));
  });
});

describe('a new blog post reaches its project followers', { skip }, () => {
  test('once per post, only when the setting is on', async () => {
    const saved = await p.adminSetting.findUnique({ where: { key: N.NOTIFY_CONFIG_KEY } });
    const project = await sharedBmmProject(p); // shared, never deleted: see the helper
    try {
      await p.adminSetting.upsert({ where: { key: N.NOTIFY_CONFIG_KEY }, create: { key: N.NOTIFY_CONFIG_KEY, value: { blogFollowers: true } }, update: { value: { blogFollowers: true } } });
      const post = await p.blogPost.create({ data: { projectId: project.id, authorId: U.mod.id, title: 'Big news', slug: `big-news-${RUNID}`, body: 'x', excerpt: 'All of it', status: 'PUBLISHED', publishedAt: new Date() } });
      const r1 = await N.notifyFollowersOfPost(p, post);
      assert.equal(r1.ok, true, JSON.stringify(r1));
      assert.equal(r1.deduped, false);
      const [row] = await rowsFor(U.a.id, r1.sendId);
      assert.equal(row.kind, 'project_post');
      assert.equal(row.href, `/blog/${post.slug}`);
      assert.match(row.body, /Big news/);
      const r2 = await N.notifyFollowersOfPost(p, post);
      assert.equal(r2.deduped, true, 'an edit of the post does not send it again');
      await p.adminSetting.update({ where: { key: N.NOTIFY_CONFIG_KEY }, data: { value: { blogFollowers: false } } });
      const post2 = await p.blogPost.create({ data: { projectId: project.id, authorId: U.mod.id, title: 'Quiet', slug: `quiet-${RUNID}`, body: 'x', status: 'PUBLISHED', publishedAt: new Date() } });
      assert.equal((await N.notifyFollowersOfPost(p, post2)).skipped, 'disabled');
      const draft = { ...post2, status: 'DRAFT' };
      assert.equal((await N.notifyFollowersOfPost(p, draft)).skipped, 'not_published');
      await p.notificationSend.deleteMany({ where: { dedupeKey: { in: [`blog-post:${post.id}`, `blog-post:${post2.id}`] } } });
    } finally {
      if (saved) await p.adminSetting.update({ where: { key: N.NOTIFY_CONFIG_KEY }, data: { value: saved.value } });
      else await p.adminSetting.deleteMany({ where: { key: N.NOTIFY_CONFIG_KEY } });
      await p.blogPost.deleteMany({ where: { slug: { in: [`big-news-${RUNID}`, `quiet-${RUNID}`] } } });
    }
  });
});

describe('the admin composer', { skip }, () => {
  const body = (o = {}) => ({ target: 'users', userIds: [U.a.id, U.b.id], kind: 'announce', title: `Composer ${RUNID}`, body: 'Hello', ...o });

  test('preview counts who is reached after mutes and writes nothing', async () => {
    const cookie = await cookieFor(U.admin);
    const before = await p.notification.count({ where: { userId: U.a.id } });
    const r = await app.inject({ method: 'POST', url: '/admin/notify/preview', headers: { cookie }, payload: body() });
    assert.equal(r.statusCode, 200, r.body);
    const pv = r.json();
    assert.equal(pv.targeted, 2);
    assert.equal(pv.muted, 1);
    assert.equal(pv.recipients, 1);
    assert.equal(pv.text.en, `Composer ${RUNID}: Hello`);
    assert.equal(pv.duplicate, null);
    assert.equal(await p.notification.count({ where: { userId: U.a.id } }), before);
  });

  test('send once per request id; the same content again asks first; force sends', async () => {
    const cookie = await cookieFor(U.admin);
    const send = (extra) => app.inject({ method: 'POST', url: '/admin/notify/send', headers: { cookie }, payload: { ...body(), ...extra } });
    const first = await send({ requestId: `req${RUNID}one` });
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().delivered, 1);
    const replay = await send({ requestId: `req${RUNID}one` });
    assert.equal(replay.statusCode, 200, 'a double click is the same send');
    assert.equal(replay.json().deduped, true);
    const dup = await send({ requestId: `req${RUNID}two` });
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.json().error, 'duplicate_content');
    const forced = await send({ requestId: `req${RUNID}two`, force: true });
    assert.equal(forced.statusCode, 201);
    assert.equal(await p.notification.count({ where: { userId: U.a.id, body: { startsWith: `Composer ${RUNID}` } } }), 2);
    const audit = await p.auditLogEntry.count({ where: { actorId: U.admin.id, action: 'notify.sent' } });
    assert.equal(audit, 2, 'each real send is in the audit chain, the replay is not');
  });

  test('refusals: public needs everyone, a notice needs named accounts, a link must be in-app', async () => {
    const cookie = await cookieFor(U.admin);
    const pv = async (o) => (await app.inject({ method: 'POST', url: '/admin/notify/preview', headers: { cookie }, payload: body(o) })).json().error;
    assert.equal(await pv({ public: true }), 'public_needs_all');
    assert.equal(await pv({ target: 'role', role: 'MOD', kind: 'admin_notice' }), 'notice_needs_users');
    assert.equal(await pv({ href: 'https://evil.example/' }), 'bad_link');
    assert.equal(await pv({ href: 'javascript:alert(1)' }), 'bad_link');
  });

  test('a member cannot reach the composer', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/notify/preview', headers: { cookie: await cookieFor(U.a) }, payload: body() });
    assert.equal(r.statusCode, 403);
  });
});
