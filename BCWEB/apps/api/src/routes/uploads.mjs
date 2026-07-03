import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db, requireRole } from '../lib.mjs';
import { presignPut, getObject } from '../storage.mjs';

const GiB = 1024 ** 3;
// Submission payloads (.bmmplugin / .bmmtheme / app bundles / presets) live in a
// DEDICATED temp margin, separate from the hosted-repo capacity. When it's full,
// uploads are refused until moderation clears space (approve→paid hosting / reject).
export async function tempMarginStatus(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'hosting.tempMarginGB' } }).catch(() => null);
  const marginGB = Number(row?.value ?? 20);
  // Only PENDING submissions count here — once approved or rejected they no longer
  // occupy "space awaiting a moderation decision" (approved work moves to the
  // permanent submissionsPublished bucket in capacityStatus(); this was the bug
  // where the temp margin filled up forever and never freed after approvals).
  const agg = await p.catalogItem.aggregate({ where: { payloadKey: { not: null }, status: 'PENDING' }, _sum: { payloadSize: true } });
  const usedBytes = Number(agg._sum.payloadSize || 0);
  return { marginGB, usedBytes, usedGB: usedBytes / GiB, freeBytes: Math.max(0, marginGB * GiB - usedBytes) };
}

const IMG = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
// Per-kind upload caps + allowed content types (defence in depth; MinIO also enforced).
const LIMITS = {
  APP:    { maxBytes: 500 * 1024 * 1024, types: ['application/zip', 'application/octet-stream', 'application/x-msdownload'] },
  PLUGIN: { maxBytes: 50 * 1024 * 1024, types: ['application/zip', 'application/octet-stream', 'application/wasm'] },
  // .bmmtheme is a custom extension unknown to browser MIME tables, so
  // <input type=file> reports an empty file.type → uploadPayload() falls back
  // to 'application/octet-stream'. Without it here every real .bmmtheme
  // submission 415'd (this was the "submit content doesn't work" bug).
  THEME:  { maxBytes: 5 * 1024 * 1024, types: ['application/json', 'application/zip', 'text/css', 'application/octet-stream'] },
  PRESET: { maxBytes: 2 * 1024 * 1024, types: ['application/json'] },
  BLOG:   { maxBytes: 10 * 1024 * 1024, types: IMG, prefix: 'blog' },
};

const schema = z.object({
  kind: z.enum(['APP', 'PLUGIN', 'THEME', 'PRESET', 'BLOG']),
  filename: z.string().min(1).max(160),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive(),
});

export default async function uploadRoutes(app) {
  // Anti-spam: presigning is rate-limited — a burst of raw uploads can't drain the
  // temp margin or flood object storage even without creating catalog items.
  app.post('/uploads/presign', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const { kind, filename, contentType, size } = parsed.data;
    const lim = LIMITS[kind];
    if (size > lim.maxBytes) return reply.code(413).send({ error: 'too_large', maxBytes: lim.maxBytes });
    if (!lim.types.includes(contentType)) return reply.code(415).send({ error: 'unsupported_type', allowed: lim.types });
    // Submission payloads draw from the dedicated temp margin — refuse when full.
    if (kind !== 'BLOG') {
      const temp = await tempMarginStatus(await db());
      if (size > temp.freeBytes) return reply.code(507).send({ error: 'temp_storage_full', marginGB: temp.marginGB, usedGB: Number(temp.usedGB.toFixed(2)) });
    }

    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const key = lim.prefix ? `${lim.prefix}/${randomUUID()}-${safe}` : `uploads/${req.user.uid}/${randomUUID()}-${safe}`;
    const url = await presignPut(key, contentType);
    // For blog images, return a stable public URL (served by the media proxy below).
    const mediaUrl = kind === 'BLOG' ? `/api/media/${key}` : null;
    return { key, url, mediaUrl, expiresIn: 600 };
  });

  // Public media proxy — serves blog images with stable URLs (only the blog/ prefix).
  app.get('/media/*', async (req, reply) => {
    const key = req.params['*'];
    // Public only under the blog/ prefix. Reject any '..' so a crafted key can't
    // escape the prefix into another user's uploads if the store normalises paths.
    if (!key || !key.startsWith('blog/') || key.includes('..')) return reply.code(404).send({ error: 'not_found' });
    try {
      const { body, contentType } = await getObject(key);
      reply.header('Content-Type', contentType).header('Cache-Control', 'public, max-age=86400');
      return reply.send(body);
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
}
