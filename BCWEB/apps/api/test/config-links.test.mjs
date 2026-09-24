// A page config may not carry a link that runs script (pentest round 2, card R10).
//
// The project page puts the config's legal cards, downloads, social links and buttons straight
// into `<a href>`; React 18 lets `javascript:` through and the CSP allows inline script. A
// per-project grantee — not staff — writes that config. See lib/config-links.mjs.
//
// PURE half: the checker. HTTP half (needs DATABASE_URL): every door a config goes through.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { configLinkProblems, isScriptUrl } from '../src/lib/config-links.mjs';

describe('configLinkProblems (pure)', () => {
  test('the spellings a browser still runs are all refused', () => {
    for (const v of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', '\u0001javascript:x', 'vbscript:msgbox(1)']) {
      assert.equal(isScriptUrl(v), true, JSON.stringify(v));
    }
  });
  test('controls: links that are links, and prose that merely mentions JavaScript', () => {
    for (const v of ['https://x.org', 'http://x', 'mailto:a@b.c', '/relative', '#anchor', 'steam://run/1', 'data:image/png;base64,AA']) {
      assert.equal(isScriptUrl(v), false, v);
    }
    assert.deepEqual(configLinkProblems({ description: 'JavaScript: 60% of the code', legal: [{ title: 'javascript: the terms', url: 'https://x' }] }), []);
  });
  test('found wherever a link lives, with its path', () => {
    const got = configLinkProblems({
      legal: [{ title: 'Privacy', url: 'javascript:1' }],
      links: { github: 'javascript:2' },
      downloads: [{ label: 'Win', url: 'javascript:3' }],
      button: { url: 'javascript:4' },
      community: { url: 'javascript:5' },
      milestones: [{ title: 'm', url: 'javascript:6' }],
      redeemUrl: 'javascript:7',
    }).map((x) => x.path);
    assert.deepEqual(got, ['legal[0].url', 'links.github', 'downloads[0].url', 'button.url', 'community.url', 'milestones[0].url', 'redeemUrl']);
  });
});

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the config-links doors';
process.env.JWT_SECRET ||= 'config-links-test-secret';
const STAMP = Date.now().toString(36);
const TAG = `cfgln-${STAMP}-`;
const KA = `cfl${STAMP}a`;
const BAD = { tagline: 'x', legal: [{ title: 'Privacy policy', url: 'javascript:fetch(`/api/admin/users`)' }] };
const GOOD = { tagline: 'x', legal: [{ title: 'Privacy policy', url: 'https://example.org/privacy' }] };

let p, app, seq = 0;
const A = {};
const F = {};
async function actor(name, data = {}) {
  const u = await p.user.create({ data: { email: `${TAG}${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true, emailVerified: true, ...data } });
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  A[name] = { id: u.id, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}` };
}
const call = async (name, method, url, payload) => {
  const r = await app.inject({ method, url, headers: { cookie: A[name].cookie }, payload });
  let body = null; try { body = r.json(); } catch { /* */ }
  return { status: r.statusCode, body };
};

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  await p.project.create({ data: { key: KA, name: `${TAG}${KA}` } });
  await p.adminSetting.create({ data: { key: `project.${KA}`, value: GOOD } });
  await p.projectVersion.create({ data: { target: KA, version: '1.0.0', config: GOOD } });
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  F.X = await p.showcaseProject.create({ data: { slug: `${TAG}x`, name: `${TAG}X`, short: 'SX', config: GOOD } });
  await actor('ADMIN', { role: 'ADMIN' });
  await actor('editorA');
  await actor('editorX');
  await p.projectPermission.create({ data: { userId: A.editorA.id, projectKey: KA, rights: ['pages'], grantedBy: A.ADMIN.id } });
  await p.projectPermission.create({ data: { userId: A.editorX.id, showcaseProjectId: F.X.id, rights: ['pages'], grantedBy: A.ADMIN.id } });
  const Fastify = (await import('fastify')).default;
  app = Fastify({ logger: false });
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/projects.mjs')).default);
  await app.register((await import('../src/routes/showcase.mjs')).default);
  await app.ready();
});
after(async () => {
  if (!RUN) return;
  try {
    const ids = (await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    const none = ids.length ? ids : ['-'];
    await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
    await p.projectConfigRevision.deleteMany({ where: { target: KA } });
    await p.projectVersion.deleteMany({ where: { target: { in: [KA, `sc:${F.X?.id}`] } } });
    await p.adminSetting.deleteMany({ where: { key: `project.${KA}` } });
    await p.project.deleteMany({ where: { key: KA } });
    await p.showcaseProject.deleteMany({ where: { slug: { startsWith: TAG } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: none } } });
    await p.user.deleteMany({ where: { id: { in: none } } });
  } finally { await app?.close(); }
});

describe('config links over HTTP', { skip }, () => {
  test('a project grantee cannot store a script link on the page', async () => {
    const r = await call('editorA', 'PUT', `/projects/${KA}`, { config: BAD });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.error, 'unsafe_link');
    assert.equal((await p.adminSetting.findUnique({ where: { key: `project.${KA}` } })).value.legal[0].url, GOOD.legal[0].url);
  });
  test('nor through a stored version, nor a staged swap, nor the showcase copy', async () => {
    assert.equal((await call('editorA', 'PUT', `/admin/projects/${KA}/versions/1.0.0`, { config: BAD })).status, 400);
    assert.equal((await call('ADMIN', 'PUT', `/admin/projects/${KA}/schedule`, { at: new Date(Date.now() + 86_400_000).toISOString(), next: { config: BAD } })).status, 400);
    assert.equal((await call('editorX', 'PUT', `/admin/showcase/${F.X.id}`, { config: BAD })).status, 400);
    assert.equal((await call('ADMIN', 'PUT', `/admin/showcase/${F.X.id}`, { announceButtonUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await call('ADMIN', 'PUT', `/admin/showcase/${F.X.id}/schedule`, { at: new Date(Date.now() + 86_400_000).toISOString(), next: { config: BAD } })).status, 400);
    const v = await p.projectVersion.findUnique({ where: { target_version: { target: KA, version: '1.0.0' } } });
    assert.equal(v.config.legal[0].url, GOOD.legal[0].url);
    assert.equal((await p.showcaseProject.findUnique({ where: { id: F.X.id } })).config.legal[0].url, GOOD.legal[0].url);
  });
  test('controls: an http(s) link saves', async () => {
    const r = await call('editorA', 'PUT', `/projects/${KA}`, { config: { ...GOOD, tagline: 'y' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await call('editorX', 'PUT', `/admin/showcase/${F.X.id}`, { config: { ...GOOD, tagline: 'y' } })).status, 200);
  });
});
