// agent-bcw-pools: admin-made payment links (rules in lib/paylinks.mjs).
//
// ADMIN (manage_hosting, the capability that already owns plans, pools and prices)
//   GET    /admin/hosting/paylinks              every link, with its counts
//   POST   /admin/hosting/paylinks/quote        what a link would charge (nothing written)
//   POST   /admin/hosting/paylinks              create one
//   GET    /admin/hosting/paylinks/:id          one, with who paid (names only) and when
//   PATCH  /admin/hosting/paylinks/:id          edit the words, the limit, the expiry; revoke
//
// MEMBERS
//   GET    /pay/:token                          the link as a payer sees it (signed out: the
//                                               same, without the "may I" answer)
//   POST   /pay/:token/checkout                 hold a place, open Stripe Checkout
//   GET    /me/paylinks                         what I paid through links (my receipts)
//
// The WEBHOOK delivers (routes/stripe-webhook.mjs, type `paylink`, lib/paylinks.mjs
// fulfilPaylink). Nothing on this side grants anything: the return page only reads.
import { z } from 'zod';
import { db, requireCap, requireRole, optionalAuth, logAudit, clientIp } from '../lib/lib.mjs';
import { stripe, ensureCustomer, settings as hostingSettings, priceCents } from './hosting.mjs';
import { recordPendingCheckout } from '../lib/pending-checkout.mjs';
import { projectByRef, projectByTarget } from '../lib/project-target.mjs';
import {
  paylinkSchema, paylinkProblem, amountFor, unavailable, serPublic, serAdmin, checkoutParams, newToken, HOLD_MINUTES, LIMITS,
} from '../lib/paylinks.mjs';

const bad = (reply, r) => reply.code(400).send({ error: 'invalid_input', issues: r.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })) });
const tariff = (st) => (gb, mbps) => priceCents(st, gb, mbps, 0);

/** The stored `provision` for a parsed body, with the names a payer is shown. Answers
 *  { provision } or { error }. */
async function provisionOf(p, d) {
  if (d.kind === 'pool') {
    const pv = { storageGB: d.pool.storageGB, uploadMbps: d.pool.uploadMbps, months: d.pool.months };
    if (d.pool.projectRef) {
      const proj = await projectByRef(p, d.pool.projectRef);
      if (!proj) return { error: 'unknown_project' };
      pv.projectTarget = proj.target; pv.projectName = proj.name;
    }
    return { provision: pv };
  }
  if (d.kind === 'prerelease') {
    const pr = await p.preRelease.findUnique({ where: { id: d.prereleaseId }, select: { id: true, title: true, slug: true, closedAt: true } });
    if (!pr) return { error: 'unknown_prerelease' };
    if (pr.closedAt) return { error: 'prerelease_closed' };
    return { provision: { prereleaseId: pr.id, prereleaseTitle: pr.title, prereleaseSlug: pr.slug } };
  }
  return { provision: {} };
}

