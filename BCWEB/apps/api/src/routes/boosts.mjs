// Included boosts: the ledger, and spending one.
//
// A plan can come with N boosts every M months. They are granted as ROWS rather than counted
// on the subscription, because "you have 2" answers nothing when somebody asks where the
// others went — and a counter has to be adjusted by every writer, so it drifts the first time
// one of them fails halfway.
//
// Spendable on a repo OR a catalogue. Both listings have always sorted by featuredUntil, so a
// featured catalogue already surfaced; what did not exist was any way to make one.
import { z } from 'zod';
import { db, requireRole, requireCap, logAudit, clientIp, notify } from '../lib/lib.mjs';
import { periodStartFor, owedThisPeriod, boostEndFrom, creditState, pickCredit } from '../lib/boostcredit.mjs';
import { recordChange } from '../lib/changelog.mjs';

/** What the owner sees. Never the subscription id — it is ours, not theirs. */
export const creditView = (c, now = new Date()) => ({
  id: c.id,
  days: c.days,
  state: creditState(c, now),
  grantedAt: c.createdAt,
  expiresAt: c.expiresAt,
  usedAt: c.usedAt,
  usedOn: c.usedRepoId ? { kind: 'repo', id: c.usedRepoId } : c.usedCatalogId ? { kind: 'catalog', id: c.usedCatalogId } : null,
});

/**
 * Grant whatever the current period owes, for every live subscription on a plan that includes
 * boosts. Called from the sweeper; safe to call twice.
 *
 * Idempotence is the unique index (subscriptionId, periodStart, seq), not a check-then-write:
 * two containers running the sweeper at the same instant would both pass a check.
 */
export async function grantIncludedBoosts(p, now = new Date()) {
  let granted = 0;
  const subs = await p.subscription.findMany({
    where: { status: 'active', plan: { boostsPerPeriod: { gt: 0 } } },
    select: {
      id: true, userId: true, createdAt: true, currentPeriodEnd: true,
      plan: { select: { id: true, boostsPerPeriod: true, boostPeriodMonths: true, boostDays: true } },
    },
    take: 5000,
  });
  for (const sub of subs) {
    const plan = sub.plan;
    if (!plan?.boostsPerPeriod) continue;
    const periodStart = periodStartFor(sub.createdAt, now, plan.boostPeriodMonths);
    const have = await p.boostCredit.count({ where: { subscriptionId: sub.id, periodStart } });
    const owed = owedThisPeriod(plan, have);
    for (let i = 0; i < owed; i++) {
      try {
        await p.boostCredit.create({
          data: {
            ownerId: sub.userId,
            subscriptionId: sub.id,
            planId: plan.id,
            days: plan.boostDays,
            periodStart,
            seq: have + i,
            // Use it or lose it, at the end of the period that granted it. A credit that never
            // expires turns a monthly perk into a savings account, and twelve arriving at once
            // is not what was sold.
            expiresAt: periodStartFor(sub.createdAt, new Date(periodStart.getTime() + plan.boostPeriodMonths * 30 * 24 * 3600 * 1000 + 1000), plan.boostPeriodMonths),
          },
        });
        granted++;
      } catch { /* the unique index did its job — another run got there first */ }
    }
    if (owed > 0) {
      await notify(p, sub.userId, 'hosting_started',
        `${owed} boost${owed === 1 ? '' : 's'} included with your plan ${owed === 1 ? 'is' : 'are'} available.`).catch(() => {});
    }
  }
  return granted;
}

