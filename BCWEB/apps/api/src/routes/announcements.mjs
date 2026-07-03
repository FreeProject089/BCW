import { z } from 'zod';
import { db, requireRole } from '../lib.mjs';

// Push a Notification to every user in one bulk insert — used both by the
// announcement broadcast and the standalone "notify everyone" admin action.
async function broadcastNotification(p, kind, body) {
  const users = await p.user.findMany({ select: { id: true } });
  if (!users.length) return 0;
  await p.notification.createMany({ data: users.map((u) => ({ userId: u.id, kind, body })) });
  return users.length;
}

const announcementSchema = z.object({
  title: z.string().min(2).max(160),
  // The UI labels this "Body (optional)" — it must actually accept an empty
  // string, or every title-only announcement (a very normal case, e.g. a short
  // banner with no extra detail) silently fails validation and never gets
  // created at all, which is exactly what made the banner "not work".
  // Banner bodies stay short/scannable (the frontend caps + counts to 500 too).
  body: z.string().max(500).default(''),
  tone: z.enum(['info', 'warning', 'success']).default('info'),
  active: z.boolean().default(true),
  showBanner: z.boolean().default(true),
  // Either an internal path ("/blog/my-post", "/p/bmm") or a full external URL —
  // the frontend decides which based on whether it starts with http(s).
  linkUrl: z.string().max(500).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export default async function announcementRoutes(app) {
  // Public: active, non-expired, banner-enabled announcements — the site-wide
  // banner reads this. Every active announcement still notifies everyone
  // regardless of showBanner (see the POST handler below).
  app.get('/announcements', async () => {
    const p = await db();
    const rows = await p.announcement.findMany({
      where: { active: true, showBanner: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: 'desc' },
    });
    return { announcements: rows };
  });

  app.get('/admin/announcements', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    return { announcements: await p.announcement.findMany({ orderBy: { createdAt: 'desc' } }) };
  });

  // Publishing an announcement also broadcasts a Notification to every user — the
  // banner is persistent/dismissible, the notification is the "something's new" ping.
  app.post('/admin/announcements', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = announcementSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const p = await db();
    const a = await p.announcement.create({ data: { ...b.data, expiresAt: b.data.expiresAt ? new Date(b.data.expiresAt) : null, createdBy: req.user.uid } });
    let notified = 0;
    if (a.active) notified = await broadcastNotification(p, 'announcement', a.title);
    return reply.code(201).send({ announcement: a, notified });
  });

  app.put('/admin/announcements/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = announcementSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = { ...b.data };
    if (data.expiresAt !== undefined) data.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    const a = await p.announcement.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    return { announcement: a };
  });

  app.delete('/admin/announcements/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.announcement.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });

  // Standalone broadcast — a one-off notification with no persistent banner.
  app.post('/admin/notify-all', { preHandler: requireRole('ADMIN'), config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = z.object({ body: z.string().min(1).max(500) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const notified = await broadcastNotification(p, 'admin_broadcast', b.data.body);
    return reply.code(201).send({ ok: true, notified });
  });
}
