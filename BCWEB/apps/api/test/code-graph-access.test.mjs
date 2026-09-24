// Who may configure, refresh and read a project's CODE GRAPH (pentest round 2, card R4).
//
// The four keyed routes (`/admin/projects/:key/code-graph`, `…/snapshot`, `…/refresh`) and the
// saved-graph list were `requireEditor()` and nothing else — and requireEditor is "any account
// with 2FA on", the door the per-project grantees come through, which then asks canEditProject
// in the handler. These four never asked. So an editor of project A — or any account with 2FA —
// could, on project B:
//   · set B's webhook SECRET (a page secret wins over the environment's), then sign pushes;
//   · point `refresh` at a repository of their choice: B's PUBLIC code map is rebuilt from it,
//     source excerpts included, on B's own page;
//   · read B's stored snapshot and settings, whatever B's page visibility says;
//   · and, with the key `settings.<B>`, write a snapshot over B's settings row
//     (snapshotKey('settings.b') === settingsKey('b')).
// The door is now the page's own: canEditProject for an official project key, canEditShowcase
// for a showcase slug, 404 for anything that is neither.
//
// No network: `refresh` is sent a URL that is not a GitHub repository, so a request that gets
// past the door answers 502 not_a_github_repo from rebuildSnapshot before fetching anything.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the code-graph access test';
process.env.JWT_SECRET ||= 'code-graph-access-test-secret';

const STAMP = Date.now().toString(36);
const TAG = `cgacc-${STAMP}-`;
const KA = `cga${STAMP}a`;
const KB = `cga${STAMP}b`;
const SNAP = { graph: { nodes: [{ id: 'secret-path/internal.ts' }], links: [] }, url: 'https://github.com/owner/private', generatedAt: '2026-09-24T00:00:00Z' };

let p, app, seq = 0;
const A = {};
const F = {};

async function actor(name, data = {}) {
  const u = await p.user.create({ data: { email: `${TAG}${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true, emailVerified: true, ...data } });
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  A[name] = { id: u.id, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}` };
}
async function call(name, method, url, payload) {
  const res = await app.inject({ method, url, headers: { cookie: A[name].cookie }, ...(payload ? { payload } : {}) });
  let body = null; try { body = res.json(); } catch { /* not json */ }
  return { status: res.statusCode, body };
}
const setting = async (key) => (await p.adminSetting.findUnique({ where: { key } }))?.value ?? null;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  for (const k of [KA, KB]) {
    await p.project.create({ data: { key: k, name: `${TAG}${k}` } });
    await p.adminSetting.create({ data: { key: `project.${k}`, value: { tagline: 'x' } } });
    await p.adminSetting.create({ data: { key: `codegraph.settings.${k}`, value: { url: `https://github.com/owner/${k}`, secret: `real-secret-${k}` } } });
    await p.adminSetting.create({ data: { key: `codegraph.${k}`, value: SNAP } });
  }
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  const X = await p.showcaseProject.create({ data: { slug: `${TAG}x`, name: `${TAG}X`, short: 'SX', config: {} } });
  const Y = await p.showcaseProject.create({ data: { slug: `${TAG}y`, name: `${TAG}Y`, short: 'SY', config: {} } });
  F.X = X; F.Y = Y;
  await p.adminSetting.create({ data: { key: `codegraph.settings.${Y.slug}`, value: { url: 'https://github.com/owner/y', secret: 'real-secret-y' } } });

  await actor('editorA');        // edits project A only
  await actor('editorX');        // edits showcase X only
  await actor('plain');          // 2FA on, no grant at all
  await actor('ADMIN', { role: 'ADMIN' });
  await p.projectPermission.create({ data: { userId: A.editorA.id, projectKey: KA, rights: ['pages'], grantedBy: A.ADMIN.id } });
  await p.projectPermission.create({ data: { userId: A.editorX.id, showcaseProjectId: X.id, rights: ['pages'], grantedBy: A.ADMIN.id } });

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
    const keys = [KA, KB, F.X?.slug, F.Y?.slug, `settings.${KB}`].filter(Boolean);
    await p.adminSetting.deleteMany({ where: { key: { in: [...keys.map((k) => `codegraph.${k}`), ...keys.map((k) => `codegraph.settings.${k}`), `project.${KA}`, `project.${KB}`] } } });
    await p.project.deleteMany({ where: { key: { in: [KA, KB] } } });
    await p.showcaseProject.deleteMany({ where: { slug: { startsWith: TAG } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: none } } });
    await p.user.deleteMany({ where: { id: { in: none } } });
  } finally { await app?.close(); }
});

