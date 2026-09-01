import { z } from 'zod';
import { db, requireRole, logAudit } from '../lib/lib.mjs';
import { clientIp } from '../lib/geo.mjs';
import {
  CHARITY_CONFIG_KEY, CHARITY_DEFAULTS, CHARITY_MAX_PCT,
  normalizeCharityConfig, computeOrgShare, clampCharityPct,
} from '../lib/charity.mjs';

// B14 Community Charity — Phase 1: admin config + the org-share preview. No money moves here;
// the contribution rail and the public widget are later phases. This route lets an admin set
// the monthly percentage (hard-capped at 50) and see, live, what BetterCommunity's share would
// be from the revenue the site already tracks.

// Recurring cost the business carries EVERY month right now — the same formula the expenses
// screen calls `monthlyBurn` (routes/misc.mjs): monthly costs at face value, yearly costs /12,
// one-offs excluded. Kept identical so the two screens never disagree about the burn.
async function monthlyBurnCents(p) {
  const rows = await p.expense.findMany({ select: { amountCents: true, recurring: true } });
  return rows.reduce((n, e) => n
    + (e.recurring === 'monthly' ? e.amountCents
      : e.recurring === 'yearly' ? Math.round(e.amountCents / 12)
        : 0), 0);
}

// Recurring income, DB-native: the sum of every ACTIVE subscription's plan price. This is the
// figure the billing screens approximate from Stripe; taken from the DB here so a preview never
// depends on a live Stripe call (Stripe may not even be configured in a given environment).
async function recurringMrrCents(p) {
  const subs = await p.subscription.findMany({
    where: { status: 'active' },
    select: { plan: { select: { priceMonthlyCents: true } } },
  });
  return subs.reduce((n, s) => n + (s.plan?.priceMonthlyCents || 0), 0);
}

async function loadConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: CHARITY_CONFIG_KEY } });
  return normalizeCharityConfig(row?.value);
}

export default async function charityRoutes(app) {
  // Admin: read the config + a live org-share preview computed from mrr − monthlyBurn.
  app.get('/admin/charity', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const config = await loadConfig(p);
    const [mrr, burn] = await Promise.all([recurringMrrCents(p), monthlyBurnCents(p)]);
    const preview = computeOrgShare({ mrrCents: mrr, monthlyBurnCents: burn, percent: config.percent });
    return { config, preview, maxPct: CHARITY_MAX_PCT };
  });

  // Admin: update the config. Percent is clamped server-side to [0, 50] regardless of input,
  // so the 50% ceiling holds even if the UI is bypassed.
  app.put('/admin/charity', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const body = z.object({
      enabled: z.boolean().optional(),
      percent: z.number().optional(),
      currency: z.string().min(1).max(8).optional(),
      association: z.string().max(200).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });

    const p = await db();
    const current = await loadConfig(p);
    const next = normalizeCharityConfig({ ...current, ...body.data });
    await p.adminSetting.upsert({
      where: { key: CHARITY_CONFIG_KEY },
      create: { key: CHARITY_CONFIG_KEY, value: next },
      update: { value: next },
    });
    await logAudit(p, req.user.uid,
      'charity.config',
      `enabled=${next.enabled} percent=${next.percent}% currency=${next.currency}${next.association ? ` association=${next.association}` : ''}`,
      clientIp(req)).catch(() => {});

    const [mrr, burn] = await Promise.all([recurringMrrCents(p), monthlyBurnCents(p)]);
    const preview = computeOrgShare({ mrrCents: mrr, monthlyBurnCents: burn, percent: next.percent });
    return { config: next, preview, maxPct: CHARITY_MAX_PCT };
  });
}

export { CHARITY_DEFAULTS, clampCharityPct };
