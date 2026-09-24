// The anonymous conversation link, and staff reading conversations (SECURITY_SUMMARY §9).
//
//   #11 (O5)  `/messages/t/<accessToken>` opened the conversation for ever — a mail forwarded
//             years later still read and answered in the sender's name. Now:
//               · it expires 12 months after the conversation's last activity (410);
//               · from the expired page the sender asks for a new link, MAILED to the
//                 address the conversation already carries, and the old token dies;
//               · the answering side can replace the link at any time ("revoke link").
//   F2        A staff member reading a conversation they are not in wrote no audit line.
//
// Against a real database; mails are captured, the stored threads.config is never touched.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the thread link expiry tests';
process.env.JWT_SECRET ||= 'thread-link-expiry-secret';

let p, app, jwt, threads;
const MAIL = '@tle.test';
let seq = 0;
const mails = [];
const DAY = 864e5;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  threads = await import('../src/routes/threads.mjs');
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register(threads.default);
  await app.ready();
  threads.setLinkMailer(async (m) => { mails.push(m); });
  threads.setCopyMailer(async () => {});
});

after(async () => {
  if (!RUN) return;
  threads?.setLinkMailer?.(null);
  threads?.setCopyMailer?.(null);
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const ours = await p.contactThread.findMany({ where: { OR: [{ senderId: { in: ids } }, { ownerUserId: { in: ids } }, { senderEmail: { endsWith: MAIL } }] }, select: { id: true } });
  await p.contactThread.deleteMany({ where: { id: { in: ours.map((t) => t.id) } } });
  await p.conversationCursor.deleteMany({ where: { conversationId: { in: ours.map((t) => t.id) } } }).catch(() => {});
  if (ids.length) {
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close();
});

const mkUser = (over = {}) => p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `tle-${seq}`, emailVerified: true, status: 'active', ...over } });
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const as = (cookie, opts) => app.inject({ headers: cookie ? { cookie } : {}, ...opts });

/** An anonymous conversation addressed to `ownerUserId`, last active `ageDays` ago. */
async function anonThread(ownerUserId, ageDays = 0) {
  const at = new Date(Date.now() - ageDays * DAY);
  return p.contactThread.create({
    data: {
      kind: 'repo', targetId: 'tle-repo', targetLabel: 'a repo',
      ownerUserId, senderEmail: `sender${seq++}${MAIL}`, accessToken: crypto.randomBytes(24).toString('base64url'),
      subject: 'about the thing', status: 'open', lastActivityAt: at, createdAt: at,
      messages: { create: { side: 'sender', body: 'the one message', createdAt: at } },
    },
  });
}

