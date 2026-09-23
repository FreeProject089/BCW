// Who may OPEN and SAVE a studio page, over HTTP — and what a save may carry.
//
// PLAN-STUDIO-2026 section 1.5: the studio loaded a project's config through the PUBLIC
// `GET /projects/:key`, so the holder of a permission on project A opened `/studio/project/b`
// and edited B's page; only the save answered 403. Loading for editing now goes through
// `GET /admin/projects/:key/studio`, which asks exactly what saving asks (canEditProject), and
// the studio saves ONE page, by id, from the revision it opened (409 on a concurrent change).
//
// HOW IT IS BUILT (same method as task-permissions-matrix.test.mjs)
//   · `oracle()` restates the rules by hand; nothing here imports lib.mjs's predicates.
//   · REFUSAL pass: every request the oracle refuses is sent, and must answer 403/404, never
//     `unauthenticated` or `2fa_required` (a broken fixture), except for the two actors whose
//     refusal IS that (anonymous, no 2FA). Then nothing may have changed.
//   · POSITIVE pass: each probe once, with the LEAST privileged actor the oracle allows, on
//     the current revision, so a route that does not exist (404) cannot pass as a refusal.
//   · D8: ADMIN has the studio everywhere.
//
// MUTATION CHECK, by hand, recorded at the bottom of this file.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { lockRow, unlockRow } from './row-lock.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the studio permission matrix';
process.env.JWT_SECRET ||= 'studio-matrix-test-secret';

const STAMP = Date.now().toString(36);
const TAG = `stumx-${STAMP}-`;
const KA = `smx${STAMP}a`;
const KB = `smx${STAMP}b`;
const HOME_KEY = 'site.home';

let p, app, seq = 0;
const A = {};
const F = {};
let homeBefore = null;

async function mkUser(name, data = {}) {
  const u = await p.user.create({ data: { email: `${TAG}${name}-${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true, emailVerified: true, ...data } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}` };
}
async function actor(name, spec, data = {}) {
  const made = await mkUser(name, { role: spec.role || 'USER', permissions: spec.perms || [], ...data });
  A[name] = { ...made, spec };
  return A[name];
}

const page = (id, blocks = []) => ({ id, title: id, blocks });
const projectConfig = () => ({ tagline: 'stored', canvases: [page('p1', [{ id: 'b1', kind: 'text', x: 0, y: 0, w: 200, h: 80, props: { md: 'hi' } }]), page('p2')] });

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  await lockRow(p, HOME_KEY);
  homeBefore = await p.adminSetting.findUnique({ where: { key: HOME_KEY } });

  for (const k of [KA, KB]) {
    await p.project.create({ data: { key: k, name: `${TAG}${k}` } });
    await p.adminSetting.create({ data: { key: `project.${k}`, value: projectConfig() } });
  }
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  const X = await p.showcaseProject.create({ data: { slug: `${TAG}x`, name: `${TAG}X`, short: 'SX', config: projectConfig() } });
  const Y = await p.showcaseProject.create({ data: { slug: `${TAG}y`, name: `${TAG}Y`, short: 'SY', config: projectConfig() } });
  F.X = X.id; F.Y = Y.id;
  const homeValue = { ...(homeBefore?.value || {}), customSections: [{ id: `${TAG}s1`, enabled: true, position: 'top', mode: 'canvas', title: { en: 's', fr: 's' }, body: { en: '', fr: '' }, canvas: page('h1') }] };
  await p.adminSetting.upsert({ where: { key: HOME_KEY }, create: { key: HOME_KEY, value: homeValue }, update: { value: homeValue } });

  await actor('USER', {});
  await actor('MOD', { role: 'MOD' });
  await actor('grantA', { grants: { projects: [KA] } });
  await actor('grantX', { grants: { showcases: ['X'] } });
  await actor('allShowcase', { grants: { allShowcase: true } });
  await actor('scopedB', { grants: { projects: [KB] } });
  await actor('manageProjects', { perms: ['manage_projects'], caps: ['manage_projects'] });
  await actor('manageShowcase', { perms: ['manage_showcase'], caps: ['manage_showcase'] });
  await actor('ADMIN', { role: 'ADMIN' });
  await actor('SUPERADMIN', { role: 'SUPERADMIN' });
  // The A grantee, without 2FA: refused by the 2FA gate, which is the one refusal allowed to say so.
  await actor('grantA_no2fa', { grants: { projects: [KA] }, twofa: false }, { totpEnabled: false });

  for (const n of ['grantA', 'grantA_no2fa']) await p.projectPermission.create({ data: { userId: A[n].user.id, projectKey: KA, grantedBy: A.ADMIN.user.id } });
  await p.projectPermission.create({ data: { userId: A.grantX.user.id, showcaseProjectId: F.X, grantedBy: A.ADMIN.user.id } });
  await p.projectPermission.create({ data: { userId: A.allShowcase.user.id, allShowcase: true, grantedBy: A.ADMIN.user.id } });
  // Project B through a SCOPED custom role with the page right.
  const scoped = await p.customRole.create({ data: { name: `${TAG}scopedB`, capabilities: [], color: '#3b82f6', createdBy: A.SUPERADMIN.user.id, scope: { projectKeys: [KB], showcaseIds: [], allShowcase: false, rights: ['pages'] } } });
  await p.user.update({ where: { id: A.scopedB.user.id }, data: { customRoleIds: [scoped.id] } });

  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/projects.mjs')).default);
  await app.register((await import('../src/routes/showcase.mjs')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    const users = await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const none = ids.length ? ids : ['-'];
    await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
    await p.customRole.deleteMany({ where: { name: { startsWith: TAG } } });
    await p.projectConfigRevision.deleteMany({ where: { target: { in: [KA, KB] } } });
    await p.projectVersion.deleteMany({ where: { target: { in: [KA, KB, `sc:${F.X}`, `sc:${F.Y}`] } } });
    await p.adminSetting.deleteMany({ where: { key: { in: [`project.${KA}`, `project.${KB}`] } } });
    await p.project.deleteMany({ where: { key: { in: [KA, KB] } } });
    await p.showcaseProject.deleteMany({ where: { slug: { startsWith: TAG } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: none } } });
    await p.user.deleteMany({ where: { id: { in: none } } });
    if (homeBefore) await p.adminSetting.update({ where: { key: HOME_KEY }, data: { value: homeBefore.value } });
    else await p.adminSetting.deleteMany({ where: { key: HOME_KEY } });
  } finally {
    await unlockRow(p, HOME_KEY);
    await app?.close();
  }
});