export default async function paylinkRoutes(app) {
  // ── admin ─────────────────────────────────────────────────────────────────────────────
  app.get('/admin/hosting/paylinks', { preHandler: requireCap('manage_hosting') }, async () => {
    const p = await db();
    const links = await p.paymentLink.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { uses: { select: { status: true, holdUntil: true, amountCents: true, userId: true } } } });
    const now = Date.now();
    return { links: links.map((l) => serAdmin(l, { uses: l.uses, now })) };
  });

  app.post('/admin/hosting/paylinks/quote', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const b = paylinkSchema.safeParse({ title: 'quote', ...(req.body || {}) });
    if (!b.success) return bad(reply, b);
    const p = await db();
    if (b.data.kind !== 'pool') return { amountCents: b.data.amountCents ?? 0, monthlyCents: null };
    const st = await hostingSettings(p);
    const monthlyCents = tariff(st)(b.data.pool.storageGB, b.data.pool.uploadMbps);
    return { amountCents: amountFor({ ...b.data, priceMode: 'auto' }, tariff(st)), monthlyCents };
  });

  app.post('/admin/hosting/paylinks', { preHandler: requireCap('manage_hosting'), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = paylinkSchema.safeParse(req.body || {});
    if (!b.success) return bad(reply, b);
    const d = b.data;
    const problem = paylinkProblem(d);
    if (problem) return reply.code(400).send({ error: problem });
    const p = await db();
    const pv = await provisionOf(p, d);
    if (pv.error) return reply.code(400).send({ error: pv.error });
    const st = await hostingSettings(p);
    const amountCents = amountFor(d, tariff(st));
    if (amountCents < 50) return reply.code(400).send({ error: 'amount_required' });
    // A pool link carries its own (hidden) plan, made once, so every pool it provisions points
    // at the same row and the plans list gains one line per link, not one per payment.
    if (d.kind === 'pool') {
      const plan = await p.hostingPlan.create({ data: {
        name: `Payment link: ${d.title}`.slice(0, 120), storageGB: d.pool.storageGB, uploadLimitKbps: Math.round(d.pool.uploadMbps * 1024),
        cpuShare: 0.25, priceMonthlyCents: d.interval === 'month' ? amountCents : Math.round(amountCents / (d.pool.months || 1)), active: false,
      } });
      pv.provision.planId = plan.id;
    }
    const link = await p.paymentLink.create({ data: {
      token: newToken(), title: d.title, description: d.description || '', kind: d.kind, provision: pv.provision,
      priceMode: d.priceMode, amountCents, currency: d.currency, interval: d.interval,
      maxUses: d.maxUses ?? null, onlyEmail: (d.onlyEmail || '').toLowerCase(), expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
      createdById: req.user.uid,
    } });
    await logAudit(p, req.user.uid, 'paylink.created', `${link.id} ${d.kind} ${amountCents}${d.currency} ${d.interval} max=${d.maxUses ?? '-'}`, clientIp(req));
    return reply.code(201).send({ link: serAdmin(link, { uses: [] }) });
  });

  app.get('/admin/hosting/paylinks/:id', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const p = await db();
    const link = await p.paymentLink.findUnique({ where: { id: String(req.params.id || '').slice(0, 40) }, include: { uses: { orderBy: { createdAt: 'desc' }, take: 500 } } });
    if (!link) return reply.code(404).send({ error: 'not_found' });
    const users = await p.user.findMany({ where: { id: { in: [...new Set(link.uses.map((u) => u.userId))] } }, select: { id: true, displayName: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.displayName]));
    return {
      link: serAdmin(link, { uses: link.uses }),
      uses: link.uses.map((u) => ({ id: u.id, userId: u.userId, name: nameOf.get(u.userId) || '', status: u.status, amountCents: u.amountCents, currency: u.currency, paidAt: u.paidAt, createdAt: u.createdAt, result: u.result })),
    };
  });

  app.patch('/admin/hosting/paylinks/:id', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const b = z.object({
      title: z.string().trim().min(2).max(LIMITS.title).optional(),
      description: z.string().max(LIMITS.description).optional(),
      maxUses: z.number().int().min(1).max(LIMITS.maxUses).nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      revoked: z.boolean().optional(),
    }).safeParse(req.body || {});
    if (!b.success) return bad(reply, b);
    const p = await db();
    const link = await p.paymentLink.findUnique({ where: { id: String(req.params.id || '').slice(0, 40) } });
    if (!link) return reply.code(404).send({ error: 'not_found' });
    const data = {};
    for (const k of ['title', 'description', 'maxUses']) if (b.data[k] !== undefined) data[k] = b.data[k];
    if (b.data.expiresAt !== undefined) data.expiresAt = b.data.expiresAt ? new Date(b.data.expiresAt) : null;
    // Revoking stops NEW payments. What was already paid for stays delivered: a pool someone
    // pays for is ended from the pool (or its subscription), never from here by surprise.
    if (b.data.revoked === true && !link.revokedAt) data.revokedAt = new Date();
    if (b.data.revoked === false) data.revokedAt = null;
    const row = await p.paymentLink.update({ where: { id: link.id }, data, include: { uses: { select: { status: true, holdUntil: true, amountCents: true, userId: true } } } });
    await logAudit(p, req.user.uid, b.data.revoked ? 'paylink.revoked' : 'paylink.edited', `${link.id} ${Object.keys(data).join(',')}`, clientIp(req));
    return { link: serAdmin(row, { uses: row.uses }) };
  });

  // ── members ───────────────────────────────────────────────────────────────────────────
  app.get('/pay/:token', { preHandler: optionalAuth(), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = await db();
    const link = await p.paymentLink.findUnique({ where: { token: String(req.params.token || '').slice(0, 64) }, include: { uses: { select: { status: true, holdUntil: true, userId: true } } } });
    if (!link) return reply.code(404).send({ error: 'not_found' });
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    let email = null; const userId = req.user?.uid || null;
    if (userId) email = (await p.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email || null;
    const why = unavailable(link, { uses: link.uses, email, userId });
    const mine = userId ? link.uses.find((u) => u.userId === userId && u.status === 'paid') : null;
    return { link: serPublic(link, { uses: link.uses }), available: !why, why, paid: !!mine, signedIn: !!userId };
  });

  app.post('/pay/:token/checkout', { preHandler: requireRole(), config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const st = await hostingSettings(p);
    if (st['features.paymentsEnabled'] === false) return reply.code(503).send({ error: 'payments_disabled' });
    const link = await p.paymentLink.findUnique({ where: { token: String(req.params.token || '').slice(0, 64) } });
    if (!link) return reply.code(404).send({ error: 'not_found' });
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { id: true, email: true, closedAt: true, status: true } });
    if (!me || me.closedAt || (me.status && me.status !== 'active')) return reply.code(403).send({ error: 'forbidden' });
    if (link.kind === 'prerelease') {
      const pr = await p.preRelease.findUnique({ where: { id: link.provision?.prereleaseId || '' }, select: { closedAt: true } });
      if (!pr || pr.closedAt) return reply.code(409).send({ error: 'prerelease_closed' });
    }
    if (link.kind === 'pool' && link.provision?.projectTarget && !(await projectByTarget(p, link.provision.projectTarget))) return reply.code(409).send({ error: 'unknown_project' });
    const sk = await stripe({ forPurchase: true });
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    // The hold is written under a lock on the link, so the last place cannot be sold twice.
    const holdUntil = new Date(Date.now() + (HOLD_MINUTES + 1) * 60_000);
    const placeholder = `hold_${link.id}_${me.id}_${Date.now()}`;
    let use;
    try {
      use = await p.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`paylink:${link.id}`}))`;
        const uses = await tx.paymentLinkUse.findMany({ where: { linkId: link.id }, select: { status: true, holdUntil: true, userId: true } });
        const why = unavailable(link, { uses, email: me.email, userId: me.id });
        if (why) return { error: why };
        return tx.paymentLinkUse.create({ data: { linkId: link.id, userId: me.id, sessionId: placeholder, status: 'pending', amountCents: link.amountCents, currency: link.currency, holdUntil } });
      });
    } catch { return reply.code(409).send({ error: 'busy' }); }
    if (use.error) return reply.code(409).send({ error: use.error });
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    let session;
    try {
      const customer = await ensureCustomer(p, sk, me.id);
      session = await sk.checkout.sessions.create({ ...checkoutParams(link, { useId: use.id, userId: me.id, siteUrl }), customer });
    } catch (e) {
      // No session, no hold: the place goes back at once.
      await p.paymentLinkUse.delete({ where: { id: use.id } }).catch(() => {});
      req.log?.warn?.({ e: String(e?.message || e) }, 'paylink checkout failed');
      return reply.code(502).send({ error: 'checkout_failed' });
    }
    await p.paymentLinkUse.update({ where: { id: use.id }, data: { sessionId: session.id } });
    await recordPendingCheckout(p, { kind: 'paylink', sessionId: session.id, userId: me.id, payload: session.metadata || null }).catch(() => {});
    return { url: session.url };
  });

  app.get('/me/paylinks', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const uses = await p.paymentLinkUse.findMany({ where: { userId: req.user.uid, status: { in: ['paid', 'revoked'] } }, orderBy: { createdAt: 'desc' }, take: 100, include: { link: { select: { title: true, kind: true, interval: true, token: true } } } });
    return { receipts: uses.map((u) => ({ id: u.id, title: u.link.title, kind: u.link.kind, interval: u.link.interval, amountCents: u.amountCents, currency: u.currency, paidAt: u.paidAt, status: u.status })) };
  });
}
