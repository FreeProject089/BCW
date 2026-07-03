import { z } from 'zod';
import { db, requireRole, optionalAuth, pageVisibilitySchema, pageAccountEntrySchema, canViewPage } from '../lib.mjs';
import { safeFetch } from '../net.mjs';

// Per-project, admin-editable config (downloads, links, contributors, progress,
// legal, release-notes source) stored as an AdminSetting row `project.<key>`.
const KEYS = ['community', 'bmm', 'bsm', 'installer'];
// 'community' always stays public — it's the site's own community hub, not an
// admin-curated project someone might want to soft-launch or gate.
const VISIBILITY_KEYS = KEYS.filter((k) => k !== 'community');
const settingKey = (k) => `project.${k}`;

async function getConfig(p, key) {
  const row = await p.adminSetting.findUnique({ where: { key: settingKey(key) } });
  return row?.value ?? null;
}

// Scheduling metadata lives on the Project row; the actual content lives in a
// separate AdminSetting row (see getConfig) — so a "swap in the staged config"
// touches both tables, unlike ShowcaseProject where everything is one row
// (hence this can't just call the generic applyScheduledUpdate from lib.mjs).
async function applyProjectSchedule(p, key) {
  const row = await p.project.findUnique({ where: { key } });
  if (!row?.scheduledAt || !row.scheduledNext || row.scheduledAt > new Date()) return row;
  if (row.scheduledNext.config) {
    const k = settingKey(key);
    await p.adminSetting.upsert({ where: { key: k }, create: { key: k, value: row.scheduledNext.config }, update: { value: row.scheduledNext.config } });
  }
  return p.project.update({ where: { key }, data: { scheduledAt: null, scheduledNext: null } });
}

