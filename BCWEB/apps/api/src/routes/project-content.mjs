// A project's own content (PLAN-SEPT23 G2 + G3): its release history, its docs and its legal
// pages, for the fixed projects (/projects/:key/…) and the Other projects (/project/:slug/…).
//
// WHO MAY WRITE. Whoever may edit the project's page: canEditProject / canEditShowcase, the
// predicates the page config uses, behind requireEditor (a session with 2FA on). Nothing else.
// In particular NOT manage_docs or manage_legal: those are the site's, and the site's rows
// (DocPage, LegalSection, LegalPage) are not reachable from here at all. The target of every
// write is computed from the URL, never read from the body, and `kind` is `doc` or `legal`.
// test/project-content.test.mjs proves both halves: an editor of A cannot touch B, and no
// project editor changes a single site legal row.
//
// WHO MAY READ. Whoever may see the page (canViewPage on its visibility; an unpublished Other
// project is a 404), and its editors, who also see drafts (published: false).
//
// The rules that do not need a database (schemas, languages, the GitHub mapping) live in
// lib/project-content.mjs, where they are unit-tested.
import { z } from 'zod';
import { db, requireEditor, optionalAuth, canViewPage, canEditProject, canEditShowcase, currentUser, logAudit, clientIp, httpUrl } from '../lib/lib.mjs';
import { isProjectKey } from '../lib/project-keys.mjs';
import { safeFetch } from '../lib/net.mjs';
import { gh, repoOf } from './projects.mjs';
import {
  KINDS, LIMITS, VERSION_RE, slugifyDoc, compactContent, contentSize,
  docWriteSchema, releaseWriteSchema, cleanRelease, toDate, releasesFromGithub,
  githubMarkdownSource, importMarkdown, rawUrl,
} from '../lib/project-content.mjs';

/** Every page of one project, every language, counted in characters of stored JSON. */
const MAX_TARGET_CHARS = 6_000_000;
const IMPORT_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };

const kindParam = z.enum(KINDS);

// optionalAuth hands over the token's claims, which carry no capabilities; requireEditor hands
// over the live ones. canEdit* read `perms`, so read them live when they are missing.
async function liveUser(req) {
  if (!req.user?.uid) return null;
  if (Array.isArray(req.user.perms)) return req.user;
  const cur = await currentUser(req.user.uid);
  if (cur.exists === false) return null;
  return { ...req.user, role: cur.role || req.user.role, perms: cur.perms || [] };
}

/**
 * The project a request names, whether the caller may see it, and whether they may edit it.
 * Answers the refusal itself and returns null when the request stops here.
 */
async function resolveTarget(p, req, reply, scope) {
  const user = await liveUser(req);
  if (scope === 'project') {
    const key = String(req.params.key || '');
    if (!(await isProjectKey(key))) { reply.code(404).send({ error: 'unknown_project' }); return null; }
    const canEdit = !!user && (await canEditProject(user, key));
    if (!canEdit && key !== 'community') {
      const row = await p.project.findUnique({ where: { key }, select: { visibility: true, visibilityWhitelist: true } });
      if (row && !(await canViewPage(p, row, req))) { reply.code(403).send({ error: 'no_access' }); return null; }
    }
    const config = (await p.adminSetting.findUnique({ where: { key: `project.${key}` } }))?.value || null;
    return { target: key, canEdit, config, label: key };
  }
  const slug = String(req.params.slug || '').slice(0, 120);
  const row = await p.showcaseProject.findUnique({
    where: { slug }, select: { id: true, slug: true, published: true, visibility: true, visibilityWhitelist: true, config: true },
  });
  if (!row) { reply.code(404).send({ error: 'not_found' }); return null; }
  const canEdit = !!user && (await canEditShowcase(user, row.id));
  if (!canEdit) {
    if (!row.published) { reply.code(404).send({ error: 'not_found' }); return null; }
    if (!(await canViewPage(p, row, req))) { reply.code(403).send({ error: 'no_access' }); return null; }
  }
  return { target: `sc:${row.id}`, canEdit, config: row.config || null, label: `sc:${row.slug}` };
}

/** resolveTarget, then "and you may edit it": the door of every write. */
async function editTarget(p, req, reply, scope) {
  const t = await resolveTarget(p, req, reply, scope);
  if (!t) return null;
  if (!t.canEdit) { reply.code(403).send({ error: 'forbidden' }); return null; }
  return t;
}

