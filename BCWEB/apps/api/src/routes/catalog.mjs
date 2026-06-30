import { z } from 'zod';
import { db, requireRole, slugify, notify } from '../lib.mjs';
import { presignGet } from '../storage.mjs';

const KINDS = ['APP', 'PLUGIN', 'THEME', 'PRESET'];

// BSM preset shape — the metadata is always carried inside the preset itself.
// passthrough() tolerates extra fields the format may grow.
const presetSchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().regex(/^#?[0-9a-fA-F]{3,8}$/).optional(),
  version: z.string().max(24),
  UpdateNumber: z.number().optional(),
  date: z.string().max(40).optional(),
  assetPaths: z.array(z.string().max(300)).max(10000),
}).passthrough();

const submitSchema = z.object({
  projectKey: z.enum(['bmm', 'bsm', 'community']),
  kind: z.enum(['APP', 'PLUGIN', 'THEME', 'PRESET']),
  name: z.string().min(2).max(80),
  description: z.string().max(4000).default(''),
  tags: z.array(z.string().max(24)).max(12).default([]),
  version: z.string().max(24).default('1.0.0'),
  payloadKey: z.string().max(256).optional(), // S3 key uploaded via presigned URL
  meta: z.record(z.any()).default({}),         // preset JSON / plugin manifest
});

export default async function catalogRoutes(app) {
  // ── Public browse (PUBLISHED only) ──
  app.get('/catalog', async (req) => {
    const p = await db();
    const { project, kind, q, take = '50', skip = '0' } = req.query || {};
    const where = { status: 'PUBLISHED' };
    if (project) where.project = { key: project };
    if (kind && KINDS.includes(kind)) where.kind = kind;
    if (q) where.OR = [{ name: { contains: String(q), mode: 'insensitive' } }, { description: { contains: String(q), mode: 'insensitive' } }];
    const items = await p.catalogItem.findMany({
      where, orderBy: { updatedAt: 'desc' },
      take: Math.min(Number(take) || 50, 100), skip: Number(skip) || 0,
      select: { id: true, slug: true, kind: true, name: true, description: true, tags: true, version: true, updatedAt: true, meta: true,
                owner: { select: { displayName: true } } },
    });
    return { items };
  });

  app.get('/catalog/:slug', async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { slug: req.params.slug }, include: { owner: { select: { displayName: true } } } });
    if (!item || item.status !== 'PUBLISHED') return reply.code(404).send({ error: 'not_found' });
    return { item };
  });

  // ── Download: short-lived pre-signed GET for a published payload ──
  app.get('/catalog/:slug/download', async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { slug: req.params.slug } });
    if (!item || item.status !== 'PUBLISHED') return reply.code(404).send({ error: 'not_found' });
    if (!item.payloadKey) return reply.code(404).send({ error: 'no_payload' });
    return { url: await presignGet(item.payloadKey) };
  });

  // ── Submit a NEW item (requires an account) → PENDING + a submission ──
  app.post('/catalog', { preHandler: requireRole() }, async (req, reply) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    const d = parsed.data;
    // BSM presets must match the preset schema (validated server-side).
    if (d.kind === 'PRESET') {
      const ok = presetSchema.safeParse(d.meta);
      if (!ok.success) return reply.code(400).send({ error: 'invalid_preset', details: ok.error.flatten() });
    }
    const p = await db();
    const project = await p.project.findUnique({ where: { key: d.projectKey } });
    if (!project) return reply.code(400).send({ error: 'unknown_project' });
    const slug = `${d.projectKey}-${slugify(d.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const item = await p.catalogItem.create({
      data: { projectId: project.id, kind: d.kind, ownerId: req.user.uid, name: d.name, slug,
              description: d.description, tags: d.tags, version: d.version, payloadKey: d.payloadKey, meta: d.meta, status: 'PENDING' },
    });
    await p.submission.create({ data: { itemId: item.id, ownerId: req.user.uid, type: 'NEW', status: 'PENDING' } });
    return reply.code(201).send({ item });
  });

  // ── Propose an UPDATE to your own item ──
  app.post('/catalog/:id/update', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.ownerId !== req.user.uid && req.user.role === 'USER') return reply.code(403).send({ error: 'forbidden' });
    const patch = z.object({ description: z.string().max(4000).optional(), version: z.string().max(24).optional(), tags: z.array(z.string()).optional(), payloadKey: z.string().optional(), meta: z.record(z.any()).optional() }).parse(req.body || {});
    await p.catalogItem.update({ where: { id: item.id }, data: { ...patch, status: 'PENDING' } });
    const sub = await p.submission.create({ data: { itemId: item.id, ownerId: item.ownerId, type: 'UPDATE', status: 'PENDING' } });
    return { submission: sub };
  });

  // ── My items ──
  app.get('/me/items', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    return { items: await p.catalogItem.findMany({ where: { ownerId: req.user.uid }, orderBy: { updatedAt: 'desc' } }) };
  });

  // ── Moderation (MOD / ADMIN) ──
  app.get('/mod/submissions', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    return { submissions: await p.submission.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, include: { item: true } }) };
  });

  app.post('/mod/submissions/:id/approve', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const sub = await p.submission.findUnique({ where: { id: req.params.id }, include: { item: true } });
    if (!sub) return reply.code(404).send({ error: 'not_found' });
    await p.$transaction([
      p.submission.update({ where: { id: sub.id }, data: { status: 'PUBLISHED', reviewerId: req.user.uid } }),
      p.catalogItem.update({ where: { id: sub.itemId }, data: { status: 'PUBLISHED' } }),
    ]);
    await notify(p, sub.ownerId, 'submission_approved', `"${sub.item.name}" was approved and is now live.`);
    return { ok: true };
  });

  app.post('/mod/submissions/:id/reject', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const reason = z.object({ reason: z.string().min(1).max(500) }).safeParse(req.body);
    if (!reason.success) return reply.code(400).send({ error: 'reason_required' });
    const p = await db();
    const sub = await p.submission.findUnique({ where: { id: req.params.id }, include: { item: true } });
    if (!sub) return reply.code(404).send({ error: 'not_found' });
    await p.$transaction([
      p.submission.update({ where: { id: sub.id }, data: { status: 'REJECTED', reviewerId: req.user.uid, reason: reason.data.reason } }),
      p.catalogItem.update({ where: { id: sub.itemId }, data: { status: 'REJECTED' } }),
    ]);
    await notify(p, sub.ownerId, 'submission_rejected', `"${sub.item.name}" was rejected: ${reason.data.reason}`);
    return { ok: true };
  });
}
