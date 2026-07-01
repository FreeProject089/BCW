import { z } from 'zod';
import { db, requireRole } from '../lib.mjs';

// Per-project, admin-editable config (downloads, links, contributors, progress,
// legal, release-notes source) stored as an AdminSetting row `project.<key>`.
const KEYS = ['community', 'bmm', 'bsm', 'installer'];
const settingKey = (k) => `project.${k}`;

async function getConfig(p, key) {
  const row = await p.adminSetting.findUnique({ where: { key: settingKey(key) } });
  return row?.value ?? null;
}

// ── GitHub release-notes proxy (cached) ──
const cache = new Map(); // url -> { at, data }
async function gh(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const res = await fetch(url, { headers: { 'User-Agent': 'bcweb', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`github_${res.status}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

export default async function projectRoutes(app) {
  app.get('/projects', async () => {
    const p = await db();
    const rows = await p.adminSetting.findMany({ where: { key: { in: KEYS.map(settingKey) } } });
    const out = {};
    for (const r of rows) out[r.key.replace('project.', '')] = r.value;
    return { projects: out };
  });

  app.get('/projects/:key', async (req, reply) => {
    if (!KEYS.includes(req.params.key)) return reply.code(404).send({ error: 'unknown_project' });
    const cfg = await getConfig(await db(), req.params.key);
    if (!cfg) return reply.code(404).send({ error: 'not_configured' });
    return { config: cfg };
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

  // List the markdown release notes from the project's configured GitHub folder.
  // Detects sub-folders; returns each .md with a raw URL the client renders.
  app.get('/projects/:key/releases', async (req, reply) => {
    const cfg = await getConfig(await db(), req.params.key);
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
            rawUrl: `https://raw.githubusercontent.com/${rn.owner}/${rn.repo}/${branch}/${e.path}`,
          };
        })
        .sort((a, b) => b.path.localeCompare(a.path)); // newest-ish first
      return { source: { owner: rn.owner, repo: rn.repo, branch, path: base }, files };
    } catch (e) {
      return reply.code(502).send({ error: 'github_unreachable', detail: String(e.message) });
    }
  });
}
