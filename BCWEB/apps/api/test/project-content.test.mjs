// A project's releases, docs and legal pages (PLAN-SEPT23 G2 + G3), and who may write them.
//
// Two halves.
//
// PURE (always runs): the rules in lib/project-content.mjs, the language a reader gets, what a
// release may carry (no javascript: download, no javascript: blog link), how GitHub's release
// list and a repository's markdown become entries, and which URLs an import will read at all.
//
// OVER HTTP (needs DATABASE_URL, like every DB test here): the doors.
//   · every write route, for every actor: anonymous 401, a signed-in USER 403, the editor of
//     ANOTHER project 403, the editor without 2FA 403 2fa_required, the editor 2xx;
//   · pentest R10: a project editor cannot rewrite the SITE's legal pages. The /admin/legal
//     routes refuse them, `kind` is doc|legal and nothing else, a body naming another target is
//     ignored, and after every attempt the site's legal rows (and site docs) are byte-identical;
//   · readers: a draft is the editors' only, a private project refuses anonymous readers, an
//     unpublished Other project is a 404;
//   · a hostile body is stored as written (the renderer sanitises it, proved on the web side in
//     apps/web/test/project-content-render.test.mjs), and a stale save answers 409.
//
// MUTATION CHECK, run by hand 2026-09-23: replacing `if (!t.canEdit)` in editTarget with
// `if (false)` turns the door test red on its first refusal row (a plain USER creating a page on
// project A: 201 instead of 403). Restored, 12/12.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  pickLang, normalizeChecksum, releasesFromGithub, versionFromTag, breakingFrom, githubMarkdownSource,
  importMarkdown, releaseWriteSchema, docWriteSchema, slugifyDoc, compactContent,
} from '../src/lib/project-content.mjs';

