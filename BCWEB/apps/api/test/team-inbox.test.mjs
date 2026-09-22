// A team's contact inbox: which roles answer it, who the sender is, how many conversations it
// keeps open, files on a pool of the team's own, and archiving / deleting.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the team inbox tests';
process.env.JWT_SECRET ||= 'team-inbox-secret';
process.env.POW_BITS = '1';

let p, app, jwt, files;
const MAIL = '@ti.test';
const stamp = `${Date.now()}`;
let seq = 0;
const objects = new Map(); // the object store, in memory: storage is not the database under test

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  files = await import('../src/lib/thread-files.mjs');
  const threadsMod = await import('../src/routes/threads.mjs');
  // Generous limits and the member switch on, in THIS process only: what the user's dev
  // database has stored, or another test file set, must not decide this file's results.
  threadsMod.setThreadsConfigOverride({ userPerHour: 1000, userPerDay: 1000, anonPerHour: 1000, anonPerDay: 1000, messagesPerHour: 1000, memberDirect: { enabled: true, openPerHour: 0, openPerDay: 0 } });
  files.setThreadFileStore({
    put: async (k, b) => { objects.set(k, Buffer.from(b)); },
    get: async (k) => (objects.has(k) ? { body: objects.get(k), contentType: 'application/octet-stream', length: objects.get(k).length } : null),
    del: async (k) => { objects.delete(k); },
  });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/auth.mjs')).default);
  await app.register((await import('../src/routes/teams.mjs')).default);
  await app.register((await import('../src/routes/threads.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  files?.setThreadFileStore(null);
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const teams = await p.team.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
  const teamIds = teams.map((t) => t.id);
  const threads = await p.contactThread.findMany({ where: { OR: [{ ownerTeamId: { in: teamIds } }, { senderId: { in: ids } }, { senderEmail: { endsWith: MAIL } }] }, select: { id: true } });
  await p.conversationCursor.deleteMany({ where: { conversationId: { in: threads.map((t) => t.id) } } });
  await p.contactThread.deleteMany({ where: { id: { in: threads.map((t) => t.id) } } });
  await p.entityHostingSettings.deleteMany({ where: { kind: 'team-contact', ref: { in: teamIds } } });
  await p.teamContactSettings.deleteMany({ where: { teamId: { in: teamIds } } });
  await p.hostingGroup.deleteMany({ where: { ownerId: { in: ids } } });
  await p.team.deleteMany({ where: { id: { in: teamIds } } });
  await p.notification.deleteMany({ where: { userId: { in: ids } } });
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.auditLogEntry?.deleteMany?.({ where: { actorId: { in: ids } } }).catch(() => {});
  await p.user.deleteMany({ where: { id: { in: ids } } });
  await app?.close();
});

const mkUser = (over = {}) => p.user.create({ data: { email: `u${stamp}-${seq++}${MAIL}`, displayName: `ti-${stamp}-${seq}`, emailVerified: true, status: 'active', ...over } });
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const as = (cookie, opts) => app.inject({ headers: cookie ? { cookie } : {}, ...opts });
async function pow() {
  const { challenge, difficulty } = (await app.inject({ method: 'GET', url: '/auth/pow' })).json();
  for (let nonce = 0; ; nonce += 1) {
    const h = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
    let bits = 0; for (const b of h) { if (b === 0) { bits += 8; continue; } bits += Math.clz32(b) - 24; break; }
    if (bits >= difficulty) return { challenge, nonce };
  }
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

/** A team with an owner, an admin and a member, all active. */
async function mkTeam() {
  const owner = await mkUser(); const admin = await mkUser(); const member = await mkUser();
  const team = await p.team.create({ data: { slug: `ti-${stamp}-${seq++}`, name: `TI ${seq}`, contactEmail: `t${MAIL}`, ownerId: owner.id } });
  for (const [u, role] of [[owner, 'owner'], [admin, 'admin'], [member, 'member']]) await p.teamMember.create({ data: { teamId: team.id, userId: u.id, role, status: 'active' } });
  return { team, owner, admin, member, cO: await cookieFor(owner), cA: await cookieFor(admin), cM: await cookieFor(member) };
}
const openTo = (cookie, team, extra = {}) => as(cookie, { method: 'POST', url: '/threads', payload: { kind: 'team', targetId: team.slug, subject: 'For the team', body: 'A message for the whole team.', ...extra } });

describe('team inbox', { skip }, () => {
  test('the team chooses which roles answer: a plain member loses the inbox, an admin keeps it', async () => {
    const T = await mkTeam();
    const cS = await cookieFor(await mkUser());
    const id = (await openTo(cS, T.team)).json().thread.id;
    assert.equal((await as(T.cM, { method: 'GET', url: `/me/threads/${id}` })).statusCode, 200, 'by default every member answers');
    assert.equal((await as(T.cM, { method: 'PUT', url: `/me/teams/${T.team.id}/contact`, payload: { answerRoles: ['admin'] } })).statusCode, 403, 'only owner/admin change it');
    assert.equal((await as(T.cO, { method: 'PUT', url: `/me/teams/${T.team.id}/contact`, payload: { answerRoles: ['admin'] } })).statusCode, 200);
    assert.equal((await as(T.cM, { method: 'GET', url: `/me/threads/${id}` })).statusCode, 404);
    assert.ok(!(await as(T.cM, { method: 'GET', url: '/me/threads' })).json().threads.some((t) => t.id === id));
    assert.equal((await as(T.cM, { method: 'GET', url: `/me/teams/${T.team.id}/threads` })).statusCode, 403);
    const r = await as(T.cA, { method: 'POST', url: `/me/threads/${id}/messages`, payload: { body: 'The admin answers.' } });
    assert.equal(r.statusCode, 200, r.body);
    const settings = (await as(T.cO, { method: 'GET', url: `/me/teams/${T.team.id}/contact` })).json();
    assert.deepEqual(settings.answerRoles.sort(), ['admin', 'owner'], 'the owner always answers');
  });

  test('the answering side sees who wrote: a member as a person, an anonymous sender as what they gave', async () => {
    const T = await mkTeam();
    const sender = await mkUser();
    const id = (await openTo(await cookieFor(sender), T.team)).json().thread.id;
    const th = (await as(T.cO, { method: 'GET', url: `/me/threads/${id}` })).json().thread;
    assert.equal(th.sender.displayName, sender.displayName);
    assert.ok(th.sender.bcId, 'BC id shown'); assert.equal(th.sender.profile, `/u/${sender.id}`);
    assert.ok(!('email' in th.sender), 'never the account e-mail');
    const email = `anon${seq}${MAIL}`;
    const r = await openTo(null, T.team, { email, name: 'Ana Nonymous', pow: await pow() });
    assert.equal(r.statusCode, 201, r.body);
    const anon = (await as(T.cO, { method: 'GET', url: `/me/threads/${r.json().thread.id}` })).json().thread;
    assert.equal(anon.senderEmail, email, 'the address the sender typed, which the form said the team would see');
    assert.equal(anon.senderName, 'Ana Nonymous');
  });

  test('a team caps its open conversations, separately for anonymous senders and members', async () => {
    const T = await mkTeam();
    await as(T.cO, { method: 'PUT', url: `/me/teams/${T.team.id}/contact`, payload: { maxOpenAnon: 1, maxOpenMembers: 0 } });
    assert.equal((await openTo(null, T.team, { email: `a1${seq}${MAIL}`, pow: await pow() })).statusCode, 201);
    const full = await openTo(null, T.team, { email: `a2${seq}${MAIL}`, pow: await pow() });
    assert.equal(full.statusCode, 429); assert.equal(full.json().error, 'team_inbox_full');
    assert.equal((await openTo(await cookieFor(await mkUser()), T.team)).statusCode, 201, 'members are not capped');
  });

  test('files: refused without a pool, accepted on the team pool, counted against it, downloaded as an attachment', async () => {
    const T = await mkTeam();
    await as(T.cO, { method: 'PUT', url: `/me/teams/${T.team.id}/contact`, payload: { attachments: 'pool_only' } });
    const cS = await cookieFor(await mkUser());
    const id = (await openTo(cS, T.team)).json().thread.id;
    const withFile = (data = PNG) => as(cS, { method: 'POST', url: `/me/threads/${id}/messages`, payload: { body: 'see file', files: [{ name: 'shot.png', type: 'image/png', data: data.toString('base64') }] } });
    let r = await withFile();
    assert.equal(r.statusCode, 400); assert.equal(r.json().error, 'attachments_need_pool');
    // Somebody else's pool is not the team's to spend.
    const stranger = await mkUser();
    const foreign = await p.hostingGroup.create({ data: { ownerId: stranger.id, name: 'not yours', poolBytes: 5n * 1048576n } });
    r = await as(T.cO, { method: 'PUT', url: `/me/teams/${T.team.id}/contact`, payload: { storage: { mode: 'pool', poolId: foreign.id, quotaMB: 1 } } });
    assert.equal(r.statusCode, 403);
    const pool = await p.hostingGroup.create({ data: { ownerId: T.owner.id, teamId: T.team.id, name: 'team pool', poolBytes: 5n * 1048576n } });
    r = await as(T.cO, { method: 'PUT', url: `/me/teams/${T.team.id}/contact`, payload: { storage: { mode: 'pool', poolId: pool.id, quotaMB: 1 } } });
    assert.equal(r.statusCode, 200, r.body);
    r = await withFile();
    assert.equal(r.statusCode, 200, r.body);
    const f = r.json().message.files[0];
    assert.equal(f.name, 'shot.png'); assert.ok(!('key' in f), 'the storage key never leaves the server');
    const dl = await as(T.cO, { method: 'GET', url: `/me/threads/${id}/files/${f.id}` });
    assert.equal(dl.statusCode, 200);
    assert.match(dl.headers['content-disposition'], /^attachment;/); assert.equal(dl.headers['x-content-type-options'], 'nosniff');
    assert.equal(Buffer.compare(dl.rawPayload, PNG), 0);
    assert.equal((await as(await cookieFor(await mkUser()), { method: 'GET', url: `/me/threads/${id}/files/${f.id}` })).statusCode, 404, 'a stranger cannot fetch it');
    r = await withFile(Buffer.alloc(1048576, 1));
    assert.equal(r.statusCode, 413); assert.equal(r.json().error, 'storage_full', 'the reservation is full');
    r = await as(cS, { method: 'POST', url: `/me/threads/${id}/messages`, payload: { body: 'x', files: [{ name: 'a.html', type: 'text/html', data: 'PGI+' }] } });
    assert.equal(r.statusCode, 415, 'no HTML');
  });

  test('archive in bulk (answerers), delete (owner / admin), and the files go with it', async () => {
    const T = await mkTeam();
    await as(T.cO, { method: 'PUT', url: `/me/teams/${T.team.id}/contact`, payload: { attachments: 'pool_only' } });
    const pool = await p.hostingGroup.create({ data: { ownerId: T.owner.id, teamId: T.team.id, name: 'team pool 2', poolBytes: 5n * 1048576n } });
    await as(T.cO, { method: 'PUT', url: `/me/teams/${T.team.id}/contact`, payload: { storage: { mode: 'pool', poolId: pool.id, quotaMB: 2 } } });
    const cS = await cookieFor(await mkUser());
    const a = (await openTo(cS, T.team, { files: [{ name: 'x.png', type: 'image/png', data: PNG.toString('base64') }] })).json().thread;
    const b = (await openTo(cS, T.team)).json().thread;
    assert.equal(a.messages[0].files.length, 1, 'a file on the opening message');
    const before = objects.size;
    let r = await as(T.cM, { method: 'POST', url: `/me/teams/${T.team.id}/threads/archive`, payload: { ids: [a.id, b.id] } });
    assert.equal(r.json().count, 2);
    assert.equal((await as(T.cM, { method: 'GET', url: `/me/teams/${T.team.id}/threads?status=archived` })).json().threads.length, 2);
    assert.equal((await as(T.cM, { method: 'DELETE', url: `/me/teams/${T.team.id}/threads/${a.id}` })).statusCode, 403);
    r = await as(T.cA, { method: 'DELETE', url: `/me/teams/${T.team.id}/threads/${a.id}` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(await p.contactThread.findUnique({ where: { id: a.id } }), null);
    assert.equal(objects.size, before - 1, 'its stored file was deleted');
  });
});