export default async function boostRoutes(app) {
  /** The owner's ledger, and what they can spend it on. */
  app.get('/me/boosts', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const now = new Date();
    const credits = await p.boostCredit.findMany({
      where: { ownerId: req.user.uid },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const available = credits.filter((c) => creditState(c, now) === 'available');
    // The two things a credit can be spent on, so the picker does not need two more calls.
    const [repos, catalogs] = await Promise.all([
      p.serverRepo.findMany({ where: { ownerId: req.user.uid, deleteAt: null }, select: { id: true, name: true, featuredUntil: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
      p.communityCatalog.findMany({ where: { ownerId: req.user.uid, deleteAt: null }, select: { id: true, name: true, featuredUntil: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    return {
      available: available.length,
      nextExpiry: available.map((c) => c.expiresAt).filter(Boolean).sort()[0] || null,
      credits: credits.slice(0, 60).map((c) => creditView(c, now)),
      targets: {
        repos: repos.map((r) => ({ ...r, featured: !!(r.featuredUntil && r.featuredUntil > now) })),
        catalogs: catalogs.map((c) => ({ ...c, featured: !!(c.featuredUntil && c.featuredUntil > now) })),
      },
    };
  });

  /**
   * Spend one on a repo or a catalogue.
   *
   * The credit is claimed with a guarded update rather than read-then-write: two clicks on a
   * slow connection would otherwise both find the same unused row and both feature something,
   * spending one credit twice. `updateMany` with `usedAt: null` in the WHERE either claims it
   * or reports zero rows, and zero rows means somebody else already had it.
   */
  app.post('/me/boosts/spend', {
    preHandler: requireRole(),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(['repo', 'catalog']),
      id: z.string().min(1).max(60),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const now = new Date();

    const target = b.data.kind === 'repo'
      ? await p.serverRepo.findUnique({ where: { id: b.data.id }, select: { id: true, name: true, ownerId: true, featuredUntil: true, deleteAt: true } })
      : await p.communityCatalog.findUnique({ where: { id: b.data.id }, select: { id: true, name: true, ownerId: true, featuredUntil: true, deleteAt: true } });
    if (!target || target.deleteAt) return reply.code(404).send({ error: 'not_found' });
    if (target.ownerId !== req.user.uid) return reply.code(403).send({ error: 'forbidden' });

    const credits = await p.boostCredit.findMany({ where: { ownerId: req.user.uid, usedAt: null }, take: 200 });
    const pick = pickCredit(credits, now);
    if (!pick) return reply.code(409).send({ error: 'no_credit' });

    const claimed = await p.boostCredit.updateMany({
      where: { id: pick.id, usedAt: null },
      data: {
        usedAt: now,
        usedRepoId: b.data.kind === 'repo' ? target.id : null,
        usedCatalogId: b.data.kind === 'catalog' ? target.id : null,
      },
    });
    if (!claimed.count) return reply.code(409).send({ error: 'no_credit' });

    // Stacks onto whatever is left, which is the whole reason boostEndFrom exists rather than
    // `now + days` written here.
    const until = boostEndFrom(target.featuredUntil, pick.days, now);
    if (b.data.kind === 'repo') await p.serverRepo.update({ where: { id: target.id }, data: { featuredUntil: until } });
    else await p.communityCatalog.update({ where: { id: target.id }, data: { featuredUntil: until } });

    await recordChange(p, b.data.kind === 'repo' ? { repoId: target.id } : { catalogId: target.id }, {
      actorId: req.user.uid, actorLabel: req.user.name || req.user.uid, action: 'plan', summary: '',
      changes: [{ field: 'featuredUntil', from: target.featuredUntil ? new Date(target.featuredUntil).toISOString() : null, to: until.toISOString() }],
    }).catch(() => {});
    await logAudit(p, req.user.uid, 'boost.spend', `${target.name} — ${pick.days}d included boost`, clientIp(req)).catch(() => {});
    return { ok: true, featuredUntil: until, remaining: credits.filter((c) => c.id !== pick.id && creditState(c, now) === 'available').length };
  });

  /**
   * Hand somebody a credit by hand — support, an apology, a giveaway.
   *
   * Under /admin/hosting rather than /admin/boosts: the capability ratchet refuses to let
   * manage_hosting reach a second URL section, and it is right to. An included boost is a
   * property of a hosting plan, so this is where it lives.
   */
  app.post('/admin/hosting/boosts/grant', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const b = z.object({
      userId: z.string().min(1).max(60),
      days: z.number().int().min(1).max(365).default(7),
      count: z.number().int().min(1).max(20).default(1),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const now = new Date();
    const made = [];
    for (let i = 0; i < b.data.count; i++) {
      // subscriptionId null, so the unique index does not apply — a hand-granted credit is not
      // part of any period and must not collide with one that is.
      made.push(await p.boostCredit.create({
        data: { ownerId: b.data.userId, days: b.data.days, periodStart: now, seq: i, expiresAt: null },
      }));
    }
    await logAudit(p, req.user.uid, 'boost.grant', `${b.data.count} × ${b.data.days}d to ${b.data.userId}`, clientIp(req)).catch(() => {});
    return { ok: true, granted: made.length };
  });
}
