// Staff: the pictures that look like somebody else's (perceptual-hash flags).
//
//   GET  /admin/media-flags?status=pending|cleared|actioned|all&page=   the queue, both pictures per flag
//   POST /admin/media-flags/:id            { status: cleared|actioned|pending, note? }
//   GET  /admin/media-hashes/stats         counts + the settings
//   PUT  /admin/media-hashes/settings      { threshold?, enabled? }
//   POST /admin/media-hashes/scan          hash a batch now (+ backfill the public media prefix)
//   GET  /admin/media-hashes/:id/preview   the picture (redirect to storage / the avatar, or the archive entry's bytes)
//
// manage_reports: the same people who work the report and moderation queues.
import { z } from 'zod';
import { db, requireCap, logAudit, clientIp } from '../lib/lib.mjs';
import { getObject } from '../lib/storage.mjs';
import { phashSettings, savePhashSettings, sweepMediaHashes, backfillStorage, previewOf } from '../lib/media-hash.mjs';

const PAGE = 40;

export default async function mediaFlagRoutes(app) {
  const serHash = (h, owners) => ({
    id: h.id, key: h.key, kind: h.kind, ownerId: h.ownerId, owner: h.ownerId ? owners.get(h.ownerId) || null : null,
    refType: h.refType, refId: h.refId, contentType: h.contentType, bytes: h.bytes, width: h.width, height: h.height,
    status: h.status, createdAt: h.createdAt, preview: `/admin/media-hashes/${h.id}/preview`,
  });

  app.get('/admin/media-flags', { preHandler: requireCap('manage_reports') }, async (req) => {
    const p = await db();
    const status = ['pending', 'cleared', 'actioned', 'all'].includes(req.query?.status) ? req.query.status : 'pending';
    const page = Math.max(0, parseInt(req.query?.page, 10) || 0);
    const where = status === 'all' ? {} : { status };
    const [rows, total] = await Promise.all([
      p.mediaFlag.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: page * PAGE, take: PAGE, include: { hash: true, match: true } }),
      p.mediaFlag.count({ where }),
    ]);
    const ownerIds = [...new Set(rows.flatMap((f) => [f.hash.ownerId, f.match.ownerId]).filter(Boolean))];
    const users = ownerIds.length ? await p.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, displayName: true, status: true } }) : [];
    const owners = new Map(users.map((u) => [u.id, u]));
    return {
      total, page, pageSize: PAGE,
      flags: rows.map((f) => ({ id: f.id, distance: f.distance, reason: f.reason, status: f.status, note: f.note, resolvedById: f.resolvedById, resolvedAt: f.resolvedAt, createdAt: f.createdAt, hash: serHash(f.hash, owners), match: serHash(f.match, owners) })),
    };
  });

  app.post('/admin/media-flags/:id', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const b = z.object({ status: z.enum(['pending', 'cleared', 'actioned']), note: z.string().trim().max(500).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cur = await p.mediaFlag.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    const resolved = b.data.status !== 'pending';
    const flag = await p.mediaFlag.update({ where: { id: cur.id }, data: { status: b.data.status, ...(b.data.note != null ? { note: b.data.note } : {}), resolvedById: resolved ? req.user.uid : null, resolvedAt: resolved ? new Date() : null } });
    await logAudit(p, req.user.uid, 'media.flag', `${flag.id} ${b.data.status}`, clientIp(req));
    return { ok: true, flag: { id: flag.id, status: flag.status, note: flag.note } };
  });

  app.get('/admin/media-hashes/stats', { preHandler: requireCap('manage_reports') }, async () => {
    const p = await db();
    const [pending, hashed, flags, settings] = await Promise.all([
      p.mediaHash.count({ where: { status: 'pending' } }),
      p.mediaHash.count({ where: { status: 'hashed' } }),
      p.mediaFlag.groupBy({ by: ['status'], _count: { _all: true } }),
      phashSettings(p),
    ]);
    const by = Object.fromEntries(flags.map((f) => [f.status, f._count._all]));
    return { pending, hashed, flags: { pending: by.pending || 0, cleared: by.cleared || 0, actioned: by.actioned || 0 }, settings };
  });

  app.put('/admin/media-hashes/settings', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const b = z.object({ threshold: z.number().int().min(0).max(20).optional(), enabled: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const settings = await savePhashSettings(p, b.data);
    await logAudit(p, req.user.uid, 'media.phash.settings', JSON.stringify(settings), clientIp(req));
    return { ok: true, settings };
  });

  app.post('/admin/media-hashes/scan', { preHandler: requireCap('manage_reports') }, async (req) => {
    const p = await db();
    const backfilled = req.body?.backfill ? await backfillStorage(p).catch(() => 0) : 0;
    const r = await sweepMediaHashes(p, app.log, { limit: 120 });
    await logAudit(p, req.user.uid, 'media.phash.scan', `hashed=${r.hashed} flagged=${r.flagged} backfilled=${backfilled}`, clientIp(req));
    return { ok: true, ...r, backfilled };
  });

  app.get('/admin/media-hashes/:id/preview', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const p = await db();
    const row = await p.mediaHash.findUnique({ where: { id: req.params.id } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const pv = await previewOf(row);
    if (!pv) return reply.code(404).send({ error: 'no_preview' });
    if (pv.redirect) return reply.redirect(pv.redirect, 302);
    // An image inside an archive: pull the archive, hand back that entry's bytes.
    const [key, entry] = [row.key.split('#')[0], row.key.split('#').slice(1).join('#')];
    try {
      const { body } = await getObject(key);
      const chunks = []; for await (const c of body) chunks.push(c);
      const AdmZip = (await import('adm-zip')).default;
      const e = new AdmZip(Buffer.concat(chunks)).getEntry(entry);
      if (!e) return reply.code(404).send({ error: 'not_found' });
      const ext = (entry.split('.').pop() || 'png').toLowerCase();
      const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
      return reply.header('Content-Type', type).header('Cache-Control', 'private, max-age=300').header('X-Content-Type-Options', 'nosniff').send(e.getData());
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
}
