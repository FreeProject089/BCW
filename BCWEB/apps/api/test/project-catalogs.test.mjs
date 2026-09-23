// G4 — a project's own catalogues.
//
// Pure half: what a config may hold. Every link and picture ends up in an <a href> or an
// <img src> on a public page, so http(s) only (`z.string().url()` accepts javascript:); tags
// must come from the project's vocabulary; an unknown key anywhere is refused (strict
// allowlist, not a passthrough); an uploaded feed is narrowed to the one array its kind reads.
//
// DB half, over HTTP: who may CONFIGURE a project's catalogues. The rule is the page editor's
// own (canEditProject / canEditShowcase behind requireEditor's 2FA wall), restated by hand in
// `may()` below rather than imported, and every refused request must leave nothing written.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'project-catalogs-test-secret';
const { normalizeConfig, inlineDisplay, feedOf, urlsOfConfig, BUILTIN_TAGS } = await import('../src/lib/project-catalogs.mjs');

const custom = (entries, extra = {}) => ({
  catalogs: [{ id: 'maps', name: 'Maps', format: 'custom', fields: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'link', label: 'Link', type: 'url' },
    { key: 'shot', label: 'Picture', type: 'image' },
    { key: 'tags', label: 'Tags', type: 'tags' },
  ], entries }],
  ...extra,
});

describe('what a catalogue config may hold', () => {
  test('a clean custom catalogue is kept, and every entry gets an id', () => {
    const out = normalizeConfig(custom([{ title: 'Dust', link: 'https://example.com/dust', tags: ['utility'] }]), { isOfficial: false });
    assert.ok(out.config, JSON.stringify(out));
    const e = out.config.catalogs[0].entries[0];
    assert.equal(e.title, 'Dust');
    assert.match(e.id, /^[a-z0-9-]+$/);
  });

  for (const [name, v] of [['javascript:', 'javascript:alert(1)'], ['data:', 'data:text/html,<b>x</b>'], ['a bare word', 'not a url'], ['java\\nscript:', 'java\nscript:alert(1)']]) {
    test(`a link that is ${name} is refused`, () => {
      assert.equal(normalizeConfig(custom([{ title: 'x', link: v }]), { isOfficial: false }).error, 'invalid_value_url');
      assert.equal(normalizeConfig(custom([{ title: 'x', shot: v }]), { isOfficial: false }).error, 'invalid_value_url');
    });
  }

  test('tags come from the vocabulary: built-in or the project\'s own', () => {
    assert.equal(normalizeConfig(custom([{ title: 'x', tags: ['nope'] }]), { isOfficial: false }).error, 'invalid_value_unknown_tag');
    const own = normalizeConfig(custom([{ title: 'x', tags: ['maps'] }], { tags: [{ key: 'maps', label: 'Maps', icon: 'globe' }] }), { isOfficial: false });
    assert.ok(own.config);
    assert.equal(normalizeConfig(custom([], { tags: [{ key: 'utility', label: 'Mine', icon: 'globe' }] }), { isOfficial: false }).error, 'tag_is_builtin');
  });

  test('a tag icon is a kit name, never a URL', () => {
    const r = normalizeConfig(custom([], { tags: [{ key: 'x', label: 'X', icon: 'https://evil.example/a.svg' }] }), { isOfficial: false });
    assert.equal(r.error, 'invalid_config');
  });

  test('a required value that is missing is refused', () => {
    assert.equal(normalizeConfig(custom([{ link: 'https://a.example' }]), { isOfficial: false }).error, 'required_value');
  });

  test('unknown keys are refused, not passed through', () => {
    assert.equal(normalizeConfig({ catalogs: [], owner: 'me' }, { isOfficial: true }).error, 'invalid_config');
    const c = custom([]); c.catalogs[0].style = 'x';
    assert.equal(normalizeConfig(c, { isOfficial: true }).error, 'invalid_config');
  });

  test('the official source exists only on an official project', () => {
    const cfg = { catalogs: [{ id: 'apps', name: 'Apps', format: 'bmm', source: 'official', kind: 'APP' }] };
    assert.equal(normalizeConfig(cfg, { isOfficial: false }).error, 'official_source_needs_official_project');
    assert.ok(normalizeConfig(cfg, { isOfficial: true }).config);
  });

  test('an inline feed keeps only the array its kind reads, and needs it', () => {
    const feed = { name: 'F', plugins: [{ id: 'a', name: 'A', download_url: 'https://x.example/a.bmmplug' }], themes: [{ id: 't' }], secret: 'x' };
    const ok = normalizeConfig({ catalogs: [{ id: 'p', name: 'Plugins', format: 'bmm', source: 'inline', kind: 'PLUGIN', feed }] }, { isOfficial: false });
    assert.deepEqual(Object.keys(ok.config.catalogs[0].feed).sort(), ['name', 'plugins', 'version']);
    const bad = normalizeConfig({ catalogs: [{ id: 'p', name: 'Plugins', format: 'bmm', source: 'inline', kind: 'THEME', feed: { plugins: [] } }] }, { isOfficial: false });
    assert.equal(bad.error, 'feed_missing_array');
    assert.equal(normalizeConfig({ catalogs: [{ id: 'm', name: 'Mods', format: 'bmm', source: 'inline', kind: 'MODPACK', feed: {} }] }, { isOfficial: false }).error, 'inline_kind_unsupported');
  });

  test('what a reader sees of an inline feed is whitelisted, and a non-http link is dropped', () => {
    const rows = inlineDisplay('PLUGIN', { plugins: [{ id: 'a', name: 'A', download_url: 'javascript:alert(1)', icon_url: 'data:image/svg+xml,x', password: 'hunter2' }] });
    assert.equal(rows[0].url, null);
    assert.equal(rows[0].icon, null);
    assert.ok(!JSON.stringify(rows).includes('hunter2'));
  });

  test('the feed of a custom catalogue declares its schema', () => {
    const { config } = normalizeConfig(custom([{ title: 'Dust' }]), { isOfficial: false });
    const f = feedOf(config.catalogs[0], 'Proj');
    assert.equal(f.format, 'custom');
    assert.equal(f.fields.length, 4);
    assert.equal(f.entries[0].title, 'Dust');
  });

  test('every address is collected for the takedown blocklist', () => {
    const { config } = normalizeConfig(custom([{ title: 'x', link: 'https://a.example/1', shot: 'https://b.example/2.png' }]), { isOfficial: false });
    assert.deepEqual(urlsOfConfig(config).sort(), ['https://a.example/1', 'https://b.example/2.png']);
  });

  test('built-in tags draw from the bundled icon set', () => {
    for (const t of BUILTIN_TAGS) assert.match(t.icon, /^[a-z-]+$/, t.key);
  });
});

