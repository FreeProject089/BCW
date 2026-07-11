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
    fxDensity: e.fxDensity, fxSize: e.fxSize, fxFlagDrops: e.fxFlagDrops, badgeIcon: e.badgeIcon,
    linkUrl: e.linkUrl || null,
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
  fxDensity: z.number().int().min(1).max(10).optional(),
  fxSize: z.number().int().min(1).max(10).optional(),
  fxFlagDrops: z.number().int().min(0).max(20).optional(),
  badgeIcon: z.enum(['sparkles', 'party', 'flag', 'gift', 'star', 'rocket', 'calendar', 'bell']).optional(),
  // Where the badge links: an internal path (/…) or an http(s) URL. Empty = not clickable.
  linkUrl: z.string().max(400).refine((v) => v === '' || v.startsWith('/') || /^https?:\/\//.test(v), 'must be a path or http(s) URL').optional().or(z.literal('')),
  promoPercent: z.number().int().min(0).max(100).optional(),
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
    let e = await p.event.create({ data: {
      name: d.name, kind: d.kind ?? 'custom', countryCode: (d.countryCode || '').toUpperCase(),
      startsAt: starts, endsAt: ends, active: d.active ?? true, effect: d.effect ?? 'fireworks',
      fxDensity: d.fxDensity ?? 5, fxSize: d.fxSize ?? 5, fxFlagDrops: d.fxFlagDrops ?? 2, badgeIcon: d.badgeIcon ?? 'sparkles',
      linkUrl: d.linkUrl || null, promoPercent: d.promoPercent ?? 0,
      titleEn: d.titleEn ?? '', titleFr: d.titleFr ?? '', messageEn: d.messageEn ?? '', messageFr: d.messageFr ?? '',
      notifyDaysBefore: d.notifyDaysBefore ?? 0, eventCode: (d.eventCode || '').toUpperCase().replace(/\s+/g, ''),
    } });
    // Event promo: a linked site-wide campaign (discount + badge for the window) and,
    // if an event-code is set, a promo code valid ONLY during the event window.
    if (e.promoPercent > 0) {
      const camp = await p.promoCampaign.create({ data: {
        name: `Event: ${e.name}`, kind: 'custom', percentOff: e.promoPercent, appliesTo: 'all',
        startsAt: starts, endsAt: ends, active: true, badgeEnabled: true,
        badgeMessageEn: e.titleEn || e.messageEn || 'Event offer', badgeMessageFr: e.titleFr || e.messageFr || 'Offre événement',
        eventId: e.id,
      } }).catch(() => null);
      if (camp) e = await p.event.update({ where: { id: e.id }, data: { campaignId: camp.id } });
      if (e.eventCode) {
        await p.promoCode.create({ data: {
          code: e.eventCode, kind: 'discount', percentOff: e.promoPercent, active: true,
          notBefore: starts, expiresAt: ends, note: `event: ${e.name}`,
        } }).catch(() => { /* a code with that name already exists — leave it be */ });
      }
    }
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
    for (const k of ['name', 'kind', 'active', 'effect', 'fxDensity', 'fxSize', 'fxFlagDrops', 'badgeIcon', 'linkUrl', 'promoPercent', 'titleEn', 'titleFr', 'messageEn', 'messageFr', 'notifyDaysBefore']) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    if (data.linkUrl === '') data.linkUrl = null;
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
    const e = await p.event.findUnique({ where: { id: req.params.id } });
    if (e) {
      // Tear down the linked campaign + event-only code alongside the event.
      if (e.campaignId) await p.promoCampaign.delete({ where: { id: e.campaignId } }).catch(() => {});
      if (e.eventCode) await p.promoCode.deleteMany({ where: { code: e.eventCode, note: `event: ${e.name}` } }).catch(() => {});
      await p.event.delete({ where: { id: e.id } }).catch(() => {});
    }
    return { ok: true };
  });
}

// Notification body for an event (prefer FR then EN; append the event-only code).
function eventNotifBody(e, pre) {
  const title = e.titleFr || e.titleEn || e.name;
  const msg = e.messageFr || e.messageEn || '';
  const code = e.eventCode ? ` · code ${e.eventCode} (−${e.promoPercent}%, ${'event only'})` : '';
  return pre
    ? `Bientôt / Upcoming: ${title}${msg ? ` — ${msg}` : ''}${code}`
    : `${title}${msg ? ` — ${msg}` : ''}${code}`;
}

async function broadcastEventNotif(p, e, pre) {
  const users = await p.user.findMany({ select: { id: true } });
  if (!users.length) return;
  const body = eventNotifBody(e, pre);
  await p.notification.createMany({ data: users.map((u) => ({ userId: u.id, kind: 'event', body })) }).catch(() => {});
}

// Periodic (called from the sweeper): fire the pre-event notification once
// `notifyDaysBefore` days out, and the activation notification once the event goes
// live. Idempotent via preNotifiedAt / startNotifiedAt.
export async function runEventScheduler(p) {
  const now = new Date();
  const pre = await p.event.findMany({ where: { active: true, notifyDaysBefore: { gt: 0 }, preNotifiedAt: null, startsAt: { gt: now } } });
  for (const e of pre) {
    if (new Date(e.startsAt.getTime() - e.notifyDaysBefore * 86400000) <= now) {
      await broadcastEventNotif(p, e, true);
      await p.event.update({ where: { id: e.id }, data: { preNotifiedAt: now } }).catch(() => {});
    }
  }
  const started = await p.event.findMany({ where: { active: true, startNotifiedAt: null, startsAt: { lte: now }, endsAt: { gte: now } } });
  for (const e of started) {
    await broadcastEventNotif(p, e, false);
    await p.event.update({ where: { id: e.id }, data: { startNotifiedAt: now } }).catch(() => {});
  }
}
