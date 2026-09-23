// The conversation-copy machinery, attacked rather than exercised (pentest 2026-09-23).
//
// Five rules, each of which was false when this file was written:
//
//   1. Closing a conversation mails ONE copy per side, not one per close. A close/reopen
//      loop was an unbounded mail sender aimed at whatever address the thread carries —
//      and on an anonymous thread that address is typed by the person who opened it.
//   2. Staff reach a conversation they are not in through /me/threads/*. That is an admin
//      power, so it goes through the admin gate: 2FA, like every /admin/* route.
//   3. A path can be the credential (`/threads/t/<token>`, `/f/<token>`). The redaction
//      that keeps secrets out of logs stripped the QUERY STRING only.
//   4. A sender staff BLOCKED does not get to keep making the server send them mail.
//   5. Checking a copy shows WHAT was signed. A verifier that says "valid" without
//      showing the authentic text cannot contradict a doctored conversation.html sitting
//      in the same archive.
//
// Against a real database, with the site config held in this process only.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the thread-copy abuse tests';
process.env.JWT_SECRET ||= 'thread-copy-abuse-secret';

let p, app, jwt, threads, setOverride;
const MAIL = '@tca.test';
const KEY = 'threads.config';
let saved; let seq = 0;
const mails = [];

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  threads = await import('../src/routes/threads.mjs');
  setOverride = threads.setThreadsConfigOverride;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register(threads.default);
  await app.ready();
  threads.setCopyMailer(async (m) => { mails.push(m); });
  saved = await p.adminSetting.findUnique({ where: { key: KEY } });
});

after(async () => {
  if (!RUN) return;
  setOverride?.(null);
  threads?.setCopyMailer?.(null);
  const now = await p.adminSetting.findUnique({ where: { key: KEY } });
  assert.deepEqual(now?.value ?? null, saved?.value ?? null, 'the stored threads.config was never touched');
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const ours = await p.contactThread.findMany({ where: { OR: [{ senderId: { in: ids } }, { ownerUserId: { in: ids } }, { senderEmail: { endsWith: MAIL } }] }, select: { id: true } });
  // Threads first, cursors after: closing mails its copies fire-and-forget, so a copy claim
  // can still be written while this hook runs, and a cursor swept first comes back orphaned.
  await p.contactThread.deleteMany({ where: { id: { in: ours.map((t) => t.id) } } });
  await p.conversationCursor.deleteMany({ where: { conversationId: { in: ours.map((t) => t.id) } } }).catch(() => {});
  if (ids.length) {
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close();
});

const mkUser = (over = {}) => p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `tca-${seq}`, emailVerified: true, status: 'active', ...over } });
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const as = (cookie, opts) => app.inject({ headers: cookie ? { cookie } : {}, ...opts });

/** A conversation between two members, with one message. */
async function conversation({ senderId = null, senderEmail = '', ownerUserId }) {
  return p.contactThread.create({
    data: {
      kind: 'user', targetId: ownerUserId, targetLabel: 'a member',
      ownerUserId, senderId, senderEmail, accessToken: crypto.randomBytes(24).toString('base64url'),
      subject: 'about the thing', status: 'open',
      messages: { create: { authorId: senderId, side: 'sender', body: 'the one message' } },
    },
  });
}

