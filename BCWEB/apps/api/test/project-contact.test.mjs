// A project's own contact inbox: topics, the on/off switch, and WHO reads it, through the
// per-project permission system (ProjectPermission, scoped CustomRole, a listed account).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the project contact tests';
process.env.JWT_SECRET ||= 'project-contact-secret';

let p, app, jwt;
const MAIL = '@pc.test';
const stamp = `${Date.now()}`;
let seq = 0;
let show, priv, role;

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  const threadsMod = await import('../src/routes/threads.mjs');
  // Generous limits and the member switch on, in THIS process only: what the user's dev
  // database has stored, or another test file set, must not decide this file's results.
  threadsMod.setThreadsConfigOverride({ userPerHour: 1000, userPerDay: 1000, anonPerHour: 1000, anonPerDay: 1000, messagesPerHour: 1000, memberDirect: { enabled: true, openPerHour: 0, openPerDay: 0 } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/threads.mjs')).default);
  await app.register((await import('../src/routes/project-contact.mjs')).default);
  await app.ready();
  show = await p.showcaseProject.create({ data: { slug: `pc-test-${stamp}`, name: 'PC Test Project', short: 'PCT' } });
  priv = await p.showcaseProject.create({ data: { slug: `pc-priv-${stamp}`, name: 'PC Private', short: 'PCP', visibility: 'private' } });
});

after(async () => {
  if (!RUN) return;
  const refs = [`sc:${show?.slug}`, `sc:${priv?.slug}`];
  const threads = await p.contactThread.findMany({ where: { kind: 'project', targetId: { in: refs } }, select: { id: true } });
  await p.conversationCursor.deleteMany({ where: { conversationId: { in: threads.map((t) => t.id) } } });
  await p.contactThread.deleteMany({ where: { kind: 'project', targetId: { in: refs } } });
  await p.projectContactSettings.deleteMany({ where: { ref: { in: refs } } });
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await p.projectPermission.deleteMany({ where: { userId: { in: ids } } });
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.auditLogEntry?.deleteMany?.({ where: { actorId: { in: ids } } }).catch(() => {});
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (role) await p.customRole.delete({ where: { id: role.id } }).catch(() => {});
  if (show) await p.showcaseProject.delete({ where: { id: show.id } }).catch(() => {});
  if (priv) await p.showcaseProject.delete({ where: { id: priv.id } }).catch(() => {});
  await app?.close();
});

const mkUser = (over = {}) => p.user.create({ data: { email: `u${stamp}-${seq++}${MAIL}`, displayName: `pc-${stamp}-${seq}`, emailVerified: true, status: 'active', ...over } });
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const as = (cookie, opts) => app.inject({ headers: cookie ? { cookie } : {}, ...opts });
const open = (cookie, ref, topic) => as(cookie, { method: 'POST', url: '/threads', payload: { kind: 'project', targetId: ref, topic, subject: 'A project question', body: 'Something about the project itself.' } });

describe('custom topics are cleaned', () => {
  test('ids are slugs, never a basic id, never twice, and capped', async () => {
    // Imported here, not at the top: lib.mjs reads JWT_SECRET when it loads, and a static
    // import would load it before this file sets the secret.
    const { cleanCustomTopics, BASIC_TOPICS } = await import('../src/lib/project-contact.mjs');
    const got = cleanCustomTopics([{ label: 'Accès serveur' }, { label: 'Bug' }, { label: 'accès serveur' }, { label: '' }, ...Array.from({ length: 20 }, (_, i) => ({ label: `T${i}` }))]);
    assert.equal(got[0].id, 'acces-serveur');
    assert.equal(got[1].id, 'c-bug', 'a custom topic cannot take a basic id');
    assert.ok(!got.slice(2).some((x) => x.id === 'acces-serveur'));
    assert.equal(got.length, 12);
    assert.ok(BASIC_TOPICS.includes('translation'));
  });
});