const serRelease = (r) => ({
  version: r.version, channel: r.channel, date: r.date, content: r.content || {}, assets: r.assets || [],
  links: r.links || {}, published: r.published, source: r.source || null, updatedAt: r.updatedAt,
});
const serPageHead = (r) => {
  const langs = {};
  for (const [l, e] of Object.entries(r.content || {})) langs[l] = { title: e?.title || '', category: e?.category || '' };
  return { slug: r.slug, icon: r.icon || null, order: r.order, published: r.published, updatedAt: r.updatedAt, langs };
};
const serPage = (r) => ({
  slug: r.slug, kind: r.kind, icon: r.icon || null, order: r.order, published: r.published,
  content: r.content || {}, source: r.source || null, version: r.version, updatedAt: r.updatedAt, createdAt: r.createdAt,
});

async function targetChars(p, target, excludeId = '') {
  const [row] = await p.$queryRaw`SELECT COALESCE(SUM(octet_length(content::text)), 0)::bigint AS n FROM "ProjectDoc" WHERE target = ${target} AND id <> ${excludeId}`;
  return Number(row?.n || 0);
}

/** A slug nobody on this project uses yet: the one asked for, else -2, -3… */
async function freeSlug(p, target, kind, base) {
  const root = base.slice(0, 74);
  for (let i = 1; i < 200; i++) {
    const s = i === 1 ? root : `${root}-${i}`;
    if (!(await p.projectDoc.findUnique({ where: { target_kind_slug: { target, kind, slug: s } }, select: { id: true } }))) return s;
  }
  return `${root}-${Date.now().toString(36)}`;
}

