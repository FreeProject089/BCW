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
    return { id: ev.id, name: ev.name, theme: ev.theme, flag: ev.flag || null, startsAt: ev.startsAt, endsAt: ev.endsAt, discountPct: ev.discountPct, scope: ev.scope, fx: ev.fx || null };
  });
}

// ONE event at a time: an enabled event may not overlap another enabled event's
// window. Returns the conflicting event (or null). Standard interval overlap:
// A.start < B.end && A.end > B.start.
async function findOverlap(p, { startsAt, endsAt, excludeId }) {
  return p.siteEvent.findFirst({ where: {
    enabled: true,
    ...(excludeId ? { id: { not: excludeId } } : {}),
    startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
  } });
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
  // Effect-editor overrides — every knob bounded so a bad value can't melt phones.
  const fxSchema = z.object({
    density: z.number().min(0.1).max(3).optional(),   // particle count multiplier
    speed: z.number().min(0.2).max(3).optional(),     // fall/float speed multiplier
    size: z.number().min(0.4).max(2.5).optional(),    // particle size multiplier
    opacity: z.number().min(0.1).max(1).optional(),   // particle opacity multiplier
    wind: z.number().min(-3).max(3).optional(),       // constant horizontal push
    intensity: z.number().min(0.2).max(3).optional(), // fireworks launch rate/burst size
    glyphs: z.string().max(60).optional(),            // custom emoji set (overrides the theme's)
    strip: z.boolean().optional(),                    // seasonal bottom illustration
    fog: z.boolean().optional(),                      // halloween fog layer
    sound: z.boolean().optional(),                    // halloween sound toggle button
    countdown: z.boolean().optional(),                // new-year midnight countdown chip
  }).optional();
  const eventSchema = z.object({
    name: z.string().min(2).max(80),
    theme: z.enum(EVENT_THEMES),
    flag: z.string().max(8).nullable().optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    enabled: z.boolean().optional(),
    discountPct: z.number().int().min(0).max(90).optional(),
    scope: z.enum(['all', 'hosting', 'boost']).optional(),
    fx: fxSchema,
    note: z.string().max(300).optional(),
  });

  app.get('/admin/events', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    return { events: await p.siteEvent.findMany({ orderBy: { startsAt: 'desc' }, take: 100 }) };
  });

  app.post('/admin/events', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = eventSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const startsAt = new Date(b.data.startsAt), endsAt = new Date(b.data.endsAt);
    if (endsAt <= startsAt) return reply.code(400).send({ error: 'ends_before_starts' });
    const p = await db();
    // One event at a time — refuse a window that overlaps another ENABLED event.
    if (b.data.enabled !== false) {
      const clash = await findOverlap(p, { startsAt, endsAt });
      if (clash) return reply.code(409).send({ error: 'overlaps', with: clash.name });
    }
    const ev = await p.siteEvent.create({ data: {
      name: b.data.name, theme: b.data.theme, flag: b.data.flag || null,
      startsAt, endsAt,
      enabled: b.data.enabled ?? true, discountPct: b.data.discountPct ?? 0,
      scope: b.data.scope ?? 'all', fx: b.data.fx ?? undefined, note: b.data.note ?? '',
    } });
    invalidate('events.active');
    return reply.code(201).send({ event: ev });
  });

  app.put('/admin/events/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = eventSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const current = await p.siteEvent.findUnique({ where: { id: req.params.id } });
    if (!current) return reply.code(404).send({ error: 'not_found' });
    // Validate the MERGED result (patch may change only one of the fields).
    const merged = {
      startsAt: b.data.startsAt ? new Date(b.data.startsAt) : current.startsAt,
      endsAt: b.data.endsAt ? new Date(b.data.endsAt) : current.endsAt,
      enabled: b.data.enabled ?? current.enabled,
    };
    if (merged.endsAt <= merged.startsAt) return reply.code(400).send({ error: 'ends_before_starts' });
    if (merged.enabled) {
      const clash = await findOverlap(p, { startsAt: merged.startsAt, endsAt: merged.endsAt, excludeId: current.id });
      if (clash) return reply.code(409).send({ error: 'overlaps', with: clash.name });
    }
    const data = { ...b.data };
    if (data.startsAt) data.startsAt = new Date(data.startsAt);
    if (data.endsAt) data.endsAt = new Date(data.endsAt);
    if (data.flag !== undefined) data.flag = data.flag || null;
    const ev = await p.siteEvent.update({ where: { id: req.params.id }, data });
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
