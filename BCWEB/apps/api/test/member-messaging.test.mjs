// Member-to-member conversations: no cap, two archive clocks, one switch that touches
// nothing else, rate limits on opening AND on sending, and the admin's archive / delete.
//
// Against a real database. The site config is set IN THIS PROCESS ONLY
// (setThreadsConfigOverride): the stored `threads.config` row belongs to the user's dev
// database and is read by every other test file running in parallel, so it is never written.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the member-messaging tests';
process.env.JWT_SECRET ||= 'member-messaging-secret';

let p, app, jwt, autoArchive, setOverride;
const MAIL = '@mm.test';
const KEY = 'threads.config';
let saved; let seq = 0;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  ({ autoArchive, setThreadsConfigOverride: setOverride } = await import('../src/routes/threads.mjs'));
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/threads.mjs')).default);
  await app.register((await import('../src/routes/teams.mjs')).default);
  await app.ready();
  // The stored row, for the check that nothing here ever wrote it.
  saved = await p.adminSetting.findUnique({ where: { key: KEY } });
});

after(async () => {
  if (!RUN) return;
  setOverride?.(null);
  const now = await p.adminSetting.findUnique({ where: { key: KEY } });
  assert.deepEqual(now?.value ?? null, saved?.value ?? null, 'the stored threads.config was never touched');
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await p.contactThread.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { ownerUserId: { in: ids } }, { senderEmail: { endsWith: MAIL } }] } });
  if (ids.length) {
    await p.serverRepo.deleteMany({ where: { ownerId: { in: ids } } });
    await p.team.deleteMany({ where: { ownerId: { in: ids } } });
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.auditLogEntry?.deleteMany?.({ where: { actorId: { in: ids } } }).catch(() => {});
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close();
});

const mkUser = (over = {}) => p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `mm-${seq}`, emailVerified: true, status: 'active', ...over } });
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const as = (cookie, opts) => app.inject({ headers: cookie ? { cookie } : {}, ...opts });
async function setConfig(patch) {
  setOverride({ enabled: true, userPerHour: 1000, userPerDay: 1000, anonPerHour: 1000, anonPerDay: 1000, messagesPerHour: 1000, blockedEmails: [], blockedUserIds: [], ...patch, memberDirect: { enabled: true, openPerHour: 0, openPerDay: 0, ...(patch.memberDirect || {}) } });
}
const open = (cookie, targetId, kind = 'user') => as(cookie, { method: 'POST', url: '/threads', payload: { kind, targetId, subject: 'Hello there', body: 'A message long enough to pass.' } });

