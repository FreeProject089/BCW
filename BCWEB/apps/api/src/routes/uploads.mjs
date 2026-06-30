import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireRole } from '../lib.mjs';
import { presignPut } from '../storage.mjs';

// Per-kind upload caps + allowed content types (defence in depth; MinIO also enforced).
const LIMITS = {
  APP:    { maxBytes: 500 * 1024 * 1024, types: ['application/zip', 'application/octet-stream', 'application/x-msdownload'] },
  PLUGIN: { maxBytes: 50 * 1024 * 1024, types: ['application/zip', 'application/octet-stream', 'application/wasm'] },
  THEME:  { maxBytes: 5 * 1024 * 1024, types: ['application/json', 'application/zip', 'text/css'] },
  PRESET: { maxBytes: 2 * 1024 * 1024, types: ['application/json'] },
};

const schema = z.object({
  kind: z.enum(['APP', 'PLUGIN', 'THEME', 'PRESET']),
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
    const key = `uploads/${req.user.uid}/${randomUUID()}-${safe}`;
    const url = await presignPut(key, contentType);
    return { key, url, expiresIn: 600 };
  });
}