async function fetchText(url, max) {
  const res = await safeFetch(url, { headers: { 'User-Agent': 'bcweb' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const text = await res.text();
  if (text.length > max) throw new Error('too_large');
  return text;
}

export default async function projectContentRoutes(app) {
  // ── Summary: which tabs have something to show ─────────────────────────────────────────
  const summary = async (req, reply, scope) => {
    const p = await db();
    const t = await resolveTarget(p, req, reply, scope);
    if (!t) return reply;
    const pub = t.canEdit ? {} : { published: true };
    const [releases, docs, legal] = await Promise.all([
      p.projectRelease.count({ where: { target: t.target, ...pub } }),
      p.projectDoc.count({ where: { target: t.target, kind: 'doc', ...pub } }),
      p.projectDoc.count({ where: { target: t.target, kind: 'legal', ...pub } }),
    ]);
    return { canEdit: t.canEdit, releases, docs, legal };
  };
  app.get('/projects/:key/content', { preHandler: optionalAuth() }, (req, reply) => summary(req, reply, 'project'));
  app.get('/project/:slug/content', { preHandler: optionalAuth() }, (req, reply) => summary(req, reply, 'showcase'));

  // ── G2: the release history ─────────────────────────────────────────────────────────────
  //
  // One list: the release entries, plus every version that only has a page snapshot (the
  // existing history), plus the live version when neither has it yet. A snapshot-only version
  // shows the downloads its page had; the reader can still open the page as it was.
  const changelog = async (req, reply, scope) => {
    const p = await db();
    const t = await resolveTarget(p, req, reply, scope);
    if (!t) return reply;
    const [rels, snaps] = await Promise.all([
      p.projectRelease.findMany({ where: { target: t.target, ...(t.canEdit ? {} : { published: true }) }, orderBy: { date: 'desc' }, take: LIMITS.releases }),
      // Only the downloads out of each snapshot: a config can carry whole studio pages, and
      // this is a public list.
      p.$queryRaw`SELECT version, "createdAt", config->'downloads' AS downloads FROM "ProjectVersion" WHERE target = ${t.target}`,
    ]);
    const current = typeof t.config?.version === 'string' ? t.config.version.trim() : '';
    const snapBy = new Map(snaps.map((s) => [s.version, s]));
    const dl = (s) => (Array.isArray(s?.downloads) ? s.downloads : [])
      .filter((d) => d && typeof d.url === 'string' && /^https?:\/\//.test(d.url))
      .slice(0, LIMITS.assets)
      .map((d) => ({ label: String(d.label || d.url).slice(0, 160), url: d.url, size: null, checksum: null, platform: null }));
    const entries = rels.map((r) => {
      const s = snapBy.get(r.version);
      const e = serRelease(r);
      return { ...e, assets: e.assets.length ? e.assets : dl(s), snapshot: !!s, current: r.version === current };
    });
    const have = new Set(entries.map((e) => e.version));
    for (const s of snaps) {
      if (have.has(s.version)) continue;
      have.add(s.version);
      entries.push({ version: s.version, channel: 'stable', date: s.createdAt, content: {}, assets: dl(s), links: {}, published: true, source: null, snapshot: true, snapshotOnly: true, current: s.version === current });
    }
    if (current && !have.has(current)) {
      entries.push({ version: current, channel: 'stable', date: null, content: {}, assets: dl({ downloads: t.config?.downloads }), links: {}, published: true, source: null, snapshot: true, snapshotOnly: true, current: true });
    }
    // Newest first; an undated live version leads.
    entries.sort((a, b) => (b.date ? new Date(b.date).getTime() : Infinity) - (a.date ? new Date(a.date).getTime() : Infinity));
    return { canEdit: t.canEdit, current, entries };
  };
  app.get('/projects/:key/changelog', { preHandler: optionalAuth() }, (req, reply) => changelog(req, reply, 'project'));
  app.get('/project/:slug/changelog', { preHandler: optionalAuth() }, (req, reply) => changelog(req, reply, 'showcase'));

  // Write one release entry. The URL's version is its identity; `rename` moves it.
  const saveRelease = async (req, reply, scope) => {
    const p = await db();
    const t = await editTarget(p, req, reply, scope);
    if (!t) return reply;
    const version = String(req.params.version || '').trim();
    if (!VERSION_RE.test(version)) return reply.code(400).send({ error: 'invalid_version' });
    const b = releaseWriteSchema.extend({ rename: z.string().trim().regex(VERSION_RE).optional() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', issues: b.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const data = cleanRelease(b.data);
    const date = b.data.date ? toDate(b.data.date) : null;
    const existing = await p.projectRelease.findUnique({ where: { target_version: { target: t.target, version } } });
    if (!existing && (await p.projectRelease.count({ where: { target: t.target } })) >= LIMITS.releases) {
      return reply.code(409).send({ error: 'limit', limit: LIMITS.releases });
    }
    const next = b.data.rename && b.data.rename !== version ? b.data.rename : version;
    if (next !== version && (await p.projectRelease.findUnique({ where: { target_version: { target: t.target, version: next } }, select: { id: true } }))) {
      return reply.code(409).send({ error: 'version_taken' });
    }
    const row = existing
      ? await p.projectRelease.update({ where: { id: existing.id }, data: { ...data, version: next, ...(date ? { date } : {}), updatedById: req.user.uid } })
      : await p.projectRelease.create({ data: { target: t.target, ...data, version: next, date: date || new Date(), updatedById: req.user.uid } });
    await logAudit(p, req.user.uid, existing ? 'project.release.edited' : 'project.release.created', `${t.label} ${next}`, clientIp(req));
    return { ok: true, release: serRelease(row) };
  };
  app.put('/projects/:key/changelog/:version', { preHandler: requireEditor() }, (req, reply) => saveRelease(req, reply, 'project'));
  app.put('/project/:slug/changelog/:version', { preHandler: requireEditor() }, (req, reply) => saveRelease(req, reply, 'showcase'));

  const deleteRelease = async (req, reply, scope) => {
    const p = await db();
    const t = await editTarget(p, req, reply, scope);
    if (!t) return reply;
    const gone = await p.projectRelease.deleteMany({ where: { target: t.target, version: String(req.params.version || '') } });
    if (!gone.count) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'project.release.deleted', `${t.label} ${req.params.version}`, clientIp(req));
    return { ok: true };
  };
  app.delete('/projects/:key/changelog/:version', { preHandler: requireEditor() }, (req, reply) => deleteRelease(req, reply, 'project'));
  app.delete('/project/:slug/changelog/:version', { preHandler: requireEditor() }, (req, reply) => deleteRelease(req, reply, 'showcase'));

  // Import the GitHub releases of the project's repository (its release-notes repo, else its
  // GitHub link, the same `repoOf` the Activity tab reads, or a URL in the body). Adds the
  // versions the history does not have; never overwrites one somebody has written.
  const importReleases = async (req, reply, scope) => {
    const p = await db();
    const t = await editTarget(p, req, reply, scope);
    if (!t) return reply;
    const fromBody = typeof req.body?.github === 'string' && req.body.github.trim() ? repoOf({ links: { github: req.body.github.trim() } }) : null;
    const src = fromBody || repoOf(t.config);
    if (!src) return reply.code(400).send({ error: 'no_github' });
    if (![src.owner, src.repo].every((s) => /^[A-Za-z0-9_.-]{1,100}$/.test(s))) return reply.code(400).send({ error: 'no_github' });
    let list;
    try { list = await gh(`https://api.github.com/repos/${src.owner}/${src.repo}/releases?per_page=100`); }
    catch (e) { return reply.code(502).send({ error: 'github_unreachable', detail: String(e.message).slice(0, 80) }); }
    const found = releasesFromGithub(list);
    const have = new Set((await p.projectRelease.findMany({ where: { target: t.target }, select: { version: true } })).map((r) => r.version));
    const room = Math.max(0, LIMITS.releases - have.size);
    const add = found.filter((r) => !have.has(r.version)).slice(0, room);
    if (add.length) {
      await p.projectRelease.createMany({
        data: add.map((r) => ({
          target: t.target, version: r.version, channel: r.channel, date: r.date ? new Date(r.date) : new Date(),
          content: r.content, assets: r.assets, links: r.links, published: true, source: 'github', updatedById: req.user.uid,
        })),
        skipDuplicates: true,
      });
      await logAudit(p, req.user.uid, 'project.release.imported', `${t.label} ${add.length} from ${src.owner}/${src.repo}`, clientIp(req));
    }
    return { ok: true, found: found.length, created: add.length, skipped: found.length - add.length, repo: `${src.owner}/${src.repo}` };
  };
  app.post('/projects/:key/changelog/import', { preHandler: requireEditor(), config: IMPORT_LIMIT }, (req, reply) => importReleases(req, reply, 'project'));
  app.post('/project/:slug/changelog/import', { preHandler: requireEditor(), config: IMPORT_LIMIT }, (req, reply) => importReleases(req, reply, 'showcase'));

  // ── G3: docs and legal pages ────────────────────────────────────────────────────────────
  const listPages = async (req, reply, scope) => {
    const kind = kindParam.safeParse(req.params.kind);
    if (!kind.success) return reply.code(400).send({ error: 'invalid_kind' });
    const p = await db();
    const t = await resolveTarget(p, req, reply, scope);
    if (!t) return reply;
    const rows = await p.projectDoc.findMany({
      where: { target: t.target, kind: kind.data, ...(t.canEdit ? {} : { published: true }) },
      orderBy: [{ order: 'asc' }, { slug: 'asc' }], take: LIMITS.pagesPerKind,
      select: { slug: true, icon: true, order: true, published: true, updatedAt: true, content: true },
    });
    return { canEdit: t.canEdit, kind: kind.data, pages: rows.map(serPageHead) };
  };
  app.get('/projects/:key/pages/:kind', { preHandler: optionalAuth() }, (req, reply) => listPages(req, reply, 'project'));
  app.get('/project/:slug/pages/:kind', { preHandler: optionalAuth() }, (req, reply) => listPages(req, reply, 'showcase'));

  const getPage = async (req, reply, scope) => {
    const kind = kindParam.safeParse(req.params.kind);
    if (!kind.success) return reply.code(400).send({ error: 'invalid_kind' });
    const p = await db();
    const t = await resolveTarget(p, req, reply, scope);
    if (!t) return reply;
    const row = await p.projectDoc.findUnique({ where: { target_kind_slug: { target: t.target, kind: kind.data, slug: String(req.params.pslug || '') } } });
    if (!row || (!row.published && !t.canEdit)) return reply.code(404).send({ error: 'not_found' });
    return { canEdit: t.canEdit, page: serPage(row) };
  };
  app.get('/projects/:key/pages/:kind/:pslug', { preHandler: optionalAuth() }, (req, reply) => getPage(req, reply, 'project'));
  app.get('/project/:slug/pages/:kind/:pslug', { preHandler: optionalAuth() }, (req, reply) => getPage(req, reply, 'showcase'));

  // Where an imported page came from: shown as a link under it, so https only.
  const writeSchema = docWriteSchema.extend({ source: z.object({ url: httpUrl(600).refine((u) => /^https:\/\//.test(u)) }).optional() });
  const bad = (reply, r) => reply.code(400).send({ error: 'invalid_input', issues: r.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })) });

  const createPage = async (req, reply, scope) => {
    const kind = kindParam.safeParse(req.params.kind);
    if (!kind.success) return reply.code(400).send({ error: 'invalid_kind' });
    const p = await db();
    const t = await editTarget(p, req, reply, scope);
    if (!t) return reply;
    const b = writeSchema.safeParse(req.body || {});
    if (!b.success) return bad(reply, b);
    const content = compactContent(b.data.content);
    if ((await p.projectDoc.count({ where: { target: t.target, kind: kind.data } })) >= LIMITS.pagesPerKind) {
      return reply.code(409).send({ error: 'limit', kind: 'count', limit: LIMITS.pagesPerKind });
    }
    if ((await targetChars(p, t.target)) + contentSize(content) > MAX_TARGET_CHARS) {
      return reply.code(409).send({ error: 'limit', kind: 'size', limitKB: Math.round(MAX_TARGET_CHARS / 1024) });
    }
    const title = content.en?.title || Object.values(content).find((e) => e.title)?.title || '';
    let slug;
    if (b.data.slug) {
      if (await p.projectDoc.findUnique({ where: { target_kind_slug: { target: t.target, kind: kind.data, slug: b.data.slug } }, select: { id: true } })) {
        return reply.code(409).send({ error: 'slug_taken' });
      }
      slug = b.data.slug;
    } else slug = await freeSlug(p, t.target, kind.data, slugifyDoc(title));
    const row = await p.projectDoc.create({
      data: {
        target: t.target, kind: kind.data, slug, icon: b.data.icon || null, order: b.data.order ?? 0,
        published: b.data.published !== false, content,
        source: b.data.source ? { url: b.data.source.url, importedAt: new Date().toISOString() } : undefined,
        updatedById: req.user.uid,
      },
    });
    await logAudit(p, req.user.uid, `project.${kind.data}.created`, `${t.label} ${slug}`, clientIp(req));
    return reply.code(201).send({ ok: true, page: serPage(row) });
  };
  app.post('/projects/:key/pages/:kind', { preHandler: requireEditor() }, (req, reply) => createPage(req, reply, 'project'));
  app.post('/project/:slug/pages/:kind', { preHandler: requireEditor() }, (req, reply) => createPage(req, reply, 'showcase'));

  const updatePage = async (req, reply, scope) => {
    const kind = kindParam.safeParse(req.params.kind);
    if (!kind.success) return reply.code(400).send({ error: 'invalid_kind' });
    const p = await db();
    const t = await editTarget(p, req, reply, scope);
    if (!t) return reply;
    const b = writeSchema.safeParse(req.body || {});
    if (!b.success) return bad(reply, b);
    const row = await p.projectDoc.findUnique({ where: { target_kind_slug: { target: t.target, kind: kind.data, slug: String(req.params.pslug || '') } } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    // Somebody else saved since this editor loaded: hand back what is there so it can merge.
    if (b.data.baseVersion != null && b.data.baseVersion !== row.version) {
      return reply.code(409).send({ error: 'conflict', current: { content: row.content, version: row.version } });
    }
    const content = compactContent(b.data.content);
    if ((await targetChars(p, t.target, row.id)) + contentSize(content) > MAX_TARGET_CHARS) {
      return reply.code(409).send({ error: 'limit', kind: 'size', limitKB: Math.round(MAX_TARGET_CHARS / 1024) });
    }
    let slug = row.slug;
    if (b.data.slug && b.data.slug !== row.slug) {
      if (await p.projectDoc.findUnique({ where: { target_kind_slug: { target: t.target, kind: kind.data, slug: b.data.slug } }, select: { id: true } })) {
        return reply.code(409).send({ error: 'slug_taken' });
      }
      slug = b.data.slug;
    }
    // The version check and the write are one statement, so two saves cannot both pass it.
    const done = await p.projectDoc.updateMany({
      where: { id: row.id, version: row.version },
      data: {
        slug, content, version: { increment: 1 }, updatedById: req.user.uid,
        ...(b.data.icon !== undefined ? { icon: b.data.icon || null } : {}),
        ...(b.data.order !== undefined ? { order: b.data.order } : {}),
        ...(b.data.published !== undefined ? { published: b.data.published } : {}),
      },
    });
    if (!done.count) {
      const cur = await p.projectDoc.findUnique({ where: { id: row.id } });
      return reply.code(409).send({ error: 'conflict', current: cur ? { content: cur.content, version: cur.version } : null });
    }
    await logAudit(p, req.user.uid, `project.${kind.data}.edited`, `${t.label} ${slug}`, clientIp(req));
    return { ok: true, page: serPage(await p.projectDoc.findUnique({ where: { id: row.id } })) };
  };
  app.put('/projects/:key/pages/:kind/:pslug', { preHandler: requireEditor() }, (req, reply) => updatePage(req, reply, 'project'));
  app.put('/project/:slug/pages/:kind/:pslug', { preHandler: requireEditor() }, (req, reply) => updatePage(req, reply, 'showcase'));

  const deletePage = async (req, reply, scope) => {
    const kind = kindParam.safeParse(req.params.kind);
    if (!kind.success) return reply.code(400).send({ error: 'invalid_kind' });
    const p = await db();
    const t = await editTarget(p, req, reply, scope);
    if (!t) return reply;
    const gone = await p.projectDoc.deleteMany({ where: { target: t.target, kind: kind.data, slug: String(req.params.pslug || '') } });
    if (!gone.count) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, `project.${kind.data}.deleted`, `${t.label} ${req.params.pslug}`, clientIp(req));
    return { ok: true };
  };
  app.delete('/projects/:key/pages/:kind/:pslug', { preHandler: requireEditor() }, (req, reply) => deletePage(req, reply, 'project'));
  app.delete('/project/:slug/pages/:kind/:pslug', { preHandler: requireEditor() }, (req, reply) => deletePage(req, reply, 'showcase'));

  // Read markdown out of a GitHub repository and hand it back as DRAFTS. Nothing is saved here:
  // the editor shows what was found and the person creates the pages they want, through the
  // create route above and its checks. GitHub only (githubMarkdownSource), through safeFetch.
  const importPages = async (req, reply, scope) => {
    const kind = kindParam.safeParse(req.params.kind);
    if (!kind.success) return reply.code(400).send({ error: 'invalid_kind' });
    const p = await db();
    const t = await editTarget(p, req, reply, scope);
    if (!t) return reply;
    const src = githubMarkdownSource(req.body?.url);
    if (!src) return reply.code(400).send({ error: 'unsupported_url' });
    try {
      if (!src.branch) {
        const meta = await gh(`https://api.github.com/repos/${src.owner}/${src.repo}`);
        src.branch = String(meta?.default_branch || 'main');
        if (!/^[A-Za-z0-9_.-]{1,100}$/.test(src.branch)) return reply.code(400).send({ error: 'unsupported_url' });
      }
      if (src.kind === 'file') {
        const md = await fetchText(rawUrl(src, src.path), LIMITS.importBytes);
        const d = importMarkdown(md, src, src.path);
        return { drafts: [{ ...d, category: '', path: src.path, url: `https://github.com/${src.owner}/${src.repo}/blob/${src.branch}/${src.path}` }] };
      }
      const tree = await gh(`https://api.github.com/repos/${src.owner}/${src.repo}/git/trees/${encodeURIComponent(src.branch)}?recursive=1`);
      const base = src.path.replace(/^\/+|\/+$/g, '');
      const files = (tree?.tree || [])
        .filter((e) => e.type === 'blob' && /\.md$/i.test(e.path) && (!base || e.path.startsWith(`${base}/`)))
        .sort((a, b) => a.path.localeCompare(b.path));
      const picked = files.slice(0, LIMITS.importFiles);
      const drafts = [];
      for (const f of picked) {
        try {
          const md = await fetchText(rawUrl(src, f.path), LIMITS.importBytes);
          const d = importMarkdown(md, src, f.path);
          const rel = base ? f.path.slice(base.length + 1) : f.path;
          const folders = rel.split('/').slice(0, -1);
          drafts.push({ ...d, category: folders.join(' / ').slice(0, 120), path: f.path, url: `https://github.com/${src.owner}/${src.repo}/blob/${src.branch}/${f.path}` });
        } catch { /* one unreadable file does not sink the folder */ }
      }
      return { drafts, total: files.length, truncated: files.length > picked.length };
    } catch (e) {
      return reply.code(502).send({ error: 'github_unreachable', detail: String(e.message).slice(0, 80) });
    }
  };
  app.post('/projects/:key/pages/:kind/import', { preHandler: requireEditor(), config: IMPORT_LIMIT }, (req, reply) => importPages(req, reply, 'project'));
  app.post('/project/:slug/pages/:kind/import', { preHandler: requireEditor(), config: IMPORT_LIMIT }, (req, reply) => importPages(req, reply, 'showcase'));
}

