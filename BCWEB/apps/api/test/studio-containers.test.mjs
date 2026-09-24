// Studio containers refused on SAVE (PLAN-STUDIO-2026 2.2, tests 3.3.6, phase 7a).
//
// The tree rules are the studio package's (packages/studio/src/tree.js), run by validateDoc;
// web/test/studio-containers.test.mjs covers each rule, the renderer (a broken chain is never
// drawn) and the editor's arithmetic. This file covers the API's half: a hostile tree (a cycle,
// a self-parent, an unknown parent, depth 4, ten thousand children) is a 400
// `invalid_studio_doc` naming the field, through the lib functions every route uses and, with
// DATABASE_URL, over HTTP on the studio's own save route, and nothing is stored. The `modal` and
// `tab` steps, live since phase 7a, are accepted when they name a dialog or a tab card.
//
// MUTATION CHECK (by hand, studio phase 7a, run with DATABASE_URL): with the
// `for (const p of treeProblems(blocks))` loop taken out of packages/studio/src/validate.js,
// 5 of this file's 7 tests go red (every hostile-tree test, the ten thousand children through
// the per-container limit; the page's own block limit still refuses that one), and 10 of the
// web's 30 in studio-containers.test.mjs. Restored, all green.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { configStudioProblems, sectionsStudioProblems, replaceConfigPage, pageRev } from '../src/lib/studio-doc.mjs';

const page = (id, blocks) => ({ id, title: id, blocks });
const cfg = (blocks) => ({ canvases: [page('p1', blocks)] });
const why = (list) => list.map((p) => `${p.path}:${p.reason}`);
const box = (id, extra = {}) => ({ id, kind: 'group', x: 0, y: 0, w: 400, h: 400, ...extra });
const leaf = (id, parent, extra = {}) => ({ id, kind: 'text', x: 8, y: 8, w: 100, h: 40, props: { md: id }, ...(parent ? { parent } : {}), ...extra });

// 3.3.6: each hostile tree, with the field path the API must name.
const HOSTILE = [
  ['a cycle', [box('c1', { parent: 'c2' }), box('c2', { parent: 'c1' })], 'blocks[0].parent', 'cycle'],
  ['a self-parent', [box('s', { parent: 's' })], 'blocks[0].parent', 'self_parent'],
  ['an unknown parent', [leaf('o', 'nowhere')], 'blocks[0].parent', 'unknown_parent'],
  ['depth 4', [box('d1'), box('d2', { parent: 'd1' }), box('d3', { parent: 'd2' }), box('d4', { parent: 'd3' }), leaf('d5', 'd4')], 'blocks[4].parent', 'too_deep'],
  ['a parent that holds nothing', [leaf('x'), leaf('k', 'x')], 'blocks[1].parent', 'not_container'],
  ['a nested dialog', [box('g'), { ...box('m'), kind: 'modal', parent: 'g' }], 'blocks[1].parent', 'modal_nested'],
  ['a child entirely outside', [box('g', { w: 100, h: 100 }), leaf('far', 'g', { x: 5000 })], 'blocks[1]', 'outside_parent'],
  ['a slot outside a tab card', [box('g'), leaf('a', 'g', { slot: 2 })], 'blocks[1].slot', 'bad_value'],
];
/** Ten thousand children of one group, as compact as a block gets (about 400 KB), so the body
 *  passes the page route's 600 KB transport bound and reaches the validator. */
const FAN = () => [box('fan'), ...Array.from({ length: 10_000 }, (_v, i) => ({ id: `k${i.toString(36)}`, kind: 'box', parent: 'fan' }))];
/** The same with every field written: past the transport bound, refused before it is parsed. */
const FAN_FULL = () => [box('fan'), ...Array.from({ length: 10_000 }, (_v, i) => ({ id: `k${i}`, kind: 'box', x: 0, y: 0, w: 9, h: 9, parent: 'fan' }))];

