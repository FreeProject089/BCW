// Read receipts (sent / delivered / read) on every conversation kind, and the ONE debounced
// "you have N unread messages" mail an anonymous sender gets per burst of replies.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { receiptOf, recipientSide } from '../src/lib/receipts.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the read-receipt tests';
process.env.JWT_SECRET ||= 'read-receipts-secret';

let p, app, jwt, threads;
const MAIL = '@rr.test';
let seq = 0;
const made = { reports: [], myo: [], threads: [] };

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  threads = await import('../src/routes/threads.mjs');
  const threadsMod = await import('../src/routes/threads.mjs');
  // Generous limits and the member switch on, in THIS process only: what the user's dev
  // database has stored, or another test file set, must not decide this file's results.
  threadsMod.setThreadsConfigOverride({ userPerHour: 1000, userPerDay: 1000, anonPerHour: 1000, anonPerDay: 1000, messagesPerHour: 1000, memberDirect: { enabled: true, openPerHour: 0, openPerDay: 0 } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register(threads.default);
  await app.register((await import('../src/routes/reports.mjs')).default);
  await app.register((await import('../src/routes/myo.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const convIds = [...made.reports, ...made.myo, ...made.threads];
  await p.conversationCursor.deleteMany({ where: { conversationId: { in: convIds } } });
  await p.contactThread.deleteMany({ where: { OR: [{ id: { in: made.threads } }, { senderId: { in: ids } }, { ownerUserId: { in: ids } }] } });
  await p.report.deleteMany({ where: { id: { in: made.reports } } });
  await p.myoRequest.deleteMany({ where: { id: { in: made.myo } } });
  if (ids.length) {
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close();
});

const mkUser = (over = {}) => p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `rr-${seq}`, emailVerified: true, status: 'active', ...over } });
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const as = (cookie, opts) => app.inject({ headers: cookie ? { cookie } : {}, ...opts });
const last = (msgs, pred = () => true) => [...msgs].reverse().find(pred);

describe('receipts: the rule', () => {
  test('read beats delivered beats sent, and a timestamp equal to createdAt counts', () => {
    const at = new Date('2026-09-22T10:00:00Z');
    assert.equal(receiptOf(at, null), 'sent');
    assert.equal(receiptOf(at, { deliveredAt: new Date('2026-09-22T09:59:59Z') }), 'sent');
    assert.equal(receiptOf(at, { deliveredAt: at }), 'delivered');
    assert.equal(receiptOf(at, { deliveredAt: at, readAt: at }), 'read');
    assert.equal(recipientSide('thread', 'sender'), 'owner');
    assert.equal(recipientSide('thread', 'staff'), 'sender');
    assert.equal(recipientSide('report', 'reporter'), 'staff');
    assert.equal(recipientSide('myo', 'staff'), 'user');
  });
});

describe('receipts over HTTP', { skip }, () => {
  test('contact thread: sent, then delivered when the owner lists it, then read when they open it', async () => {
    const owner = await mkUser(); const sender = await mkUser();
    const cO = await cookieFor(owner); const cS = await cookieFor(sender);
    let r = await as(cS, { method: 'POST', url: '/threads', payload: { kind: 'user', targetId: owner.id, subject: 'Receipts', body: 'Is this delivered yet?' } });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().thread.id; made.threads.push(id);
    const mine = async () => last((await as(cS, { method: 'GET', url: `/me/threads/${id}` })).json().thread.messages, (m) => m.side === 'sender');
    assert.equal((await mine()).receipt, 'sent');
    await as(cO, { method: 'GET', url: '/me/threads' });
    assert.equal((await mine()).receipt, 'delivered');
    r = await as(cO, { method: 'GET', url: `/me/threads/${id}` });
    // The owner's view carries no receipt on a message the owner did not write.
    assert.equal(last(r.json().thread.messages).receipt, undefined);
    assert.equal((await mine()).receipt, 'read');
  });

  test('report: the reporter sees their message read once staff open the report', async () => {
    const reporter = await mkUser(); const staff = await mkUser({ role: 'SUPERADMIN', totpEnabled: true });
    const cR = await cookieFor(reporter); const cA = await cookieFor(staff);
    const rep = await p.report.create({ data: { targetType: 'general', reporterId: reporter.id, reason: 'rr', messages: { create: { authorId: reporter.id, staff: false, body: 'Please look' } } } });
    made.reports.push(rep.id);
    const mine = async () => last((await as(cR, { method: 'GET', url: `/me/reports/${rep.id}` })).json().report.messages, (m) => !m.staff);
    assert.equal((await mine()).receipt, 'sent');
    await as(cA, { method: 'GET', url: '/admin/reports' });
    assert.equal((await mine()).receipt, 'delivered');
    await as(cA, { method: 'GET', url: `/admin/reports/${rep.id}` });
    assert.equal((await mine()).receipt, 'read');
  });

  test('MYO: the requester sees their message read once staff open the request', async () => {
    const user = await mkUser(); const staff = await mkUser({ role: 'SUPERADMIN', totpEnabled: true });
    const cU = await cookieFor(user); const cA = await cookieFor(staff);
    const req = await p.myoRequest.create({ data: { userId: user.id, name: 'rr product', consultationPaid: true, status: 'open' } });
    made.myo.push(req.id);
    const r = await as(cU, { method: 'POST', url: `/myo/requests/${req.id}/messages`, payload: { body: 'hello staff' } });
    assert.equal(r.statusCode, 201, r.body);
    const mine = async () => last((await as(cU, { method: 'GET', url: `/myo/requests/${req.id}` })).json().messages, (m) => !m.staff);
    assert.equal((await mine()).receipt, 'sent');
    await as(cA, { method: 'GET', url: `/myo/requests/${req.id}` });
    assert.equal((await mine()).receipt, 'read');
  });

  test('anonymous sender: three replies make ONE mail, counting three, with the thread link', async () => {
    const owner = await mkUser(); const cO = await cookieFor(owner);
    const token = `rr-${Date.now()}-${seq++}`;
    const th = await p.contactThread.create({ data: { kind: 'user', targetId: owner.id, targetLabel: 'rr owner', ownerUserId: owner.id, senderEmail: `anon${seq}${MAIL}`, accessToken: token, subject: 'Anon question', messages: { create: { side: 'sender', body: 'hi from nobody' } } } });
    made.threads.push(th.id);
    for (const body of ['one', 'two', 'three']) {
      const r = await as(cO, { method: 'POST', url: `/me/threads/${th.id}/messages`, payload: { body } });
      assert.equal(r.statusCode, 200, r.body);
    }
    const sent = [];
    const send = async (m) => { sent.push(m); return true; };
    const later = new Date(Date.now() + 24 * 3600e3);
    // Only this thread's cursor: other due mails in the dev database are not ours to send.
    const only = [th.id];
    const n = await threads.flushAnonThreadMails(p, { now: later, send, only });
    assert.equal(n, 1);
    const ours = sent.filter((m) => m.text.includes(token));
    assert.equal(ours.length, 1, 'one mail for the burst, not one per reply');
    assert.match(ours[0].subject, /^3 unread messages/);
    assert.ok(ours[0].text.includes(`/messages/t/${token}`), 'the link is the existing tokenised thread link');
    // Nothing left to send: the burst is spent.
    sent.length = 0;
    await threads.flushAnonThreadMails(p, { now: later, send, only });
    assert.equal(sent.filter((m) => m.text.includes(token)).length, 0);
    // A new reply that the sender READS before it falls due is never mailed.
    await as(cO, { method: 'POST', url: `/me/threads/${th.id}/messages`, payload: { body: 'four' } });
    const view = await as(null, { method: 'GET', url: `/threads/t/${token}` });
    assert.equal(view.statusCode, 200);
    await threads.flushAnonThreadMails(p, { now: later, send, only });
    assert.equal(sent.filter((m) => m.text.includes(token)).length, 0, 'read before due: no mail');
    // And the owner's own message now reads as read: the sender opened the link.
    const ov = await as(cO, { method: 'GET', url: `/me/threads/${th.id}` });
    assert.equal(last(ov.json().thread.messages, (m) => m.side === 'owner').receipt, 'read');
  });
});