// ── The rules, restated by hand ──────────────────────────────────────────────────────────
const ADMINS = new Set(['ADMIN', 'SUPERADMIN']);
function oracle(name, target) {
  const s = A[name].spec;
  if (s.twofa === false) return false;
  if (ADMINS.has(s.role)) return true;                           // D8
  const caps = s.caps || [];
  const g = s.grants || {};
  if (target.kind === 'project') return caps.includes('manage_projects') || (g.projects || []).includes(target.key);
  if (target.kind === 'showcase') return caps.includes('manage_showcase') || !!g.allShowcase || (g.showcases || []).includes(target.ref);
  return false;                                                  // home: ADMIN only
}

const TARGETS = [
  { name: 'project A', kind: 'project', key: KA },
  { name: 'project B', kind: 'project', key: KB },
  { name: 'showcase X', kind: 'showcase', ref: 'X' },
  { name: 'showcase Y', kind: 'showcase', ref: 'Y' },
  { name: 'home', kind: 'home' },
];
const id = (t) => (t.kind === 'showcase' ? F[t.ref] : t.key);
const openPath = (t) => (t.kind === 'project' ? `/admin/projects/${t.key}/studio` : t.kind === 'showcase' ? `/admin/showcase/${id(t)}/studio` : '/admin/site/home');
const savePath = (t) => (t.kind === 'project' ? `/admin/projects/${t.key}/studio/pages/p1` : t.kind === 'showcase' ? `/admin/showcase/${id(t)}/studio/pages/p1` : '/admin/site/home');
// The home page's studio save rides on the home route: `{ studioSection: { id, canvas, base } }`.
const saveBody = (t, canvas, base) => (t.kind === 'home' ? { studioSection: { id: `${TAG}s1`, canvas, base } } : { canvas, base });
const revsOf = (t, body) => (t.kind === 'home' ? body.studioRevs : body.revs);
const pageIdOf = (t) => (t.kind === 'home' ? 'h1' : 'p1');

async function call(name, method, url, payload) {
  const headers = name ? { cookie: A[name].cookie } : {};
  const res = await app.inject({ method, url, headers, payload });
  let body = null; try { body = res.json(); } catch { /* not json */ }
  return { status: res.statusCode, body };
}
async function storedDoc(t) {
  if (t.kind === 'project') return (await p.adminSetting.findUnique({ where: { key: `project.${t.key}` } })).value;
  if (t.kind === 'showcase') return (await p.showcaseProject.findUnique({ where: { id: id(t) } })).config;
  return (await p.adminSetting.findUnique({ where: { key: HOME_KEY } })).value;
}
async function revOf(t) {
  const r = await call('SUPERADMIN', 'GET', openPath(t));
  assert.equal(r.status, 200, `SUPERADMIN could not open ${t.name}: ${JSON.stringify(r.body)}`);
  return t.kind === 'home' ? r.body.studioRevs[`${TAG}s1`] : r.body.revs.p1;
}
const ACTORS = () => Object.keys(A);