// ── Who may configure them ────────────────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the project-catalogue permission tests';
const STAMP = Date.now().toString(36);
const TAG = `pcat-${STAMP}-`;
const KA = `pc${STAMP}a`;
const KB = `pc${STAMP}b`;
let p, app, seq = 0;
const A = {};
const F = {};

async function actor(name, data = {}, spec = {}) {
  const u = await p.user.create({ data: { email: `${TAG}${name}-${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true, emailVerified: true, ...data } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  A[name] = { user: u, spec, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}` };
}

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  for (const k of [KA, KB]) await p.project.create({ data: { key: k, name: `${TAG}${k}` } });
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  F.X = (await p.showcaseProject.create({ data: { slug: `${TAG}x`, name: `${TAG}X`, short: 'SX' } })).id;
  F.Y = (await p.showcaseProject.create({ data: { slug: `${TAG}y`, name: `${TAG}Y`, short: 'SY' } })).id;
  await actor('USER');
  await actor('MOD', { role: 'MOD' });
  await actor('grantA', {}, { projects: [KA] });
  await actor('grantX', {}, { showcases: ['X'] });
  await actor('manageProjects', { permissions: ['manage_projects'] }, { caps: ['manage_projects'] });
  await actor('ADMIN', { role: 'ADMIN' }, { admin: true });
  await actor('grantA_no2fa', { totpEnabled: false }, { projects: [KA], no2fa: true });
  for (const n of ['grantA', 'grantA_no2fa']) await p.projectPermission.create({ data: { userId: A[n].user.id, projectKey: KA, grantedBy: A.ADMIN.user.id } });
  await p.projectPermission.create({ data: { userId: A.grantX.user.id, showcaseProjectId: F.X, grantedBy: A.ADMIN.user.id } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/project-catalogs.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const users = await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  const none = users.length ? users.map((u) => u.id) : ['-'];
  await p.adminSetting.deleteMany({ where: { key: { in: [`catalogs.project.${KA}`, `catalogs.project.${KB}`, `catalogs.showcase.${F.X}`, `catalogs.showcase.${F.Y}`] } } });
  await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
  await p.project.deleteMany({ where: { key: { in: [KA, KB] } } });
  await p.showcaseProject.deleteMany({ where: { slug: { startsWith: TAG } } });
  await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } }).catch(() => null);
  await p.session.deleteMany({ where: { userId: { in: none } } });
  await p.user.deleteMany({ where: { id: { in: none } } });
  await app?.close();
});