// ── pure ─────────────────────────────────────────────────────────────────────────────────
describe('project content: pure rules', () => {
  test('a reader gets their language, else English, and is told when it is a fallback', () => {
    const c = { en: { title: 'Hello' }, fr: { title: 'Bonjour' } };
    assert.deepEqual([pickLang(c, 'fr').lang, pickLang(c, 'fr').fallback], ['fr', false]);
    assert.deepEqual([pickLang(c, 'de').lang, pickLang(c, 'de').fallback], ['en', true]);
    assert.deepEqual([pickLang({ de: { title: 'Hallo' } }, 'fr').lang, pickLang({ de: { title: 'Hallo' } }, 'fr').fallback], ['de', true]);
    assert.equal(pickLang({}, 'en').entry, null);
    assert.equal(pickLang(null, 'en').lang, null);
  });

  test('checksums are normalised, and junk is refused rather than stored', () => {
    const hex = 'A'.repeat(64);
    assert.equal(normalizeChecksum(`sha256:${hex}`), `sha256:${'a'.repeat(64)}`);
    assert.equal(normalizeChecksum(`SHA256-${hex}`), `sha256:${'a'.repeat(64)}`);
    assert.equal(normalizeChecksum('b'.repeat(40)), `sha1:${'b'.repeat(40)}`);
    assert.equal(normalizeChecksum(''), '');
    assert.equal(normalizeChecksum('not a hash'), null);
    assert.equal(normalizeChecksum('sha256:xyz'), null);
  });

  test('a release write refuses a javascript: download and a javascript: blog link', () => {
    const base = { content: { en: { title: 'x' } } };
    assert.equal(releaseWriteSchema.safeParse({ ...base, assets: [{ label: 'a', url: 'javascript:alert(1)' }] }).success, false);
    assert.equal(releaseWriteSchema.safeParse({ ...base, assets: [{ label: 'a', url: '//evil.example/x' }] }).success, false);
    assert.equal(releaseWriteSchema.safeParse({ ...base, links: { blog: 'javascript:alert(1)' } }).success, false);
    assert.equal(releaseWriteSchema.safeParse({ ...base, links: { github: 'data:text/html,x' } }).success, false);
    assert.equal(releaseWriteSchema.safeParse({ ...base, assets: [{ label: 'a', url: 'https://x.example/a.zip', checksum: 'nope' }] }).success, false);
    assert.equal(releaseWriteSchema.safeParse({ ...base, channel: 'evil' }).success, false);
    const ok = releaseWriteSchema.safeParse({ ...base, channel: 'beta', date: '2026-09-01', links: { blog: '/blog/v2-is-out', github: 'https://github.com/o/r/releases/tag/v2' }, assets: [{ label: 'Setup', url: 'https://x.example/a.exe', size: 1234, checksum: `sha256:${'c'.repeat(64)}` }] });
    assert.equal(ok.success, true, JSON.stringify(ok.error?.issues));
  });

  test('a doc write needs a title somewhere, and language keys must be language codes', () => {
    assert.equal(docWriteSchema.safeParse({ content: { en: { title: '', body: 'x' } } }).success, false);
    assert.equal(docWriteSchema.safeParse({ content: { '../x': { title: 'T' } } }).success, false);
    assert.equal(docWriteSchema.safeParse({ content: { fr: { title: 'T' } } }).success, true);
    assert.equal(docWriteSchema.safeParse({ slug: 'Bad Slug', content: { en: { title: 'T' } } }).success, false);
    assert.deepEqual(Object.keys(compactContent({ en: { title: 'T', body: '' }, fr: { title: '', body: '' } })), ['en']);
    assert.equal(slugifyDoc('Politique de confidentialité.md'), 'politique-de-confidentialite');
    assert.equal(slugifyDoc('***'), 'page');
  });

  test('GitHub releases become entries: drafts skipped, channels, sizes and digests kept', () => {
    const digest = `sha256:${'d'.repeat(64)}`;
    const out = releasesFromGithub([
      { tag_name: 'v2.0.0', name: 'The big one', published_at: '2026-09-01T10:00:00Z', html_url: 'https://github.com/o/r/releases/tag/v2.0.0', body: '## New\n- a\n## Breaking changes\n- removed X\n- renamed Y\n', assets: [{ name: 'setup.exe', size: 1024, browser_download_url: 'https://github.com/o/r/releases/download/v2.0.0/setup.exe', digest }] },
      { tag_name: 'v2.1.0-rc.1', prerelease: true, published_at: '2026-09-10T10:00:00Z', assets: [] },
      { tag_name: 'v2.1.0-beta', prerelease: true, published_at: '2026-09-05T10:00:00Z' },
      { tag_name: 'v3.0.0', draft: true },
      { tag_name: 'v2.0.0', name: 'duplicate' },
      { tag_name: 'x', assets: [{ name: 'evil', browser_download_url: 'javascript:alert(1)' }] },
    ]);
    assert.deepEqual(out.map((r) => r.version), ['2.0.0', '2.1.0-rc.1', '2.1.0-beta', 'x']);
    assert.deepEqual(out.map((r) => r.channel), ['stable', 'rc', 'beta', 'stable']);
    assert.equal(out[0].content.en.title, 'The big one');
    assert.deepEqual(out[0].content.en.breaking, ['removed X', 'renamed Y']);
    assert.deepEqual(out[0].assets[0], { label: 'setup.exe', url: 'https://github.com/o/r/releases/download/v2.0.0/setup.exe', size: 1024, checksum: digest, platform: null });
    assert.equal(out[0].links.github, 'https://github.com/o/r/releases/tag/v2.0.0');
    assert.deepEqual(out[3].assets, [], 'a javascript: asset URL is dropped');
    assert.equal(versionFromTag('V1.2'), '1.2');
    assert.equal(versionFromTag('version-1'), 'version-1');
    assert.deepEqual(breakingFrom('# Notes\n- a'), []);
  });

  test('an import reads GitHub only, and nothing that climbs out of the repository', () => {
    assert.deepEqual(githubMarkdownSource('https://github.com/o/r/blob/main/docs/intro.md'), { kind: 'file', owner: 'o', repo: 'r', branch: 'main', path: 'docs/intro.md' });
    assert.deepEqual(githubMarkdownSource('https://raw.githubusercontent.com/o/r/main/README.md'), { kind: 'file', owner: 'o', repo: 'r', branch: 'main', path: 'README.md' });
    assert.deepEqual(githubMarkdownSource('https://github.com/o/r/tree/dev/docs/guide'), { kind: 'dir', owner: 'o', repo: 'r', branch: 'dev', path: 'docs/guide' });
    assert.deepEqual(githubMarkdownSource('https://github.com/o/r.git'), { kind: 'dir', owner: 'o', repo: 'r', branch: null, path: 'docs' });
    for (const bad of [
      'http://github.com/o/r/blob/main/a.md', 'https://evil.example/o/r/blob/main/a.md', 'https://github.com.evil.example/o/r',
      'https://github.com/o/r/blob/main/../../x.md', 'https://github.com/o/r/blob/main/a.txt', 'javascript:alert(1)', 'https://127.0.0.1/a.md',
      'https://raw.githubusercontent.com/o/r/main/%2e%2e/x.md', '',
    ]) assert.equal(githubMarkdownSource(bad), null, bad);
  });

  test('imported markdown: the H1 becomes the title, relative images and links point at GitHub', () => {
    const src = { owner: 'o', repo: 'r', branch: 'main' };
    const d = importMarkdown('# Getting started\n\n![shot](img/a.png) see [next](../other.md#top) or [site](https://x.example) [anchor](#here)\n', src, 'docs/guide/intro.md');
    assert.equal(d.title, 'Getting started');
    assert.equal(d.slug, 'intro');
    assert.match(d.body, /!\[shot\]\(https:\/\/raw\.githubusercontent\.com\/o\/r\/main\/docs\/guide\/img\/a\.png\)/);
    assert.match(d.body, /\[next\]\(https:\/\/github\.com\/o\/r\/blob\/main\/docs\/other\.md#top\)/);
    assert.match(d.body, /\[site\]\(https:\/\/x\.example\)/);
    assert.match(d.body, /\[anchor\]\(#here\)/);
    assert.doesNotMatch(d.body, /^# Getting started/m);
    assert.equal(importMarkdown('text', src, 'docs/README.md').slug, 'docs');
  });
});

// ── over HTTP ────────────────────────────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the project content doors';
// lib.mjs is already loaded (the pure half imports it above), so it read JWT_SECRET, or its
// dev fallback, at import time. Sign with that; setting the variable now would change nothing.
const SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

const STAMP = Date.now().toString(36);
const TAG = `pcont-${STAMP}-`;
const KA = `pct${STAMP}a`;
const KB = `pct${STAMP}b`;
let p, app, seq = 0;
const A = {};
const F = {};

async function actor(name, data = {}, grants = []) {
  const u = await p.user.create({ data: { email: `${TAG}${name}-${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true, emailVerified: true, ...data } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  for (const g of grants) await p.projectPermission.create({ data: { userId: u.id, rights: ['pages'], grantedBy: A.ADMIN?.user.id || u.id, ...g } });
  A[name] = { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, SECRET)}` };
}
async function call(name, method, url, payload) {
  const headers = name ? { cookie: A[name].cookie } : {};
  const res = await app.inject({ method, url, headers, payload });
  let body = null; try { body = res.json(); } catch { /* not json */ }
  return { status: res.statusCode, body };
}
/** Every row of the site's legal pages and docs, hashed: what "untouched" means. */
async function siteFingerprint() {
  const [sections, pages, cats, versions, docs] = await Promise.all([
    p.legalSection.findMany({ orderBy: { id: 'asc' } }),
    p.legalPage.findMany({ orderBy: { id: 'asc' } }),
    p.legalCategory.findMany({ orderBy: { id: 'asc' } }),
    p.legalVersion.findMany({ orderBy: { id: 'asc' } }),
    p.docPage.findMany({ orderBy: { id: 'asc' } }),
  ]);
  return createHash('sha256').update(JSON.stringify({ sections, pages, cats, versions, docs })).digest('hex');
}

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  for (const k of [KA, KB]) {
    await p.project.create({ data: { key: k, name: `${TAG}${k}` } });
    await p.adminSetting.create({ data: { key: `project.${k}`, value: { name: k, version: '1.0.0', downloads: [{ label: 'Setup', url: 'https://example.com/setup.exe' }] } } });
  }
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  const X = await p.showcaseProject.create({ data: { slug: `${TAG}x`, name: `${TAG}X`, short: 'PX', published: true, config: {} } });
  const H = await p.showcaseProject.create({ data: { slug: `${TAG}hidden`, name: `${TAG}H`, short: 'PH', published: false, config: {} } });
  F.X = X.id; F.slugX = X.slug; F.H = H.id; F.slugH = H.slug;
  await actor('ADMIN', { role: 'ADMIN' });
  await actor('USER');
  await actor('editorA', {}, [{ projectKey: KA }]);
  await actor('editorX', {}, [{ showcaseProjectId: X.id }]);
  await actor('editorH', {}, [{ showcaseProjectId: H.id }]);
  await actor('editorA_no2fa', { totpEnabled: false }, [{ projectKey: KA }]);
  // A studio-only grant on A: draws the page, does not edit its words, so no docs either.
  await actor('studioOnlyA', {}, []);
  await p.projectPermission.create({ data: { userId: A.studioOnlyA.user.id, rights: ['studio'], grantedBy: A.ADMIN.user.id, projectKey: KA } });

  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.register((await import('../src/routes/docs.mjs')).default);
  await app.register((await import('../src/routes/project-content.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    const targets = [KA, KB, `sc:${F.X}`, `sc:${F.H}`];
    await p.projectDoc.deleteMany({ where: { target: { in: targets } } });
    await p.projectRelease.deleteMany({ where: { target: { in: targets } } });
    await p.projectVersion.deleteMany({ where: { target: { in: targets } } });
    const ids = (await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    const none = ids.length ? ids : ['-'];
    await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
    await p.adminSetting.deleteMany({ where: { key: { in: [`project.${KA}`, `project.${KB}`] } } });
    await p.project.deleteMany({ where: { key: { in: [KA, KB] } } });
    await p.showcaseProject.deleteMany({ where: { slug: { startsWith: TAG } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: none } } });
    await p.user.deleteMany({ where: { id: { in: none } } });
    (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  } finally { await app?.close(); }
});

const doc = (title, body = 'Body') => ({ content: { en: { title, body, category: 'Guides / Setup' }, fr: { title: `${title} FR`, body: 'Corps' } } });
const release = { channel: 'stable', date: '2026-09-01', content: { en: { title: 'First', highlights: ['a'], notes: 'n', breaking: [] } }, assets: [{ label: 'Setup', url: 'https://example.com/s.exe', size: 10, checksum: `sha256:${'e'.repeat(64)}` }] };

describe('project content over HTTP', { skip }, () => {
  test('every write door: anonymous, USER, another project’s editor, no 2FA, studio-only are refused', async () => {
    // Seed one page and one release on each target so the PUT/DELETE rows hit something real.
    assert.equal((await call('editorA', 'POST', `/projects/${KA}/pages/doc`, { ...doc('Seed'), slug: 'seed' })).status, 201);
    assert.equal((await call('editorA', 'PUT', `/projects/${KA}/changelog/1.0.0`, release)).status, 200);
    assert.equal((await call('editorX', 'POST', `/project/${F.slugX}/pages/legal`, { ...doc('Privacy'), slug: 'privacy' })).status, 201);
    assert.equal((await call('editorX', 'PUT', `/project/${F.slugX}/changelog/1.0.0`, release)).status, 200);

    const doors = (base) => [
      ['POST', `${base}/pages/doc`, doc('New')],
      ['PUT', `${base}/pages/${base.startsWith('/projects') ? 'doc/seed' : 'legal/privacy'}`, doc('Changed')],
      ['DELETE', `${base}/pages/${base.startsWith('/projects') ? 'doc/seed' : 'legal/privacy'}`],
      ['POST', `${base}/pages/doc/import`, { url: 'https://evil.example/x.md' }],
      ['PUT', `${base}/changelog/1.0.0`, release],
      ['DELETE', `${base}/changelog/1.0.0`],
      ['POST', `${base}/changelog/import`, { github: 'https://github.com/o/r' }],
    ];
    const refusals = [
      [null, `/projects/${KA}`, 401], ['USER', `/projects/${KA}`, 403], ['editorX', `/projects/${KA}`, 403],
      ['studioOnlyA', `/projects/${KA}`, 403], ['editorA_no2fa', `/projects/${KA}`, 403],
      [null, `/project/${F.slugX}`, 401], ['USER', `/project/${F.slugX}`, 403], ['editorA', `/project/${F.slugX}`, 403],
      ['editorA', `/projects/${KB}`, 403], ['editorH', `/project/${F.slugX}`, 403],
    ];
    let n = 0;
    for (const [who, base, want] of refusals) {
      for (const [m, url, body] of doors(base)) {
        const r = await call(who, m, url, body);
        assert.equal(r.status, want, `${who || 'anonymous'} ${m} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
        if (who === 'editorA_no2fa') assert.equal(r.body?.error, '2fa_required');
        n++;
      }
    }
    assert.ok(n >= 70, `${n} refusals sent`);
    // Nothing moved.
    assert.equal((await p.projectDoc.findUnique({ where: { target_kind_slug: { target: KA, kind: 'doc', slug: 'seed' } } })).content.en.title, 'Seed');
    assert.equal(await p.projectDoc.count({ where: { target: { in: [KA, KB, `sc:${F.X}`] } } }), 2);
    assert.equal(await p.projectRelease.count({ where: { target: { in: [KA, KB, `sc:${F.X}`] } } }), 2);

    // And the editor's own doors open (the import ones answer 400 on a non-GitHub URL, which is
    // past the door: a route that did not exist would be a 404).
    assert.equal((await call('editorA', 'PUT', `/projects/${KA}/pages/doc/seed`, doc('Changed'))).status, 200);
    assert.equal((await call('editorA', 'POST', `/projects/${KA}/pages/doc/import`, { url: 'https://evil.example/x.md' })).status, 400);
    assert.equal((await call('editorX', 'PUT', `/project/${F.slugX}/pages/legal/privacy`, doc('Privacy 2'))).status, 200);
    assert.equal((await call('ADMIN', 'PUT', `/projects/${KB}/pages/legal/none`, doc('x'))).status, 404, 'an admin passes the door, then finds no page');
  });

  test('R10: a project editor cannot rewrite the site’s legal pages', async () => {
    const before = await siteFingerprint();
    const someSection = await p.legalSection.findFirst({ select: { id: true } });
    const someId = someSection?.id || 'no-such-section';
    // The site's own legal routes: manage_legal, which a project grant does not carry.
    for (const [m, url, body] of [
      ['GET', '/admin/legal'],
      ['PUT', `/admin/legal/${someId}`, { body: 'pwned' }],
      ['POST', '/admin/legal', { doc: 'privacy', title: 'pwned', body: 'pwned' }],
      ['DELETE', `/admin/legal/${someId}`],
      ['POST', '/admin/legal/import', { doc: 'privacy', sections: [{ title: 'pwned', body: 'pwned' }] }],
      ['POST', '/admin/legal/pages', { key: `${TAG}pwn`, label: 'pwned' }],
      ['POST', '/admin/legal/revert', { doc: 'privacy' }],
      // The site's docs likewise: manage_docs.
      ['POST', '/docs', { title: 'pwned', body: 'pwned' }],
    ]) {
      const r = await call('editorA', m, url, body);
      assert.equal(r.status, 403, `editorA ${m} ${url} → ${r.status}`);
    }
    // The project routes cannot be pointed at anything but the project's own pages.
    for (const kind of ['site', 'legalsection', 'LEGAL', '..', 'privacy']) {
      const r = await call('editorA', 'POST', `/projects/${KA}/pages/${encodeURIComponent(kind)}`, doc('pwned'));
      // `..` never reaches the route (the router normalises it away): a 404, still a refusal.
      assert.equal(r.status, kind === '..' ? 404 : 400, `kind=${kind} → ${r.status}`);
    }
    for (const key of ['..', 'site', 'legal', '%2E%2E']) {
      const r = await call('editorA', 'POST', `/projects/${key}/pages/legal`, doc('pwned'));
      assert.ok([403, 404].includes(r.status), `key=${key} → ${r.status}`);
    }
    // A body that names another target or kind is not read: the page lands on A, as a legal page.
    const r = await call('editorA', 'POST', `/projects/${KA}/pages/legal`, { ...doc('Privacy policy'), slug: 'privacy', target: 'site', kind: 'site', doc: 'privacy' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const row = await p.projectDoc.findUnique({ where: { target_kind_slug: { target: KA, kind: 'legal', slug: 'privacy' } } });
    assert.ok(row, 'stored as the project’s legal page');
    assert.equal(await p.projectDoc.count({ where: { target: 'site' } }), 0);
    // The site's legal pages are exactly what they were.
    assert.equal(await siteFingerprint(), before, 'a site legal or docs row changed');
    const site = await call(null, 'GET', '/legal');
    assert.equal(site.status, 200);
    assert.doesNotMatch(JSON.stringify(site.body), /Privacy policy FR|pwned/);
  });

  test('readers: drafts are the editors’, a private project and an unpublished page refuse', async () => {
    await call('editorA', 'POST', `/projects/${KA}/pages/doc`, { ...doc('Draft page'), slug: 'draft', published: false });
    const anon = await call(null, 'GET', `/projects/${KA}/pages/doc`);
    assert.equal(anon.status, 200);
    assert.equal(anon.body.canEdit, false);
    assert.ok(!anon.body.pages.some((x) => x.slug === 'draft'), 'a draft listed to a visitor');
    assert.equal((await call(null, 'GET', `/projects/${KA}/pages/doc/draft`)).status, 404);
    const ed = await call('editorA', 'GET', `/projects/${KA}/pages/doc`);
    assert.equal(ed.body.canEdit, true);
    assert.ok(ed.body.pages.some((x) => x.slug === 'draft'));
    assert.deepEqual(Object.keys(ed.body.pages.find((x) => x.slug === 'seed').langs).sort(), ['en', 'fr']);
    assert.equal((await call('editorA', 'GET', `/projects/${KA}/pages/doc/draft`)).status, 200);

    await p.project.update({ where: { key: KA }, data: { visibility: 'private' } });
    try {
      assert.equal((await call(null, 'GET', `/projects/${KA}/pages/doc`)).status, 403);
      assert.equal((await call('USER', 'GET', `/projects/${KA}/changelog`)).status, 403);
      assert.equal((await call('editorA', 'GET', `/projects/${KA}/pages/doc`)).status, 200, 'the editor still reads a private page');
    } finally { await p.project.update({ where: { key: KA }, data: { visibility: 'public' } }); }

    assert.equal((await call(null, 'GET', `/project/${F.slugH}/pages/legal`)).status, 404);
    assert.equal((await call('editorH', 'GET', `/project/${F.slugH}/pages/legal`)).status, 200);
    assert.equal((await call(null, 'GET', `/projects/${KA}/pages/nope`)).status, 400);
  });

  test('the history: releases, snapshot-only versions and the live one, drafts hidden', async () => {
    await p.projectVersion.create({ data: { target: KA, version: '0.9.0', config: { downloads: [{ label: 'Old', url: 'https://example.com/old.exe' }, { label: 'bad', url: 'javascript:alert(1)' }] }, createdAt: new Date('2026-01-01T00:00:00Z') } });
    await call('editorA', 'PUT', `/projects/${KA}/changelog/2.0.0-beta`, { ...release, channel: 'beta', date: '2026-09-10', published: false });
    const anon = await call(null, 'GET', `/projects/${KA}/changelog`);
    assert.equal(anon.status, 200);
    const vs = anon.body.entries.map((e) => e.version);
    assert.deepEqual(vs, ['1.0.0', '0.9.0'], `anonymous sees ${vs}`);
    const v1 = anon.body.entries[0];
    assert.equal(v1.current, true);
    assert.equal(v1.assets[0].checksum, `sha256:${'e'.repeat(64)}`);
    const old = anon.body.entries[1];
    assert.equal(old.snapshotOnly, true);
    assert.deepEqual(old.assets.map((a) => a.url), ['https://example.com/old.exe'], 'a javascript: download from a snapshot is not listed');
    const ed = await call('editorA', 'GET', `/projects/${KA}/changelog`);
    assert.deepEqual(ed.body.entries.map((e) => e.version), ['2.0.0-beta', '1.0.0', '0.9.0']);
    // Rename, then a clash.
    assert.equal((await call('editorA', 'PUT', `/projects/${KA}/changelog/2.0.0-beta`, { ...release, rename: '2.0.0-rc.1' })).status, 200);
    assert.equal((await call('editorA', 'PUT', `/projects/${KA}/changelog/2.0.0-rc.1`, { ...release, rename: '1.0.0' })).status, 409);
    assert.equal((await call('editorA', 'PUT', `/projects/${KA}/changelog/..%2Fx`, release)).status, 400);
    assert.equal((await call('editorA', 'DELETE', `/projects/${KA}/changelog/2.0.0-rc.1`)).status, 200);
    assert.equal((await call('editorA', 'DELETE', `/projects/${KA}/changelog/2.0.0-rc.1`)).status, 404);
    const sum = await call(null, 'GET', `/projects/${KA}/content`);
    assert.equal(sum.status, 200);
    assert.equal(sum.body.releases, 1);
  });

  test('a hostile body is stored as written, and a stale save is refused', async () => {
    const hostile = '<script>alert(1)</script>\n\n[go](javascript:alert(1))\n\n<img src=x onerror="alert(1)">';
    const r = await call('editorA', 'POST', `/projects/${KA}/pages/doc`, { content: { en: { title: 'Hostile', body: hostile } }, slug: 'hostile' });
    assert.equal(r.status, 201);
    const got = await call(null, 'GET', `/projects/${KA}/pages/doc/hostile`);
    // Text in a JSON string. What makes it harmless is the renderer, which the web test runs.
    assert.equal(got.body.page.content.en.body, hostile);
    assert.equal(typeof got.body.page.content.en.body, 'string');

    const v = got.body.page.version;
    assert.equal((await call('editorA', 'PUT', `/projects/${KA}/pages/doc/hostile`, { content: { en: { title: 'H2', body: 'x' } }, baseVersion: v })).status, 200);
    const stale = await call('editorA', 'PUT', `/projects/${KA}/pages/doc/hostile`, { content: { en: { title: 'H3', body: 'y' } }, baseVersion: v });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.current.content.en.title, 'H2');
    // Slugs: taken, then auto-suffixed.
    assert.equal((await call('editorA', 'POST', `/projects/${KA}/pages/doc`, { ...doc('Hostile'), slug: 'hostile' })).status, 409);
    const auto = await call('editorA', 'POST', `/projects/${KA}/pages/doc`, { content: { en: { title: 'Hostile' } } });
    assert.equal(auto.body.page.slug, 'hostile-2');
  });
});
