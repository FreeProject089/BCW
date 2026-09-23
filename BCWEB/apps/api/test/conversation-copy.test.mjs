// A signed copy of a conversation: what goes in it (only what that side saw), the signature
// (the platform's Ed25519 key), the archive, the mails on close, and the verify route.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the conversation copy tests';
process.env.JWT_SECRET ||= 'conversation-copy-secret';

let p, app, jwt, CC, threads, native;
const MAIL = '@cc.test';
const stamp = `${Date.now()}`;
let seq = 0;
const made = [];

before(async () => {
  CC = await import('../src/lib/conversation-copy.mjs');
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  native = await import('../src/lib/native.mjs');
  threads = await import('../src/routes/threads.mjs');
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register(threads.default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  threads?.setCopyMailer(null);
  const ids = (await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })).map((u) => u.id);
  const ours = await p.contactThread.findMany({ where: { OR: [{ id: { in: made } }, { senderId: { in: ids } }, { ownerUserId: { in: ids } }] }, select: { id: true } });
  // ConversationCursor points at a conversation by a plain string, so nothing cascades:
  // receipts and copy claims have to be swept by hand or they outlive their conversation.
  // AFTER the threads, not before: closing is fire-and-forget, so a claim can still be
  // written while this hook runs, and a cursor swept first comes straight back as an orphan.
  await p.contactThread.deleteMany({ where: { id: { in: ours.map((t) => t.id) } } });
  await p.conversationCursor.deleteMany({ where: { conversationId: { in: ours.map((t) => t.id) } } }).catch(() => {});
  await p.notification.deleteMany({ where: { userId: { in: ids } } });
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.user.deleteMany({ where: { id: { in: ids } } });
  await app?.close();
});

const mkUser = () => p.user.create({ data: { email: `u${stamp}-${seq++}${MAIL}`, displayName: `cc-${stamp}-${seq}`, emailVerified: true, status: 'active' } });
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
async function mkThread({ owner, sender = null, anonEmail = '' }) {
  const t = await p.contactThread.create({ data: {
    kind: 'user', targetId: owner.id, targetLabel: owner.displayName, ownerUserId: owner.id,
    senderId: sender?.id || null, senderEmail: anonEmail, senderName: anonEmail ? 'Ana' : '', accessToken: `cc-${stamp}-${seq++}`,
    subject: 'Copy me', ip: '203.0.113.9',
    messages: { create: [
      { side: 'sender', authorId: sender?.id || null, body: 'First, from the sender.' },
      { side: 'owner', authorId: owner.id, body: 'An answer.' },
      { side: 'sender', authorId: sender?.id || null, body: 'Something staff hid.', hidden: true },
    ] },
  } });
  made.push(t.id);
  return t;
}

describe('the signature', () => {
  test('canonical JSON is the same bytes whatever the key order', () => {
    assert.equal(CC.canonical({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } }), CC.canonical({ a: { c: 'x', d: [1, { y: 2, z: 1 }] }, b: 1 }));
  });
});