describe('project contact over HTTP', { skip }, () => {
  test('a visitor sees the topics; a member writes to the project; its editor answers; a stranger cannot read', async () => {
    const ref = `sc:${show.slug}`;
    let r = await as(null, { method: 'GET', url: `/projects-contact/${ref}` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().enabled, true);
    assert.deepEqual(r.json().topics.map((x) => x.id), ['question', 'bug', 'translation', 'suggestion', 'other']);
    assert.equal(r.json().canReadInbox, false);

    const sender = await mkUser(); const editor = await mkUser(); const stranger = await mkUser();
    const cS = await cookieFor(sender); const cE = await cookieFor(editor); const cX = await cookieFor(stranger);
    await p.projectPermission.create({ data: { userId: editor.id, showcaseProjectId: show.id, grantedBy: editor.id } });
    assert.equal((await open(cS, ref, 'nope')).statusCode, 400, 'a topic the project does not offer');
    r = await open(cS, ref, 'translation');
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().thread.id;
    assert.equal(r.json().thread.topic, 'translation');
    // The editor has it in their ordinary inbox and answers it.
    r = await as(cE, { method: 'GET', url: '/me/threads' });
    assert.ok(r.json().threads.some((t) => t.id === id), 'the editor sees the project conversation in their inbox');
    assert.equal((await as(cE, { method: 'GET', url: `/projects-contact/${ref}` })).json().canReadInbox, true);
    r = await as(cE, { method: 'POST', url: `/me/threads/${id}/messages`, payload: { body: 'The project answers.' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await as(cX, { method: 'GET', url: `/me/threads/${id}` })).statusCode, 404, 'a stranger cannot read it');
    assert.ok(!(await as(cX, { method: 'GET', url: '/me/threads' })).json().threads.some((t) => t.id === id));

    // A manager switches editors out of the inbox: the editor loses it, and cannot put it back.
    const admin = await mkUser({ role: 'SUPERADMIN', totpEnabled: true }); const cA = await cookieFor(admin);
    r = await as(cA, { method: 'PUT', url: `/projects-contact/${ref}/settings`, payload: { editorsSeeInbox: false } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await as(cE, { method: 'GET', url: `/me/threads/${id}` })).statusCode, 404, 'editors switched out of this inbox');
    assert.ok(!(await as(cE, { method: 'GET', url: '/me/threads' })).json().threads.some((t) => t.id === id));
    r = await as(cE, { method: 'PUT', url: `/projects-contact/${ref}/settings`, payload: { editorsSeeInbox: true } });
    assert.equal(r.statusCode, 403); assert.equal(r.json().error, 'access_is_managers_only');
    // …but may still change the topics, which is content, not access.
    r = await as(cE, { method: 'PUT', url: `/projects-contact/${ref}/settings`, payload: { customTopics: [{ label: 'Server access', labelFr: 'Accès serveur' }] } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await open(cS, ref, 'server-access')).statusCode, 201, 'a custom topic can be picked');

    // A listed account reads it without being an editor.
    r = await as(cA, { method: 'PUT', url: `/projects-contact/${ref}/settings`, payload: { inboxUsers: [stranger.email] } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await as(cX, { method: 'GET', url: `/me/threads/${id}` })).statusCode, 200, 'a listed account reads the inbox');
  });

  test('a scoped role with the inbox right opens the inbox, without any edit grant', async () => {
    const ref = `sc:${show.slug}`;
    role = await p.customRole.create({ data: { name: `pc-inbox-${stamp}`, capabilities: [], scope: { showcaseIds: [show.id], rights: ['inbox'] }, createdBy: 'test' } });
    const holder = await mkUser({ customRoleIds: [role.id] }); const cH = await cookieFor(holder);
    const sender = await mkUser(); const cS = await cookieFor(sender);
    const id = (await open(cS, ref, 'question')).json().thread.id;
    assert.equal((await as(cH, { method: 'GET', url: `/me/threads/${id}` })).statusCode, 200);
    assert.ok((await as(cH, { method: 'GET', url: '/me/threads' })).json().threads.some((t) => t.id === id));
  });

  test('a closed inbox refuses, and a private project cannot be contacted at all', async () => {
    const ref = `sc:${show.slug}`;
    const admin = await mkUser({ role: 'SUPERADMIN', totpEnabled: true }); const cA = await cookieFor(admin);
    assert.equal((await as(cA, { method: 'PUT', url: `/projects-contact/${ref}/settings`, payload: { enabled: false } })).statusCode, 200);
    const cS = await cookieFor(await mkUser());
    const r = await open(cS, ref, 'question');
    assert.equal(r.statusCode, 403); assert.equal(r.json().error, 'project_contact_off');
    assert.equal((await open(cS, `sc:${priv.slug}`, 'question')).statusCode, 404);
    assert.equal((await as(null, { method: 'GET', url: `/projects-contact/sc:${priv.slug}` })).statusCode, 404);
    assert.equal((await as(cA, { method: 'PUT', url: `/projects-contact/${ref}/settings`, payload: { enabled: true, basicTopics: [], customTopics: [] } })).statusCode, 400, 'an open inbox needs a topic');
  });
});
