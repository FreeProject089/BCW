// Site-wide events: a scheduled window carrying a visual theme (frontend effects)
// and/or an automatic price discount on purchases made during it. The public
// endpoint is hot (every visitor asks "what's active?") → micro-cached; hosting.mjs
// imports getActiveEvent() to apply the discount server-side at quote/checkout time.
import { z } from 'zod';
import { db, requireRole } from '../lib.mjs';
import { cached, invalidate } from '../cache.mjs';

export const EVENT_THEMES = ['halloween', 'newyear', 'valentine', 'christmas', 'blackfriday', 'national', 'spring', 'summer', 'autumn', 'winter', 'easter', 'none'];

// The one active event right now (enabled + inside its window). If several overlap,
// the most recently started wins. Cached 30 s (invalidated on every admin write).
export async function getActiveEvent(p) {
  return cached('events.active', 30_000, async () => {
    const now = new Date();
    const ev = await p.siteEvent.findFirst({
      where: { enabled: true, startsAt: { lte: now }, endsAt: { gte: now } },
      orderBy: { startsAt: 'desc' },
    });
    if (!ev) return null;
    return { id: ev.id, name: ev.name, theme: ev.theme, flag: ev.flag || null, startsAt: ev.startsAt, endsAt: ev.endsAt, discountPct: ev.discountPct, scope: ev.scope };
  });
}

// Does the active event's discount apply to this purchase kind ('hosting'|'boost')?
export function eventDiscountFor(ev, kind) {
  if (!ev || !ev.discountPct) return 0;
  if (ev.scope === 'all' || ev.scope === kind) return Math.min(90, Math.max(0, ev.discountPct));
  return 0;
}

export default async function eventRoutes(app) {
  // ── Public: the currently active event (drives frontend theme/effects + badges) ──
  app.get('/events/active', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    const p = await db();
    const event = await getActiveEvent(p);
    return { event };
  });

  // ── Admin CRUD ──
  const eventSchema = z.object({
    name: z.string().min(2).max(80),
    theme: z.enum(EVENT_THEMES),
    flag: z.string().max(8).nullable().optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    enabled: z.boolean().optional(),
    discountPct: z.number().int().min(0).max(90).optional(),
    scope: z.enum(['all', 'hosting', 'boost']).optional(),
    note: z.string().max(300).optional(),
  });

  app.get('/admin/events', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    return { events: await p.siteEvent.findMany({ orderBy: { startsAt: 'desc' }, take: 100 }) };
  });

  app.post('/admin/events', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = eventSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (new Date(b.data.endsAt) <= new Date(b.data.startsAt)) return reply.code(400).send({ error: 'ends_before_starts' });
    const p = await db();
    const ev = await p.siteEvent.create({ data: {
      name: b.data.name, theme: b.data.theme, flag: b.data.flag || null,
      startsAt: new Date(b.data.startsAt), endsAt: new Date(b.data.endsAt),
      enabled: b.data.enabled ?? true, discountPct: b.data.discountPct ?? 0,
      scope: b.data.scope ?? 'all', note: b.data.note ?? '',
    } });
    invalidate('events.active');
    return reply.code(201).send({ event: ev });
  });

  app.put('/admin/events/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = eventSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = { ...b.data };
    if (data.startsAt) data.startsAt = new Date(data.startsAt);
    if (data.endsAt) data.endsAt = new Date(data.endsAt);
    if (data.flag !== undefined) data.flag = data.flag || null;
    const ev = await p.siteEvent.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!ev) return reply.code(404).send({ error: 'not_found' });
    if (ev.endsAt <= ev.startsAt) return reply.code(400).send({ error: 'ends_before_starts' });
    invalidate('events.active');
    return { event: ev };
  });

  app.delete('/admin/events/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.siteEvent.deleteMany({ where: { id: req.params.id } });
    invalidate('events.active');
    return { ok: true };
  });
}
