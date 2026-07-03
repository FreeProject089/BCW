import { z } from 'zod';
import { db, requireRole, optionalAuth, slugify, pageVisibilitySchema, pageAccountEntrySchema, canViewPage, applyScheduledUpdate } from '../lib.mjs';
import { safeFetch } from '../net.mjs';
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
  const pub = (p) => ({ id: p.id, slug: p.slug, name: p.name, short: p.short, tagline: p.config?.tagline || '', config: p.config || {}, showBlogTab: p.showBlogTab === true });

  // ── Public ──
  app.get('/showcase', async () => {
    const p = await db();
    const rows0 = await p.showcaseProject.findMany({ where: { published: true }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    const rows = await Promise.all(rows0.map((r) => applyScheduledUpdate(p, p.showcaseProject, r)));
    // Listing = discovery: only 'public' pages show up here (unlisted/private/
    // whitelist are still directly reachable by slug, just not surfaced) — a
    // still-announcing page IS listed though, so its topbar pill/grid card can
    // show the countdown teaser.
    return {
      projects: rows.filter((r) => r.visibility === 'public' || isAnnouncing(r)).map((r) => ({
        slug: r.slug, name: r.name, short: r.short, tagline: r.config?.tagline || '',
        pinTopbar: r.pinTopbar, isAnnouncing: isAnnouncing(r), announceTitle: r.announceTitle, announceRevealAt: r.announceRevealAt,
      })),
    };
  });

  app.get('/showcase/:slug', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    let row = await p.showcaseProject.findUnique({ where: { slug: req.params.slug } });
    if (!row || !row.published) return reply.code(404).send({ error: 'not_found' });
    row = await applyScheduledUpdate(p, p.showcaseProject, row);
    if (isAnnouncing(row)) return { project: null, announcement: { title: row.announceTitle, logo: row.announceLogo, markdown: row.announceMarkdown, revealAt: row.announceRevealAt } };
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
  app.get('/admin/showcase', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const rows = await p.showcaseProject.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    return {
      projects: rows.map((r) => ({
        id: r.id, slug: r.slug, name: r.name, short: r.short, published: r.published, order: r.order, config: r.config,
        showOnHomeNews: r.showOnHomeNews, showBlogTab: r.showBlogTab,
        visibility: r.visibility, visibilityWhitelist: r.visibilityWhitelist, pinTopbar: r.pinTopbar,
        announceEnabled: r.announceEnabled, announceTitle: r.announceTitle, announceLogo: r.announceLogo, announceMarkdown: r.announceMarkdown, announceRevealAt: r.announceRevealAt,
        scheduledAt: r.scheduledAt, scheduledNext: r.scheduledNext,
      })),
    };
  });

  const upsertSchema = z.object({
    name: z.string().min(2).max(60),
    short: z.string().min(1).max(5),
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
  });

  app.post('/admin/showcase', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = upsertSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const p = await db();
    const base = slugify(b.data.name) || 'project';
    let slug = base; for (let i = 1; await p.showcaseProject.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    const { announceRevealAt, ...data } = b.data;
    const row = await p.showcaseProject.create({ data: { ...data, slug, announceRevealAt: announceRevealAt ? new Date(announceRevealAt) : null } });
    return reply.code(201).send({ project: { id: row.id, slug: row.slug } });
  });

  app.put('/admin/showcase/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = upsertSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = { ...b.data };
    if (data.announceRevealAt !== undefined) data.announceRevealAt = data.announceRevealAt ? new Date(data.announceRevealAt) : null;
    const row = await p.showcaseProject.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // Stage a future content swap — { name?, short?, config? } replaces the live
  // fields the first time the page is read after `at` (see applyScheduledUpdate
  // in lib.mjs). Passing at:null cancels a pending schedule.
  app.put('/admin/showcase/:id/schedule', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
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

  app.delete('/admin/showcase/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.showcaseProject.deleteMany({ where: { id: req.params.id } });
    return { ok: true };
  });
}