// The rule, by hand: admins everywhere; manage_projects on every official project; a grant on
// exactly the project it names; nobody without 2FA; a MOD is not an editor of anything.
function may(name, t) {
  const s = A[name].spec;
  if (s.no2fa) return false;
  if (s.admin) return true;
  if (t.scope === 'project') return (s.caps || []).includes('manage_projects') || (s.projects || []).includes(t.ref);
  return (s.showcases || []).includes(t.name);
}
const TARGETS = [
  { name: 'A', scope: 'project', ref: KA }, { name: 'B', scope: 'project', ref: KB },
  { name: 'X', scope: 'showcase', ref: 'X' }, { name: 'Y', scope: 'showcase', ref: 'Y' },
];
const refOf = (t) => (t.scope === 'showcase' ? F[t.ref] : t.ref);
const body = { config: { tags: [{ key: 'maps', label: 'Maps', icon: 'globe' }], catalogs: [{ id: 'maps', name: 'Maps', format: 'custom', fields: [{ key: 'title', label: 'Title', type: 'text' }], entries: [{ title: 'Dust' }] }] } };
const settingOf = (t) => p.adminSetting.findUnique({ where: { key: `catalogs.${t.scope}.${refOf(t)}` } });

describe('configuring a project\'s catalogues: who may', () => {
  test('anonymous is refused (401) and nothing is written', { skip }, async () => {
    for (const t of TARGETS) {
      const r = await app.inject({ method: 'PUT', url: `/admin/project-catalogs/${t.scope}/${refOf(t)}`, payload: body });
      assert.equal(r.statusCode, 401, `${t.name}: ${r.body}`);
      assert.equal(await settingOf(t), null);
    }
  });

  test('every refused actor gets 403 (or the 2FA wall), on read AND save, and nothing is written', { skip }, async () => {
    let refusals = 0;
    for (const name of Object.keys(A)) {
      for (const t of TARGETS) {
        if (may(name, t)) continue;
        for (const method of ['GET', 'PUT']) {
          const r = await app.inject({ method, url: `/admin/project-catalogs/${t.scope}/${refOf(t)}`, headers: { cookie: A[name].cookie }, ...(method === 'PUT' ? { payload: body } : {}) });
          const why = r.json()?.error;
          if (A[name].spec.no2fa) assert.equal(r.statusCode, 403, `${name} ${method} ${t.name}`);
          else assert.equal(why, 'forbidden', `${name} ${method} ${t.name}: ${r.statusCode} ${r.body}`);
          refusals++;
        }
        assert.equal(await settingOf(t), null, `${name} wrote ${t.name}`);
      }
    }
    assert.ok(refusals >= 20, `only ${refusals} refusals were exercised`);
  });

  test('the least privileged allowed actor saves, and the public read serves it', { skip }, async () => {
    for (const [name, t] of [['grantA', TARGETS[0]], ['grantX', TARGETS[2]], ['manageProjects', TARGETS[1]]]) {
      assert.ok(may(name, t));
      const r = await app.inject({ method: 'PUT', url: `/admin/project-catalogs/${t.scope}/${refOf(t)}`, headers: { cookie: A[name].cookie }, payload: body });
      assert.equal(r.statusCode, 200, `${name} ${t.name}: ${r.body}`);
      assert.ok(await settingOf(t));
    }
    const pub = await app.inject({ method: 'GET', url: `/project-catalogs/showcase/${TAG}x` });
    assert.equal(pub.statusCode, 200, pub.body);
    assert.equal(pub.json().catalogs[0].id, 'maps');
    assert.ok(pub.json().tags.some((t) => t.key === 'maps'));
    const one = await app.inject({ method: 'GET', url: `/project-catalogs/showcase/${TAG}x/maps` });
    assert.equal(one.json().catalog.entries[0].title, 'Dust');
    const feed = await app.inject({ method: 'GET', url: `/project-catalogs/showcase/${TAG}x/maps/catalog.json` });
    assert.equal(feed.json().format, 'custom');
  });

  test('a grantee cannot smuggle a javascript: link through the save', { skip }, async () => {
    const bad = structuredClone(body);
    bad.config.catalogs[0].fields.push({ key: 'link', label: 'Link', type: 'url' });
    bad.config.catalogs[0].entries[0].link = 'javascript:alert(1)';
    const r = await app.inject({ method: 'PUT', url: `/admin/project-catalogs/project/${KA}`, headers: { cookie: A.grantA.cookie }, payload: bad });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'invalid_value_url');
  });

  test('a private or unpublished other project shows no catalogue to the public', { skip }, async () => {
    await p.showcaseProject.update({ where: { id: F.X }, data: { visibility: 'private' } });
    const r = await app.inject({ method: 'GET', url: `/project-catalogs/showcase/${TAG}x` });
    assert.equal(r.statusCode, 404);
    const list = await app.inject({ method: 'GET', url: '/project-catalogs' });
    assert.ok(!list.json().projects.some((x) => x.ref === `${TAG}x`));
    await p.showcaseProject.update({ where: { id: F.X }, data: { visibility: 'public' } });
  });
});