describe('copies against the database', { skip }, () => {
  test('each side gets what it saw: no hidden message, no IP, a member profile only for the answering side', async () => {
    const owner = await mkUser(); const sender = await mkUser();
    const t = await mkThread({ owner, sender });
    const mine = (await threads.copyOf(p, t.id, 'sender')).signed.payload;
    const theirs = (await threads.copyOf(p, t.id, 'owner')).signed.payload;
    for (const pl of [mine, theirs]) {
      assert.equal(pl.messages.length, 2, 'the hidden message is left out');
      assert.ok(!JSON.stringify(pl).includes('203.0.113.9'), 'no IP');
      assert.ok(!JSON.stringify(pl).includes(sender.email), 'never an account e-mail');
    }
    assert.equal(mine.conversation.sender.profile, undefined);
    assert.match(theirs.conversation.sender.profile, new RegExp(`/u/${sender.id}$`));
  });

  test('verify: genuine is valid, one changed character is tampered, a foreign key is refused', async () => {
    const owner = await mkUser();
    const t = await mkThread({ owner, anonEmail: `anon${stamp}${MAIL}` });
    const { signed } = await threads.copyOf(p, t.id, 'sender');
    const ask = (doc) => app.inject({ method: 'POST', url: '/conversation-copy/verify', payload: { doc } }).then((r) => r.json());
    const ok = await ask(signed);
    assert.equal(ok.valid, true); assert.equal(ok.conversation.messages, 2);
    const forged = structuredClone(signed); forged.payload.messages[1].body = 'An answer!';
    assert.deepEqual(await ask(forged), { valid: false, reason: 'tampered' });
    // A forger who re-signs with their own key and ships it along gets nowhere.
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' });
    const resigned = { payload: forged.payload, signature: { alg: 'Ed25519', keyId: CC.keyIdOf(pem), value: crypto.sign(null, Buffer.from(CC.canonical(forged.payload)), privateKey).toString('base64') }, publicKey: pem };
    assert.equal((await ask(resigned)).reason, 'other_key');
    resigned.signature.keyId = signed.signature.keyId;
    assert.equal((await ask(resigned)).reason, 'tampered', 'claiming our key id does not make their signature ours');
    assert.equal((await ask({ nope: 1 })).reason, 'malformed');
  });

  test('the archive checks out offline with openssl-equivalent steps, and holds the readable copy', async () => {
    const owner = await mkUser();
    const t = await mkThread({ owner, anonEmail: `anon2${stamp}${MAIL}` });
    const r = await app.inject({ method: 'GET', url: `/threads/t/${t.accessToken}/copy` });
    assert.equal(r.statusCode, 200); assert.equal(r.headers['content-type'], 'application/zip');
    const entries = Object.fromEntries((await native.zipReadAll(r.rawPayload)).map((e) => [e.name, Buffer.from(e.data)]));
    for (const n of ['conversation.html', 'conversation.txt', 'conversation.signed.json', 'conversation.payload.json', 'conversation.sig', 'server-public-key.pem', 'HOW-TO-VERIFY.txt']) assert.ok(entries[n], `${n} is in the archive`);
    // What `openssl pkeyutl -verify -rawin` does: the payload bytes, the signature, the key.
    const good = crypto.verify(null, entries['conversation.payload.json'], crypto.createPublicKey(entries['server-public-key.pem'].toString()), Buffer.from(entries['conversation.sig'].toString(), 'base64'));
    assert.equal(good, true);
    assert.ok(entries['conversation.html'].toString().includes('An answer.'));
    assert.ok(!entries['conversation.html'].toString().includes('Something staff hid.'));
    // A stranger cannot pull a signed-in thread's copy.
    const stranger = await mkUser();
    assert.equal((await app.inject({ method: 'GET', url: `/me/threads/${t.id}/copy`, headers: { cookie: await cookieFor(stranger) } })).statusCode, 404);
  });

  test('closing mails a copy to each participant, the archive attached', async () => {
    const owner = await mkUser(); const sender = await mkUser();
    const t = await mkThread({ owner, sender });
    const sent = [];
    threads.setCopyMailer(async (m) => { sent.push(m); return true; });
    const n = await threads.mailCopiesOnClose(p, t.id);
    assert.equal(n, 2);
    assert.deepEqual(sent.map((m) => m.to).sort(), [owner.email, sender.email].sort());
    for (const m of sent) {
      assert.equal(m.attachments[0].contentType, 'application/zip');
      assert.ok(m.html.includes('First, from the sender.'));
      assert.ok(!m.html.includes('Something staff hid.'));
    }
    // Closing the SAME conversation again sends nothing: a copy per side goes out once, not
    // once per close. Without that, close/reopen was an unbounded mail sender aimed at
    // whatever address the thread carries (test/thread-copy-abuse.test.mjs).
    sent.length = 0;
    assert.equal(await threads.mailCopiesOnClose(p, t.id), 0, 'a second close re-sent the copies');

    // And through the route: closing triggers it — on a conversation whose copies have not
    // gone out yet, which is what a real close is.
    const t2 = await mkThread({ owner, sender });
    const r = await app.inject({ method: 'POST', url: `/me/threads/${t2.id}/close`, headers: { cookie: await cookieFor(owner) } });
    assert.equal(r.statusCode, 200);
    for (let i = 0; i < 50 && sent.length < 2; i += 1) await new Promise((res) => setTimeout(res, 20));
    assert.equal(sent.length, 2, 'the close route mailed both participants');
  });
});