describe('studio permission matrix', { skip }, () => {
  test('refusals: nobody opens or saves a studio page they may not edit, and nothing changes', async () => {
    const before = {};
    for (const t of TARGETS) before[t.name] = JSON.stringify(await storedDoc(t));
    let refused = 0;
    for (const t of TARGETS) {
      const base = await revOf(t);
      for (const name of ACTORS()) {
        if (oracle(name, t)) continue;
        for (const [method, url, payload] of [['GET', openPath(t)], ['PUT', savePath(t), saveBody(t, page(pageIdOf(t), [{ id: 'z', kind: 'box' }]), base)]]) {
          const r = await call(name, method, url, payload);
          const why = `${name} ${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`;
          // No 2FA: refused by the 2FA gate — or, on the ADMIN-only home route, by the role
          // check that runs before it. Either way a 403, and never a pass.
          if (A[name].spec.twofa === false) { assert.equal(r.status, 403, why); assert.ok(['2fa_required', 'forbidden'].includes(r.body?.error), why); }
          else {
            assert.ok(r.status === 403 || r.status === 404, why);
            assert.notEqual(r.body?.error, '2fa_required', `broken fixture: ${why}`);
            assert.notEqual(r.body?.error, 'unauthenticated', `broken fixture: ${why}`);
          }
          refused++;
        }
      }
      // Anonymous: no session at all.
      for (const [method, url] of [['GET', openPath(t)], ['PUT', savePath(t)]]) {
        const r = await call(null, method, url, saveBody(t, page(pageIdOf(t)), base));
        assert.ok(r.status === 401 || r.status === 403, `anonymous ${method} ${url} → ${r.status}`);
      }
    }
    for (const t of TARGETS) assert.equal(JSON.stringify(await storedDoc(t)), before[t.name], `${t.name} changed although every request was refused`);
    assert.ok(refused > 40, `only ${refused} refusals were exercised`);
  });

  test('the central case: a grantee of A can neither open nor save B, and can do both on A', async () => {
    const B = TARGETS[1];
    assert.equal((await call('grantA', 'GET', openPath(B))).status, 403);
    assert.equal((await call('grantA', 'PUT', savePath(B), { canvas: page('p1'), base: await revOf(B) })).status, 403);
    const Ta = TARGETS[0];
    const open = await call('grantA', 'GET', openPath(Ta));
    assert.equal(open.status, 200);
    assert.equal(open.body.config.tagline, 'stored');
    // ... and the same holds for the config route the studio used to go around.
    assert.equal((await call('grantA', 'PUT', `/projects/${KB}`, { config: { tagline: 'hijack' } })).status, 403);
  });

  test('positive pass: the least privileged allowed actor opens and saves each target', async () => {
    const ORDER = ['grantA', 'scopedB', 'grantX', 'allShowcase', 'manageProjects', 'manageShowcase', 'ADMIN', 'SUPERADMIN'];
    for (const t of TARGETS) {
      const who = ORDER.find((n) => oracle(n, t));
      assert.ok(who, `nobody may edit ${t.name}`);
      const open = await call(who, 'GET', openPath(t));
      assert.equal(open.status, 200, `${who} could not open ${t.name}: ${JSON.stringify(open.body)}`);
      const base = t.kind === 'home' ? revsOf(t, open.body)[`${TAG}s1`] : revsOf(t, open.body).p1;
      const saved = await call(who, 'PUT', savePath(t), saveBody(t, page(pageIdOf(t), [{ id: 'n1', kind: 'box', x: 0, y: 0, w: 100, h: 100, props: { bg: '#123456' } }]), base));
      assert.equal(saved.status, 200, `${who} could not save ${t.name}: ${JSON.stringify(saved.body)}`);
      const doc = await storedDoc(t);
      const pg = t.kind === 'home' ? doc.customSections.find((s) => s.id === `${TAG}s1`).canvas : doc.canvases.find((c) => c.id === 'p1');
      assert.equal(pg.blocks[0].props.bg, '#123456', `${t.name}: the save did not land`);
    }
  });
});