describe('the anonymous link expires (§9 #11)', { skip }, () => {
  test('a link used within the year works; the same link past a year of silence is 410 on every route', async () => {
    const owner = await mkUser();
    const fresh = await anonThread(owner.id, 364);
    assert.equal((await as(null, { method: 'GET', url: `/threads/t/${fresh.accessToken}` })).statusCode, 200);

    const old = await anonThread(owner.id, 366);
    const routes = [
      ['GET', `/threads/t/${old.accessToken}`],
      ['POST', `/threads/t/${old.accessToken}/messages`, { body: 'still me' }],
      ['GET', `/threads/t/${old.accessToken}/copy`],
      ['POST', `/threads/t/${old.accessToken}/copy/mail`],
      ['GET', `/threads/t/${old.accessToken}/files/whatever`],
    ];
    for (const [method, url, payload] of routes) {
      const r = await as(null, { method, url, payload });
      assert.equal(r.statusCode, 410, `${method} ${url.replace(old.accessToken, '<token>')} answered ${r.statusCode}`);
      assert.deepEqual(r.json(), { error: 'link_expired' }, 'an expired link says nothing about the conversation');
    }
    // Nothing was written through the dead link.
    assert.equal(await p.contactThreadMessage.count({ where: { threadId: old.id } }), 1);
  });

  test('an expired link asks for a new one: mailed to the thread’s own address, old token dead', async () => {
    const owner = await mkUser();
    const old = await anonThread(owner.id, 400);
    mails.length = 0;
    const r = await as(null, { method: 'POST', url: `/threads/t/${old.accessToken}/renew` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, old.senderEmail);
    const now = await p.contactThread.findUnique({ where: { id: old.id } });
    assert.notEqual(now.accessToken, old.accessToken);
    assert.ok(mails[0].text.includes(`/messages/t/${now.accessToken}`), 'the mail carries the NEW link');
    // The old link is gone for good (a forwarded copy gets nothing back), the new one works.
    assert.equal((await as(null, { method: 'GET', url: `/threads/t/${old.accessToken}` })).statusCode, 404);
    assert.equal((await as(null, { method: 'GET', url: `/threads/t/${now.accessToken}` })).statusCode, 200);
  });

  test('a link that still works cannot be used to make the server send mail', async () => {
    const owner = await mkUser();
    const live = await anonThread(owner.id, 3);
    mails.length = 0;
    assert.equal((await as(null, { method: 'POST', url: `/threads/t/${live.accessToken}/renew` })).statusCode, 409);
    assert.equal(mails.length, 0);
  });

  test('the answering side revokes the link: the old one stops, the sender is mailed the new one', async () => {
    const owner = await mkUser(); const cOwner = await cookieFor(owner);
    const t = await anonThread(owner.id, 1);
    mails.length = 0;
    const r = await as(cOwner, { method: 'POST', url: `/me/threads/${t.id}/revoke-link` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().mailed, true);
    const now = await p.contactThread.findUnique({ where: { id: t.id } });
    assert.notEqual(now.accessToken, t.accessToken);
    assert.equal((await as(null, { method: 'GET', url: `/threads/t/${t.accessToken}` })).statusCode, 404);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, t.senderEmail);
    assert.ok(mails[0].text.includes(`/messages/t/${now.accessToken}`));
  });

  test('somebody who is not on the answering side cannot revoke it', async () => {
    const owner = await mkUser(); const stranger = await mkUser();
    const t = await anonThread(owner.id, 1);
    const r = await as(await cookieFor(stranger), { method: 'POST', url: `/me/threads/${t.id}/revoke-link` });
    assert.equal(r.statusCode, 404);
    assert.equal((await p.contactThread.findUnique({ where: { id: t.id } })).accessToken, t.accessToken);
  });
});

describe('a staff read of somebody else’s conversation is audited (§9, F2 residual)', { skip }, () => {
  test('through the member door and the moderation screen alike; a participant’s own read is not', async () => {
    const owner = await mkUser();
    const admin = await mkUser({ role: 'ADMIN', totpEnabled: true });
    const t = await anonThread(owner.id, 1);
    const lines = () => p.auditLogEntry.count({ where: { actorId: admin.id, action: 'thread.staff_read', detail: { contains: `thread=${t.id}` } } });
    const cAdmin = await cookieFor(admin);
    assert.equal((await as(cAdmin, { method: 'GET', url: `/me/threads/${t.id}` })).statusCode, 200);
    assert.equal(await lines(), 1, 'reading through /me/threads left no audit line');
    // The moderation screen needs manage_reports; ADMIN holds it.
    const adm = await as(cAdmin, { method: 'GET', url: `/admin/threads/${t.id}` });
    assert.equal(adm.statusCode, 200, adm.body);
    assert.equal(await lines(), 2, 'reading through /admin/threads left no audit line');
    // The owner reading their own inbox is not an audited act.
    assert.equal((await as(await cookieFor(owner), { method: 'GET', url: `/me/threads/${t.id}` })).statusCode, 200);
    assert.equal(await p.auditLogEntry.count({ where: { actorId: owner.id, action: 'thread.staff_read' } }), 0);
  });
});