// ── GitHub release-notes proxy (cached) ──
export const ghCache = new Map(); // url -> { at, data }
const cache = ghCache;
export async function gh(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const res = await safeFetch(url, { headers: { 'User-Agent': 'bcweb', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`github_${res.status}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

// raw.githubusercontent.com is fronted by its own CDN (Fastly) with a cache TTL
// independent of OUR ghCache — clearing our cache and refetching can still hand
// back a stale edge copy for a plain, unversioned raw URL. The fix (same one
// already used for release-notes rawUrl below): resolve the file's CURRENT
// blob sha via the git trees API and append it as a `?v=` query param. A sha
// change means a genuinely different URL, which the CDN has never cached and
// must fetch fresh from origin — so an edited contributors.json (or any other
// raw file) shows up immediately, with no manual "flush cache" needed at all.
const RAW_GH_RE = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;
export async function versionedRawUrl(url) {
  const m = url.match(RAW_GH_RE);
  if (!m) return url; // not a raw.githubusercontent URL (or already handled elsewhere) — use as-is
  const [, owner, repo, branch, path] = m;
  try {
    const tree = await gh(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    const entry = (tree.tree || []).find((e) => e.type === 'blob' && e.path === path);
    if (entry?.sha) return `${url}${url.includes('?') ? '&' : '?'}v=${entry.sha.slice(0, 8)}`;
  } catch { /* fall through to the unversioned URL — still works, just cache-fragile */ }
  return url;
}

export default async function projectRoutes(app) {
  // Admin: raw visibility/schedule state per fixed project — the public
  // GET /projects only exposes a computed `visible` bool for the CURRENT
  // visitor, not the admin-editable settings themselves.
  app.get('/admin/projects', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const rows = await p.project.findMany({ where: { key: { in: KEYS } } });
    return { projects: rows.map((r) => ({ key: r.key, visibility: r.visibility, visibilityWhitelist: r.visibilityWhitelist, scheduledAt: r.scheduledAt, scheduledNext: r.scheduledNext })) };
  });

  app.get('/projects', { preHandler: optionalAuth() }, async (req) => {
    const p = await db();
    const [rows, projectRows0] = await Promise.all([
      p.adminSetting.findMany({ where: { key: { in: KEYS.map(settingKey) } } }),
      p.project.findMany({ select: { key: true, showOnHomeNews: true, showBlogTab: true, visibility: true, visibilityWhitelist: true, scheduledAt: true } }),
    ]);
    // Perf: only touch the DB for a scheduled swap when a row is ACTUALLY due —
    // the old code fired 3 findUnique + up-to-3 update round-trips on EVERY hit
    // of this hot endpoint even when nothing was ever scheduled.
    const now = Date.now();
    const due = projectRows0.filter((r) => r.scheduledAt && new Date(r.scheduledAt).getTime() <= now && VISIBILITY_KEYS.includes(r.key));
    let projectRows = projectRows0;
    if (due.length) {
      await Promise.all(due.map((r) => applyProjectSchedule(p, r.key)));
      projectRows = await p.project.findMany({ select: { key: true, showOnHomeNews: true, showBlogTab: true, visibility: true, visibilityWhitelist: true } });
    }
    const byKey = Object.fromEntries(projectRows.map((r) => [r.key, r]));
    const out = {};
    // If a schedule just swapped config, re-read those keys' settings rows.
    const settingRows = due.length ? await p.adminSetting.findMany({ where: { key: { in: KEYS.map(settingKey) } } }) : rows;
    for (const r of settingRows) out[r.key.replace('project.', '')] = r.value;
    // Kept separate from `out` (the free-form config JSON the admin edits as raw
    // text) so it never gets mixed into — or accidentally stripped from — that blob.
    const homeNews = Object.fromEntries(KEYS.map((k) => [k, byKey[k]?.showOnHomeNews !== false]));
    const blogTab = Object.fromEntries(KEYS.map((k) => [k, byKey[k]?.showBlogTab === true]));
    // Lets the topbar hide a pill for a key the current visitor can't view.
    // Fast path: public/unlisted keys (the overwhelmingly common case) need no
    // DB work in canViewPage — only whitelist keys do, so we skip the await
    // entirely unless a key is actually gated.
    const visible = {};
    for (const k of KEYS) {
      const pr = byKey[k];
      visible[k] = !pr || pr.visibility === 'public' || pr.visibility === 'unlisted' || k === 'community'
        ? true
        : await canViewPage(p, pr, req);
    }
    return { projects: out, homeNews, blogTab, visible };
  });

  app.get('/projects/:key', { preHandler: optionalAuth() }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const p = await db();
    if (VISIBILITY_KEYS.includes(req.params.key)) await applyProjectSchedule(p, req.params.key);
    const cfg = await getConfig(p, req.params.key);
    if (!cfg) return reply.code(404).send({ error: 'not_configured' });
    const row = await p.project.findUnique({ where: { key: req.params.key }, select: { showBlogTab: true, visibility: true, visibilityWhitelist: true } });
    if (row && req.params.key !== 'community' && !(await canViewPage(p, row, req))) return reply.code(403).send({ error: 'no_access' });
    return { config: cfg, showBlogTab: row?.showBlogTab === true };
  });

  // Admin: per-project "show this blog's posts in the home page's Latest news"
  // toggle. Posts always show on /blog regardless — this only affects the home feed.
  app.put('/admin/projects/:key/home-news', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const b = z.object({ show: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.project.update({ where: { key: req.params.key }, data: { showOnHomeNews: b.data.show } });
    return { ok: true };
  });

  // Admin: per-project "Blog" tab toggle on the project's own page — the tab shows
  // only THIS project's posts (via GET /blog?project=<key>). Off by default (opt-in).
  app.put('/admin/projects/:key/blog-tab', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const b = z.object({ show: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.project.update({ where: { key: req.params.key }, data: { showBlogTab: b.data.show } });
    return { ok: true };
  });

  // Admin: visibility gate — every fixed project EXCEPT 'community' (see
  // VISIBILITY_KEYS above).
  app.put('/admin/projects/:key/visibility', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    if (!VISIBILITY_KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const b = z.object({ visibility: pageVisibilitySchema, whitelist: z.array(pageAccountEntrySchema).max(2000).default([]) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.project.update({ where: { key: req.params.key }, data: { visibility: b.data.visibility, visibilityWhitelist: b.data.whitelist } });
    return { ok: true };
  });

  // Admin: stage a future config swap (task: scheduled Projects-config updates) —
  // applies to every fixed project, including 'community'. Passing at:null cancels.
  app.put('/admin/projects/:key/schedule', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const b = z.object({ at: z.string().datetime().nullable(), next: z.object({ config: z.record(z.any()) }).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (b.data.at && !b.data.next) return reply.code(400).send({ error: 'next_required' });
    const p = await db();
    await p.project.update({ where: { key: req.params.key }, data: { scheduledAt: b.data.at ? new Date(b.data.at) : null, scheduledNext: b.data.at ? b.data.next : null } });
    return { ok: true };
  });

  // Admin: flush the GitHub proxy cache so a change in a repo (progress.json,
  // release notes, links…) is visible on the site immediately.
  app.post('/admin/projects/flush-cache', { preHandler: requireRole('ADMIN') }, async () => {
    const n = cache.size;
    cache.clear();
    return { ok: true, flushed: n };
  });

  app.put('/projects/:key', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const b = z.object({ config: z.record(z.any()) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_config' });
    const p = await db();
    const k = settingKey(req.params.key);
    await p.adminSetting.upsert({ where: { key: k }, create: { key: k, value: b.data.config }, update: { value: b.data.config } });
    return { ok: true };
  });

  // Shared visibility guard for the sub-resource routes below — 'community' is
  // never gated (see VISIBILITY_KEYS).
  async function assertVisible(p, req, reply) {
    if (req.params.key === 'community') return true;
    const row = await p.project.findUnique({ where: { key: req.params.key }, select: { visibility: true, visibilityWhitelist: true } });
    if (row && !(await canViewPage(p, row, req))) { reply.code(403).send({ error: 'no_access' }); return false; }
    return true;
  }

  // Progress tracker data. Prefers a configured remote source (e.g. the repo's
  // progress.json), cached; falls back to inline config.progressData / legacy array.
  app.get('/projects/:key/progress', { preHandler: optionalAuth() }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const p = await db();
    if (!(await assertVisible(p, req, reply))) return;
    const cfg = await getConfig(p, req.params.key);
    const src = cfg?.progressSource;
    if (src) {
      if (!/^https?:\/\//.test(src)) return reply.code(400).send({ error: 'bad_source' });
      try { return { progress: await gh(await versionedRawUrl(src)), source: src }; }
      catch (e) { return reply.code(502).send({ error: 'progress_unreachable', detail: String(e.message) }); }
    }
    if (cfg?.progressData) return { progress: cfg.progressData };
    if (Array.isArray(cfg?.progress) && cfg.progress.length) return { progress: { legacy: cfg.progress } };
    return { progress: null }; // no tracker configured (e.g. BSM) — not an error
  });

  // List the markdown release notes from the project's configured GitHub folder.
  // Detects sub-folders; returns each .md with a raw URL the client renders.
  app.get('/projects/:key/releases', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    if (KEYS.includes(req.params.key) && !(await assertVisible(p, req, reply))) return;
    const cfg = await getConfig(p, req.params.key);
    const rn = cfg?.releaseNotes;
    if (!rn?.owner || !rn?.repo) return reply.code(404).send({ error: 'no_release_notes' });
    const branch = rn.branch || 'main';
    const base = (rn.path || '').replace(/^\/+|\/+$/g, '');
    try {
      const tree = await gh(`https://api.github.com/repos/${rn.owner}/${rn.repo}/git/trees/${branch}?recursive=1`);
      const files = (tree.tree || [])
        .filter((e) => e.type === 'blob' && /\.md$/i.test(e.path) && (!base || e.path.startsWith(base + '/') || e.path === base))
        .map((e) => {
          const rel = base ? e.path.slice(base.length + 1) : e.path;
          const parts = rel.split('/');
          return {
            path: e.path,
            name: parts[parts.length - 1].replace(/\.md$/i, ''),
            dir: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
            // The blob sha versions the URL: when the file changes on GitHub, the
            // URL changes too → the raw CDN can never serve a stale copy (this is
            // why an edited link in a repo .md didn't show up on the site).
            rawUrl: `https://raw.githubusercontent.com/${rn.owner}/${rn.repo}/${branch}/${e.path}?v=${(e.sha || '').slice(0, 8)}`,
          };
        })
        .sort((a, b) => b.path.localeCompare(a.path)); // newest-ish first
      return { source: { owner: rn.owner, repo: rn.repo, branch, path: base }, files };
    } catch (e) {
      return reply.code(502).send({ error: 'github_unreachable', detail: String(e.message) });
    }
  });

  // Community tab data (contributors + messages). When the project's config
  // points at a remote contributorsUrl, it's proxied through the SAME cached
  // gh() fetch as release notes/progress -- so it participates in the 5-min
  // cache and, critically, in the admin's "Refresh site caches" flush. Before
  // this route existed the browser fetched contributorsUrl directly, which no
  // admin action could ever force to refresh.
  app.get('/projects/:key/community', { preHandler: optionalAuth() }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const p = await db();
    if (!(await assertVisible(p, req, reply))) return;
    const cfg = await getConfig(p, req.params.key);
    const url = cfg?.contributorsUrl;
    if (!url) return { data: null };
    if (!/^https?:\/\//.test(url)) return reply.code(400).send({ error: 'bad_source' });
    try { return { data: await gh(await versionedRawUrl(url)) }; }
    catch (e) { return reply.code(502).send({ error: 'community_unreachable', detail: String(e.message) }); }
  });
}
