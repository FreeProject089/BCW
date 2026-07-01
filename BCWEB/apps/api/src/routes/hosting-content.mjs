import { z } from 'zod';
import { db, requireRole, slugify, notify } from '../lib.mjs';
import { presignPut, getObject } from '../storage.mjs';

const fileSer = (f) => ({ ...f, size: Number(f.size) });
const norm = (p) => p.replace(/\\/g, '/').replace(/^\/+/, '').split('/').map((s) => s.replace(/[^a-zA-Z0-9._-]/g, '_')).join('/').slice(0, 200);

async function ownHosted(p, id, user) {
  const repo = await p.serverRepo.findUnique({ where: { id }, include: { files: true } });
  if (!repo) return { err: 404 };
  if (!repo.hosted) return { err: 400, msg: 'not_hosted' };
  if (repo.ownerId !== user.uid && user.role === 'USER') return { err: 403 };
  return { repo };
}
async function recomputeUsage(p, repoId) {
  const agg = await p.repoFile.aggregate({ where: { serverRepoId: repoId }, _sum: { size: true } });
  const used = agg._sum.size || 0n;
  await p.serverRepo.update({ where: { id: repoId }, data: { storageUsedBytes: used } });
  return used;
}

export default async function hostingContentRoutes(app) {
  // Pre-signed upload for a hosted repo file — refused if it would exceed the quota.
  app.post('/repos/:id/files/presign', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1).max(220), size: z.number().int().positive(), contentType: z.string().max(120).default('application/octet-stream') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err, msg } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: msg || (err === 404 ? 'not_found' : 'forbidden') });
    const path = norm(b.data.path);
    const existing = repo.files.find((f) => f.path === path);
    const used = repo.files.reduce((a, f) => a + Number(f.size), 0) - (existing ? Number(existing.size) : 0);
    if (BigInt(used + b.data.size) > repo.storageQuotaBytes) return reply.code(413).send({ error: 'quota_exceeded', quota: Number(repo.storageQuotaBytes), used });
    const key = `hosting/${repo.id}/${path}`;
    const url = await presignPut(key, b.data.contentType);
    return { key, url, path, expiresIn: 600 };
  });

  // Register an uploaded file (after the PUT). Parses repo.json into the manifest.
  app.post('/repos/:id/files', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1).max(220), key: z.string().max(300), size: z.number().int().nonnegative(), contentType: z.string().max(120).default('application/octet-stream') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err, msg } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: msg || (err === 404 ? 'not_found' : 'forbidden') });
    const path = norm(b.data.path);
    await p.repoFile.upsert({
      where: { serverRepoId_path: { serverRepoId: repo.id, path } },
      create: { serverRepoId: repo.id, path, key: b.data.key, size: BigInt(b.data.size), contentType: b.data.contentType },
      update: { key: b.data.key, size: BigInt(b.data.size), contentType: b.data.contentType },
    });
    await recomputeUsage(p, repo.id);
    const data = { published: false, pendingReview: true }; // any change → needs re-review
    if (path === 'repo.json') {
      try { const { body } = await getObject(b.data.key); const txt = await streamText(body); data.repoJson = JSON.parse(txt); }
      catch { /* keep previous */ }
    }
    await p.serverRepo.update({ where: { id: repo.id }, data });
    return { ok: true };
  });

  app.get('/repos/:id/files', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: 'not_found' });
    return { files: repo.files.map(fileSer), used: repo.files.reduce((a, f) => a + Number(f.size), 0), quota: Number(repo.storageQuotaBytes), published: repo.published, repoJson: repo.repoJson };
  });

  app.delete('/repos/:id/files/:fid', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: 'not_found' });
    await p.repoFile.deleteMany({ where: { id: req.params.fid, serverRepoId: repo.id } });
    await recomputeUsage(p, repo.id);
    return { ok: true };
  });

  // ── Admin review ──
  app.post('/admin/repos/:id/publish', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id }, include: { owner: { select: { displayName: true } } } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    if (!repo.repoJson) return reply.code(400).send({ error: 'no_repo_json' });
    const hostPath = `${slugify(repo.owner.displayName)}/${slugify(repo.name)}`;
    await p.serverRepo.update({ where: { id: repo.id }, data: { published: true, pendingReview: false, hostPath, status: 'ONLINE' } });
    await notify(p, repo.ownerId, 'repo_published', `Your hosted repo "${repo.name}" is live at /hosting/${hostPath}/repo.json`);
    return { ok: true, hostPath };
  });

  app.post('/admin/repos/:id/unpublish', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    await p.serverRepo.update({ where: { id: req.params.id }, data: { published: false } }).catch(() => {});
    return { ok: true };
  });

  // ── Public serving (validated content only; bytes only, never executed) ──
  app.get('/hosting/:owner/:repo/repo.json', async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { hostPath: `${req.params.owner}/${req.params.repo}` } });
    if (!repo || !repo.published || !repo.repoJson) return reply.code(404).send({ error: 'not_found' });
    return reply.header('Content-Type', 'application/json').header('Cache-Control', 'public, max-age=60').send(repo.repoJson);
  });

  app.get('/hosting/:owner/:repo/files/*', async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { hostPath: `${req.params.owner}/${req.params.repo}` }, include: { files: true } });
    if (!repo || !repo.published) return reply.code(404).send({ error: 'not_found' });
    const file = repo.files.find((f) => f.path === req.params['*']);
    if (!file) return reply.code(404).send({ error: 'not_found' });
    try {
      const { body } = await getObject(file.key);
      // Force a non-executable content type (never serve as HTML/JS).
      const ct = file.path.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      return reply.header('Content-Type', ct).header('Content-Disposition', 'attachment').send(body);
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
}

// Read a Node stream (S3 body) to a string.
async function streamText(stream) {
  if (typeof stream.text === 'function') return stream.text();
  const chunks = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf-8');
}
