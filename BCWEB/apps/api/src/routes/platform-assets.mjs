import { z } from 'zod';
import { db, requireRole } from '../lib/lib.mjs';
import { presignPut, getObject, deleteObject } from '../lib/storage.mjs';

// Platform-hosted assets (app installers, auto-update manifests, links.json / contributors.json)
// served at stable public URLs `/api/assets/<key>`. File assets live in object storage; JSON
// assets are stored inline so admins can edit them in the dashboard. Admin-only to write.
const KEY_RE = /^[a-zA-Z0-9._-]{1,64}$/;

const ser = (a) => ({
  key: a.key, kind: a.kind, label: a.label, filename: a.filename || null, contentType: a.contentType || null,
  size: Number(a.size), version: a.version || null, channel: a.channel, updatedAt: a.updatedAt,
  url: `/api/assets/${a.key}`,
});

export default async function platformAssetRoutes(app) {
  // Admin: list every asset (JSON payload included so it can be edited inline).
  app.get('/admin/assets', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const rows = await p.platformAsset.findMany({ orderBy: { key: 'asc' } });
    return { assets: rows.map((a) => ({ ...ser(a), json: a.kind === 'json' ? (a.json ?? null) : undefined })) };
  });

  // Admin: upsert a JSON asset (links.json / contributors.json — edited inline).
  app.put('/admin/assets/json/:key', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'bad_key' });
    const b = z.object({ label: z.string().max(120).optional(), json: z.any() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = { kind: 'json', label: b.data.label ?? '', json: b.data.json ?? {}, updatedById: req.user.uid, storageKey: null };
    await p.platformAsset.upsert({ where: { key }, create: { key, ...data }, update: data });
    return { ok: true };
  });

  // Admin: presign a direct-to-storage upload. The storageKey is minted server-side (under
  // the platform/ prefix) so a client can never target another prefix.
  app.post('/admin/assets/presign', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ key: z.string(), filename: z.string().min(1).max(200), contentType: z.string().max(120).optional() }).safeParse(req.body);
    if (!b.success || !KEY_RE.test(b.data.key)) return reply.code(400).send({ error: 'invalid_input' });
    const safeName = b.data.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `platform/${b.data.key}/${Date.now()}-${safeName}`;
    const url = await presignPut(storageKey, b.data.contentType || 'application/octet-stream');
    return { url, storageKey };
  });

  // Admin: confirm a file asset after the presigned PUT succeeded.
  app.put('/admin/assets/file/:key', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'bad_key' });
    const b = z.object({
      label: z.string().max(120).optional(), filename: z.string().min(1).max(200),
      contentType: z.string().max(120).optional(), size: z.number().int().nonnegative().max(50 * 1024 ** 3).optional(),
      storageKey: z.string().max(300), version: z.string().max(40).optional(), channel: z.string().max(40).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!b.data.storageKey.startsWith('platform/') || b.data.storageKey.includes('..')) return reply.code(400).send({ error: 'bad_storage_key' });
    const p = await db();
    const prev = await p.platformAsset.findUnique({ where: { key } });
    if (prev?.storageKey && prev.storageKey !== b.data.storageKey) await deleteObject(prev.storageKey).catch(() => {});
    const data = {
      kind: 'file', label: b.data.label ?? prev?.label ?? '', filename: b.data.filename,
      contentType: b.data.contentType || 'application/octet-stream', size: BigInt(b.data.size || 0),
      storageKey: b.data.storageKey, version: b.data.version ?? null, channel: b.data.channel || 'stable',
      updatedById: req.user.uid, json: null,
    };
    await p.platformAsset.upsert({ where: { key }, create: { key, ...data }, update: data });
    return { ok: true };
  });

  // Admin: delete an asset (+ purge its stored object).
  app.delete('/admin/assets/:key', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'bad_key' });
    const p = await db();
    const a = await p.platformAsset.findUnique({ where: { key } });
    if (!a) return reply.code(404).send({ error: 'not_found' });
    if (a.storageKey) await deleteObject(a.storageKey).catch(() => {});
    await p.platformAsset.delete({ where: { key } });
    return { ok: true };
  });

  // Public: serve an asset at a stable URL. JSON returns inline (CORS-open so BMM/BSM can
  // fetch it cross-origin); files stream from storage, forced to download. This is the
  // "BCWEB-first" source the apps point at (GitHub, then a bundled local copy, are fallbacks).
  app.get('/assets/:key', async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(404).send({ error: 'not_found' });
    const p = await db();
    const a = await p.platformAsset.findUnique({ where: { key } });
    if (!a) return reply.code(404).send({ error: 'not_found' });
    if (a.kind === 'json') {
      reply.header('Cache-Control', 'public, max-age=120').header('Access-Control-Allow-Origin', '*');
      return reply.send(a.json ?? {});
    }
    if (!a.storageKey) return reply.code(404).send({ error: 'not_found' });
    try {
      const { body, contentType } = await getObject(a.storageKey);
      reply.header('Content-Type', a.contentType || contentType || 'application/octet-stream')
        .header('Cache-Control', 'public, max-age=300')
        .header('Access-Control-Allow-Origin', '*')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', `attachment; filename="${(a.filename || key).replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
      return reply.send(body);
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
}
