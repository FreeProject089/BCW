// followups (agent-bcw-followups): three gaps the moderation engine left, against a real
// database.
//
//   (a) a HELD first message of a contact thread left the recipient a thread with a subject and
//       no message, and nobody was told when a moderator released it. The thread is now held
//       whole (status 'held': out of the recipient's inbox, a 404 for them) and the release
//       opens it and tells them.
//   (b) a case the after-the-response AI pass opens has no id to point at — the route linked
//       the case that existed when it answered, which was none. linkCase now takes the whole
//       moderate() result, and the late case is linked whichever of the two comes first.
//   (c) the "my data" export carries the person's moderation cases (the column is a plain id,
//       no relation, so the metadata-derived plan never saw it), without the staff note or
//       the resolving moderator; and an admin erasure that DELETES the account detaches them
//       too (only the anonymise path used to).
//
// Fixtures are tagged and removed; the moderation settings are snapshotted and put back.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the moderation follow-up tests';
process.env.JWT_SECRET ||= 'moderation-followups-test-secret';

const TAG = `modfu-${Date.now().toString(36)}-`;
const MAIL = '@moderation-followups.test';
const PHISH = 'Claim your prize now: https://dіscord.com/gift/abc and javascript:alert(1) before it expires';
const KEYS_TO_SAVE = ['moderation.settings', 'moderation.policies', 'moderation.rules', 'ai.killed'];
let p, app, eng, cfgMod, cases, threads, admin, sender, recipient;
const cookies = {};
const saved = {};
let seq = 0;
const key = () => `test:${TAG}${seq++}`;
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 40)); } };

