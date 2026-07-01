import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireRole } from '../lib.mjs';
import { presignPut, getObject } from '../storage.mjs';

const IMG = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
// Per-kind upload caps + allowed content types (defence in depth; MinIO also enforced).
const LIMITS = {
  APP:    { maxBytes: 500 * 1024 * 1024, types: ['application/zip', 'application/octet-stream', 'application/x-msdownload'] },
  PLUGIN: { maxBytes: 50 * 1024 * 1024, types: ['application/zip', 'application/octet-stream', 'application/wasm'] },
  THEME:  { maxBytes: 5 * 1024 * 1024, types: ['application/json', 'application/zip', 'text/css'] },
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
  app.post('/uploads/presign', { preHandler: requireRole() }, async (req, reply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const { kind, filename, contentType, size } = parsed.data;
    const lim = LIMITS[kind];
    if (size > lim.maxBytes) return reply.code(413).send({ error: 'too_large', maxBytes: lim.maxBytes });
    if (!lim.types.includes(contentType)) return reply.code(415).send({ error: 'unsupported_type', allowed: lim.types });

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
    if (!key || !key.startsWith('blog/')) return reply.code(404).send({ error: 'not_found' });
    try {
      const { body, contentType } = await getObject(key);
      reply.header('Content-Type', contentType).header('Cache-Control', 'public, max-age=86400');
      return reply.send(body);
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
}
