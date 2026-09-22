import { z } from 'zod';
import { db, requireRole, optionalAuth, logAudit, requireCap } from '../lib/lib.mjs';
import { recordPendingCheckout } from '../lib/pending-checkout.mjs';
import { clientIp } from '../lib/geo.mjs';
import { emitWebhookAll } from '../lib/webhooks.mjs';
import { stripe } from './hosting.mjs';
import {
  CHARITY_CONFIG_KEY, CHARITY_DEFAULTS, CHARITY_MAX_PCT,
  normalizeCharityConfig, computeOrgShare, clampCharityPct,
  validateContribution, potTotalCents, monthKey, CONTRIBUTION_PRESETS_CENTS, pollOpen,
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

// cents → "12.50 CHF" for an announcement body.
function money(cents, currency) {
  return `${((cents || 0) / 100).toFixed(2)} ${(currency || 'chf').toUpperCase()}`;
}

// Queue a Discord announcement (the bot polls /bot/announcements/pending and posts it, routing by
// kind). 'custom' lands in the general channel. Never allowed to block the admin action that
// raised it — a charity milestone must still be recorded even if the announcement cannot be.
async function charityAnnounce(p, { title, body, url }) {
  await p.botAnnouncement.create({ data: { kind: 'custom', title, body, url: url || null } }).catch(() => {});
}

// The admin-facing shape of a pot row (with its contributions included for the totals).
function potView(pot) {
  return {
    month: pot.month, pollId: pot.pollId || '', association: pot.association || '',
    status: pot.status, proofUrl: pot.proofUrl || '', proofNote: pot.proofNote || '',
    paidAt: pot.paidAt ? pot.paidAt.toISOString() : null,
    ...potTotalCents(pot),
  };
}

// The public shape of this month's pot. Shared by the page's /charity/current and the public
// API's /v1/charity, so there is exactly one place deciding what is published.
export async function charityCurrent(p) {
  const config = await loadConfig(p);
  if (!config.enabled) return { enabled: false };
  const month = monthKey(new Date());
  const pot = await p.charityPot.findUnique({ where: { month }, include: { contributions: { select: { amountCents: true } } } });
  const totals = potTotalCents(pot || {});
  // The month's association vote, if one is linked. Only id/question/open travel — the full
  // ballot and its tally live on /polls/:id, which already applies every visibility rule, so
  // there is no second place that decides who may see the numbers.
  let poll = null;
  if (pot?.pollId) {
    const row = await p.poll.findUnique({ where: { id: pot.pollId }, select: { id: true, question: true, status: true, opensAt: true, closesAt: true } }).catch(() => null);
    if (row) poll = { id: row.id, question: row.question, open: pollOpen(row, new Date()) };
  }
  return {
    enabled: true, month, currency: config.currency, percent: config.percent,
    // The month's own association wins over the config default once an admin has set it.
    association: pot?.association || config.association || '', status: pot?.status || 'open',
    // When the month is paid, the proof link + date travel so the page can show the completed
    // donation. proofNote is admin-facing only and stays out of the public shape.
    proofUrl: pot?.status === 'paid' ? (pot.proofUrl || '') : '',
    paidAt: pot?.paidAt ? pot.paidAt.toISOString() : null,
    poll, presets: CONTRIBUTION_PRESETS_CENTS, ...totals,
    // The widget's look (mode, artwork URLs, geometry) — public by nature, it is what the
    // landing page draws. Normalised, so a client never sees a half-filled object.
    design: config.design,
  };
}


// The body PUT /admin/charity validates. Module-level and exported so the config import (lib/config-transfer.mjs) checks a seed with this schema rather than a copy of it.
export const CHARITY_BODY = z.object({
  enabled: z.boolean().optional(),
  percent: z.number().optional(),
  currency: z.string().min(1).max(8).optional(),
  association: z.string().max(200).optional(),
  // The landing design — normalised by normalizeCharityDesign (bounds, enum values, image
  // URL shape); zod only checks it is an object so a new field never has to be listed twice.
  design: z.record(z.unknown()).optional(),
});

export default async function charityRoutes(app) {
  // Public: the current month's pot — BetterCommunity's frozen share + the community's gifts,
  // summed, plus the configured percent/association. Read by the landing widget (Phase 3) and
  // the contribute modal. Returns zeros (not an error) before any pot exists this month.
  //
  // Switched off → 404 `charity_disabled`, not a 200 saying `enabled:false`. The page and the
  // widget treat the two the same (nothing to show), but a 404 is what a client that never
  // read this file expects from a feature that is not there — and it is the same answer the
  // contribute route and `/v1/charity` give, so "off" is one status code everywhere.
  app.get('/charity/current', async (req, reply) => {
    const p = await db();
    const cur = await charityCurrent(p);
    if (!cur.enabled) return reply.code(404).send({ error: 'charity_disabled', enabled: false });
    reply.header('Cache-Control', 'public, max-age=30');
    return cur;
  });

  // Public (auth optional — an anonymous gift is allowed): start a contribution checkout. The
  // pot itself is created/credited in the webhook AFTER payment, so an abandoned checkout leaves
  // nothing behind. No money moves here — this only opens Stripe's hosted payment page.
  app.post('/charity/contribute', { preHandler: optionalAuth() }, async (req, reply) => {
    const body = z.object({ amountCents: z.number() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const v = validateContribution(body.data.amountCents);
    if (!v.ok) return reply.code(400).send({ error: v.error });

    const p = await db();
    const config = await loadConfig(p);
    // 404, like `/charity/current`: the programme is not running, so there is nothing to give to.
    if (!config.enabled) return reply.code(404).send({ error: 'charity_disabled', enabled: false });

    const sk = await stripe({ forPurchase: true });
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });

    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const month = monthKey(new Date());
    const session = await sk.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: {
        currency: config.currency,
        unit_amount: v.amountCents,
        product_data: { name: `Community Charity — ${month}` },
      } }],
      metadata: { type: 'charity', month, amountCents: String(v.amountCents), userId: req.user?.uid || '' },
      success_url: `${siteUrl}/?charity=thanks`,
      cancel_url: `${siteUrl}/?charity=cancel`,
    });
    // The in-flight ledger the crash reconciler walks (lib/stripe-reconcile.mjs). Best-effort:
    // a session that exists but is not recorded is the old behaviour, not a failed checkout.
    await recordPendingCheckout(p, { kind: session.metadata?.type || 'charity', sessionId: session.id, userId: req.user?.uid || null, payload: session.metadata || null }).catch(() => {});
    return { url: session.url };
  });

  // Admin: read the config + a live org-share preview + the current month's pot (association
  // vote link, chosen association, status, running total).
  app.get('/admin/charity', { preHandler: requireCap('manage_donations') }, async () => {
    const p = await db();
    const config = await loadConfig(p);
    const month = monthKey(new Date());
    const [mrr, burn, potRow] = await Promise.all([
      recurringMrrCents(p), monthlyBurnCents(p),
      p.charityPot.findUnique({ where: { month }, include: { contributions: { select: { amountCents: true } } } }),
    ]);
    const preview = computeOrgShare({ mrrCents: mrr, monthlyBurnCents: burn, percent: config.percent });
    const pot = potRow ? potView(potRow)
      : { month, pollId: '', association: '', status: 'open', proofUrl: '', proofNote: '', paidAt: null, orgContribCents: 0, communityCents: 0, totalCents: 0 };
    return { config, preview, maxPct: CHARITY_MAX_PCT, pot };
  });

  // Admin: manage THIS month's pot — link the association vote, set the chosen association, or
  // move its status. Get-or-creates the pot so an admin can link a vote before any gift arrives.
  app.put('/admin/charity/pot', { preHandler: requireCap('manage_donations') }, async (req, reply) => {
    const body = z.object({
      pollId: z.string().max(64).nullable().optional(),
      association: z.string().max(200).optional(),
      status: z.enum(['open', 'closing', 'paid']).optional(),
      proofUrl: z.string().max(2000).optional(),
      proofNote: z.string().max(2000).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const p = await db();
    // A linked poll must exist — a dangling id would render a broken "vote" link on the widget.
    if (body.data.pollId) {
      const exists = await p.poll.findUnique({ where: { id: body.data.pollId }, select: { id: true } }).catch(() => null);
      if (!exists) return reply.code(400).send({ error: 'poll_not_found' });
    }
    const month = monthKey(new Date());
    const config = await loadConfig(p);
    // Read the pot BEFORE the write, so a Discord announcement fires only on a real TRANSITION
    // (a first vote link, the move to paid) — not on every incidental save of the same values.
    const before = await p.charityPot.findUnique({ where: { month } });
    const data = {};
    if (body.data.pollId !== undefined) data.pollId = body.data.pollId || null;
    if (body.data.association !== undefined) data.association = body.data.association;
    if (body.data.status !== undefined) data.status = body.data.status;
    if (body.data.proofUrl !== undefined) data.proofUrl = body.data.proofUrl;
    if (body.data.proofNote !== undefined) data.proofNote = body.data.proofNote;
    // Marking a pot paid stamps when — the public page and any later audit want the date the
    // donation actually went out, not the row's mtime.
    if (data.status === 'paid') data.paidAt = new Date();
    const pot = await p.charityPot.upsert({
      where: { month },
      update: data,
      create: { month, currency: config.currency, ...data },
      include: { contributions: { select: { amountCents: true } } },
    });
    await logAudit(p, req.user.uid, 'charity.pot',
      `${month}${data.pollId !== undefined ? ` poll=${data.pollId || 'none'}` : ''}${data.association !== undefined ? ` association=${data.association}` : ''}${data.status ? ` status=${data.status}` : ''}${data.proofUrl !== undefined ? ' proof' : ''}`,
      clientIp(req)).catch(() => {});

    // ── Discord milestones (B14 Phase 6), transition-guarded ──
    const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
    // A newly-linked association vote → announce it's open (only when the id actually changed).
    if (data.pollId && data.pollId !== (before?.pollId || null)) {
      const poll = await p.poll.findUnique({ where: { id: data.pollId }, select: { question: true } }).catch(() => null);
      await charityAnnounce(p, {
        title: 'Community Charity — vote open',
        body: poll?.question ? `Vote now for this month's association: ${poll.question}` : 'Vote now for this month\'s charity.',
        url: `${siteUrl}/polls/${data.pollId}`,
      });
    }
    // The donation went out → confirmation + proof (spec: "Confirmation du don + preuve").
    if (data.status === 'paid' && before?.status !== 'paid') {
      const totals = potTotalCents(pot);
      await charityAnnounce(p, {
        title: 'Community Charity — donation sent',
        body: `This month's donation of ${money(totals.totalCents, pot.currency)}${pot.association ? ` was sent to ${pot.association}` : ' has been sent'}. Thank you to everyone who took part!`,
        url: pot.proofUrl || `${siteUrl}/charity`,
      });
    }
    return { pot: potView(pot) };
  });

  // Admin: FREEZE this month's BetterCommunity share. Computes org-share from the live
  // mrr − monthlyBurn once and writes it onto the pot, then moves the pot to 'closing'. Frozen so
  // a later revenue swing never rewrites a promise already shown to the community. Refused once a
  // pot is 'paid' — the donation is out, the number is history.
  app.post('/admin/charity/close', { preHandler: requireCap('manage_donations') }, async (req, reply) => {
    const p = await db();
    const month = monthKey(new Date());
    const existing = await p.charityPot.findUnique({ where: { month } });
    if (existing?.status === 'paid') return reply.code(409).send({ error: 'already_paid' });
    const config = await loadConfig(p);
    const [mrr, burn] = await Promise.all([recurringMrrCents(p), monthlyBurnCents(p)]);
    const share = computeOrgShare({ mrrCents: mrr, monthlyBurnCents: burn, percent: config.percent });
    const pot = await p.charityPot.upsert({
      where: { month },
      update: { orgContribCents: share.orgShareCents, status: 'closing' },
      create: { month, currency: config.currency, orgContribCents: share.orgShareCents, status: 'closing' },
      include: { contributions: { select: { amountCents: true } } },
    });
    await logAudit(p, req.user.uid, 'charity.close', `${month} orgShare=${share.orgShareCents} (${share.percent}% of ${share.eligibleCents})`, clientIp(req)).catch(() => {});
    emitWebhookAll(p, 'charity.month.closed', { month, currency: config.currency, orgShareCents: share.orgShareCents, eligibleCents: share.eligibleCents, percent: share.percent }).catch(() => {});
    // Announce the tally once, on the move INTO closing — the community sees where the month
    // landed. Not re-announced if the pot was already closing.
    if (existing?.status !== 'closing') {
      const totals = potTotalCents(pot);
      const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
      await charityAnnounce(p, {
        title: `Community Charity — ${month}`,
        body: `This month's pot: ${money(totals.totalCents, pot.currency)} (${money(totals.orgContribCents, pot.currency)} from BetterCommunity + ${money(totals.communityCents, pot.currency)} from the community). The donation will be sent shortly.`,
        url: `${siteUrl}/charity`,
      });
    }
    return { pot: potView(pot), frozen: share };
  });

  // Admin: update the config. Percent is clamped server-side to [0, 50] regardless of input,
  // so the 50% ceiling holds even if the UI is bypassed.
  app.put('/admin/charity', { preHandler: requireCap('manage_donations') }, async (req, reply) => {
    const body = CHARITY_BODY.safeParse(req.body);
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
