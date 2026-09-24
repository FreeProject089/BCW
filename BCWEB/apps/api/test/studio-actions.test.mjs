// Studio block actions, refused on SAVE (PLAN-STUDIO-2026 2.5, tests 3.3.2, phase 5).
//
// The vocabulary and its rules are the studio package's (packages/studio/src/actions.js), run by
// validateDoc; web/test/studio-actions.test.mjs covers each rule and the renderer's plan. This
// file covers the API's half: a hostile action is a 400 `invalid_studio_doc` naming the field,
// through the lib functions every route uses and, with DATABASE_URL, over HTTP on the studio's
// own save route; the link policy is an admin setting (GET public, PUT admin) that the save
// reads fresh; a legacy value already stored is tolerated under its new path (D5).
//
// MUTATION CHECK (by hand, studio phase 5, run with DATABASE_URL): with the
// `actionProblems(b.action, actx, push)` line commented out of packages/studio/src/validate.js,
// 7 of this file's 10 tests fail (the web's studio-actions.test.mjs: 18 of 30). With
// `hostAllowed` answering true, 3 fail here (the one-page save, the policy test, the HTTP policy
// test) and 3 on the web. Restored, all green.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { configStudioProblems, sectionsStudioProblems, replaceConfigPage, pageRev, studioValidateOpts, LINK_POLICY_KEY } from '../src/lib/studio-doc.mjs';
import { lockRow, unlockRow } from './row-lock.mjs';

const BS = String.fromCharCode(92);
const page = (id, blocks) => ({ id, title: id, blocks });
const box = (id, action, extra = {}) => ({ id, kind: 'box', x: 0, y: 0, w: 100, h: 80, ...(action ? { action } : {}), ...extra });
const cfg = (blocks) => ({ canvases: [page('p1', blocks)] });
const why = (list) => list.map((p) => `${p.path}:${p.reason}`);

// The hostile corpus of 3.3.2, each with the field path the API must name.
const HOSTILE = [
  [[{ type: 'navigate', to: 'javascript:alert(1)' }], 'action[0].to', 'unsafe_url'],
  [[{ type: 'navigate', to: ' JaVaScRiPt:alert(1)' }], 'action[0].to', 'unsafe_url'],
  [[{ type: 'navigate', to: 'data:text/html,x' }], 'action[0].to', 'unsafe_url'],
  [[{ type: 'navigate', to: 'vbscript:x' }], 'action[0].to', 'unsafe_url'],
  [[{ type: 'navigate', to: '//evil.example' }], 'action[0].to', 'unsafe_url'],
  [[{ type: 'navigate', to: `/${BS}evil.example` }], 'action[0].to', 'unsafe_url'],
  [[{ type: 'navigate', to: '/%2F%2Fevil.example' }], 'action[0].to', 'unsafe_url'],
  [[{ type: 'navigate', to: '/%5Cevil.example' }], 'action[0].to', 'unsafe_url'],
  [[{ type: 'external', url: 'http://evil.example' }], 'action[0].url', 'https_only'],
  [[{ type: 'external', url: 'javascript:alert(1)' }], 'action[0].url', 'unsafe_url'],
  [[{ type: 'submit', endpoint: 'admin.users.delete' }], 'action[0].endpoint', 'unknown_endpoint'],
  [[{ type: 'download', file: 'https://evil.example/x.exe' }], 'action[0].file', 'unsafe_url'],
  [[{ type: 'scroll', target: 'body > div' }], 'action[0].target', 'bad_scroll_target'],
  [[{ type: 'modal', target: 'b0' }], 'action[0].type', 'reserved_action'],
  [[{ type: 'api', path: '/admin/users', method: 'POST' }], 'action[0].type', 'api_removed'],
  [[1, 2, 3, 4, 5, 6].map(() => ({ type: 'copy', text: 'x' })), 'action', 'too_many'],
];

