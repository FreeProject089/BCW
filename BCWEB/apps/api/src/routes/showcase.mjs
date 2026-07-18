import { z } from 'zod';
import { db, requireCap, requireEditor, optionalAuth, slugify, pageVisibilitySchema, pageAccountEntrySchema, canViewPage, applyScheduledUpdate, canManageShowcase, canEditShowcase, projectGrants } from '../lib/lib.mjs';
import { invalidate, replyCachedJson } from '../lib/cache.mjs';
import { safeFetch } from '../lib/net.mjs';
import { gh, ghCache, versionedRawUrl } from './projects.mjs';

// Cached fetch for progress.json / GitHub release-notes trees / community
// contributors. Shares `ghCache` with projects.mjs (previously a SEPARATE Map
// lived here, so the admin's "Refresh site caches" button — which only clears
// projects.mjs's cache — silently missed every showcase project's cached
// content). One shared Map means one flush actually clears everything.
async function cachedJson(url, headers) {
  const hit = ghCache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const res = await safeFetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const data = await res.json();
  ghCache.set(url, { at: Date.now(), data });
  return data;
}

const configSchema = z.record(z.any());

// Still counting down? The teaser is deliberately shown to EVERYONE regardless
// of `visibility` — an announcement's whole point is to be discoverable/hype-
// building. `visibility` only starts gating the REAL page once the countdown
// ends (see the /showcase/:slug handler below).
function isAnnouncing(row) {
  return row.announceEnabled && row.announceRevealAt && row.announceRevealAt > new Date();
}

