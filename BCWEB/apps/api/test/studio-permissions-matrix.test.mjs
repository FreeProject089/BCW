// Who may OPEN and SAVE a studio page, over HTTP — and what a save may carry.
//
// PLAN-STUDIO-2026 section 1.5: the studio loaded a project's config through the PUBLIC
// `GET /projects/:key`, so the holder of a permission on project A opened `/studio/project/b`
// and edited B's page; only the save answered 403. Loading for editing goes through
// `GET /admin/projects/:key/studio`, and the studio saves ONE page, by id, from the revision it
// opened (409 on a concurrent change).
//
// PHASE 2 (this file's second half of the story): drawing a page is its OWN right, `studio`,
// distinct from `pages` (editing the page's words). canUseStudio (lib.mjs) =
//   manage_studio (ADMIN / SUPERADMIN implicitly, D8)
//   OR the `studio` right on THIS target (direct grant, allShowcase grant, scoped role),
//      and only while that page's studio switch is on (D2: off, only manage_studio prepares);
//   never for a suspended account; the home page needs manage_studio.
// `pages`, manage_projects and manage_showcase give no studio. The config routes put the stored
// studio pages back for a caller without the right (guardStudioContent), the public GETs carry
// no drafts, and nobody hands out a right they lack or grants anything to themselves.
//
// HOW IT IS BUILT (same method as task-permissions-matrix.test.mjs)
//   · `studioOracle()` / `pagesOracle()` restate the rules by hand; nothing here imports
//     lib.mjs's predicates to decide an expectation.
//   · REFUSAL pass: every request the oracle refuses is sent, and must answer 403/404, never
//     `unauthenticated` or `2fa_required` (a broken fixture), except for the actors whose
//     refusal IS that (anonymous, no 2FA). Then nothing may have changed.
//   · CONFIG-DOOR pass: every actor PUTs every target's config with the studio pages changed;
//     the page right decides whether the call lands, the studio right whether the pages do.
//   · POSITIVE pass: each probe once, with the LEAST privileged actor the oracle allows, on
//     the current revision, so a route that does not exist (404) cannot pass as a refusal.
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

let p, app, lib, seq = 0;
const A = {};
const F = {};
let homeBefore = null;

