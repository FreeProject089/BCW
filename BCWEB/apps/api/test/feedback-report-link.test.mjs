// One submission, two screens: a Feedback row (Retours & plantages) and the Report thread it
// opened for a linked sender (Signalements, and the sender's "Messages & reports").
//
// The owner deleted a report in the feedback centre and it stayed in Signalements and in the
// user's dashboard. The Feedback row went; the Report row with targetType 'feedback' that
// represents the same submission elsewhere was never touched. This suite pins both
// directions against a real database, through the real routes:
//
//   · delete from Retours & plantages → the thread, its messages and the notifications that
//     point at it are gone from every list;
//   · delete from Signalements → the feedback row goes too, instead of a feedback item whose
//     "open in Reports" link and reply box point at a thread that no longer exists;
//   · the reports lifecycle sweeper, which is not a person deciding anything, DETACHES the
//     feedback instead of deleting it — the crash grouping keeps its data.
//
// And the "mark as seen" contract: seeing a thread clears its unread flag AND the
// notifications about it, and the unseen counters behind the topbar badges agree.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run the feedback/report link tests';
process.env.JWT_SECRET ||= 'fb-link-test-secret';

const MAIL = '@fblink.test';
const PROJECT = 'fblinktest';
let p, app, jwt;
let admin, member, adminCookie, memberCookie;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/feedback.mjs')).default);
  await app.register((await import('../src/routes/reports.mjs')).default);
  await app.ready();
  const stamp = Date.now();
  // A staff fixture needs totpEnabled: every admin route goes through ensure2fa.
  admin = await p.user.create({ data: { email: `a${stamp}${MAIL}`, displayName: 'fblink admin', role: 'SUPERADMIN', totpEnabled: true, emailVerified: true, status: 'active' } });
  member = await p.user.create({ data: { email: `m${stamp}${MAIL}`, displayName: 'fblink member', emailVerified: true, status: 'active' } });
  adminCookie = await cookieFor(admin);
  memberCookie = await cookieFor(member);
});

after(async () => {
  if (!RUN) return;
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await p.feedback.deleteMany({ where: { projectKey: PROJECT } });
    await p.report.deleteMany({ where: { reporterId: { in: ids } } });
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close();
  await p?.$disconnect?.();
});

/** A real session row plus the cookie the guards read — a staff login would need a TOTP code. */
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const as = (cookie, opts) => app.inject({ headers: { cookie }, ...opts });

let seq = 0;
/** A submission from a linked sender, shaped exactly as POST /feedback/:project writes it. */
async function mkLinked({ unreadNotif = true } = {}) {
  const id = `fbl${Date.now().toString(36)}${seq++}`.slice(0, 24);
  const fb = await p.feedback.create({ data: { id, projectKey: PROJECT, kind: 'bug', title: `link test ${seq}`, body: 'it broke', userId: member.id } });
  const r = await p.report.create({ data: {
    targetType: 'feedback', targetId: id, targetLabel: fb.title, reporterId: member.id, reason: 'bug', userUnread: true,
    messages: { create: [{ authorId: member.id, body: 'it broke' }, { staff: true, authorId: admin.id, body: 'thanks' }] },
  } });
  await p.feedback.update({ where: { id }, data: { reportId: r.id } });
  if (unreadNotif) {
    await p.notification.create({ data: { userId: member.id, kind: 'report_reply', body: 'Staff replied', href: `/dashboard?s=reports&r=${r.id}` } });
    await p.notification.create({ data: { userId: admin.id, kind: 'report_new', body: 'New report', href: `/admin?s=reports&r=${r.id}` } });
  }
  return { id, reportId: r.id };
}

const listed = async (cookie, url, reportId) => {
  const r = await as(cookie, { method: 'GET', url });
  assert.equal(r.statusCode, 200, `${url} → ${r.statusCode} ${r.body}`);
  return (r.json().reports || []).some((x) => x.id === reportId);
};

