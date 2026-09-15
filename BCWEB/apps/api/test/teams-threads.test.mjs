// Teams and contact threads over HTTP, against a real database, with namespaced fixtures.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the teams/threads tests';
process.env.JWT_SECRET ||= 'teams-test-secret';

let p, app, argon2;
const MAIL = '@teams.test';
let seq = 0;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  argon2 = (await import('argon2')).default;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/auth.mjs')).default);
  await app.register((await import('../src/routes/teams.mjs')).default);
  await app.register((await import('../src/routes/threads.mjs')).default);
  await app.register((await import('../src/routes/repos.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await p.contactThread.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { ownerUserId: { in: ids } }, { senderEmail: { endsWith: MAIL } }] } });
    await p.serverRepo.deleteMany({ where: { ownerId: { in: ids } } });
    await p.team.deleteMany({ where: { ownerId: { in: ids } } });
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.auditLogEntry?.deleteMany?.({ where: { actorId: { in: ids } } }).catch(() => {});
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close();
  await p?.$disconnect?.();
});

const mkUser = async (over = {}) => p.user.create({ data: {
  email: `t${Date.now()}-${seq++}${MAIL}`, passwordHash: await argon2.hash('Passw0rd!teams', { type: argon2.argon2id }),
  displayName: `teams-${seq}`, emailVerified: true, status: 'active', ...over,
} });
async function login(email) {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Passw0rd!teams' } });
  assert.equal(r.statusCode, 200, `login ${email}: ${r.body}`);
  return [].concat(r.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ');
}
const as = (cookie, opts) => app.inject({ headers: { cookie }, ...opts });

describe('teams + contact threads', { skip }, () => {
  test('a team is created, a member invited by e-mail, accepts, and manages an attached repo', async () => {
    const owner = await mkUser(); const mate = await mkUser(); const stranger = await mkUser();
    const cO = await login(owner.email), cM = await login(mate.email), cS = await login(stranger.email);
    let r = await as(cO, { method: 'POST', url: '/me/teams', payload: { name: 'Night Shift', contactEmail: `team${MAIL}` } });
    assert.equal(r.statusCode, 201, r.body);
    const team = r.json().team;
    assert.equal(team.slug, 'night-shift');
    // invite by e-mail (case-insensitive), the invitee sees it as invited
    r = await as(cO, { method: 'POST', url: `/me/teams/${team.id}/members`, payload: { to: mate.email.toUpperCase() } });
    assert.equal(r.statusCode, 200, r.body);
    r = await as(cM, { method: 'GET', url: '/me/teams' });
    assert.equal(r.json().teams[0].myStatus, 'invited');
    // an invited member cannot manage yet
    r = await as(cM, { method: 'PATCH', url: `/me/teams/${team.id}`, payload: { description: 'nope' } });
    assert.equal(r.statusCode, 403);
    r = await as(cM, { method: 'POST', url: `/me/teams/${team.id}/accept` });
    assert.equal(r.statusCode, 200);
    // a repo owned by the owner, attached to the team: the member may edit it, a stranger may not
    const repo = await p.serverRepo.create({ data: { name: 'Team repo', ownerId: owner.id, hosted: false, status: 'OFFLINE', repoUrl: 'https://example.org/repo.json', contactEmail: `team${MAIL}` } });
    r = await as(cM, { method: 'PATCH', url: `/repos/${repo.id}`, payload: { description: 'before attach' } });
    assert.equal(r.statusCode, 403, 'not attached yet');
    r = await as(cO, { method: 'PUT', url: `/me/teams/${team.id}/attach`, payload: { kind: 'repo', id: repo.id } });
    assert.equal(r.statusCode, 200, r.body);
    r = await as(cM, { method: 'PATCH', url: `/repos/${repo.id}`, payload: { description: 'edited by a team member' } });
    assert.equal(r.statusCode, 200, r.body);
    r = await as(cS, { method: 'PATCH', url: `/repos/${repo.id}`, payload: { description: 'stranger' } });
    assert.equal(r.statusCode, 403);
    // a stranger cannot attach somebody else's repo to their own team
    r = await as(cS, { method: 'POST', url: '/me/teams', payload: { name: 'Thieves', contactEmail: `thieves${MAIL}` } });
    r = await as(cS, { method: 'PUT', url: `/me/teams/${r.json().team.id}/attach`, payload: { kind: 'repo', id: repo.id } });
    assert.equal(r.statusCode, 403);
    // public card
    r = await app.inject({ method: 'GET', url: `/teams/night-shift` });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().team.members.length, 2);
    assert.equal(r.json().team.contactEmail, `team${MAIL}`);
    // the public repo page names the team and the declared e-mail (external repo)
    r = await app.inject({ method: 'GET', url: `/r/${repo.id}` });
    assert.equal(r.statusCode, 404, 'unlisted, unverified: not public'); // listed && verified needed
  });

  test('an external repo needs a contact e-mail, a hosted one does not', async () => {
    const u = await mkUser({ emailVerified: true });
    const c = await login(u.email);
    // the creation gate may refuse for reasons unrelated to contact (creator id…): only assert the contact rule
    const r = await as(c, { method: 'POST', url: '/repos', payload: { name: 'External no mail', repoUrl: 'https://example.org/x/repo.json' } });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'contact_email_required');
  });

  test('a signed-in member contacts a repo owner; the owner answers; a stranger sees nothing; rate limits hold', async () => {
    const owner = await mkUser(); const sender = await mkUser(); const stranger = await mkUser();
    const cO = await login(owner.email), cS = await login(sender.email), cX = await login(stranger.email);
    const repo = await p.serverRepo.create({ data: { name: 'Contact me', ownerId: owner.id, hosted: true, status: 'ONLINE' } });
    let r = await as(cS, { method: 'POST', url: '/threads', payload: { kind: 'repo', targetId: repo.id, subject: 'A broken file', body: 'The zip for mod X fails its hash on my side, could you re-upload it?' } });
    assert.equal(r.statusCode, 201, r.body);
    const th = r.json().thread;
    assert.equal(th.ownerUser.id, owner.id);
    assert.equal(r.json().accessToken, undefined, 'a signed-in sender gets no anonymous token');
    // owner's inbox shows it unread; the owner answers; the sender's box shows it unread
    r = await as(cO, { method: 'GET', url: '/me/threads' });
    assert.equal(r.json().unread, 1);
    r = await as(cO, { method: 'POST', url: `/me/threads/${th.id}/messages`, payload: { body: 'Re-uploaded, thanks.' } });
    assert.equal(r.statusCode, 200, r.body);
    r = await as(cS, { method: 'GET', url: '/me/threads?box=sent' });
    assert.equal(r.json().unread, 1);
    r = await as(cS, { method: 'GET', url: `/me/threads/${th.id}` });
    assert.equal(r.json().thread.messages.length, 2);
    assert.equal(r.json().side, 'sender');
    // a stranger gets 404, not 403 — the thread's existence is not theirs to learn
    r = await as(cX, { method: 'GET', url: `/me/threads/${th.id}` });
    assert.equal(r.statusCode, 404);
    // you cannot contact yourself
    r = await as(cO, { method: 'POST', url: '/threads', payload: { kind: 'repo', targetId: repo.id, subject: 'me', body: 'talking to myself for a while now' } });
    assert.equal(r.statusCode, 400);
    // closing stops answers
    r = await as(cO, { method: 'POST', url: `/me/threads/${th.id}/close` });
    r = await as(cS, { method: 'POST', url: `/me/threads/${th.id}/messages`, payload: { body: 'one more' } });
    assert.equal(r.statusCode, 409);
    // the per-hour cap for accounts (6): five more openings pass, the seventh is refused
    for (let i = 0; i < 5; i++) {
      r = await as(cS, { method: 'POST', url: '/threads', payload: { kind: 'repo', targetId: repo.id, subject: `q${i}`, body: 'another question about the same repo here' } });
      assert.equal(r.statusCode, 201, `#${i}: ${r.body}`);
    }
    r = await as(cS, { method: 'POST', url: '/threads', payload: { kind: 'repo', targetId: repo.id, subject: 'q7', body: 'another question about the same repo here' } });
    assert.equal(r.statusCode, 429);
  });

  test('an anonymous sender needs PoW + an e-mail, and follows the thread by token', async () => {
    const owner = await mkUser();
    const repo = await p.serverRepo.create({ data: { name: 'Anon target', ownerId: owner.id, hosted: true, status: 'ONLINE' } });
    let r = await app.inject({ method: 'POST', url: '/threads', payload: { kind: 'repo', targetId: repo.id, subject: 'hi', body: 'a question from somebody without an account', email: `anon${MAIL}` } });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'pow_required');
    // solve the PoW the way the browser does
    const ch = (await app.inject({ method: 'GET', url: '/auth/pow' })).json();
    const { createHash } = await import('node:crypto');
    const bits = (hex) => { let n = 0; for (const c of hex) { const v = parseInt(c, 16); if (v === 0) { n += 4; continue; } n += Math.clz32(v) - 28; break; } return n; };
    let nonce = 0; while (bits(createHash('sha256').update(`${ch.challenge}:${nonce}`).digest('hex')) < (ch.difficulty || 18)) nonce++;
    r = await app.inject({ method: 'POST', url: '/threads', payload: { kind: 'repo', targetId: repo.id, subject: 'hi', body: 'a question from somebody without an account', email: `anon${MAIL}`, name: 'Anon', pow: { challenge: ch.challenge, nonce } } });
    assert.equal(r.statusCode, 201, r.body);
    const token = r.json().accessToken;
    assert.ok(token && token.length > 20);
    r = await app.inject({ method: 'GET', url: `/threads/t/${token}` });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().thread.anon, true);
    r = await app.inject({ method: 'POST', url: `/threads/t/${token}/messages`, payload: { body: 'and a follow-up' } });
    assert.equal(r.statusCode, 200, r.body);
    r = await app.inject({ method: 'GET', url: `/threads/t/${token}` });
    assert.equal(r.json().thread.messages.length, 2);
    r = await app.inject({ method: 'GET', url: `/threads/t/not-a-token` });
    assert.equal(r.statusCode, 404);
  });

  test('the admin routes refuse an anonymous caller', async () => {
    for (const url of ['/admin/threads', '/admin/threads/config']) {
      assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
    }
  });
});