async function mkUser(name, data = {}) {
  const u = await p.user.create({ data: { email: `${TAG}${name}-${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true, emailVerified: true, ...data } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}` };
}
/**
 * One actor. `spec` is what the ORACLES read:
 *   role, caps           the tier and the site-wide capabilities
 *   pages / studio       the logical grants: { projects: [key], showcases: ['X'], allShowcase }
 *   viaRole              the grants come from a SCOPED custom role instead of direct rows
 *   suspended, twofa     account state
 */
async function actor(name, spec, data = {}) {
  const made = await mkUser(name, { role: spec.role || 'USER', permissions: spec.caps || [], ...data });
  A[name] = { ...made, spec };
  return A[name];
}

const page = (id, blocks = []) => ({ id, title: id, blocks });
const box = (id, extra = {}) => ({ id, kind: 'box', x: 0, y: 0, w: 100, h: 80, props: {}, ...extra });
// p1 is COMPLETE (title + a block: visitors see it); p2 has no block: a draft.
const projectConfig = (on = true) => ({ tagline: 'stored', studioEnabled: on, canvases: [page('p1', [{ id: 'b1', kind: 'text', x: 0, y: 0, w: 200, h: 80, props: { md: 'hi' } }]), page('p2')] });

// ── The targets ─────────────────────────────────────────────────────────────────────────
// Y has its studio switched OFF: decision D2, only manage_studio prepares it.
const TARGETS = [
  { name: 'project A', kind: 'project', key: KA, on: true },
  { name: 'project B', kind: 'project', key: KB, on: true },
  { name: 'showcase X', kind: 'showcase', ref: 'X', on: true },
  { name: 'showcase Y (studio off)', kind: 'showcase', ref: 'Y', on: false },
  { name: 'home', kind: 'home', on: true },
];
const T = Object.fromEntries(TARGETS.map((t) => [t.kind === 'showcase' ? t.ref : t.kind === 'project' ? (t.key === KA ? 'A' : 'B') : 'home', t]));

before(async () => {
  if (!RUN) return;
  lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  await lockRow(p, HOME_KEY);
  homeBefore = await p.adminSetting.findUnique({ where: { key: HOME_KEY } });

  for (const k of [KA, KB]) {
    await p.project.create({ data: { key: k, name: `${TAG}${k}` } });
    await p.adminSetting.create({ data: { key: `project.${k}`, value: projectConfig(true) } });
  }
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  const X = await p.showcaseProject.create({ data: { slug: `${TAG}x`, name: `${TAG}X`, short: 'SX', config: projectConfig(true) } });
  const Y = await p.showcaseProject.create({ data: { slug: `${TAG}y`, name: `${TAG}Y`, short: 'SY', config: projectConfig(false) } });
  F.X = X.id; F.Y = Y.id; F.slugX = X.slug; F.slugY = Y.slug;
  const homeValue = { ...(homeBefore?.value || {}), customSections: [{ id: `${TAG}s1`, enabled: true, position: 'top', mode: 'canvas', title: { en: 's', fr: 's' }, body: { en: '', fr: '' }, canvas: page('h1', [box('hb')]) }] };
  await p.adminSetting.upsert({ where: { key: HOME_KEY }, create: { key: HOME_KEY, value: homeValue }, update: { value: homeValue } });

  await actor('USER', {});
  await actor('MOD', { role: 'MOD' });
  await actor('pagesA', { pages: { projects: [KA] } });
  await actor('studioA', { studio: { projects: [KA] } });
  await actor('studioX', { studio: { showcases: ['X'] } });
  await actor('allShowcasePages', { pages: { allShowcase: true } });
  await actor('allShowcaseStudio', { studio: { allShowcase: true } });
  await actor('scopedPagesB', { pages: { projects: [KB] }, viaRole: true });
  await actor('scopedStudioB', { studio: { projects: [KB] }, viaRole: true });
  await actor('manageProjects', { caps: ['manage_projects'] });
  await actor('manageShowcase', { caps: ['manage_showcase'] });
  await actor('manageStudio', { caps: ['manage_studio'] });
  await actor('ADMIN', { role: 'ADMIN' });
  await actor('SUPERADMIN', { role: 'SUPERADMIN' });
  // Holds BOTH rights on A, and is suspended: edits words (a suspension leaves the door open,
  // lib.mjs accountLock), draws nothing.
  await actor('suspendedStudioA', { pages: { projects: [KA] }, studio: { projects: [KA] }, suspended: true },
    { status: 'suspended', moderationUntil: new Date(Date.now() + 86_400_000), moderationReason: 'matrix' });
  // The A studio holder, without 2FA: refused by the 2FA gate, the one refusal allowed to say so.
  await actor('studioA_no2fa', { studio: { projects: [KA] }, twofa: false }, { totpEnabled: false });

  // Direct grants: ONE row per (person, target), carrying the union of its rights.
  for (const [name, a] of Object.entries(A)) {
    const s = a.spec;
    if (s.viaRole) continue;
    const rows = new Map();
    const add = (kind, ref, right) => {
      const k = `${kind}:${ref}`;
      if (!rows.has(k)) rows.set(k, { kind, ref, rights: new Set() });
      rows.get(k).rights.add(right);
    };
    for (const [right, g] of [['pages', s.pages], ['studio', s.studio]]) {
      if (!g) continue;
      for (const k of g.projects || []) add('project', k, right);
      for (const r of g.showcases || []) add('showcase', r, right);
      if (g.allShowcase) add('all', '*', right);
    }
    for (const r of rows.values()) {
      await p.projectPermission.create({ data: {
        userId: a.user.id, grantedBy: A.ADMIN.user.id, rights: [...r.rights],
        ...(r.kind === 'project' ? { projectKey: r.ref } : r.kind === 'showcase' ? { showcaseProjectId: F[r.ref] } : { allShowcase: true }),
      } });
    }
    void name;
  }
  // Project B through SCOPED custom roles: one with the page right, one with the studio right.
  for (const [name, rights] of [['scopedPagesB', ['pages']], ['scopedStudioB', ['studio']]]) {
    const role = await p.customRole.create({ data: { name: `${TAG}${name}`, capabilities: [], color: '#3b82f6', createdBy: A.SUPERADMIN.user.id, scope: { projectKeys: [KB], showcaseIds: [], allShowcase: false, rights } } });
    await p.user.update({ where: { id: A[name].user.id }, data: { customRoleIds: [role.id] } });
  }
  F.studioRole = (await p.customRole.findFirst({ where: { name: `${TAG}scopedStudioB` } })).id;

  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/auth.mjs')).default);
  await app.register((await import('../src/routes/projects.mjs')).default);
  await app.register((await import('../src/routes/showcase.mjs')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.register((await import('../src/routes/roles.mjs')).default);
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
const holds = (g, t) => !!g && (t.kind === 'project' ? (g.projects || []).includes(t.key) : t.kind === 'showcase' ? (!!g.allShowcase || (g.showcases || []).includes(t.ref)) : false);
/** May `name` open and save the studio of `t`? */
function studioOracle(name, t) {
  const s = A[name].spec;
  if (s.twofa === false || s.suspended) return false;
  if (ADMINS.has(s.role) || (s.caps || []).includes('manage_studio')) return true;   // D8
  if (t.kind === 'home') return false;                                                // manage_studio only
  if (!t.on) return false;                                                            // D2
  return holds(s.studio, t);
}
/** May `name` call the CONFIG route of `t` at all (the page right)? */
function pagesOracle(name, t) {
  const s = A[name].spec;
  if (s.twofa === false) return false;
  if (ADMINS.has(s.role)) return true;
  if (t.kind === 'home') return false;                                                // ADMIN only
  const caps = s.caps || [];
  if (t.kind === 'project' && caps.includes('manage_projects')) return true;
  if (t.kind === 'showcase' && caps.includes('manage_showcase')) return true;
  return holds(s.pages, t);
}

const id = (t) => (t.kind === 'showcase' ? F[t.ref] : t.key);
const openPath = (t) => (t.kind === 'project' ? `/admin/projects/${t.key}/studio` : t.kind === 'showcase' ? `/admin/showcase/${id(t)}/studio` : '/admin/studio/home');
const savePath = (t) => (t.kind === 'project' ? `/admin/projects/${t.key}/studio/pages/p1` : t.kind === 'showcase' ? `/admin/showcase/${id(t)}/studio/pages/p1` : `/admin/studio/home/sections/${TAG}s1`);
const pageIdOf = (t) => (t.kind === 'home' ? 'h1' : 'p1');
const revFrom = (t, body) => (t.kind === 'home' ? body.studioRevs[`${TAG}s1`] : body.revs.p1);

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
async function writeDoc(t, v) {
  if (t.kind === 'project') await p.adminSetting.update({ where: { key: `project.${t.key}` }, data: { value: v } });
  else if (t.kind === 'showcase') await p.showcaseProject.update({ where: { id: id(t) }, data: { config: v } });
  else await p.adminSetting.update({ where: { key: HOME_KEY }, data: { value: v } });
}
/** The studio pages of a stored doc, whatever the kind. */
const pagesOf = (t, doc) => (t.kind === 'home' ? (doc.customSections || []).map((s) => s.canvas || null) : doc.canvases);
async function revOf(t) {
  const r = await call('SUPERADMIN', 'GET', openPath(t));
  assert.equal(r.status, 200, `SUPERADMIN could not open ${t.name}: ${JSON.stringify(r.body)}`);
  return revFrom(t, r.body);
}
/** The config route of a target, with its studio pages changed AND a plain field changed. */
function configProbe(t, stored, who) {
  if (t.kind === 'home') {
    const sections = (stored.customSections || []).map((s) => (s.id === `${TAG}s1` ? { ...s, title: { en: who, fr: who }, canvas: page('h1', [box('cfg')]) } : s));
    return ['PUT', '/admin/site/home', { customSections: sections }];
  }
  const config = { ...stored, tagline: `by-${who}`, canvases: [page('p1', [box('cfg')]), page('new-by-config', [box('n')])] };
  return t.kind === 'project' ? ['PUT', `/projects/${t.key}`, { config }] : ['PUT', `/admin/showcase/${id(t)}`, { config }];
}
const ACTORS = () => Object.keys(A);
/** JSON with keys sorted: Postgres JSONB hands keys back in its own order. */
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
const SOFT_REFUSALS = ['forbidden', 'not_found', 'missing_permission', 'studio_off', 'unknown_project'];

describe('studio permission matrix', { skip }, () => {
  test('refusals: nobody opens or saves a studio page they may not draw, and nothing changes', async () => {
    const before = {};
    for (const t of TARGETS) before[t.name] = JSON.stringify(await storedDoc(t));
    let refused = 0;
    for (const t of TARGETS) {
      const base = await revOf(t);
      for (const name of ACTORS()) {
        if (studioOracle(name, t)) continue;
        const probes = [['GET', openPath(t)], ['PUT', savePath(t), { canvas: page(pageIdOf(t), [box('z')]), base }]];
        // The home page's older door (ADMIN role + the same studio question).
        if (t.kind === 'home') probes.push(['PUT', '/admin/site/home', { studioSection: { id: `${TAG}s1`, canvas: page('h1', [box('z')]), base } }]);
        for (const [method, url, payload] of probes) {
          const r = await call(name, method, url, payload);
          const why = `${name} ${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`;
          if (A[name].spec.twofa === false) { assert.equal(r.status, 403, why); assert.ok(['2fa_required', ...SOFT_REFUSALS].includes(r.body?.error), why); }
          else {
            assert.ok(r.status === 403 || r.status === 404, why);
            assert.ok(SOFT_REFUSALS.includes(r.body?.error), `unexpected refusal (broken fixture?): ${why}`);
          }
          refused++;
        }
      }
      // Anonymous: no session at all.
      for (const [method, url] of [['GET', openPath(t)], ['PUT', savePath(t)]]) {
        const r = await call(null, method, url, { canvas: page(pageIdOf(t)), base });
        assert.ok(r.status === 401 || r.status === 403, `anonymous ${method} ${url} → ${r.status}`);
      }
    }
    for (const t of TARGETS) assert.equal(JSON.stringify(await storedDoc(t)), before[t.name], `${t.name} changed although every request was refused`);
    assert.ok(refused > 80, `only ${refused} refusals were exercised`);
  });

  test('config doors: the page right decides whether the save lands, the studio right whether the pages do', async () => {
    let landedWithoutPages = 0, landedWithPages = 0;
    for (const t of TARGETS) {
      for (const name of ACTORS()) {
        const stored = await storedDoc(t);
        const [method, url, payload] = configProbe(t, stored, name);
        const r = await call(name, method, url, payload);
        const why = `${name} ${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`;
        const after = await storedDoc(t);
        if (!pagesOracle(name, t)) {
          assert.ok(r.status === 403 || r.status === 404, why);
          assert.equal(stable(after), stable(stored), `${why}: refused, yet the config changed`);
          continue;
        }
        assert.equal(r.status, 200, why);
        if (t.kind === 'home') assert.equal(after.customSections.find((s) => s.id === `${TAG}s1`).title.en, name, `${why}: the plain field did not land`);
        else assert.equal(after.tagline, `by-${name}`, `${why}: the plain field did not land`);
        if (studioOracle(name, t)) {
          assert.equal(stable(pagesOf(t, after)), stable(pagesOf(t, payload.config || payload)), `${why}: a studio holder's pages did not land`);
          landedWithPages++;
        } else {
          assert.equal(stable(pagesOf(t, after)), stable(pagesOf(t, stored)), `${why}: the studio pages changed WITHOUT the studio right`);
          landedWithoutPages++;
        }
        await writeDoc(t, stored);
      }
    }
    // Both halves of the rule were actually exercised, not vacuously true.
    assert.ok(landedWithoutPages >= 5, `only ${landedWithoutPages} page-right-only saves were checked`);
    assert.ok(landedWithPages >= 5, `only ${landedWithPages} studio saves through the config were checked`);
  });

  test('positive pass: the least privileged allowed actor opens and saves each target', async () => {
    const ORDER = ['studioA', 'scopedStudioB', 'studioX', 'allShowcaseStudio', 'manageStudio', 'ADMIN', 'SUPERADMIN'];
    const used = {};
    for (const t of TARGETS) {
      const who = ORDER.find((n) => studioOracle(n, t));
      assert.ok(who, `nobody may draw ${t.name}`);
      used[t.name] = who;
      const open = await call(who, 'GET', openPath(t));
      assert.equal(open.status, 200, `${who} could not open ${t.name}: ${JSON.stringify(open.body)}`);
      const saved = await call(who, 'PUT', savePath(t), { canvas: page(pageIdOf(t), [box('n1', { props: { bg: '#123456' } })]), base: revFrom(t, open.body) });
      assert.equal(saved.status, 200, `${who} could not save ${t.name}: ${JSON.stringify(saved.body)}`);
      const doc = await storedDoc(t);
      const pg = t.kind === 'home' ? doc.customSections.find((s) => s.id === `${TAG}s1`).canvas : doc.canvases.find((c) => c.id === 'p1');
      assert.equal(pg.blocks[0].props.bg, '#123456', `${t.name}: the save did not land`);
    }
    // The least privileged really is small: a per-project studio grant, not a capability.
    assert.equal(used['project A'], 'studioA');
    assert.equal(used['project B'], 'scopedStudioB');
    assert.equal(used['showcase X'], 'studioX');
    assert.equal(used['showcase Y (studio off)'], 'manageStudio', 'D2: only manage_studio prepares a page whose studio is off');
    assert.equal(used.home, 'manageStudio', 'the home page is drawn with manage_studio, without the ADMIN role');
  });

  test('the central case: a holder of A (pages or studio) can neither open nor save B; pages on A does not draw A', async () => {
    for (const who of ['pagesA', 'studioA']) {
      assert.equal((await call(who, 'GET', openPath(T.B))).status, 403, `${who} opened B`);
      assert.equal((await call(who, 'PUT', savePath(T.B), { canvas: page('p1'), base: await revOf(T.B) })).status, 403, `${who} saved B`);
      assert.equal((await call(who, 'PUT', `/projects/${KB}`, { config: { tagline: 'hijack' } })).status, 403, `${who} wrote B's config`);
    }
    // studio on A opens A ...
    const open = await call('studioA', 'GET', openPath(T.A));
    assert.equal(open.status, 200);
    assert.equal(open.body.config.tagline, 'stored');
    // ... pages on A does not, and cannot draw A through the config either: added, removed,
    // reordered, hostile — every variant lands as the stored pages.
    assert.equal((await call('pagesA', 'GET', openPath(T.A))).body?.error, 'forbidden');
    const stored = await storedDoc(T.A);
    for (const [label, canvases] of [
      ['all removed', []],
      ['reordered', [...stored.canvases].reverse()],
      ['added', [...stored.canvases, page('p9', [box('q')])]],
      ['hostile', [page('p1', [{ id: 'b1', kind: 'button', props: { action: { type: 'link', href: 'javascript:alert(1)' } } }])]],
      ['absent', undefined],
    ]) {
      const r = await call('pagesA', 'PUT', `/projects/${KA}`, { config: { ...stored, tagline: label, canvases } });
      assert.equal(r.status, 200, `${label}: ${JSON.stringify(r.body)}`);
      const after = await storedDoc(T.A);
      assert.equal(after.tagline, label);
      assert.deepEqual(after.canvases, stored.canvases, `pages on A changed A's studio pages (${label})`);
    }
    await writeDoc(T.A, stored);
    // Same with a scoped role: the `pages` right on B does not open B's studio, `studio` does.
    assert.equal((await call('scopedPagesB', 'GET', openPath(T.B))).status, 403);
    assert.equal((await call('scopedStudioB', 'GET', openPath(T.B))).status, 200);
    // manage_projects / manage_showcase alone draw nothing.
    assert.equal((await call('manageProjects', 'GET', openPath(T.A))).status, 403);
    assert.equal((await call('manageShowcase', 'GET', openPath(T.X))).status, 403);
  });

  test('D2: a studio that is off opens for manage_studio only, and says so to a holder', async () => {
    const r = await call('allShowcaseStudio', 'GET', openPath(T.Y));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'studio_off', 'a holder of the right is told WHY');
    assert.equal((await call('allShowcaseStudio', 'GET', openPath(T.X))).status, 200, 'the same holder opens a page whose studio is on');
    assert.equal((await call('USER', 'GET', openPath(T.Y))).body.error, 'forbidden', 'somebody without the right is not told the switch state');
    assert.equal((await call('manageStudio', 'GET', openPath(T.Y))).status, 200);
    // Suspended: holds both rights on A, edits its words, draws nothing.
    assert.equal((await call('suspendedStudioA', 'GET', openPath(T.A))).status, 403);
  });
});

describe('studio drafts stay out of the public GETs (S7)', { skip }, () => {
  const draftsConfig = (on) => ({ tagline: 'drafts', studioEnabled: on, canvases: [page('p1', [box('a')]), page('p2'), { id: 'p3', title: '', blocks: [box('c')] }] });
  const ids = (cfg) => (cfg?.canvases || []).map((c) => c.id);

  test('project: visitors and page editors get the published pages; a studio holder gets them all', async () => {
    const keep = await storedDoc(T.A);
    await writeDoc(T.A, draftsConfig(true));
    try {
      assert.deepEqual(ids((await call(null, 'GET', `/projects/${KA}`)).body.config), ['p1'], 'anonymous saw a draft');
      assert.deepEqual(ids((await call('pagesA', 'GET', `/projects/${KA}`)).body.config), ['p1'], 'a page editor without the studio right saw a draft');
      assert.deepEqual(ids((await call('studioA', 'GET', `/projects/${KA}`)).body.config), ['p1', 'p2', 'p3']);
      assert.deepEqual(ids((await call(null, 'GET', '/projects')).body.projects[KA]), ['p1'], 'the list leaked a draft');
      assert.deepEqual(ids((await call('ADMIN', 'GET', '/projects')).body.projects[KA]), ['p1', 'p2', 'p3']);
      // A snapshot is public too.
      await p.projectVersion.create({ data: { target: KA, version: '9.9.9', config: draftsConfig(true) } });
      assert.deepEqual(ids((await call(null, 'GET', `/projects/${KA}/versions/9.9.9`)).body.config), ['p1'], 'a version snapshot leaked a draft');
      // Studio off: nothing is shown, so nothing is served.
      await writeDoc(T.A, draftsConfig(false));
      assert.deepEqual(ids((await call(null, 'GET', `/projects/${KA}`)).body.config), [], 'a studio that is off served its pages');
      assert.deepEqual(ids((await call('studioA', 'GET', `/projects/${KA}`)).body.config), [], 'D2: studio off, a holder is a visitor');
      assert.deepEqual(ids((await call('manageStudio', 'GET', `/projects/${KA}`)).body.config), ['p1', 'p2', 'p3']);
    } finally { await writeDoc(T.A, keep); }
  });

  test('showcase and home: the same rule', async () => {
    const keepX = await storedDoc(T.X);
    await writeDoc(T.X, draftsConfig(true));
    const keepHome = await storedDoc(T.home);
    try {
      assert.deepEqual(ids((await call(null, 'GET', `/showcase/${F.slugX}`)).body.project.config), ['p1']);
      assert.deepEqual(ids((await call('studioX', 'GET', `/showcase/${F.slugX}`)).body.project.config), ['p1', 'p2', 'p3']);
      assert.deepEqual(ids((await call(null, 'GET', `/showcase/${F.slugY}`)).body.project.config), [], 'Y is off: nothing public');
      // The admin list feeds the config editor: a page editor gets the published pages.
      const list = await call('allShowcasePages', 'GET', '/admin/showcase');
      assert.deepEqual(ids(list.body.projects.find((r) => r.id === F.X).config), ['p1']);
      const full = await call('ADMIN', 'GET', '/admin/showcase');
      assert.deepEqual(ids(full.body.projects.find((r) => r.id === F.X).config), ['p1', 'p2', 'p3']);
      await p.projectVersion.create({ data: { target: `sc:${F.X}`, version: '9.9.9', config: draftsConfig(true) } });
      assert.deepEqual(ids((await call(null, 'GET', `/project/${F.slugX}/versions/9.9.9`)).body.config), ['p1']);
      // Home: a section that is off keeps its drawing at home.
      await writeDoc(T.home, { ...keepHome, customSections: [...keepHome.customSections, { id: `${TAG}off`, enabled: false, position: 'top', mode: 'canvas', title: { en: 'o', fr: 'o' }, body: { en: '', fr: '' }, canvas: page('ho', [box('x')]) }] });
      const pub = (await call(null, 'GET', '/site/home')).body.customSections;
      assert.equal(pub.find((s) => s.id === `${TAG}off`).canvas, undefined, 'a switched-off home section served its drawing');
      assert.ok(pub.find((s) => s.id === `${TAG}s1`).canvas, 'a live home section lost its drawing');
      const studio = await call('manageStudio', 'GET', '/admin/studio/home');
      assert.ok(studio.body.customSections.find((s) => s.id === `${TAG}off`).canvas, 'the studio did not get the draft');
    } finally { await writeDoc(T.X, keepX); await writeDoc(T.home, keepHome); }
  });

  test('/me says which pages the studio opens on, apart from the page grants', async () => {
    const me = async (n) => (await call(n, 'GET', '/me')).body.user;
    const sa = await me('studioA');
    assert.deepEqual(sa.studioGrants.projectKeys, [KA]);
    assert.deepEqual(sa.projectGrants.projectKeys, [], 'a studio-only grant became a page grant');
    const pa = await me('pagesA');
    assert.deepEqual(pa.studioGrants.projectKeys, [], 'a page grant became a studio grant');
    assert.deepEqual(pa.projectGrants.projectKeys, [KA]);
    const sx = await me('studioX');
    assert.deepEqual(sx.studioGrants.showcaseIds, [F.X]);
    assert.deepEqual(sx.studioGrants.showcaseSlugs, [F.slugX]);
    assert.deepEqual((await me('scopedStudioB')).studioGrants.projectKeys, [KB]);
    assert.equal((await me('allShowcaseStudio')).studioGrants.allShowcase, true);
  });
});

describe('studio right: zero elevation', { skip }, () => {
  test('nobody below ADMIN hands out the studio right, nobody grants themselves, and nothing changes', async () => {
    const snap = async () => JSON.stringify(await p.projectPermission.findMany({ where: { user: { email: { startsWith: TAG } } }, select: { userId: true, projectKey: true, showcaseProjectId: true, allShowcase: true, rights: true }, orderBy: [{ userId: 'asc' }, { projectKey: 'asc' }] }));
    const roles = async () => p.customRole.count({ where: { name: { startsWith: TAG } } });
    const before = await snap();
    const rolesBefore = await roles();
    const target = A.USER.user.id;
    for (const name of ['USER', 'MOD', 'pagesA', 'studioA', 'allShowcaseStudio', 'scopedStudioB', 'manageStudio', 'manageProjects', 'manageShowcase', 'suspendedStudioA']) {
      const me = A[name].user.id;
      for (const [label, body] of [
        ['grant studio to another', { userId: target, projectKey: KA, rights: ['studio'] }],
        ['grant studio to self', { userId: me, projectKey: KA, rights: ['studio'] }],
        ['grant every other-project studio to self', { userId: me, allShowcase: true, rights: ['pages', 'studio'] }],
      ]) {
        const r = await call(name, 'POST', '/admin/project-permissions', body);
        assert.equal(r.status, 403, `${name} could ${label}: ${r.status} ${JSON.stringify(r.body)}`);
      }
      const role = await call(name, 'POST', '/admin/custom-roles', { name: `${TAG}esc-${name}`, capabilities: [], scope: { projectKeys: [KA], showcaseSlugs: [], allShowcase: false, rights: ['studio'] } });
      assert.equal(role.status, 403, `${name} created a studio role`);
      const assign = await call(name, 'PUT', `/admin/users/${me}/custom-roles`, { customRoleIds: [F.studioRole] });
      assert.equal(assign.status, 403, `${name} assigned themselves the studio role`);
    }
    // ADMIN is not SUPERADMIN: no role with the studio right either.
    assert.equal((await call('ADMIN', 'POST', '/admin/custom-roles', { name: `${TAG}esc-admin`, capabilities: [], scope: { projectKeys: [KA], showcaseSlugs: [], allShowcase: false, rights: ['studio'] } })).status, 403);
    // The top of the ladder does not grant ITSELF either.
    for (const name of ['ADMIN', 'SUPERADMIN']) {
      const r = await call(name, 'POST', '/admin/project-permissions', { userId: A[name].user.id, projectKey: KB, rights: ['studio'] });
      assert.equal(r.status, 400, `${name} granted themselves: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, 'cannot_grant_self');
    }
    assert.equal((await call('SUPERADMIN', 'PUT', `/admin/users/${A.SUPERADMIN.user.id}/custom-roles`, { customRoleIds: [F.studioRole] })).status, 400);
    assert.equal(await snap(), before, 'a refused grant changed a grant row');
    assert.equal(await roles(), rolesBefore, 'a refused role creation created a role');
  });

  test('ADMIN grants the studio right, it opens the studio, and taking it back closes it', async () => {
    const who = A.USER.user.id;
    assert.equal((await call('USER', 'GET', openPath(T.A))).status, 403);
    const g = await call('ADMIN', 'POST', '/admin/project-permissions', { userId: who, projectKey: KA, rights: ['studio'] });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.deepEqual(g.body.grant.rights, ['studio']);
    assert.equal((await call('USER', 'GET', openPath(T.A))).status, 200, 'the granted studio right does not open the studio');
    assert.equal((await call('USER', 'PUT', `/projects/${KA}`, { config: { tagline: 'x' } })).status, 403, 'a studio-only grant edits the page words');
    const list = await call('ADMIN', 'GET', '/admin/project-permissions');
    assert.deepEqual(list.body.grants.find((x) => x.id === g.body.grant.id).rights, ['studio']);
    // Granting the same target again SETS the rights (the screen sends the ticked boxes).
    const again = await call('ADMIN', 'POST', '/admin/project-permissions', { userId: who, projectKey: KA, rights: ['pages'] });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body.grant.rights, ['pages']);
    assert.equal((await call('USER', 'GET', openPath(T.A))).status, 403, 'the studio right survived being unticked');
    // Absent rights = `pages`, what a grant always meant: old clients give no studio.
    const old = await call('ADMIN', 'POST', '/admin/project-permissions', { userId: who, projectKey: KB });
    assert.deepEqual(old.body.grant.rights, ['pages']);
    await p.projectPermission.deleteMany({ where: { userId: who } });
  });

  test('the predicate a grant is checked against: who HOLDS the studio right on a target', async () => {
    const user = (n) => ({ uid: A[n].user.id, role: A[n].spec.role || 'USER', perms: A[n].spec.caps || [] });
    const hold = (n, kind, ref) => lib.holdsStudioRight(user(n), kind, ref);
    assert.equal(await hold('studioA', 'project', KA), true);
    assert.equal(await hold('studioA', 'project', KB), false);
    assert.equal(await hold('pagesA', 'project', KA), false);
    assert.equal(await hold('manageProjects', 'project', KA), false);
    assert.equal(await hold('MOD', 'project', KA), false);
    assert.equal(await hold('scopedStudioB', 'project', KB), true);
    assert.equal(await hold('allShowcaseStudio', 'showcase', F.Y), true, 'holding is not opening: the switch does not matter here');
    assert.equal(await hold('manageStudio', 'showcase', F.Y), true);
  });
});

describe('studio save: validation and concurrency', { skip }, () => {
  test('a hostile page is refused with the path of the field, on both doors', async () => {
    const evil = page('p1', [{ id: 'b1', kind: 'button', props: { action: { type: 'link', href: 'javascript:alert(1)' } } }]);
    const r = await call('studioA', 'PUT', savePath(T.A), { canvas: evil, base: await revOf(T.A) });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_studio_doc');
    assert.equal(r.body.path, 'canvases[0].blocks[0].props.action.href');
    const cur = await storedDoc(T.A);
    const viaConfig = await call('ADMIN', 'PUT', `/projects/${KA}`, { config: { ...cur, canvases: [evil, ...cur.canvases.slice(1)] } });
    assert.equal(viaConfig.status, 400, `the config route stored a javascript: href: ${JSON.stringify(viaConfig.body)}`);
    assert.equal(viaConfig.body.reason, 'unsafe_url');
    for (const [label, blocks, extra] of [
      ['api action', [{ id: 'b1', kind: 'button', props: { action: { type: 'api', path: '/admin/x' } } }], {}],
      ['forged id', [{ id: 'x"]{}*{color:red}', kind: 'box' }], {}],
      ['offsite background', [], { bg: 'url(https://evil.example/p)' }],
      ['position fixed', [], { css: '.a{position:fixed;inset:0}' }],
    ]) {
      const bad = { ...page('p1', blocks), ...extra };
      const x = await call('ADMIN', 'PUT', `/admin/showcase/${F.X}`, { config: { studioEnabled: true, canvases: [bad] } });
      assert.equal(x.status, 400, `showcase config accepted ${label}`);
      assert.equal(x.body.error, 'invalid_studio_doc', label);
    }
    const home = await call('ADMIN', 'PUT', '/admin/site/home', { customSections: [{ id: `${TAG}s1`, mode: 'canvas', canvas: page('h1', [{ id: 'b1', kind: 'box', props: { bg: 'url(https://evil.example/p)' } }]) }] });
    assert.equal(home.status, 400, 'the home route accepted an offsite background');
    const homeStudio = await call('manageStudio', 'PUT', savePath(T.home), { canvas: page('h1', [{ id: 'b1', kind: 'box', props: { bg: 'url(https://evil.example/p)' } }]), base: await revOf(T.home) });
    assert.equal(homeStudio.status, 400, 'the home studio door accepted an offsite background');
  });

  test('a studio save changes that page and nothing else in the config', async () => {
    const before = await storedDoc(T.X);
    const saved = await call('studioX', 'PUT', savePath(T.X), { canvas: page('p1', [box('only')]), base: await revOf(T.X) });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const after = await storedDoc(T.X);
    const rest = (c) => stable({ ...c, canvases: c.canvases.filter((x) => x.id !== 'p1') });
    assert.equal(rest(after), rest(before), 'a studio save touched another field or another page');
    assert.equal(after.canvases.find((x) => x.id === 'p1').blocks[0].id, 'only');
    assert.equal(after.studioEnabled, true, 'a studio save moved the switch');
  });

  test('two saves from the same revision: the second is a 409 with the stored page, and nothing else is lost', async () => {
    const TB = T.B;
    const base = await revOf(TB);
    // Meanwhile the config editor saves an unrelated field, and the studio of ANOTHER page saves.
    const cfg = await storedDoc(TB);
    assert.equal((await call('ADMIN', 'PUT', `/projects/${KB}`, { config: { ...cfg, tagline: 'edited elsewhere' } })).status, 200);
    const openP2 = await call('ADMIN', 'GET', openPath(TB));
    assert.equal((await call('ADMIN', 'PUT', `/admin/projects/${KB}/studio/pages/p2`, { canvas: page('p2', [{ id: 'q', kind: 'box' }]), base: openP2.body.revs.p2 })).status, 200);
    const first = await call('scopedStudioB', 'PUT', savePath(TB), { canvas: page('p1', [{ id: 'one', kind: 'box' }]), base });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await call('ADMIN', 'PUT', savePath(TB), { canvas: page('p1', [{ id: 'two', kind: 'box' }]), base });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'conflict');
    assert.equal(second.body.current.blocks[0].id, 'one', 'the 409 does not carry the page it lost to');
    assert.equal(second.body.rev, first.body.rev);
    const after = await storedDoc(TB);
    assert.equal(after.tagline, 'edited elsewhere', 'the studio save erased a field saved elsewhere');
    assert.equal(after.canvases.find((c) => c.id === 'p2').blocks[0].id, 'q', 'the studio save erased another page');
    assert.equal(after.canvases.find((c) => c.id === 'p1').blocks[0].id, 'one', 'the first save was overwritten');
    // Addressed by id: after a reorder the same save lands on the same page.
    await call('ADMIN', 'PUT', `/projects/${KB}`, { config: { ...after, canvases: [...after.canvases].reverse() } });
    const again = await call('ADMIN', 'PUT', savePath(TB), { canvas: page('p1', [{ id: 'three', kind: 'box' }]), base: second.body.rev });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const final = await storedDoc(TB);
    assert.equal(final.canvases[0].id, 'p2');
    assert.equal(final.canvases[1].blocks[0].id, 'three');
    assert.equal(final.canvases[0].blocks[0].id, 'q');
    // A page that no longer exists is not re-created by a stale tab.
    assert.equal((await call('ADMIN', 'PUT', `/admin/projects/${KB}/studio/pages/gone`, { canvas: page('gone'), base: 'stale-rev' })).body.error, 'page_gone');
    // ... while a page that was never stored (base '') is a new one, appended once.
    const made = await call('scopedStudioB', 'PUT', `/admin/projects/${KB}/studio/pages/fresh`, { canvas: page('fresh'), base: '' });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal((await call('scopedStudioB', 'PUT', `/admin/projects/${KB}/studio/pages/fresh`, { canvas: page('fresh'), base: '' })).status, 409, 'a second "new" page with the same id overwrote the first');
    assert.deepEqual((await storedDoc(TB)).canvases.map((c) => c.id), ['p2', 'p1', 'fresh']);
  });
});

// MUTATION CHECK (run by hand, 23.09.2026) — phase 0/1:
//   · GET /admin/projects/:key/studio with `canEditProject` replaced by `true`: the refusal
//     pass goes red on the first non-grantee (USER GET project A → 200).
//   · the studio-doc checks removed from PUT /projects/:key (the `configStudioProblems` line):
//     "the config route stored a javascript: href" goes red.
//   · the rev comparison in replaceConfigPage removed: the 409 test goes red (200).
//
// MUTATION CHECK — phase 2 (23.09.2026, scripted: apply one edit, run this file, revert the
// edit; every one below turned the file red, then 14/14 green again after the revert):
//   · M1 GET /admin/projects/:key/studio asks canEditProject instead of canUseStudio (the
//     mutation the plan names): 5 tests red, first the refusal pass (pagesA opens A).
//   · M2 PUT /projects/:key with guardStudioContent told "may draw" for everybody: the
//     config-door pass and the central case go red (pagesA changes A's studio pages).
//   · M3 the studio switch ignored in studioChecker (D2): the refusal pass, the D2 test and
//     the project drafts test go red.
//   · M4 GET /projects/:key serving the stored config to everybody: the drafts test goes red.
//   · M5 the `cannot_grant_self` refusal removed from POST /admin/project-permissions: the
//     zero-elevation test goes red (ADMIN grants themselves the studio right).
//   · M6 the suspension check removed from studioChecker: 4 tests red.
//   · M7 projectGrants no longer filtering on the `pages` right: 4 tests red, /me included
//     (a studio-only grant became a page grant).
//   · M8 PUT /admin/showcase/:id without guardStudioContent: the config-door pass goes red.