describe('a hostile action is refused on save, with the path of the field', () => {
  test('through configStudioProblems (every config route)', () => {
    for (const [action, path, reason] of HOSTILE) {
      const got = why(configStudioProblems(cfg([box('b0', action)]), null));
      assert.ok(got.includes(`canvases[0].blocks[0].${path}:${reason}`), `${JSON.stringify(action)} -> ${JSON.stringify(got)}`);
    }
  });
  test('through the home sections too', () => {
    const got = why(sectionsStudioProblems([{ id: 's', canvas: page('h', [box('b0', [{ type: 'navigate', to: '//evil.example' }])]) }], []));
    assert.deepEqual(got, ['customSections[0].canvas.blocks[0].action[0].to:unsafe_url']);
  });
  test('the one-page save answers the 400 body the studio reads', async () => {
    const stored = cfg([box('b0')]);
    const r = await replaceConfigPage(stored, 'p1', page('p1', [box('b0', [{ type: 'external', url: 'https://evil.example' }])]), await pageRev(stored.canvases[0]),
      { links: { mode: 'allow', hosts: ['github.com'] } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_studio_doc');
    assert.equal(r.body.path, 'canvases[0].blocks[0].action[0].url');
    assert.equal(r.body.reason, 'host_not_allowed');
  });
  test('a well-formed action is accepted', () => {
    const ok = [
      [{ type: 'copy', text: 'CODE' }, { type: 'reveal', target: 'b1', mode: 'show' }, { type: 'navigate', to: '/docs' }],
      [{ type: 'external', url: 'https://github.com/x' }],
      [{ type: 'submit', endpoint: 'poll.vote', fields: { pollId: 'cl1', optionIds: ['o1'] } }],
      [{ type: 'download', asset: 'setup.exe' }],
    ];
    for (const action of ok) assert.deepEqual(configStudioProblems(cfg([box('b0', action), box('b1', null, { hidden: true })]), null), [], JSON.stringify(action));
  });
});

describe('the link policy decides at save', () => {
  test('an off-allowlist host is refused; the same host passes the default policy', () => {
    const next = cfg([box('b0', [{ type: 'external', url: 'https://evil.example/x' }])]);
    assert.deepEqual(configStudioProblems(next, null), []);
    assert.deepEqual(why(configStudioProblems(next, null, { links: { mode: 'allow', hosts: ['github.com'] } })), ['canvases[0].blocks[0].action[0].url:host_not_allowed']);
    assert.deepEqual(why(configStudioProblems(next, null, { links: { mode: 'block', hosts: ['evil.example'] } })), ['canvases[0].blocks[0].action[0].url:host_not_allowed']);
  });
  test('studioValidateOpts without a database answers the default', async () => {
    assert.deepEqual(await studioValidateOpts(null), { links: { mode: 'block', hosts: [] } });
  });
});

describe('legacy values already stored (D5)', () => {
  test('a stored api button is tolerated when the studio writes it back as a step, and refused when new', () => {
    const stored = cfg([{ id: 'b0', kind: 'button', props: { label: 'x', action: { type: 'api', path: '/admin/x' } } }]);
    // What the studio sends back for that page: the same button, now as an `action` step.
    const next = cfg([{ id: 'b0', kind: 'button', props: { label: 'x' }, action: [{ type: 'api' }] }]);
    assert.deepEqual(configStudioProblems(next, stored), []);
    // The same thing on a block that did not have it: refused.
    const added = cfg([{ id: 'b0', kind: 'button', props: { label: 'x' }, action: [{ type: 'api' }] }, { id: 'b9', kind: 'button', props: { label: 'y' }, action: [{ type: 'api' }] }]);
    assert.deepEqual(why(configStudioProblems(added, stored)), ['canvases[0].blocks[1].action[0].type:api_removed']);
  });
  test('a stored plain-http link, upgraded to https on the way back, is simply accepted', () => {
    const stored = cfg([box('b0', null, { link: 'http://example.org' })]);
    const next = cfg([box('b0', [{ type: 'external', url: 'https://example.org' }])]);
    assert.deepEqual(configStudioProblems(next, stored), []);
  });
});

// ── Over HTTP (DATABASE_URL) ─────────────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the HTTP half';
process.env.JWT_SECRET ||= 'studio-actions-test-secret';
const STAMP = Date.now().toString(36);
const TAG = `stuact-${STAMP}-`;
const KEY = `sac${STAMP}`;
let p, app, policyBefore = null;
const U = {};

async function mkUser(name, role) {
  const u = await p.user.create({ data: { email: `${TAG}${name}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role, totpEnabled: true, emailVerified: true } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  U[name] = { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}` };
}

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  await lockRow(p, LINK_POLICY_KEY);
  policyBefore = await p.adminSetting.findUnique({ where: { key: LINK_POLICY_KEY } });
  await p.adminSetting.deleteMany({ where: { key: LINK_POLICY_KEY } });
  await p.project.create({ data: { key: KEY, name: `${TAG}${KEY}` } });
  await p.adminSetting.create({ data: { key: `project.${KEY}`, value: { studioEnabled: true, canvases: [page('p1', [box('b0')])] } } });
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  await mkUser('ADMIN', 'ADMIN');
  await mkUser('USER', 'USER');
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
    if (policyBefore) await p.adminSetting.upsert({ where: { key: LINK_POLICY_KEY }, create: { key: LINK_POLICY_KEY, value: policyBefore.value }, update: { value: policyBefore.value } });
    else await p.adminSetting.deleteMany({ where: { key: LINK_POLICY_KEY } });
  } finally {
    await unlockRow(p, LINK_POLICY_KEY);
    await app?.close();
  }
});

async function savePage(blocks) {
  const row = await p.adminSetting.findUnique({ where: { key: `project.${KEY}` } });
  const base = await pageRev(row.value.canvases[0]);
  return app.inject({ method: 'PUT', url: `/admin/projects/${KEY}/studio/pages/p1`, headers: { cookie: U.ADMIN.cookie }, payload: { canvas: page('p1', blocks), base } });
}

describe('over HTTP', { skip }, () => {
  test('the studio save refuses every hostile action with its path, and stores nothing', async () => {
    const before = (await p.adminSetting.findUnique({ where: { key: `project.${KEY}` } })).value;
    for (const [action, path, reason] of HOSTILE) {
      const r = await savePage([box('b0', action)]);
      assert.equal(r.statusCode, 400, `${JSON.stringify(action)}: ${r.body}`);
      const body = r.json();
      assert.equal(body.error, 'invalid_studio_doc');
      assert.equal(body.path, `canvases[0].blocks[0].${path}`, JSON.stringify(action));
      assert.equal(body.reason, reason);
    }
    assert.deepEqual((await p.adminSetting.findUnique({ where: { key: `project.${KEY}` } })).value, before);
  });

  test('the link policy: public read, admin write, strict, and read fresh by the save', async () => {
    assert.deepEqual((await app.inject({ method: 'GET', url: '/site/studio-links' })).json(), { mode: 'block', hosts: [] });
    assert.equal((await app.inject({ method: 'PUT', url: '/admin/studio/links', headers: { cookie: U.USER.cookie }, payload: { mode: 'allow', hosts: [] } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: '/admin/studio/links', payload: { mode: 'allow', hosts: [] } })).statusCode, 401);
    const bad = await app.inject({ method: 'PUT', url: '/admin/studio/links', headers: { cookie: U.ADMIN.cookie }, payload: { mode: 'allow', hosts: ['github.com', 'not a host'] } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().path, 'hosts[1]');
    // Before the policy: any https host saves.
    assert.equal((await savePage([box('b0', [{ type: 'external', url: 'https://evil.example/' }])])).statusCode, 200);
    const put = await app.inject({ method: 'PUT', url: '/admin/studio/links', headers: { cookie: U.ADMIN.cookie }, payload: { mode: 'allow', hosts: ['GitHub.com'] } });
    assert.equal(put.statusCode, 200, put.body);
    assert.deepEqual(put.json(), { mode: 'allow', hosts: ['github.com'] });
    assert.deepEqual((await app.inject({ method: 'GET', url: '/site/studio-links' })).json(), { mode: 'allow', hosts: ['github.com'] });
    // The stored host is now off the list: tolerated as already stored (D5), refused on a new block.
    const again = await savePage([box('b0', [{ type: 'external', url: 'https://evil.example/' }]), box('b1', [{ type: 'external', url: 'https://evil.example/2' }])]);
    assert.equal(again.statusCode, 400, again.body);
    assert.equal(again.json().path, 'canvases[0].blocks[1].action[0].url');
    assert.equal(again.json().reason, 'host_not_allowed');
    assert.equal((await savePage([box('b0', [{ type: 'external', url: 'https://docs.github.com/x' }])])).statusCode, 200);
  });
});