describe('studio save: validation and concurrency', { skip }, () => {
  test('a hostile page is refused with the path of the field, on both doors', async () => {
    const T = TARGETS[0];
    const evil = page('p1', [{ id: 'b1', kind: 'button', props: { action: { type: 'link', href: 'javascript:alert(1)' } } }]);
    const r = await call('grantA', 'PUT', savePath(T), { canvas: evil, base: await revOf(T) });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_studio_doc');
    assert.equal(r.body.path, 'canvases[0].blocks[0].props.action.href');
    const cur = await storedDoc(T);
    const viaConfig = await call('grantA', 'PUT', `/projects/${KA}`, { config: { ...cur, canvases: [evil, ...cur.canvases.slice(1)] } });
    assert.equal(viaConfig.status, 400, `the config route stored a javascript: href: ${JSON.stringify(viaConfig.body)}`);
    assert.equal(viaConfig.body.reason, 'unsafe_url');
    for (const [label, blocks, extra] of [
      ['api action', [{ id: 'b1', kind: 'button', props: { action: { type: 'api', path: '/admin/x' } } }], {}],
      ['forged id', [{ id: 'x"]{}*{color:red}', kind: 'box' }], {}],
      ['offsite background', [], { bg: 'url(https://evil.example/p)' }],
      ['position fixed', [], { css: '.a{position:fixed;inset:0}' }],
    ]) {
      const bad = { ...page('p1', blocks), ...extra };
      const x = await call('grantX', 'PUT', `/admin/showcase/${F.X}`, { config: { canvases: [bad] } });
      assert.equal(x.status, 400, `showcase config accepted ${label}`);
      assert.equal(x.body.error, 'invalid_studio_doc', label);
    }
    const home = await call('ADMIN', 'PUT', '/admin/site/home', { customSections: [{ id: `${TAG}s1`, mode: 'canvas', canvas: page('h1', [{ id: 'b1', kind: 'box', props: { bg: 'url(https://evil.example/p)' } }]) }] });
    assert.equal(home.status, 400, 'the home route accepted an offsite background');
  });

  test('two saves from the same revision: the second is a 409 with the stored page, and nothing else is lost', async () => {
    const T = TARGETS[1];
    const base = await revOf(T);
    // Meanwhile the config editor saves an unrelated field, and the studio of ANOTHER page saves.
    const cfg = await storedDoc(T);
    assert.equal((await call('ADMIN', 'PUT', `/projects/${KB}`, { config: { ...cfg, tagline: 'edited elsewhere' } })).status, 200);
    const openP2 = await call('ADMIN', 'GET', openPath(T));
    assert.equal((await call('ADMIN', 'PUT', `/admin/projects/${KB}/studio/pages/p2`, { canvas: page('p2', [{ id: 'q', kind: 'box' }]), base: openP2.body.revs.p2 })).status, 200);
    const first = await call('scopedB', 'PUT', savePath(T), { canvas: page('p1', [{ id: 'one', kind: 'box' }]), base });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await call('ADMIN', 'PUT', savePath(T), { canvas: page('p1', [{ id: 'two', kind: 'box' }]), base });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'conflict');
    assert.equal(second.body.current.blocks[0].id, 'one', 'the 409 does not carry the page it lost to');
    assert.equal(second.body.rev, first.body.rev);
    const after = await storedDoc(T);
    assert.equal(after.tagline, 'edited elsewhere', 'the studio save erased a field saved elsewhere');
    assert.equal(after.canvases.find((c) => c.id === 'p2').blocks[0].id, 'q', 'the studio save erased another page');
    assert.equal(after.canvases.find((c) => c.id === 'p1').blocks[0].id, 'one', 'the first save was overwritten');
    // Addressed by id: after a reorder the same save lands on the same page.
    await call('ADMIN', 'PUT', `/projects/${KB}`, { config: { ...after, canvases: [...after.canvases].reverse() } });
    const again = await call('ADMIN', 'PUT', savePath(T), { canvas: page('p1', [{ id: 'three', kind: 'box' }]), base: second.body.rev });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const final = await storedDoc(T);
    assert.equal(final.canvases[0].id, 'p2');
    assert.equal(final.canvases[1].blocks[0].id, 'three');
    assert.equal(final.canvases[0].blocks[0].id, 'q');
    // A page that no longer exists is not re-created by a stale tab.
    assert.equal((await call('ADMIN', 'PUT', `/admin/projects/${KB}/studio/pages/gone`, { canvas: page('gone'), base: 'stale-rev' })).body.error, 'page_gone');
    // ... while a page that was never stored (base '') is a new one, appended once.
    const made = await call('scopedB', 'PUT', `/admin/projects/${KB}/studio/pages/fresh`, { canvas: page('fresh'), base: '' });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal((await call('scopedB', 'PUT', `/admin/projects/${KB}/studio/pages/fresh`, { canvas: page('fresh'), base: '' })).status, 409, 'a second "new" page with the same id overwrote the first');
    assert.deepEqual((await storedDoc(T)).canvases.map((c) => c.id), ['p2', 'p1', 'fresh']);
  });
});

// MUTATION CHECK (run by hand, 23.09.2026):
//   · GET /admin/projects/:key/studio with `canEditProject` replaced by `true`: the refusal
//     pass goes red on the first non-grantee (USER GET project A → 200).
//   · the studio-doc checks removed from PUT /projects/:key (the `configStudioProblems` line):
//     "the config route stored a javascript: href" goes red.
//   · the rev comparison in replaceConfigPage removed: the 409 test goes red (200).