describe('conversation copies, attacked', { skip }, () => {
  test('close/reopen in a loop mails ONE copy per side, not one per close', async () => {
    const alice = await mkUser(); const bob = await mkUser();
    const cA = await cookieFor(alice);
    // An ANONYMOUS conversation: the address is whatever the opener typed, so every mail
    // this triggers is aimed at a third party who never asked for it.
    const t = await conversation({ senderEmail: `victim${MAIL}`, ownerUserId: bob.id });
    await p.contactThread.update({ where: { id: t.id }, data: { ownerUserId: alice.id } });

    mails.length = 0;
    for (let i = 0; i < 5; i++) {
      assert.equal((await as(cA, { method: 'POST', url: `/me/threads/${t.id}/close` })).statusCode, 200);
      assert.equal((await as(cA, { method: 'POST', url: `/me/threads/${t.id}/reopen` })).statusCode, 200);
    }
    await new Promise((r) => setTimeout(r, 400));
    const toVictim = mails.filter((m) => m.to === `victim${MAIL}`).length;
    assert.ok(toVictim <= 1, `five closes mailed the third-party address ${toVictim} time(s); one is the cap`);
    assert.ok(mails.length <= 2, `five closes produced ${mails.length} copy mails; two (one per side) is the cap`);
  });

  test('a staff account without 2FA cannot read, or export, a conversation it is not in', async () => {
    const alice = await mkUser(); const bob = await mkUser();
    const admin = await mkUser({ role: 'ADMIN', totpEnabled: false });
    const cAdmin = await cookieFor(admin);
    const t = await conversation({ senderId: alice.id, ownerUserId: bob.id });

    // The admin route already refuses them. The member route must agree: it is the same power.
    assert.equal((await as(cAdmin, { method: 'GET', url: `/admin/threads/${t.id}` })).statusCode, 403);
    const read = await as(cAdmin, { method: 'GET', url: `/me/threads/${t.id}` });
    assert.equal(read.statusCode, 403, `an admin without 2FA read a private conversation: ${read.body.slice(0, 200)}`);
    assert.equal(JSON.parse(read.body).error, '2fa_required');
    const copy = await as(cAdmin, { method: 'GET', url: `/me/threads/${t.id}/copy` });
    assert.equal(copy.statusCode, 403, 'an admin without 2FA downloaded a signed copy of a private conversation');
  });

  test('a path that IS a credential is redacted out of logs and error rows', async () => {
    const { redactPath } = await import('../src/lib/errorlog.mjs');
    for (const [url, want] of [
      ['/threads/t/SECRET-TOKEN-VALUE', '/threads/t/…'],
      ['/threads/t/SECRET-TOKEN-VALUE/messages', '/threads/t/…/messages'],
      ['/threads/t/SECRET-TOKEN-VALUE/files/abc?x=1', '/threads/t/…/files/abc'],
      ['/f/SECRET-TOKEN-VALUE', '/f/…'],
      ['/f/SECRET-TOKEN-VALUE/info', '/f/…/info'],
      ['/auth/oauth/link/SECRET-TOKEN-VALUE', '/auth/oauth/link/…'],
      ['/me/threads/abc123', '/me/threads/abc123'],
    ]) assert.equal(redactPath(url), want, url);
  });

  test('a blocked sender cannot keep making the server mail them', async () => {
    const bob = await mkUser();
    const t = await conversation({ senderEmail: `blocked${MAIL}`, ownerUserId: bob.id });
    await p.contactThread.update({ where: { id: t.id }, data: { status: 'blocked' } });
    const r = await app.inject({ method: 'POST', url: `/threads/t/${t.accessToken}/copy/mail` });
    assert.equal(r.statusCode, 403, `a blocked thread still mailed a copy on request: ${r.body.slice(0, 200)}`);
  });

  test('a cursor whose conversation is gone is swept, and a live one is left alone', async () => {
    const { pruneOrphanCursors } = await import('../src/lib/receipts.mjs');
    const alice = await mkUser(); const bob = await mkUser();
    const live = await conversation({ senderId: alice.id, ownerUserId: bob.id });
    const gone = await conversation({ senderId: alice.id, ownerUserId: bob.id });
    const goneId = gone.id;
    for (const [kind, id] of [['thread', live.id], ['thread', goneId], ['thread-copy', live.id], ['thread-copy', goneId]]) {
      await p.conversationCursor.create({ data: { kind, conversationId: id, side: 'sender', readAt: new Date() } });
    }
    await p.contactThread.delete({ where: { id: goneId } });

    await pruneOrphanCursors(p);
    assert.equal(await p.conversationCursor.count({ where: { conversationId: goneId } }), 0, 'the deleted conversation kept its cursors');
    assert.equal(await p.conversationCursor.count({ where: { conversationId: live.id } }), 2, 'a live conversation lost its cursors');
  });

  test('verifying a copy shows what was signed, so a doctored readable copy is contradicted', async () => {
    const alice = await mkUser(); const bob = await mkUser();
    const t = await conversation({ senderId: alice.id, ownerUserId: bob.id });
    const c = await threads.copyOf(p, t.id, 'sender', 'alice');
    const r = await app.inject({ method: 'POST', url: '/conversation-copy/verify', payload: c.signed });
    assert.equal(r.statusCode, 200);
    const out = r.json();
    assert.equal(out.valid, true, r.body);
    assert.ok(Array.isArray(out.messages), 'the verifier returned no messages, so it cannot show the authentic text');
    assert.equal(out.messages.length, 1);
    assert.equal(out.messages[0].body, 'the one message');
  });
});
