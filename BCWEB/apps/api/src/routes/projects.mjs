import { z } from 'zod';
import { db, requireCap, requireEditor, optionalAuth, pageVisibilitySchema, pageAccountEntrySchema, canViewPage, canManageProjects, canEditProject, projectGrants } from '../lib/lib.mjs';
import { safeFetch } from '../lib/net.mjs';
import { zipReadAll } from '../lib/native.mjs';
import { detectStack, interestingPaths } from '../lib/stack-detect.mjs';
import { buildCodeGraph, sourcePathsToFetch, tracePath, entryPoints } from '../lib/code-graph.mjs';
import { buildEndpointGraph, endpointPathsToFetch } from '../lib/endpoint-graph.mjs';
import { snapshotKey, settingsKey, secretFor, rebuildSnapshot } from './code-webhook.mjs';

// Per-project, admin-editable config (downloads, links, contributors, progress,
// legal, release-notes source) stored as an AdminSetting row `project.<key>`.
// 'developers' is the /dev hub. It was listed in the admin's project rail but NOT here, so
// selecting it, editing it and pressing save answered `unknown_project` — an editor for a page
// the server refused to store. The two lists have to be one list.
const KEYS = ['community', 'bmm', 'bsm', 'installer', 'developers'];
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
  app.get('/admin/projects', { preHandler: requireEditor() }, async (req) => {
    const p = await db();
    const manage = canManageProjects(req.user);
    const rows = await p.project.findMany({ where: { key: { in: KEYS } } });
    // A non-manager grantee sees only the fixed projects they hold an edit grant for.
    let list = rows;
    if (!manage) { const g = await projectGrants(req.user.uid); list = rows.filter((r) => g.projectKeys.has(r.key)); }
    return { canManage: manage, projects: list.map((r) => ({ key: r.key, visibility: r.visibility, visibilityWhitelist: r.visibilityWhitelist, scheduledAt: r.scheduledAt, scheduledNext: r.scheduledNext })) };
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
  app.put('/admin/projects/:key/home-news', { preHandler: requireCap('manage_projects') }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const b = z.object({ show: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.project.update({ where: { key: req.params.key }, data: { showOnHomeNews: b.data.show } });
    return { ok: true };
  });

  // Admin: per-project "Blog" tab toggle on the project's own page — the tab shows
  // only THIS project's posts (via GET /blog?project=<key>). Off by default (opt-in).
  app.put('/admin/projects/:key/blog-tab', { preHandler: requireCap('manage_projects') }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const b = z.object({ show: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.project.update({ where: { key: req.params.key }, data: { showBlogTab: b.data.show } });
    return { ok: true };
  });

  // Admin: visibility gate — every fixed project EXCEPT 'community' (see
  // VISIBILITY_KEYS above).
  app.put('/admin/projects/:key/visibility', { preHandler: requireCap('manage_projects') }, async (req, reply) => {
    if (!VISIBILITY_KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const b = z.object({ visibility: pageVisibilitySchema, whitelist: z.array(pageAccountEntrySchema).max(2000).default([]) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.project.update({ where: { key: req.params.key }, data: { visibility: b.data.visibility, visibilityWhitelist: b.data.whitelist } });
    return { ok: true };
  });

  // Admin: stage a future config swap (task: scheduled Projects-config updates) —
  // applies to every fixed project, including 'community'. Passing at:null cancels.
  app.put('/admin/projects/:key/schedule', { preHandler: requireCap('manage_projects') }, async (req, reply) => {
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
  app.post('/admin/projects/flush-cache', { preHandler: requireCap('manage_projects') }, async () => {
    const n = cache.size;
    cache.clear();
    return { ok: true, flushed: n };
  });

  // ── "How it runs": read a repository and propose a diagram ──────────────────
  //
  // Returns a DRAFT for the admin to edit, never a saved config: what this produces is
  // published on a public project page as a description of somebody's infrastructure, and a
  // detector that is confidently wrong there is worse than an empty tab. Every component
  // comes back with the file that produced it, and a repo with nothing recognisable comes
  // back empty rather than plausible.
  //
  // Two sources, one shape. A GitHub URL is read through the existing cached `gh()` client —
  // the tree, then only the handful of paths worth reading. A zip arrives base64 in the body
  // because uploads here go straight to object storage via presigned PUTs, so there is no
  // multipart parser to hang a file on; the cap keeps that honest.
  const MAX_ZIP_B64 = 12 * 1024 * 1024;   // ~9 MB of zip
  const GH_REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+))?\/?$/i;

  app.post('/admin/projects/stack/detect', { preHandler: requireEditor() }, async (req, reply) => {
    const b = z.object({
      url: z.string().url().max(300).optional(),
      zipBase64: z.string().max(MAX_ZIP_B64).optional(),
      // A folder picked in the browser sends only the files that matter, already filtered
      // there — the whole repo never leaves the machine.
      files: z.record(z.string().max(200_000)).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_request' });

    let files = null;
    let source = '';

    if (b.data.files) {
      files = b.data.files;
      source = 'folder';
    } else if (b.data.zipBase64) {
      let buf;
      try { buf = Buffer.from(b.data.zipBase64, 'base64'); } catch { return reply.code(400).send({ error: 'bad_zip' }); }
      let entries;
      try { entries = await zipReadAll(buf); } catch { return reply.code(400).send({ error: 'bad_zip' }); }
      // A GitHub zip wraps everything in `repo-branch/`; strip one leading folder when every
      // entry shares it, or nothing would sit at the depth the path filter expects.
      const names = entries.map((e) => e.name);
      const first = names[0]?.split('/')[0];
      const wrapped = first && names.every((n) => n.startsWith(`${first}/`));
      const strip = (n) => (wrapped ? n.slice(first.length + 1) : n);
      const wanted = new Set(interestingPaths(names.map(strip)));
      files = {};
      for (const e of entries) {
        const path = strip(e.name);
        if (wanted.has(path)) files[path] = e.data.toString('utf8');
      }
      source = 'zip';
    } else if (b.data.url) {
      const m = b.data.url.match(GH_REPO_RE);
      if (!m) return reply.code(400).send({ error: 'not_a_github_repo' });
      const [, owner, repo, ref] = m;
      let tree;
      try {
        const meta = ref ? { default_branch: ref } : await gh(`https://api.github.com/repos/${owner}/${repo}`);
        tree = await gh(`https://api.github.com/repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`);
      } catch (e) {
        // 404 covers "private" as well as "typo", and saying which would be a guess.
        return reply.code(502).send({ error: 'github_unreachable', detail: String(e.message || e).slice(0, 120) });
      }
      const paths = (tree.tree || []).filter((e) => e.type === 'blob').map((e) => e.path);
      const wanted = interestingPaths(paths);
      files = {};
      await Promise.all(wanted.map(async (path) => {
        const branch = ref || 'HEAD';
        const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
        try {
          const res = await safeFetch(raw, { headers: { 'User-Agent': 'bcweb' } });
          if (res.ok) files[path] = (await res.text()).slice(0, 200_000);
        } catch { /* one unreadable file must not abandon the scan */ }
      }));
      source = `github:${owner}/${repo}`;
    } else {
      return reply.code(400).send({ error: 'nothing_to_read' });
    }

    // Connections the manifests cannot supply. A Tauri app has no compose file, so the draft
    // used to come back as two unconnected boxes — while the `invoke` calls joining them were
    // provable all along. Only for a GitHub read: a picked folder sends fifteen manifests and
    // nothing to scan, and a zip is capped for size, so neither has the source to prove a call.
    let endpointLinks = [];
    let callsTruncated = false;
    if (b.data.url) {
      try {
        const m2 = b.data.url.match(GH_REPO_RE);
        const [, owner2, repo2, ref2] = m2;
        const meta2 = ref2 ? { default_branch: ref2 } : await gh(`https://api.github.com/repos/${owner2}/${repo2}`);
        const tree2 = await gh(`https://api.github.com/repos/${owner2}/${repo2}/git/trees/${meta2.default_branch}?recursive=1`);
        const candidates = (tree2.tree || []).filter((e) => e.type === 'blob').map((e) => e.path);
        const srcPaths = endpointPathsToFetch(candidates, { limit: 120 });
        // A big repository does not fit in the budget, and the counts drawn on the connections
        // would then be a fraction presented as a total.
        callsTruncated = srcPaths.length >= 120 && endpointPathsToFetch(candidates, { limit: 100_000 }).length > srcPaths.length;
        const srcFiles = {};
        for (let i = 0; i < srcPaths.length; i += 12) {
          await Promise.all(srcPaths.slice(i, i + 12).map(async (path) => {
            try {
              const res = await safeFetch(`https://raw.githubusercontent.com/${owner2}/${repo2}/${ref2 || 'HEAD'}/${path}`, { headers: { 'User-Agent': 'bcweb' } });
              if (res.ok) srcFiles[path] = (await res.text()).slice(0, 200_000);
            } catch { /* one unreadable file must not lose the whole draft */ }
          }));
        }
        endpointLinks = buildEndpointGraph(srcFiles).links;
      } catch { /* no connections is a poorer draft, not a failed one */ }
    }

    const draft = detectStack(files, { endpointLinks, callsTruncated });
    return { ok: true, source, filesRead: Object.keys(files).length, ...draft };
  });

  // ── The architecture graph: what the code actually imports ─────────────────
  //
  // A second, DEEPER read of the same repository. The stack detector answers "what is deployed"
  // from compose and manifests; this answers "what is wired to what" from the source itself.
  // Every edge is a real import statement — nothing is inferred from a name or a folder, because
  // a diagram that guesses looks expert and is fiction, and this one gets published.
  //
  // Separate endpoint, not folded into /stack/detect: it fetches hundreds of files instead of
  // fifteen, and nobody should pay that cost to fill in a five-box stack diagram.
  app.post('/admin/projects/code-graph', { preHandler: requireEditor() }, async (req, reply) => {
    const b = z.object({
      url: z.string().url().max(300).optional(),
      files: z.record(z.string().max(400_000)).optional(),
      maxFiles: z.number().int().min(10).max(300).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_request' });

    let sources = null;
    let source = '';

    if (b.data.files) {
      sources = b.data.files;
      source = 'folder';
    } else if (b.data.url) {
      const m = b.data.url.match(GH_REPO_RE);
      if (!m) return reply.code(400).send({ error: 'not_a_github_repo' });
      const [, owner, repo, ref] = m;
      let tree;
      try {
        const meta = ref ? { default_branch: ref } : await gh(`https://api.github.com/repos/${owner}/${repo}`);
        tree = await gh(`https://api.github.com/repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`);
      } catch (e) {
        return reply.code(502).send({ error: 'github_unreachable', detail: String(e.message || e).slice(0, 120) });
      }
      const paths = (tree.tree || []).filter((e) => e.type === 'blob').map((e) => e.path);
      // The union: the import graph reads JS/TS, the endpoint pairing also reads Rust,
      // Python and Go. Fetching only the first list would leave every Rust command unread.
      const wanted = [...new Set([
        ...sourcePathsToFetch(paths, { limit: b.data.maxFiles || 150 }),
        ...endpointPathsToFetch(paths, { limit: b.data.maxFiles || 150 }),
      ])];
      sources = {};
      // Sequentially in small batches rather than all at once: raw.githubusercontent rate-limits
      // a burst, and a half-fetched repo produces a graph with holes that look like real
      // architecture rather than like a failed download.
      const branch = ref || 'HEAD';
      for (let i = 0; i < wanted.length; i += 12) {
        await Promise.all(wanted.slice(i, i + 12).map(async (path) => {
          try {
            const res = await safeFetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`, { headers: { 'User-Agent': 'bcweb' } });
            if (res.ok) sources[path] = (await res.text()).slice(0, 400_000);
          } catch { /* one unreadable file must not abandon the scan */ }
        }));
      }
      // Said out loud: a graph built from 40 of 300 files is not this repo's architecture.
      if (Object.keys(sources).length < wanted.length * 0.6 && wanted.length > 10) {
        return reply.code(502).send({ error: 'incomplete_fetch', got: Object.keys(sources).length, wanted: wanted.length });
      }
      source = `github:${owner}/${repo}`;
    } else {
      return reply.code(400).send({ error: 'nothing_to_read' });
    }

    const graph = buildCodeGraph(sources);
    // The other half of the picture. Imports connect files inside one language; this crosses
    // the gap they cannot — a browser calling a server, a Tauri front end calling Rust — and
    // it is why a repo like BMM shows 0 import edges between its two halves and 2000 real
    // links once the command names are read.
    // `truncated` travels in: on a capped scan of a monorepo the callers are inside the cap
    // and the handlers are not, so every call looks orphaned. Those are artefacts, not
    // findings, and the flag is what stops them being shown as findings.
    const endpoints = buildEndpointGraph(sources, { truncated: !!graph.stats?.truncated });
    // Where a reader should start. Derived rather than declared: package.json `main` lies
    // as often as not in a monorepo, while "nothing imports this" is a fact about the code.
    return { ok: true, source, ...graph, entries: entryPoints(graph).slice(0, 20), endpoints };
  });

  // ── Keeping a project's code graph current ─────────────────────────────────
  //
  // The settings an admin edits, and the stored graph a webhook refreshes. `secret` is written
  // but NEVER read back — a field that returns the secret is a field that leaks it to anybody
  // who can open the page, and the page only needs to know whether one is set and where it
  // comes from.
  app.get('/admin/projects/:key/code-graph', { preHandler: requireEditor() }, async (req) => {
    const p = await db();
    const [row, snap, sec] = await Promise.all([
      p.adminSetting.findUnique({ where: { key: settingsKey(req.params.key) } }).catch(() => null),
      p.adminSetting.findUnique({ where: { key: snapshotKey(req.params.key) } }).catch(() => null),
      secretFor(p, req.params.key),
    ]);
    return {
      url: row?.value?.url || '',
      hasSecret: !!sec.secret,
      secretFrom: sec.from,          // 'page' | 'env' | null — which one is actually in force
      snapshot: snap?.value ? {
        generatedAt: snap.value.generatedAt, url: snap.value.url,
        stats: snap.value.stats, endpointStats: snap.value.endpointStats,
      } : null,
      // The address to paste into GitHub. Built here so nobody has to guess the shape of it.
      deliverTo: `${(process.env.SITE_URL || '').replace(/\/+$/, '')}/api/webhooks/code/${req.params.key}`,
    };
  });

  app.put('/admin/projects/:key/code-graph', { preHandler: requireEditor() }, async (req, reply) => {
    const b = z.object({
      url: z.string().max(300).optional(),
      // An empty string CLEARS the page secret — for an official project that means falling
      // back to the environment, which has to be possible without editing the database by hand.
      secret: z.string().max(200).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const k = settingsKey(req.params.key);
    const cur = (await p.adminSetting.findUnique({ where: { key: k } }).catch(() => null))?.value || {};
    const value = { ...cur };
    if (b.data.url !== undefined) value.url = b.data.url.trim();
    if (b.data.secret !== undefined) {
      if (b.data.secret.trim()) value.secret = b.data.secret.trim();
      else delete value.secret;
    }
    await p.adminSetting.upsert({ where: { key: k }, create: { key: k, value }, update: { value } });
    return { ok: true };
  });

  // The manual "read it now" — the same rebuild the webhook triggers, so a project without a
  // webhook is not a second-class one.
  app.post('/admin/projects/:key/code-graph/refresh', { preHandler: requireEditor() }, async (req, reply) => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: settingsKey(req.params.key) } }).catch(() => null);
    const url = req.body?.url || row?.value?.url;
    if (!url) return reply.code(400).send({ error: 'no_repo_configured' });
    const r = await rebuildSnapshot(p, req.params.key, url);
    if (!r.ok) return reply.code(502).send(r);
    return r;
  });

  app.put('/projects/:key', { preHandler: requireEditor() }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    // Editing a fixed project's page config: managers (manage_projects / admin) for any,
    // or a grantee holding that specific project key. Content only — the reserved toggles
    // (visibility / home-news / blog-tab / schedule) live on their own cap-gated routes.
    if (!(await canEditProject(req.user, req.params.key))) return reply.code(403).send({ error: 'forbidden' });
    const b = z.object({ config: z.record(z.any()) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_config' });
    const p = await db();
    const k = settingKey(req.params.key);
    await p.adminSetting.upsert({ where: { key: k }, create: { key: k, value: b.data.config }, update: { value: b.data.config } });
    await snapshotVersion(p, req.params.key, b.data.config);
    await snapshotConfigRevision(p, req.params.key, b.data.config, req.user?.uid);
    return { ok: true };
  });

  // One snapshot per SAVE, capped.
  //
  // Different from snapshotVersion below, which is keyed by the config's `version` string
  // and answers "what shipped in 1.2.0" — two saves inside one version overwrite it. This
  // answers "what changed at 14:02, and who did it", which is the question you have when
  // a page suddenly looks wrong.
  //
  // Skipped when nothing actually changed: pressing Save twice on an untouched editor
  // should not fill the history with identical entries.
  async function snapshotConfigRevision(p, target, config, editorId) {
    try {
      const last = await p.projectConfigRevision.findFirst({ where: { target }, orderBy: { createdAt: 'desc' }, select: { config: true } });
      if (last && JSON.stringify(last.config) === JSON.stringify(config)) return;
      await p.projectConfigRevision.create({ data: { target, config, editorId: editorId || null } });
      // Keep the last 50. A page config is edited rarely; an unbounded table here would
      // be a slow leak nobody ever looks at.
      const excess = await p.projectConfigRevision.findMany({ where: { target }, orderBy: { createdAt: 'desc' }, skip: 50, select: { id: true } });
      if (excess.length) await p.projectConfigRevision.deleteMany({ where: { id: { in: excess.map((x) => x.id) } } });
    } catch { /* history is a convenience; never fail the save for it */ }
  }

  // The history itself. Read-only, and the config is returned in full so the UI can diff
  // two entries — a list of timestamps with no content answers nothing.
  app.get('/admin/projects/:key/history', { preHandler: requireEditor() }, async (req, reply) => {
    const target = String(req.params.key);
    if (!KEYS.includes(target) && !target.startsWith('sc:')) return reply.code(404).send({ error: 'unknown_project' });
    if (!(await canEditProject(req.user, target))) return reply.code(403).send({ error: 'forbidden' });
    const p = await db();
    const rows = await p.projectConfigRevision.findMany({ where: { target }, orderBy: { createdAt: 'desc' }, take: 50 });
    const ids = [...new Set(rows.map((r) => r.editorId).filter(Boolean))];
    const users = ids.length ? await p.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, avatar: true } }) : [];
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));
    return {
      revisions: rows.map((r) => ({
        id: r.id, createdAt: r.createdAt, config: r.config,
        // A deleted account still has its edits in the list; naming it "(deleted)" is
        // more honest than dropping the entry or showing a bare id.
        editor: r.editorId ? (byId[r.editorId] || { id: r.editorId, displayName: '(deleted)' }) : null,
      })),
    };
  });

  // Record/refresh a project-page snapshot for its current version (powers the version
  // history modal). No-op when the config has no version string. Exported-in-spirit: the
  // showcase route calls the same shape with target `sc:<id>`.
  async function snapshotVersion(p, target, config) {
    const version = typeof config?.version === 'string' ? config.version.trim().slice(0, 40) : '';
    if (!version) return;
    await p.projectVersion.upsert({
      where: { target_version: { target, version } },
      create: { target, version, config },
      update: { config },
    }).catch(() => {});
  }

  // Public: list a project's versions (newest first). Includes the current live version even
  // if it hasn't been re-saved since the feature shipped, so the list is never empty.
  app.get('/projects/:key/versions', { preHandler: optionalAuth() }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const p = await db();
    if (!(await assertVisible(p, req, reply))) return;
    const rows = await p.projectVersion.findMany({ where: { target: req.params.key }, orderBy: { createdAt: 'desc' }, select: { version: true, createdAt: true } });
    const cfg = await getConfig(p, req.params.key);
    const cur = typeof cfg?.version === 'string' ? cfg.version.trim() : '';
    const versions = rows.map((r) => ({ version: r.version, createdAt: r.createdAt, current: r.version === cur }));
    if (cur && !versions.some((v) => v.version === cur)) versions.unshift({ version: cur, createdAt: null, current: true });
    return { versions };
  });

  // Public: the page config as it was at a given version (falls back to the live config
  // when the requested version IS the current one and no snapshot exists yet).
  app.get('/projects/:key/versions/:version', { preHandler: optionalAuth() }, async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const p = await db();
    if (!(await assertVisible(p, req, reply))) return;
    const row = await p.projectVersion.findUnique({ where: { target_version: { target: req.params.key, version: req.params.version } } });
    if (row) return { version: row.version, createdAt: row.createdAt, config: row.config };
    const cfg = await getConfig(p, req.params.key);
    if (cfg && String(cfg.version || '').trim() === req.params.version) return { version: req.params.version, createdAt: null, config: cfg };
    return reply.code(404).send({ error: 'not_found' });
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
