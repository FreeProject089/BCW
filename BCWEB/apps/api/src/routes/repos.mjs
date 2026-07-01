import { z } from 'zod';
import { db, requireRole, notify } from '../lib.mjs';

const SHA = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/i;
// BigInt fields -> numbers for JSON.
const ser = (r) => ({ ...r, storageQuotaBytes: Number(r.storageQuotaBytes), storageUsedBytes: Number(r.storageUsedBytes) });

// Ping a repo's URL → ONLINE/OFFLINE + validity. A .json manifest must parse;
// anything else just needs to be reachable. Exported for the provisioner's poller.
export async function checkRepoHealth(repo) {
  const url = repo.repoUrl || repo.publicUrl;
  if (!url) return { status: 'OFFLINE', valid: false, reason: 'no_url' };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (!res.ok) return { status: 'OFFLINE', valid: false, reason: `http_${res.status}` };
    if (/\.json($|\?)/i.test(url)) {
      try { JSON.parse(await res.text()); } catch { return { status: 'OFFLINE', valid: false, reason: 'invalid_json' }; }
    }
    return { status: 'ONLINE', valid: true };
  } catch (e) {
    return { status: 'OFFLINE', valid: false, reason: String(e?.name || e) };
  }
}

export default async function repoRoutes(app) {
  // Public list: only listed + verified repos. Featured (paid) ones float to the top.
  app.get('/repos', async () => {
    const p = await db();
    const now = new Date();
    const repos = await p.serverRepo.findMany({
      where: { listed: true, verified: true },
      orderBy: [{ featuredUntil: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, description: true, tags: true, publicUrl: true, repoUrl: true, status: true, hosted: true,
                featuredUntil: true, storageQuotaBytes: true, storageUsedBytes: true, owner: { select: { displayName: true } } },
    });
    return { repos: repos.map((r) => ({ ...ser(r), featured: r.featuredUntil && r.featuredUntil > now })) };
  });

  app.get('/me/repos', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const repos = await p.serverRepo.findMany({ where: { ownerId: req.user.uid }, orderBy: { createdAt: 'desc' }, include: { subscription: { include: { plan: true } } } });
    return { repos: repos.map(ser) };
  });

  // Create a (non-hosted) repo to list it.
  app.post('/repos', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(2).max(60), description: z.string().max(600).default(''),
      repoUrl: z.string().url().max(300).optional(), sha: z.string().regex(SHA).optional(),
      tags: z.array(z.string().max(24)).max(8).default([]),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const repo = await p.serverRepo.create({ data: { ...b.data, ownerId: req.user.uid, hosted: false, status: 'OFFLINE' } });
    return reply.code(201).send({ repo: ser(repo) });
  });

  async function ownRepo(p, id, user) {
    const repo = await p.serverRepo.findUnique({ where: { id } });
    if (!repo) return { err: 404 };
    if (repo.ownerId !== user.uid && user.role === 'USER') return { err: 403 };
    return { repo };
  }

  // Edit content/metadata. Any content change resets verification (must be re-checked).
  app.patch('/repos/:id', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(2).max(60).optional(), description: z.string().max(600).optional(),
      repoUrl: z.string().url().max(300).optional(), tags: z.array(z.string().max(24)).max(8).optional(),
      sha: z.string().regex(SHA).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    const contentChanged = (b.data.sha && b.data.sha !== repo.sha) || (b.data.repoUrl && b.data.repoUrl !== repo.repoUrl);
    const data = { ...b.data };
    if (contentChanged && repo.listed) { data.verified = false; data.pendingReview = true; }
    const out = await p.serverRepo.update({ where: { id: repo.id }, data });
    return { repo: ser(out) };
  });

  // Push an update — the only requirement is a valid SHA; queues re-verification if listed.
  app.post('/repos/:id/push', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ sha: z.string().regex(SHA), sizeBytes: z.number().int().nonnegative().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_sha' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (b.data.sizeBytes != null && BigInt(b.data.sizeBytes) > repo.storageQuotaBytes && repo.hosted) return reply.code(413).send({ error: 'quota_exceeded' });
    const data = { sha: b.data.sha };
    if (b.data.sizeBytes != null) data.storageUsedBytes = BigInt(b.data.sizeBytes);
    if (repo.listed) { data.verified = false; data.pendingReview = true; }
    await p.serverRepo.update({ where: { id: repo.id }, data });
    return { ok: true, pendingReview: !!repo.listed };
  });

  // Toggle public listing. Turning it on requires a SHA and queues verification.
  app.post('/repos/:id/list', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ listed: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (b.data.listed && !repo.sha) return reply.code(400).send({ error: 'sha_required', detail: 'Push a valid SHA before listing.' });
    await p.serverRepo.update({ where: { id: repo.id }, data: { listed: b.data.listed, pendingReview: b.data.listed && !repo.verified } });
    return { ok: true };
  });

  // On-demand health check: pings the repo URL → ONLINE/OFFLINE + validity.
  app.post('/repos/:id/check', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    const res = await checkRepoHealth(repo);
    await p.serverRepo.update({ where: { id: repo.id }, data: { status: res.status } });
    return res;
  });

  app.delete('/repos/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    await p.serverRepo.delete({ where: { id: repo.id } }).catch(() => {});
    return { ok: true };
  });

  // ── Admin / mod ──
  app.get('/admin/repos', { preHandler: requireRole('MOD', 'ADMIN') }, async () => {
    const p = await db();
    const repos = await p.serverRepo.findMany({ orderBy: [{ pendingReview: 'desc' }, { createdAt: 'desc' }], include: { owner: { select: { displayName: true, email: true } } } });
    return { repos: repos.map(ser) };
  });

  app.post('/admin/repos/:id/verify', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    await p.serverRepo.update({ where: { id: repo.id }, data: { verified: true, pendingReview: false } });
    await notify(p, repo.ownerId, 'repo_verified', `Your repo "${repo.name}" was verified and is now live in the list.`);
    return { ok: true };
  });

  app.post('/admin/repos/:id/reject', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const reason = z.object({ reason: z.string().min(1).max(400) }).safeParse(req.body);
    if (!reason.success) return reply.code(400).send({ error: 'reason_required' });
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    await p.serverRepo.update({ where: { id: repo.id }, data: { verified: false, pendingReview: false, listed: false } });
    await notify(p, repo.ownerId, 'repo_rejected', `Your repo "${repo.name}" was unlisted: ${reason.data.reason}`);
    return { ok: true };
  });

  // Set status / limits (admin).
  app.patch('/admin/repos/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      status: z.enum(['PROVISIONING', 'ONLINE', 'SUSPENDED', 'OFFLINE']).optional(),
      storageGB: z.number().min(0).optional(), uploadLimitKbps: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = {};
    if (b.data.status) data.status = b.data.status;
    if (b.data.storageGB != null) data.storageQuotaBytes = BigInt(Math.round(b.data.storageGB * 1024 ** 3));
    if (b.data.uploadLimitKbps != null) data.uploadLimitKbps = b.data.uploadLimitKbps;
    const repo = await p.serverRepo.update({ where: { id: req.params.id }, data });
    return { repo: ser(repo) };
  });
}
