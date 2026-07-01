import { z } from 'zod';
import { db, requireRole } from '../lib.mjs';

// Privacy-friendly first-party analytics: a page path + optional referrer. No
// cookies, no PII, no third party. The client only calls this after cookie consent.
export default async function analyticsRoutes(app) {
  app.post('/analytics/pageview', async (req, reply) => {
    const b = z.object({ path: z.string().max(300), ref: z.string().max(300).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    await p.analyticsEvent.create({ data: { path: b.data.path, ref: b.data.ref || null } }).catch(() => {});
    return reply.code(204).send();
  });

  // Admin overview: totals + top paths over the last 30 days.
  app.get('/admin/analytics', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const since = new Date(Date.now() - 30 * 864e5);
    const [total, last30, top] = await Promise.all([
      p.analyticsEvent.count(),
      p.analyticsEvent.count({ where: { createdAt: { gte: since } } }),
      p.analyticsEvent.groupBy({ by: ['path'], _count: { path: true }, where: { createdAt: { gte: since } }, orderBy: { _count: { path: 'desc' } }, take: 10 }),
    ]);
    return { total, last30, top: top.map((t) => ({ path: t.path, count: t._count.path })) };
  });
}