describe('member-to-member messaging', { skip }, () => {
  test('no cap on open conversations: a sixth (and a tenth) conversation opens', async () => {
    await setConfig({ memberDirect: { maxOpen: 5 } }); // a stored legacy cap is IGNORED
    const me = await mkUser(); const c = await cookieFor(me);
    for (let i = 0; i < 10; i += 1) {
      const other = await mkUser();
      const r = await open(c, other.id);
      assert.equal(r.statusCode, 201, `conversation ${i + 1}: ${r.body}`);
    }
    const r = await as(c, { method: 'GET', url: '/admin/threads/config' });
    assert.equal(r.statusCode, 403, 'a member cannot read the site config');
  });

  test('auto-archive: the anonymous clock is shorter than the member one', async () => {
    await setConfig({ memberDirect: { autoArchiveDays: 30, autoArchiveAnonDays: 7 } });
    const owner = await mkUser(); const sender = await mkUser();
    const mk = (data) => p.contactThread.create({ data: { kind: 'user', targetId: owner.id, ownerUserId: owner.id, accessToken: `mm-${Date.now()}-${seq++}`, subject: 's', ...data } });
    const days = (d) => new Date(Date.now() - d * 864e5);
    const anonOld = await mk({ senderEmail: `a${seq}${MAIL}`, lastActivityAt: days(8) });
    const anonNew = await mk({ senderEmail: `b${seq}${MAIL}`, lastActivityAt: days(3) });
    const memberMid = await mk({ senderId: sender.id, lastActivityAt: days(8) });
    const memberOld = await mk({ senderId: sender.id, lastActivityAt: days(31) });
    const repoOld = await p.contactThread.create({ data: { kind: 'repo', targetId: 'x', ownerUserId: owner.id, senderEmail: `c${seq}${MAIL}`, accessToken: `mm-r-${Date.now()}`, subject: 's', lastActivityAt: days(400) } });
    await autoArchive(p, { memberDirect: { autoArchiveDays: 30, autoArchiveAnonDays: 7 } });
    const st = async (t) => (await p.contactThread.findUnique({ where: { id: t.id } })).status;
    assert.equal(await st(anonOld), 'archived', 'anonymous, 8 days idle, 7-day clock');
    assert.equal(await st(anonNew), 'open');
    assert.equal(await st(memberMid), 'open', 'a member conversation is on the 30-day clock');
    assert.equal(await st(memberOld), 'archived');
    assert.equal(await st(repoOld), 'open', 'the member clock never touches a repo conversation');
  });

  test('the member switch refuses member conversations ONLY: repo and team contact keep working', async () => {
    await setConfig({ memberDirect: { enabled: false } });
    const owner = await mkUser(); const sender = await mkUser(); const cS = await cookieFor(sender); const cO = await cookieFor(owner);
    let r = await open(cS, owner.id);
    assert.equal(r.statusCode, 403); assert.equal(r.json().error, 'messaging_off_site');
    const repo = await p.serverRepo.create({ data: { name: 'MM repo', ownerId: owner.id, hosted: false, status: 'OFFLINE', repoUrl: 'https://example.org/r.json', contactEmail: `r${MAIL}` } });
    r = await open(cS, repo.id, 'repo');
    assert.equal(r.statusCode, 201, `repo contact with the member switch off: ${r.body}`);
    r = await as(cO, { method: 'POST', url: '/me/teams', payload: { name: `MM Team ${seq++}`, contactEmail: `team${MAIL}` } });
    assert.equal(r.statusCode, 201, r.body);
    const team = r.json().team;
    r = await open(cS, team.slug, 'team');
    assert.equal(r.statusCode, 201, `team contact with the member switch off: ${r.body}`);
    const tid = r.json().thread.id;
    r = await as(cO, { method: 'POST', url: `/me/threads/${tid}/messages`, payload: { body: 'the team answers' } });
    assert.equal(r.statusCode, 200, `a team reply with the member switch off: ${r.body}`);
  });

  test('sending is rate-limited (messagesPerHour was stored and never read)', async () => {
    await setConfig({ messagesPerHour: 2 });
    const owner = await mkUser(); const sender = await mkUser(); const cS = await cookieFor(sender);
    const r0 = await open(cS, owner.id);
    assert.equal(r0.statusCode, 201, r0.body);
    const id = r0.json().thread.id;
    // The opening message counts: one sent, one more allowed, the third refused.
    let r = await as(cS, { method: 'POST', url: `/me/threads/${id}/messages`, payload: { body: 'two' } });
    assert.equal(r.statusCode, 200, r.body);
    r = await as(cS, { method: 'POST', url: `/me/threads/${id}/messages`, payload: { body: 'three' } });
    assert.equal(r.statusCode, 429, 'the third message in the hour is refused');
    assert.equal(r.json().error, 'rate_limited');
  });

  test('opening conversations with members has its own tap; repo contact is not counted against it', async () => {
    await setConfig({ memberDirect: { openPerHour: 2 } });
    const sender = await mkUser(); const cS = await cookieFor(sender);
    for (let i = 0; i < 2; i += 1) assert.equal((await open(cS, (await mkUser()).id)).statusCode, 201);
    const r = await open(cS, (await mkUser()).id);
    assert.equal(r.statusCode, 429); assert.equal(r.json().scope, 'member');
    const owner = await mkUser();
    const repo = await p.serverRepo.create({ data: { name: 'MM repo 2', ownerId: owner.id, hosted: false, status: 'OFFLINE', repoUrl: 'https://example.org/r2.json', contactEmail: `r${MAIL}` } });
    assert.equal((await open(cS, repo.id, 'repo')).statusCode, 201, 'a repo conversation still opens');
  });

  test('an admin archives, reopens and deletes any conversation; a member cannot', async () => {
    await setConfig({});
    const admin = await mkUser({ role: 'SUPERADMIN', totpEnabled: true });
    const cA = await cookieFor(admin);
    const owner = await mkUser(); const sender = await mkUser(); const cS = await cookieFor(sender);
    const r0 = await open(cS, owner.id);
    const id = r0.json().thread.id;
    assert.equal((await as(cS, { method: 'DELETE', url: `/admin/threads/${id}` })).statusCode, 403);
    assert.equal((await as(cA, { method: 'POST', url: `/admin/threads/${id}/archive` })).statusCode, 200);
    assert.equal((await p.contactThread.findUnique({ where: { id } })).status, 'archived');
    assert.equal((await as(cA, { method: 'POST', url: `/admin/threads/${id}/reopen` })).statusCode, 200);
    assert.equal((await p.contactThread.findUnique({ where: { id } })).status, 'open');
    assert.equal((await as(cA, { method: 'DELETE', url: `/admin/threads/${id}` })).statusCode, 200);
    assert.equal(await p.contactThread.findUnique({ where: { id } }), null);
    assert.equal(await p.contactThreadMessage.count({ where: { threadId: id } }), 0, 'its messages went with it');
    assert.equal((await as(cA, { method: 'DELETE', url: `/admin/threads/${id}` })).statusCode, 404);
  });
});