describe('code graph: the page door, not any 2FA account', { skip }, () => {
  test('an editor of A, and an account with no grant, cannot touch B', async () => {
    const before = JSON.stringify([await setting(`codegraph.settings.${KB}`), await setting(`codegraph.${KB}`)]);
    for (const who of ['editorA', 'plain', 'editorX']) {
      const put = await call(who, 'PUT', `/admin/projects/${KB}/code-graph`, { url: 'https://github.com/attacker/repo', secret: 'attacker-secret' });
      assert.equal(put.status, 403, `${who} set B's webhook secret: ${JSON.stringify(put.body)}`);
      const refresh = await call(who, 'POST', `/admin/projects/${KB}/code-graph/refresh`, { url: 'not-a-repo' });
      assert.equal(refresh.status, 403, `${who} got past the refresh door of B: ${refresh.status} ${JSON.stringify(refresh.body)}`);
      const get = await call(who, 'GET', `/admin/projects/${KB}/code-graph`);
      assert.equal(get.status, 403, `${who} read B's code-graph settings`);
      const snap = await call(who, 'GET', `/admin/projects/${KB}/code-graph/snapshot`);
      assert.equal(snap.status, 403, `${who} read B's stored graph: ${JSON.stringify(snap.body)?.slice(0, 80)}`);
    }
    assert.equal(JSON.stringify([await setting(`codegraph.settings.${KB}`), await setting(`codegraph.${KB}`)]), before, 'B changed');
  });

  test('a showcase page is guarded by ITS editors', async () => {
    const put = await call('editorA', 'PUT', `/admin/projects/${F.Y.slug}/code-graph`, { secret: 'attacker-secret' });
    assert.equal(put.status, 403);
    assert.equal((await setting(`codegraph.settings.${F.Y.slug}`)).secret, 'real-secret-y');
    const own = await call('editorX', 'PUT', `/admin/projects/${F.X.slug}/code-graph`, { url: 'https://github.com/owner/x' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
  });

  test('a key that is neither a project nor a showcase page is not a code graph', async () => {
    // snapshotKey('settings.<B>') is B's SETTINGS row: a refresh there overwrote B's secret.
    const r = await call('ADMIN', 'POST', `/admin/projects/settings.${KB}/code-graph/refresh`, { url: 'not-a-repo' });
    assert.equal(r.status, 404, JSON.stringify(r.body));
    const w = await call('ADMIN', 'PUT', `/admin/projects/zz-${STAMP}-nothing/code-graph`, { secret: 'x' });
    assert.equal(w.status, 404);
    assert.equal(await setting(`codegraph.settings.zz-${STAMP}-nothing`), null);
  });

  test('the saved-graph list shows only the graphs the reader may edit', async () => {
    const mine = (await call('editorA', 'GET', '/admin/projects/code-graphs')).body.items.map((i) => i.key);
    assert.ok(mine.includes(KA), 'the editor of A does not see A');
    assert.ok(!mine.includes(KB), 'the editor of A sees B');
    const all = (await call('ADMIN', 'GET', '/admin/projects/code-graphs')).body.items.map((i) => i.key);
    assert.ok(all.includes(KA) && all.includes(KB), 'an admin lost a graph');
  });

  test('controls: the editor of A still runs A, an admin runs B', async () => {
    assert.equal((await call('editorA', 'PUT', `/admin/projects/${KA}/code-graph`, { url: 'https://github.com/owner/a2' })).status, 200);
    assert.equal((await call('editorA', 'GET', `/admin/projects/${KA}/code-graph/snapshot`)).status, 200);
    const r = await call('editorA', 'POST', `/admin/projects/${KA}/code-graph/refresh`, { url: 'not-a-repo' });
    assert.equal(r.status, 502, `the door of A refused its editor: ${JSON.stringify(r.body)}`);
    assert.equal((await call('ADMIN', 'GET', `/admin/projects/${KB}/code-graph`)).status, 200);
  });
});
