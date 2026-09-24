// A project's save history must not hand studio DRAFTS to somebody without the studio right
// (pentest round 2, card R4).
//
// Reading a config's unpublished studio pages is part of the studio right: draftReader (lib.mjs)
// gives them to exactly who could open them in the studio, and `GET /admin/projects/:key/
// versions/:version` strips them for everybody else. `GET /admin/projects/:key/history` returns
// every saved config IN FULL and asked only canEditProject — the `pages` right — so a grantee
// who may edit the page's words, and nothing more, read every draft drawn on it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the history-drafts test';
process.env.JWT_SECRET ||= 'history-drafts-test-secret';

const STAMP = Date.now().toString(36);
const TAG = `hisdr-${STAMP}-`;
const KA = `hdr${STAMP}a`;
const CONFIG = {
  tagline: 'x', studioEnabled: true,
  canvases: [
    { id: 'p1', title: 'Published', blocks: [{ id: 'b1', kind: 'text', x: 0, y: 0, w: 100, h: 40, props: { md: 'hi' } }] },
    { id: 'p2', title: 'Secret draft', blocks: [] },
  ],
};

let p, app, seq = 0;
const A = {};

async function actor(name, rights, data = {}) {
  const u = await p.user.create({ data: { email: `${TAG}${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true, emailVerified: true, ...data } });
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  if (rights) await p.projectPermission.create({ data: { userId: u.id, projectKey: KA, rights, grantedBy: u.id } });
  A[name] = `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const pageIds = async (name) => {
  const r = await app.inject({ method: 'GET', url: `/admin/projects/${KA}/history`, headers: { cookie: A[name] } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().revisions.map((x) => (x.config.canvases || []).map((c) => c.id).join(','));
};

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  await p.project.create({ data: { key: KA, name: `${TAG}${KA}` } });
  await p.adminSetting.create({ data: { key: `project.${KA}`, value: CONFIG } });
  await p.projectConfigRevision.create({ data: { target: KA, config: CONFIG } });
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  await actor('pagesOnly', ['pages']);
  await actor('pagesAndStudio', ['pages', 'studio']);
  await actor('ADMIN', null, { role: 'ADMIN' });
  const Fastify = (await import('fastify')).default;
  app = Fastify({ logger: false });
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/projects.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    const ids = (await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    const none = ids.length ? ids : ['-'];
    await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
    await p.projectConfigRevision.deleteMany({ where: { target: KA } });
    await p.adminSetting.deleteMany({ where: { key: `project.${KA}` } });
    await p.project.deleteMany({ where: { key: KA } });
    await p.session.deleteMany({ where: { userId: { in: none } } });
    await p.user.deleteMany({ where: { id: { in: none } } });
  } finally { await app?.close(); }
});

describe('project history and studio drafts', { skip }, () => {
  test('the page right reads the history without the drafts', async () => {
    assert.deepEqual(await pageIds('pagesOnly'), ['p1']);
  });
  test('controls: the studio right and an admin still read the drafts', async () => {
    assert.deepEqual(await pageIds('pagesAndStudio'), ['p1,p2']);
    assert.deepEqual(await pageIds('ADMIN'), ['p1,p2']);
  });
});
