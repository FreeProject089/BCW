import { z } from 'zod';
import { db, requireRole } from '../lib/lib.mjs';

// Strict hex color (#rgb / #rrggbb) — the badge color is rendered into a style
// attribute on the client, so anything else is rejected to avoid CSS injection.
const isSafeHex = (s) => typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);

// Badge click target: empty, an INTERNAL path ("/blog/x" — not "//" which is external
// protocol-relative), or an http(s) URL. Rejects javascript:/data:/etc. (CWE-79).
const isSafeLink = (s) => typeof s === 'string' && (s === '' || /^\/(?!\/)/.test(s) || /^https?:\/\/./i.test(s));

// Resolve the single campaign that is live RIGHT NOW (active + within its window).
// If several overlap, the most recently started one wins. Returns null when none.
export async function getActiveCampaign(p) {
  const now = new Date();
  return p.promoCampaign.findFirst({
    where: { active: true, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: 'desc' },
  });
}

// Apply the live site-wide campaign to an amount, if one covers this kind of purchase.
//
// Extracted because it was open-coded at two checkouts and simply absent from the other
// nine — so a campaign the admin created as `appliesTo: 'all'`, and a site-wide badge
// reading "30% off all purchases", discounted repo hosting and boosts and nothing else.
// A promise made in the badge and kept at two of eleven tills.
//
// `scope` is what this purchase counts as: a campaign applies when it targets 'all' or
// exactly that scope.
//
// Returns the amount unchanged and an empty label when no campaign applies, so a caller
// can use it unconditionally.
//
// The floor is Stripe's minimum chargeable amount. A campaign only ever DISCOUNTS — free
// is what a free-hosting grant code is for — so 100% off must not produce a 0 the payment
// intent would reject.
export const CAMPAIGN_MIN_CENTS = 50;

export async function applyCampaign(p, amount, scope) {
  const camp = await getActiveCampaign(p).catch(() => null);
  if (!camp || (camp.appliesTo !== 'all' && camp.appliesTo !== scope)) {
    return { amount, label: '', campaign: null };
  }
  const discounted = Math.max(CAMPAIGN_MIN_CENTS, Math.round(amount * (1 - camp.percentOff / 100)));
  const what = camp.kind === 'black_friday' ? 'Black Friday' : 'sale';
  return { amount: discounted, label: ` · −${camp.percentOff}% ${what}`, campaign: camp };
}

// Public shape (no internal fields like `name`/`active` leak to anonymous users).
function publicCampaign(c) {
  if (!c) return null;
  return {
    id: c.id, kind: c.kind, percentOff: c.percentOff, appliesTo: c.appliesTo, endsAt: c.endsAt,
    badgeEnabled: c.badgeEnabled, badgeMessageEn: c.badgeMessageEn, badgeMessageFr: c.badgeMessageFr,
    badgeColor: isSafeHex(c.badgeColor) ? c.badgeColor : '',
    badgeLink: isSafeLink(c.badgeLink) ? c.badgeLink : '',
  };
}

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['custom', 'black_friday', 'new_year', 'flash']).optional(),
  percentOff: z.number().int().min(1).max(100),
  appliesTo: z.enum(['all', 'hosting', 'boost']).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  active: z.boolean().optional(),
  badgeEnabled: z.boolean().optional(),
  badgeMessageEn: z.string().max(200).optional(),
  badgeMessageFr: z.string().max(200).optional(),
  badgeColor: z.string().max(7).optional(),
  badgeLink: z.string().max(300).optional(),
});

export default async function campaignRoutes(app) {
  // ── Public: the currently-live campaign (drives the site-wide badge + auto-discount) ──
  app.get('/promo/campaign/active', async () => {
    const p = await db();
    return { campaign: publicCampaign(await getActiveCampaign(p)) };
  });

  // ── Admin: manage campaigns ──
  app.get('/admin/campaigns', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    return { campaigns: await p.promoCampaign.findMany({ orderBy: { startsAt: 'desc' } }) };
  });

  app.post('/admin/campaigns', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;
    const starts = new Date(d.startsAt), ends = new Date(d.endsAt);
    if (ends <= starts) return reply.code(400).send({ error: 'end_before_start' });
    if (d.badgeColor && !isSafeHex(d.badgeColor)) return reply.code(400).send({ error: 'bad_color' });
    if (d.badgeLink && !isSafeLink(d.badgeLink)) return reply.code(400).send({ error: 'bad_link' });
    const p = await db();
    const c = await p.promoCampaign.create({ data: {
      name: d.name, kind: d.kind ?? 'custom', percentOff: d.percentOff, appliesTo: d.appliesTo ?? 'all',
      startsAt: starts, endsAt: ends, active: d.active ?? true, badgeEnabled: d.badgeEnabled ?? true,
      badgeMessageEn: d.badgeMessageEn ?? '', badgeMessageFr: d.badgeMessageFr ?? '', badgeColor: d.badgeColor ?? '',
      badgeLink: d.badgeLink ?? '',
    } });
    return reply.code(201).send({ campaign: c });
  });

  app.patch('/admin/campaigns/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = bodySchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;
    if (d.badgeColor && !isSafeHex(d.badgeColor)) return reply.code(400).send({ error: 'bad_color' });
    if (d.badgeLink && !isSafeLink(d.badgeLink)) return reply.code(400).send({ error: 'bad_link' });
    const data = {};
    for (const k of ['name', 'kind', 'percentOff', 'appliesTo', 'active', 'badgeEnabled', 'badgeMessageEn', 'badgeMessageFr', 'badgeColor', 'badgeLink']) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    if (d.startsAt) data.startsAt = new Date(d.startsAt);
    if (d.endsAt) data.endsAt = new Date(d.endsAt);
    if ((data.startsAt || data.endsAt)) {
      const p0 = await db();
      const cur = await p0.promoCampaign.findUnique({ where: { id: req.params.id } });
      if (!cur) return reply.code(404).send({ error: 'not_found' });
      const s = data.startsAt || cur.startsAt, e = data.endsAt || cur.endsAt;
      if (e <= s) return reply.code(400).send({ error: 'end_before_start' });
    }
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'nothing_to_update' });
    const p = await db();
    const c = await p.promoCampaign.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    return { campaign: c };
  });

  app.delete('/admin/campaigns/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.promoCampaign.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });
}
