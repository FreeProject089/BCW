import { z } from 'zod';
import { db, requireRole } from '../lib.mjs';

// The event that is live RIGHT NOW (active + within its window). One at a time; if
// several somehow overlap, the most recently started wins. Exported for the effect
// runtime and the notification scheduler.
export async function getActiveEvent(p) {
  const now = new Date();
  return p.event.findFirst({
    where: { active: true, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: 'desc' },
  });
}

// Public shape — no internal fields (name, notif timestamps, and especially eventCode,
// which is delivered privately via notifications, never surfaced to anonymous visitors).
function publicEvent(e) {
  if (!e) return null;
  return {
    id: e.id, kind: e.kind, effect: e.effect, countryCode: e.countryCode, endsAt: e.endsAt,
    titleEn: e.titleEn, titleFr: e.titleFr, messageEn: e.messageEn, messageFr: e.messageFr,
  };
}

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['custom', 'national_holiday', 'new_year']).optional(),
  countryCode: z.string().regex(/^[A-Za-z]{2}$/).optional().or(z.literal('')),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  active: z.boolean().optional(),
  effect: z.enum(['fireworks']).optional(),
  titleEn: z.string().max(120).optional(),
  titleFr: z.string().max(120).optional(),
  messageEn: z.string().max(300).optional(),
  messageFr: z.string().max(300).optional(),
  notifyDaysBefore: z.number().int().min(0).max(60).optional(),
  eventCode: z.string().max(40).optional(),
});

// Is there another ACTIVE event whose window overlaps [s,e]? Enforces "one at a time".
async function overlaps(p, s, e, exceptId) {
  const clash = await p.event.findFirst({
    where: { active: true, id: exceptId ? { not: exceptId } : undefined, startsAt: { lt: e }, endsAt: { gt: s } },
    select: { id: true, name: true },
  });
  return clash;
}

export default async function eventRoutes(app) {
  // ── Public: the live event (drives the effect + announcement) ──
  app.get('/events/active', async () => {
    const p = await db();
    return { event: publicEvent(await getActiveEvent(p)) };
  });

  // ── Admin ──
  app.get('/admin/events', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    return { events: await p.event.findMany({ orderBy: { startsAt: 'desc' } }) };
  });

  app.post('/admin/events', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;
    const starts = new Date(d.startsAt), ends = new Date(d.endsAt);
    if (ends <= starts) return reply.code(400).send({ error: 'end_before_start' });
    if ((d.kind === 'national_holiday') && !d.countryCode) return reply.code(400).send({ error: 'country_required' });
    const p = await db();
    if ((d.active ?? true)) {
      const clash = await overlaps(p, starts, ends, null);
      if (clash) return reply.code(409).send({ error: 'overlap', with: clash.name });
    }
    const e = await p.event.create({ data: {
      name: d.name, kind: d.kind ?? 'custom', countryCode: (d.countryCode || '').toUpperCase(),
      startsAt: starts, endsAt: ends, active: d.active ?? true, effect: d.effect ?? 'fireworks',
      titleEn: d.titleEn ?? '', titleFr: d.titleFr ?? '', messageEn: d.messageEn ?? '', messageFr: d.messageFr ?? '',
      notifyDaysBefore: d.notifyDaysBefore ?? 0, eventCode: (d.eventCode || '').toUpperCase().replace(/\s+/g, ''),
    } });
    return reply.code(201).send({ event: e });
  });

  app.patch('/admin/events/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = bodySchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;
    const p = await db();
    const cur = await p.event.findUnique({ where: { id: req.params.id } });
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    const data = {};
    for (const k of ['name', 'kind', 'active', 'effect', 'titleEn', 'titleFr', 'messageEn', 'messageFr', 'notifyDaysBefore']) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    if (d.countryCode !== undefined) data.countryCode = (d.countryCode || '').toUpperCase();
    if (d.eventCode !== undefined) data.eventCode = (d.eventCode || '').toUpperCase().replace(/\s+/g, '');
    if (d.startsAt) data.startsAt = new Date(d.startsAt);
    if (d.endsAt) data.endsAt = new Date(d.endsAt);
    const s = data.startsAt || cur.startsAt, e = data.endsAt || cur.endsAt;
    if (e <= s) return reply.code(400).send({ error: 'end_before_start' });
    // If it's (still) active, make sure it doesn't overlap another active event.
    if ((data.active ?? cur.active)) {
      const clash = await overlaps(p, s, e, cur.id);
      if (clash) return reply.code(409).send({ error: 'overlap', with: clash.name });
    }
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'nothing_to_update' });
    const updated = await p.event.update({ where: { id: cur.id }, data }).catch(() => null);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { event: updated };
  });

  app.delete('/admin/events/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.event.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });
}