function policies(over = {}) {
  const base = { flood: { max: 0, windowSec: 60 }, dup: { windowSec: 0, crossAuthors: 3 }, notify: false, ai: false };
  const out = {};
  for (const s of ['contact', 'report', 'legal', 'crash', 'bug', 'suggestion', 'member_message', 'team_message', 'community', 'discord_automod', 'phishing']) out[s] = { ...base, mode: 'flag', ...(over[s] || {}) };
  return out;
}
// The policies are ONE row every moderation test file writes, and node --test runs the files in
// parallel. So after saving, the config is read fresh until it is ours and then left in this
// process's 15-second cache, which another file's write cannot reach.
async function setPolicies(over) {
  const want = policies(over);
  for (let i = 0; i < 40; i++) {
    await cfgMod.saveSetting(p, 'moderation.policies', want);
    const cfg = await cfgMod.loadConfig(p, { fresh: true });
    const ok = Object.entries(over).every(([s, o]) => cfg.policies[s]?.mode === (o.mode || 'flag') && (!o.thresholds || cfg.policies[s]?.thresholds?.block === o.thresholds.block) && cfg.settings.enabled && !cfg.killSwitch?.killed);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('could not pin the moderation policies');
}
// A held message (QUARANTINE), not a refused one (BLOCK): the block threshold out of reach.
const HOLD = { mode: 'auto', thresholds: { flag: 10, review: 20, quarantine: 30, block: 1000 } };

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  eng = await import('../src/lib/moderation/engine.mjs');
  cfgMod = await import('../src/lib/moderation/config.mjs');
  cases = await import('../src/lib/moderation/cases.mjs');
  threads = await import('../src/routes/threads.mjs');
  threads.setThreadsConfigOverride({}); // the defaults, never the dev database's own config
  for (const k of KEYS_TO_SAVE) saved[k] = await p.adminSetting.findUnique({ where: { key: k } });
  await p.adminSetting.deleteMany({ where: { key: { in: KEYS_TO_SAVE } } });
  cfgMod.invalidateConfig();
  const old = new Date(Date.now() - 400 * 864e5);
  const mk = (n, role = 'USER') => p.user.create({ data: { email: `${TAG}${n}${MAIL}`, displayName: `${TAG}${n}`.slice(0, 40), role, totpEnabled: role !== 'USER', emailVerified: true, createdAt: old } });
  admin = await mk('admin', 'SUPERADMIN'); sender = await mk('sender'); recipient = await mk('recipient');
  for (const u of [admin, sender, recipient]) {
    const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
    cookies[u.id] = `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
  }
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register(threads.default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    const ids = [admin?.id, sender?.id, recipient?.id].filter(Boolean);
    await p.moderationCase.deleteMany({ where: { OR: [{ authorId: { in: ids } }, { authorKey: { startsWith: `test:${TAG}` } }, { excerpt: { contains: TAG } }, { subjectId: { startsWith: TAG } }] } });
    await p.contactThread.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { ownerUserId: { in: ids } }] } });
    await p.conversationCursor?.deleteMany?.({ where: { conversationId: { startsWith: TAG } } }).catch(() => {});
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
    for (const k of KEYS_TO_SAVE) {
      if (saved[k]) await p.adminSetting.upsert({ where: { key: k }, create: saved[k], update: { value: saved[k].value } });
      else await p.adminSetting.deleteMany({ where: { key: k } });
    }
    cfgMod.invalidateConfig();
  } finally {
    threads?.setThreadsConfigOverride?.(null);
    eng?._setAiModule?.(null);
    await app?.close();
  }
});

const as = (u) => ({
  get: (url) => app.inject({ method: 'GET', url, headers: { cookie: cookies[u.id] } }),
  post: (url, payload) => app.inject({ method: 'POST', url, headers: { cookie: cookies[u.id] }, payload: payload || {} }),
});

describe('(a) a held first message holds the whole thread (db)', { skip }, () => {
  test('invisible to the recipient until released; the release opens it and tells them', async () => {
    eng._setAiModule(null);
    await setPolicies({ member_message: HOLD });
    const r = await as(sender).post('/threads', { kind: 'user', targetId: recipient.id, subject: `${TAG} subject`, body: `${TAG} ${PHISH}` });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().thread.id;
    const t = await p.contactThread.findUnique({ where: { id }, include: { messages: true } });
    assert.equal(t.status, 'held');
    assert.equal(t.messages[0].hidden, true);

    // The recipient: not in the inbox, a 404 on the thread itself, and no notice.
    const inbox = (await as(recipient).get('/me/threads')).json();
    assert.ok(!inbox.threads.some((x) => x.id === id), 'a held thread is not in the inbox');
    assert.equal((await as(recipient).get(`/me/threads/${id}`)).statusCode, 404);
    assert.equal(await p.notification.count({ where: { userId: recipient.id } }), 0);
    // The sender still has it, and cannot add to it until it is released.
    assert.ok((await as(sender).get('/me/threads?box=sent')).json().threads.some((x) => x.id === id));
    assert.equal((await as(sender).post(`/me/threads/${id}/messages`, { body: 'anything else to add?' })).statusCode, 409);

    // The case points at the message; a moderator releases it.
    const c = await p.moderationCase.findFirst({ where: { subjectType: 'thread_message', subjectId: t.messages[0].id } });
    assert.ok(c?.held, 'an open, held case linked to the message');
    const out = await cases.actOnCase(p, c.id, 'release', { uid: admin.id, role: 'SUPERADMIN', perms: [] });
    assert.equal(out.ok, true, JSON.stringify(out));

    const after = await p.contactThread.findUnique({ where: { id }, include: { messages: true } });
    assert.equal(after.status, 'open');
    assert.equal(after.messages[0].hidden, false);
    assert.equal(after.ownerUnread, true);
    const n = await waitFor(() => p.notification.findFirst({ where: { userId: recipient.id } }));
    assert.ok(n, 'the recipient is told on release');
    assert.ok((await as(recipient).get('/me/threads')).json().threads.some((x) => x.id === id));
    assert.equal((await as(recipient).get(`/me/threads/${id}`)).statusCode, 200);
  });

  test('a held REPLY released later tells the other side too', async () => {
    await setPolicies({ member_message: { mode: 'flag' } });
    const r = await as(sender).post('/threads', { kind: 'user', targetId: recipient.id, subject: `${TAG} fine`, body: `${TAG} a perfectly ordinary question about your mod` });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().thread.id;
    // The "new conversation" notice is sent without being awaited: let THIS one land (not the
    // previous test's release notice), then clear them all.
    const mine = async () => (await p.notification.findMany({ where: { userId: recipient.id } })).some((x) => JSON.stringify(x).includes(`${TAG} fine`));
    assert.ok(await waitFor(mine));
    await p.notification.deleteMany({ where: { userId: recipient.id } });
    await setPolicies({ member_message: HOLD });
    const m = await as(sender).post(`/me/threads/${id}/messages`, { body: `${TAG} ${PHISH}` });
    assert.equal(m.statusCode, 200, m.body);
    await new Promise((r) => setTimeout(r, 300)); // a notice, if one were sent, would be written by now
    const early = await p.notification.findMany({ where: { userId: recipient.id } });
    assert.equal(early.length, 0, `held: nobody told yet (${JSON.stringify(early.map((x) => [x.type || x.kind, x.title || x.body || x.message]))})`);
    const c = await p.moderationCase.findFirst({ where: { subjectType: 'thread_message', subjectId: m.json().message.id } });
    assert.ok(c?.held);
    await cases.actOnCase(p, c.id, 'approve', { uid: admin.id, role: 'SUPERADMIN', perms: [] });
    assert.ok(await waitFor(() => p.notification.findFirst({ where: { userId: recipient.id } })), 'told on release');
  });
});

describe('(b) a case the late AI pass opens is linked to its content (db)', { skip }, () => {
  // Grey zone from a heuristic (three invisible characters, 20), not from a link: the engine's
  // own test allow-lists bit.ly while it runs, in parallel, on the same rules row.
  const grey = `${TAG} have a look${String.fromCharCode(0x200b).repeat(3)} at the new build`;
  const stub = (delay) => ({
    aiEnabledFor: () => true,
    aiAnalyze: async () => { if (delay) await new Promise((r) => setTimeout(r, delay)); return { provider: 'stub', model: 't', latencyMs: 1, labels: { spam: 0.99, phishing: 0.99, toxic: 0.99 } }; },
  });

  test('the content id arrives BEFORE the late case: the case is created with it', async () => {
    eng._setAiModule(stub(150));
    await setPolicies({ community: { mode: 'auto', ai: true, aiBlocking: false } });
    const ak = key();
    const r = await eng.moderate('community', { text: grey, authorKey: ak }, { p, subject: { type: 'project_review' }, canRefuse: true });
    assert.equal(r.caseId, null);
    await eng.linkCase(p, r, 'project_review', `${TAG}review-1`);
    const c = await waitFor(() => p.moderationCase.findFirst({ where: { authorKey: ak } }));
    assert.ok(c, 'the late AI answer opened a case');
    assert.equal(c.subjectType, 'project_review');
    assert.equal(c.subjectId, `${TAG}review-1`);
  });

  test('the content id arrives AFTER the late case: the case is updated with it', async () => {
    eng._setAiModule(stub(0));
    const ak = key();
    const r = await eng.moderate('community', { text: grey, authorKey: ak }, { p, subject: { type: 'project_review' }, canRefuse: true });
    const c0 = await waitFor(() => p.moderationCase.findFirst({ where: { authorKey: ak } }));
    assert.ok(c0);
    assert.equal(c0.subjectId, '');
    await eng.linkCase(p, r, 'project_review', `${TAG}review-2`);
    const c = await p.moderationCase.findUnique({ where: { id: c0.id } });
    assert.equal(c.subjectId, `${TAG}review-2`);
    eng._setAiModule(null);
  });

  test('the result stays plain data: the holder is not serialised', async () => {
    const r = await eng.moderate('community', { text: 'hello', authorKey: key() }, { p, dryRun: true });
    assert.ok(!('subjectRef' in JSON.parse(JSON.stringify(r))));
  });
});

describe('(c) the export carries the cases, the erasure detaches them (db)', { skip }, () => {
  test('exportUser lists the person’s cases, without the staff note or the moderator', async () => {
    const { Prisma } = await import('@prisma/client');
    const { exportUser } = await import('../src/lib/user-export.mjs');
    const c = await p.moderationCase.create({ data: { surface: 'contact', decision: 'REVIEW', status: 'resolved', authorId: sender.id, excerpt: `${TAG} my words`, reasons: [{ rule: 'text.keyword', weight: 10, detail: 'secret-list-term' }], note: 'staff only: known spammer', resolverId: admin.id, resolution: 'approved' } });
    const doc = await exportUser(p, sender.id, Prisma.dmmf, new Date());
    const rows = doc.data['ModerationCase.authorId'];
    assert.ok(Array.isArray(rows), `ModerationCase is in the export (keys: ${Object.keys(doc.data).join(', ')})`);
    const row = rows.find((x) => x.id === c.id);
    assert.ok(row);
    assert.equal(row.excerpt, `${TAG} my words`);
    assert.equal(row.decision, 'REVIEW');
    assert.ok(!('note' in row), 'the staff note is not theirs');
    assert.ok(!('resolverId' in row), 'nor is the moderator who resolved it');
    assert.deepEqual(row.reasons, [{ rule: 'text.keyword', weight: 10 }], 'the rule, not the list it matched from');
    assert.ok(doc.lookedIn.some((x) => x.startsWith('ModerationCase.authorId')));
  });

  test('forgetAuthor detaches the cases (the path every erasure now takes)', async () => {
    const c = await p.moderationCase.create({ data: { surface: 'contact', decision: 'REVIEW', status: 'open', authorId: recipient.id, excerpt: `${TAG} words`, payload: { email: `x${MAIL}` } } });
    assert.equal(await cases.forgetAuthor(p, recipient.id) >= 1, true);
    const after = await p.moderationCase.findUnique({ where: { id: c.id } });
    assert.equal(after.authorId, null);
    assert.equal(after.excerpt, null);
    assert.equal(after.payload, null);
  });
});