describe('deleting a feedback report removes it everywhere', { skip }, () => {
  test('from Retours & plantages: the thread leaves Signalements and the sender dashboard', async () => {
    const { id, reportId } = await mkLinked();
    assert.ok(await listed(adminCookie, '/admin/reports?status=open', reportId), 'fixture: listed in Signalements before');
    assert.ok(await listed(memberCookie, '/me/reports', reportId), 'fixture: listed in the dashboard before');

    const del = await as(adminCookie, { method: 'DELETE', url: `/admin/feedback/${id}` });
    assert.equal(del.statusCode, 200, del.body);

    assert.equal(await p.feedback.findUnique({ where: { id } }), null, 'the feedback row is gone');
    assert.equal(await p.report.findUnique({ where: { id: reportId } }), null, 'the Report row that represents it is gone');
    assert.equal(await p.reportMessage.count({ where: { reportId } }), 0, 'and its messages');
    assert.equal(await listed(adminCookie, '/admin/reports?status=open', reportId), false, 'not in Signalements');
    assert.equal(await listed(memberCookie, '/me/reports', reportId), false, 'not in Messages & reports');
    const dangling = await p.notification.count({ where: { href: { in: [`/dashboard?s=reports&r=${reportId}`, `/admin?s=reports&r=${reportId}`] } } });
    assert.equal(dangling, 0, 'no notification still points at the deleted thread');
  });

  test('from Signalements: the feedback item does not stay behind pointing at nothing', async () => {
    const { id, reportId } = await mkLinked();
    const del = await as(adminCookie, { method: 'DELETE', url: `/admin/reports/${reportId}` });
    assert.equal(del.statusCode, 200, del.body);
    assert.equal(await p.report.findUnique({ where: { id: reportId } }), null);
    assert.equal(await p.feedback.findUnique({ where: { id } }), null, 'the feedback item is removed with its thread');
    const list = await as(adminCookie, { method: 'GET', url: `/admin/feedback?project=${PROJECT}` });
    assert.equal(list.statusCode, 200);
    assert.ok(!list.json().items.some((f) => f.id === id), 'not in Retours & plantages');
  });

  test('a feedback whose reportId was lost is still found through the thread target', async () => {
    // Older rows, or a write that failed half-way: the thread knows its feedback by targetId
    // even when feedback.reportId is null. Deleting the feedback must still find the thread.
    const { id, reportId } = await mkLinked({ unreadNotif: false });
    await p.feedback.update({ where: { id }, data: { reportId: null } });
    const del = await as(adminCookie, { method: 'DELETE', url: `/admin/feedback/${id}` });
    assert.equal(del.statusCode, 200);
    assert.equal(await p.report.findUnique({ where: { id: reportId } }), null);
  });

  test('the lifecycle sweeper detaches the feedback instead of deleting it', async () => {
    const { sweepReportIds } = await import('../src/routes/reports.mjs');
    const { id, reportId } = await mkLinked({ unreadNotif: false });
    await sweepReportIds(p, [reportId]);
    assert.equal(await p.report.findUnique({ where: { id: reportId } }), null);
    const fb = await p.feedback.findUnique({ where: { id } });
    assert.ok(fb, 'the crash data survives an automatic thread expiry');
    assert.equal(fb.reportId, null, 'and no longer points at the swept thread');
  });

  test('a reply on a feedback whose thread vanished does not 500', async () => {
    const { id, reportId } = await mkLinked({ unreadNotif: false });
    await p.report.delete({ where: { id: reportId } }); // a thread removed outside every route
    const r = await as(adminCookie, { method: 'POST', url: `/admin/feedback/${id}/reply`, payload: { body: 'hello?' } });
    assert.notEqual(r.statusCode, 500, r.body);
    assert.equal((await p.feedback.findUnique({ where: { id } })).reportId, null, 'the stale pointer is cleared');
  });
});

describe('mark as seen', { skip }, () => {
  test('the sender marks a thread seen: unread flag and its notifications clear, counter follows', async () => {
    const { reportId } = await mkLinked();
    const before = (await as(memberCookie, { method: 'GET', url: '/me/reports/unseen' })).json();
    assert.ok(before.mine >= 1, `unseen before: ${JSON.stringify(before)}`);
    const r = await as(memberCookie, { method: 'POST', url: `/me/reports/${reportId}/seen` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await p.report.findUnique({ where: { id: reportId } })).userUnread, false);
    const n = await p.notification.findFirst({ where: { userId: member.id, href: `/dashboard?s=reports&r=${reportId}` } });
    assert.ok(n.readAt, 'the notification about it is read');
    assert.ok(r.json().notifIds.includes(n.id), 'and the client is told which, so the bell drops at once');
    const after = (await as(memberCookie, { method: 'GET', url: '/me/reports/unseen' })).json();
    assert.equal(after.mine, before.mine - 1);
  });

  test('a stranger cannot mark somebody else’s thread seen', async () => {
    const { reportId } = await mkLinked({ unreadNotif: false });
    const other = await p.user.create({ data: { email: `o${Date.now()}${MAIL}`, displayName: 'other', emailVerified: true, status: 'active' } });
    const r = await as(await cookieFor(other), { method: 'POST', url: `/me/reports/${reportId}/seen` });
    assert.equal(r.statusCode, 404);
    assert.equal((await p.report.findUnique({ where: { id: reportId } })).userUnread, true);
  });

  test('staff mark a thread seen: staffUnread and the staff notification clear', async () => {
    const { reportId } = await mkLinked();
    const r = await as(adminCookie, { method: 'POST', url: `/admin/reports/${reportId}/seen` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await p.report.findUnique({ where: { id: reportId } })).staffUnread, false);
    const n = await p.notification.findFirst({ where: { userId: admin.id, href: `/admin?s=reports&r=${reportId}` } });
    assert.ok(n.readAt);
    const u = (await as(adminCookie, { method: 'GET', url: '/me/reports/unseen' })).json();
    assert.equal(typeof u.staff, 'number', 'staff get the queue counter');
    const m = (await as(memberCookie, { method: 'GET', url: '/me/reports/unseen' })).json();
    assert.equal(m.staff, undefined, 'a member does not');
  });

  test('mark all seen, both sides', async () => {
    await mkLinked(); await mkLinked();
    assert.equal((await as(memberCookie, { method: 'POST', url: '/me/reports/seen-all' })).statusCode, 200);
    assert.equal((await as(memberCookie, { method: 'GET', url: '/me/reports/unseen' })).json().mine, 0);
    // The staff side acts on the whole queue, and this may be somebody's dev database: put
    // back exactly the unread flags that were there before, whatever the assertion says.
    const was = (await p.report.findMany({ where: { staffUnread: true, NOT: { reporterId: { in: [member.id, admin.id] } } }, select: { id: true } })).map((r) => r.id);
    try {
      assert.equal((await as(adminCookie, { method: 'POST', url: '/admin/reports/seen-all' })).statusCode, 200);
      assert.equal((await as(adminCookie, { method: 'GET', url: '/me/reports/unseen' })).json().staff, 0);
    } finally {
      if (was.length) await p.report.updateMany({ where: { id: { in: was } }, data: { staffUnread: true } });
    }
  });
});