export default async function showcaseRoutes(app) {
  const pub = (p) => ({ id: p.id, slug: p.slug, name: p.name, short: p.short, icon: p.icon || null, tagline: p.config?.tagline || '', config: p.config || {}, showBlogTab: p.showBlogTab === true });
  // The countdown block a page carries — shared by the full-takeover teaser and the
  // "first tab" (announceShowPage) mode. Button can point anywhere (blog/docs/URL).
  const countdownOf = (r) => ({
    title: r.announceTitle, logo: r.announceLogo, markdown: r.announceMarkdown, revealAt: r.announceRevealAt,
    button: r.announceButtonUrl ? { label: r.announceButtonLabel || 'Learn more', url: r.announceButtonUrl } : null,
  });

  // ── Public ──
  app.get('/showcase', async (req, reply) => {
    // Same for every visitor (public listing only) → 10s micro-cache + Cache-Control.
    // A scheduled reveal is at most ~10s late, which is fine for a public grid.
    reply.header('Cache-Control', 'public, max-age=10');
    return replyCachedJson(req, reply, 'showcase.list', 10_000, async () => {
      const p = await db();
      const rows0 = await p.showcaseProject.findMany({ where: { published: true }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
      const rows = await Promise.all(rows0.map((r) => applyScheduledUpdate(p, p.showcaseProject, r)));
      // Listing = discovery: only 'public' pages show up here (unlisted/private/
      // whitelist are still directly reachable by slug, just not surfaced) — a
      // still-announcing page IS listed though, so its topbar pill/grid card can
      // show the countdown teaser.
      return {
        projects: rows.filter((r) => r.visibility === 'public' || isAnnouncing(r)).map((r) => ({
          slug: r.slug, name: r.name, short: r.short, icon: r.icon || null, tagline: r.config?.tagline || '',
          pinTopbar: r.pinTopbar, isAnnouncing: isAnnouncing(r), announceTitle: r.announceTitle, announceRevealAt: r.announceRevealAt,
        })),
      };
    });
  });

  app.get('/showcase/:slug', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    let row = await p.showcaseProject.findUnique({ where: { slug: req.params.slug } });
    if (!row || !row.published) return reply.code(404).send({ error: 'not_found' });
    row = await applyScheduledUpdate(p, p.showcaseProject, row);
    // Countdown active. Two modes:
    //  • takeover (default): the countdown IS the page — return it alone.
    //  • showPage: the real page renders too, with the countdown as a first tab —
    //    return BOTH (still gated by visibility, since the page is really shown).
    if (isAnnouncing(row)) {
      if (!row.announceShowPage) return { project: null, announcement: countdownOf(row) };
      if (!(await canViewPage(p, row, req))) return reply.code(403).send({ error: 'no_access' });
      return { project: pub(row), announcement: countdownOf(row), announcementInline: true };
    }
    if (!(await canViewPage(p, row, req))) return reply.code(403).send({ error: 'no_access' });
    return { project: pub(row) };
  });

  // Progress tracker (remote progress.json or inline config.progressData).
  app.get('/showcase/:slug/progress', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const row = await p.showcaseProject.findUnique({ where: { slug: req.params.slug } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (!isAnnouncing(row) && !(await canViewPage(p, row, req))) return reply.code(403).send({ error: 'no_access' });
    const src = row.config?.progressSource;
    if (src && /^https?:\/\//.test(src)) { try { return { progress: await cachedJson(await versionedRawUrl(src)) }; } catch (e) { return reply.code(502).send({ error: 'progress_unreachable', detail: String(e.message) }); } }
    if (row.config?.progressData) return { progress: row.config.progressData };
    return { progress: null };
  });

  // GitHub release-notes listing (same shape as /projects/:key/releases).
  app.get('/showcase/:slug/releases', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const row = await p.showcaseProject.findUnique({ where: { slug: req.params.slug } });
    if (row && !isAnnouncing(row) && !(await canViewPage(p, row, req))) return reply.code(403).send({ error: 'no_access' });
    const rn = row?.config?.releaseNotes;
    if (!rn?.owner || !rn?.repo) return reply.code(404).send({ error: 'no_release_notes' });
    const branch = rn.branch || 'main';
    const base = (rn.path || '').replace(/^\/+|\/+$/g, '');
    try {
      const tree = await cachedJson(`https://api.github.com/repos/${rn.owner}/${rn.repo}/git/trees/${branch}?recursive=1`, { 'User-Agent': 'bcweb', Accept: 'application/vnd.github+json' });
      const files = (tree.tree || [])
        .filter((e) => e.type === 'blob' && /\.md$/i.test(e.path) && (!base || e.path.startsWith(base + '/') || e.path === base))
        .map((e) => { const rel = base ? e.path.slice(base.length + 1) : e.path; const parts = rel.split('/'); return {
          path: e.path, name: parts[parts.length - 1].replace(/\.md$/i, ''), dir: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
          rawUrl: `https://raw.githubusercontent.com/${rn.owner}/${rn.repo}/${branch}/${e.path}?v=${(e.sha || '').slice(0, 8)}` }; })
        .sort((a, b) => b.path.localeCompare(a.path));
      return { source: { owner: rn.owner, repo: rn.repo, branch, path: base }, files };
    } catch (e) { return reply.code(502).send({ error: 'github_unreachable', detail: String(e.message) }); }
  });

  // Community tab data (contributors + messages) for a showcase project — same
  // cached-proxy treatment as core projects' /projects/:key/community.
  app.get('/showcase/:slug/community', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const row = await p.showcaseProject.findUnique({ where: { slug: req.params.slug } });
    if (!row || !row.published) return reply.code(404).send({ error: 'not_found' });
    if (!isAnnouncing(row) && !(await canViewPage(p, row, req))) return reply.code(403).send({ error: 'no_access' });
    const url = row.config?.community?.contributorsUrl;
    if (!url) return { data: null };
    if (!/^https?:\/\//.test(url)) return reply.code(400).send({ error: 'bad_source' });
    try { return { data: await gh(await versionedRawUrl(url)) }; }
    catch (e) { return reply.code(502).send({ error: 'community_unreachable', detail: String(e.message) }); }
  });

  // ── Admin ──
  app.get('/admin/showcase', { preHandler: requireEditor() }, async (req) => {
    const p = await db();
    const manage = canManageShowcase(req.user);
    let rows = await p.showcaseProject.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    // A non-manager grantee sees only the projects they were granted (a blanket
    // allShowcase grant → all of them). Managers/admins see every project.
    if (!manage) {
      const g = await projectGrants(req.user.uid);
      if (!g.allShowcase) rows = rows.filter((r) => g.showcaseIds.has(r.id));
    }
    return {
      canManage: manage, // client hides pin/visibility/announce/publish when false
      projects: rows.map((r) => ({
        id: r.id, slug: r.slug, name: r.name, short: r.short, icon: r.icon, published: r.published, order: r.order, config: r.config,
        showOnHomeNews: r.showOnHomeNews, showBlogTab: r.showBlogTab,
        visibility: r.visibility, visibilityWhitelist: r.visibilityWhitelist, pinTopbar: r.pinTopbar,
        announceEnabled: r.announceEnabled, announceTitle: r.announceTitle, announceLogo: r.announceLogo, announceMarkdown: r.announceMarkdown, announceRevealAt: r.announceRevealAt,
        announceShowPage: r.announceShowPage, announceButtonLabel: r.announceButtonLabel, announceButtonUrl: r.announceButtonUrl,
        scheduledAt: r.scheduledAt, scheduledNext: r.scheduledNext,
      })),
    };
  });

  const upsertSchema = z.object({
    name: z.string().min(2).max(60),
    short: z.string().min(1).max(5),
    icon: z.string().max(500).nullable().optional(),
    config: configSchema.default({}),
    published: z.boolean().default(true),
    order: z.number().int().default(0),
    showOnHomeNews: z.boolean().default(true),
    showBlogTab: z.boolean().default(false),
    visibility: pageVisibilitySchema.default('public'),
    visibilityWhitelist: z.array(pageAccountEntrySchema).max(2000).default([]),
    pinTopbar: z.boolean().default(false),
    announceEnabled: z.boolean().default(false),
    announceTitle: z.string().max(120).default(''),
    announceLogo: z.string().max(500).nullable().optional(),
    announceMarkdown: z.string().max(20000).default(''),
    announceRevealAt: z.string().datetime().nullable().optional(),
    announceShowPage: z.boolean().default(false),
    announceButtonLabel: z.string().max(60).default(''),
    announceButtonUrl: z.string().max(500).default(''),
  });

  // Reserved controls a per-project GRANTEE may never touch — only a manager (admin-tier
  // or the manage_showcase capability). Stripped from a grantee's PUT payload below.
  const RESERVED_SHOWCASE = ['published', 'order', 'visibility', 'visibilityWhitelist', 'pinTopbar', 'announceEnabled', 'announceTitle', 'announceLogo', 'announceMarkdown', 'announceRevealAt', 'announceShowPage', 'announceButtonLabel', 'announceButtonUrl'];

  app.post('/admin/showcase', { preHandler: requireCap('manage_showcase') }, async (req, reply) => {
    const b = upsertSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const p = await db();
    const base = slugify(b.data.name) || 'project';
    let slug = base; for (let i = 1; await p.showcaseProject.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    const { announceRevealAt, ...data } = b.data;
    const row = await p.showcaseProject.create({ data: { ...data, slug, announceRevealAt: announceRevealAt ? new Date(announceRevealAt) : null } });
    invalidate('showcase.list');
    return reply.code(201).send({ project: { id: row.id, slug: row.slug } });
  });

  app.put('/admin/showcase/:id', { preHandler: requireEditor() }, async (req, reply) => {
    // A grantee can edit a project's content; a manager can also change the reserved
    // controls. Non-editors are refused outright.
    if (!(await canEditShowcase(req.user, req.params.id))) return reply.code(403).send({ error: 'forbidden' });
    const b = upsertSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = { ...b.data };
    // Strip reserved fields for a non-manager so a grantee can't pin/publish/change
    // visibility even by hand-crafting the request — server is the authority.
    if (!canManageShowcase(req.user)) for (const k of RESERVED_SHOWCASE) delete data[k];
    if (data.announceRevealAt !== undefined) data.announceRevealAt = data.announceRevealAt ? new Date(data.announceRevealAt) : null;
    if (!Object.keys(data).length) return { ok: true }; // nothing left to write
    const row = await p.showcaseProject.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    // Snapshot this version for the version-history modal (target = sc:<id>).
    const version = typeof row.config?.version === 'string' ? row.config.version.trim().slice(0, 40) : '';
    if (version) {
      await p.projectVersion.upsert({
        where: { target_version: { target: `sc:${row.id}`, version } },
        create: { target: `sc:${row.id}`, version, config: row.config },
        update: { config: row.config },
      }).catch(() => {});
    }
    invalidate('showcase.list');
    return { ok: true };
  });

  // Public: version history for a showcase project (by slug). Mirrors /projects/:key/versions.
  app.get('/project/:slug/versions', async (req, reply) => {
    const p = await db();
    const row = await p.showcaseProject.findUnique({ where: { slug: req.params.slug }, select: { id: true, published: true, config: true } });
    if (!row || !row.published) return reply.code(404).send({ error: 'not_found' });
    const target = `sc:${row.id}`;
    const rows = await p.projectVersion.findMany({ where: { target }, orderBy: { createdAt: 'desc' }, select: { version: true, createdAt: true } });
    const cur = typeof row.config?.version === 'string' ? row.config.version.trim() : '';
    const versions = rows.map((r) => ({ version: r.version, createdAt: r.createdAt, current: r.version === cur }));
    if (cur && !versions.some((v) => v.version === cur)) versions.unshift({ version: cur, createdAt: null, current: true });
    return { versions };
  });

  app.get('/project/:slug/versions/:version', async (req, reply) => {
    const p = await db();
    const row = await p.showcaseProject.findUnique({ where: { slug: req.params.slug }, select: { id: true, published: true, config: true } });
    if (!row || !row.published) return reply.code(404).send({ error: 'not_found' });
    const snap = await p.projectVersion.findUnique({ where: { target_version: { target: `sc:${row.id}`, version: req.params.version } } });
    if (snap) return { version: snap.version, createdAt: snap.createdAt, config: snap.config };
    if (String(row.config?.version || '').trim() === req.params.version) return { version: req.params.version, createdAt: null, config: row.config };
    return reply.code(404).send({ error: 'not_found' });
  });

  // Stage a future content swap — { name?, short?, config? } replaces the live
  // fields the first time the page is read after `at` (see applyScheduledUpdate
  // in lib.mjs). Passing at:null cancels a pending schedule.
  app.put('/admin/showcase/:id/schedule', { preHandler: requireCap('manage_showcase') }, async (req, reply) => {
    const b = z.object({
      at: z.string().datetime().nullable(),
      next: z.object({ name: z.string().min(2).max(60).optional(), short: z.string().min(1).max(5).optional(), config: configSchema.optional() }).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (b.data.at && !b.data.next) return reply.code(400).send({ error: 'next_required' });
    const p = await db();
    const row = await p.showcaseProject.update({
      where: { id: req.params.id },
      data: { scheduledAt: b.data.at ? new Date(b.data.at) : null, scheduledNext: b.data.at ? b.data.next : null },
    }).catch(() => null);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.delete('/admin/showcase/:id', { preHandler: requireCap('manage_showcase') }, async (req) => {
    const p = await db();
    await p.showcaseProject.deleteMany({ where: { id: req.params.id } });
    invalidate('showcase.list');
    return { ok: true };
  });
}
