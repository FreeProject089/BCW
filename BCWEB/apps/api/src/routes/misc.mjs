import { z } from 'zod';
import { db, requireRole, slugify } from '../lib.mjs';

export default async function miscRoutes(app) {
  // ── Notifications ──
  app.get('/me/notifications', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    return { notifications: await p.notification.findMany({ where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  });
  app.post('/me/notifications/:id/read', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    await p.notification.updateMany({ where: { id: req.params.id, userId: req.user.uid }, data: { readAt: new Date() } });
    return { ok: true };
  });

  // (Blog routes live in routes/blog.mjs.)

  // (Server-repo routes live in routes/repos.mjs.)

  // ── Admin settings (global hosting cap, pricing knobs…) ──
  app.get('/admin/settings', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const rows = await p.adminSetting.findMany();
    return { settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  });
  app.put('/admin/settings/:key', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const value = req.body?.value ?? req.body;
    await p.adminSetting.upsert({ where: { key: req.params.key }, create: { key: req.params.key, value }, update: { value } });
    return { ok: true };
  });
}