describe('a hostile tree is refused on save, with the path of the field', () => {
  test('through configStudioProblems (every config route)', () => {
    for (const [name, blocks, path, reason] of HOSTILE) {
      const got = why(configStudioProblems(cfg(blocks), null));
      assert.ok(got.includes(`canvases[0].${path}:${reason}`), `${name} -> ${JSON.stringify(got)}`);
    }
  });
  test('through the home sections too', () => {
    const got = why(sectionsStudioProblems([{ id: 's', canvas: page('h', [leaf('o', 'nowhere')]) }], []));
    assert.deepEqual(got, ['customSections[0].canvas.blocks[0].parent:unknown_parent']);
  });
  test('ten thousand children: refused (the page limit and the per-container limit), quickly', () => {
    const t0 = Date.now();
    const got = why(configStudioProblems(cfg(FAN()), null));
    assert.ok(got.includes('canvases[0].blocks:too_many'), got.slice(0, 3).join(' '));
    assert.ok(got.includes('canvases[0].blocks[101].parent:too_many'), 'the 101st child names its parent');
    assert.ok(Date.now() - t0 < 5000);
  });
  test('the one-page save answers the 400 body the studio reads', async () => {
    const stored = cfg([box('g')]);
    const r = await replaceConfigPage(stored, 'p1', page('p1', [box('g', { parent: 'g' })]), await pageRev(stored.canvases[0]));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_studio_doc');
    assert.equal(r.body.path, 'canvases[0].blocks[0].parent');
    assert.equal(r.body.reason, 'self_parent');
  });
  test('a sound tree, with a button that opens its dialog and one that picks a tab, is accepted', () => {
    const blocks = [
      box('g'), leaf('a', 'g'),
      { id: 't', kind: 'tabs', x: 500, y: 0, w: 400, h: 300, props: { tabs: ['A', 'B'] } }, leaf('b', 't', { slot: 1 }),
      { id: 'm', kind: 'modal', x: 1400, y: 0, w: 400, h: 300, props: { title: 'Hi' } }, leaf('c', 'm'),
      { ...leaf('btn'), y: 500, action: [{ type: 'tab', target: 't', index: 1 }, { type: 'modal', target: 'm' }] },
      { ...leaf('rev'), y: 560, action: [{ type: 'reveal', target: 'g', mode: 'toggle' }] },
    ];
    assert.deepEqual(configStudioProblems(cfg(blocks), null), []);
  });
});

// ── Over HTTP (DATABASE_URL) ─────────────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the HTTP half';
process.env.JWT_SECRET ||= 'studio-containers-test-secret';
const STAMP = Date.now().toString(36);
const TAG = `stubox-${STAMP}-`;
const KEY = `sbx${STAMP}`;
let p, app;
const U = {};

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  await p.project.create({ data: { key: KEY, name: `${TAG}${KEY}` } });
  await p.adminSetting.create({ data: { key: `project.${KEY}`, value: { studioEnabled: true, canvases: [page('p1', [box('g')])] } } });
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  const u = await p.user.create({ data: { email: `${TAG}admin@bettercommunity.invalid`, displayName: `${TAG}admin`, role: 'ADMIN', totpEnabled: true, emailVerified: true } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  U.ADMIN = { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}` };
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/projects.mjs')).default);
  await app.register((await import('../src/routes/studio.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    const ids = Object.values(U).map((x) => x.user.id);
    await p.projectConfigRevision.deleteMany({ where: { target: KEY } });
    await p.projectVersion.deleteMany({ where: { target: KEY } });
    await p.adminSetting.deleteMany({ where: { key: `project.${KEY}` } });
    await p.project.deleteMany({ where: { key: KEY } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: ids } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await app?.close();
  }
});

async function savePage(blocks) {
  const row = await p.adminSetting.findUnique({ where: { key: `project.${KEY}` } });
  const base = await pageRev(row.value.canvases[0]);
  return app.inject({ method: 'PUT', url: `/admin/projects/${KEY}/studio/pages/p1`, headers: { cookie: U.ADMIN.cookie }, payload: { canvas: page('p1', blocks), base } });
}

describe('over HTTP', { skip }, () => {
  test('the studio save refuses every hostile tree with its path, and stores nothing', async () => {
    const stored = (await p.adminSetting.findUnique({ where: { key: `project.${KEY}` } })).value;
    for (const [name, blocks, path, reason] of HOSTILE) {
      const r = await savePage(blocks);
      assert.equal(r.statusCode, 400, `${name}: ${r.body.slice(0, 200)}`);
      const body = r.json();
      assert.equal(body.error, 'invalid_studio_doc');
      assert.equal(body.path, `canvases[0].${path}`, name);
      assert.equal(body.reason, reason, name);
    }
    const fan = await savePage(FAN());
    assert.equal(fan.statusCode, 400, fan.body.slice(0, 200));
    assert.equal(fan.json().error, 'invalid_studio_doc');
    assert.ok(fan.json().problems.some((x) => x.path === 'canvases[0].blocks' && x.reason === 'too_many'), JSON.stringify(fan.json().problems.slice(0, 3)));
    // Written out in full it never reaches the validator: the route's body bound answers first.
    assert.equal((await savePage(FAN_FULL())).statusCode, 413);
    assert.deepEqual((await p.adminSetting.findUnique({ where: { key: `project.${KEY}` } })).value, stored);
  });
  test('a sound tree saves, and comes back as it was sent', async () => {
    const blocks = [box('g'), leaf('a', 'g'), { id: 'm', kind: 'modal', x: 1400, y: 0, w: 400, h: 300, props: { title: 'Hi' } }, leaf('c', 'm'),
      { ...leaf('btn'), y: 500, action: [{ type: 'modal', target: 'm' }] }];
    const r = await savePage(blocks);
    assert.equal(r.statusCode, 200, r.body.slice(0, 300));
    const got = (await p.adminSetting.findUnique({ where: { key: `project.${KEY}` } })).value.canvases[0].blocks;
    assert.equal(got.find((b) => b.id === 'a').parent, 'g');
    assert.equal(got.find((b) => b.id === 'c').parent, 'm');
  });
});
