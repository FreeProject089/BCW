// Asking for your project to appear in "Other projects".
//
// The showcase grid was admin-only. The pages existed, the grid rendered them, and there was
// no way in from outside — so the answer to "can my project be listed?" was an e-mail, if the
// person thought to send one and knew where.
//
// Two doors, and BOTH are off by default. An admin turns on the free one, the paid one, or
// both, from Hosting settings. With neither on, the site behaves exactly as it does today:
// the form is not offered, and the routes refuse. That is deliberate — a submission box on a
// site whose owner is not reading submissions is worse than no box.
//
// **Paying does not buy a listing.** A paid request goes through the same review as a free
// one; the payment buys a place in the queue and nothing else. A listing that appears because
// money arrived is an advert, and the grid stops meaning anything the moment it holds one.
// That is stated on the form too, not just here.
import { z } from 'zod';
import { db, requireRole, requireVerifiedEmail, logAudit, clientIp } from '../lib/lib.mjs';
import { stripe } from './hosting.mjs';

const KEYS = ['showcase.requestsEnabled', 'showcase.paidEnabled', 'showcase.priceCents', 'showcase.currency', 'showcase.maxOpenPerUser'];

/** The admin's switches. Absent = off, so a fresh install offers nothing. */
export async function showcaseConfig(p) {
  const rows = await p.adminSetting.findMany({ where: { key: { in: KEYS } } });
  const get = (k) => rows.find((r) => r.key === k)?.value;
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    // `=== true`, not `!== false`: a key nobody has set must read as OFF. The MYO config
    // defaults its own switch ON because that feature shipped enabled; this one has not.
    requestsEnabled: get('showcase.requestsEnabled') === true,
    paidEnabled: get('showcase.paidEnabled') === true,
    priceCents: num(get('showcase.priceCents'), 2000),
    currency: typeof get('showcase.currency') === 'string' ? get('showcase.currency') : 'usd',
    // How many pending requests one account may hold. A person who can open fifty is a
    // person who can bury the queue. 0 = no limit.
    maxOpenPerUser: num(get('showcase.maxOpenPerUser'), 3),
  };
}

const slugify = (s) => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  // The 3–4 character label the grid and topbar show. Not derived from the name: "Better
  // Sound Maker" would become "BET", and the whole point of the field is that a person picks.
  short: z.string().trim().min(1).max(8),
  url: z.union([z.literal(''), z.string().trim().max(400).regex(/^https?:\/\//i, 'must start with http(s)://')]).optional().default(''),
  icon: z.union([z.literal(''), z.string().trim().max(400).regex(/^(https?:\/\/|\/[a-zA-Z0-9])/, 'an address or an uploaded /api/media path')]).optional().default(''),
  description: z.string().trim().max(2000).optional().default(''),
  pitch: z.string().trim().max(2000).optional().default(''),
  paid: z.boolean().optional().default(false),
});

const ser = (r) => ({
  id: r.id, slug: r.slug, name: r.name, short: r.short, url: r.url, icon: r.icon,
  description: r.description, pitch: r.pitch, status: r.status,
  paid: r.paid, paidCents: r.paidCents, currency: r.currency,
  reviewNote: r.reviewNote, reviewedAt: r.reviewedAt, projectId: r.projectId,
  createdAt: r.createdAt,
  ...(r.user ? { user: { id: r.user.id, displayName: r.user.displayName, email: r.user.email } } : {}),
});

export default async function showcaseRequestRoutes(app) {
  // ── Public: is either door open, and what does the paid one cost? ──
  app.get('/showcase-requests/config', async () => {
    const p = await db();
    const c = await showcaseConfig(p);
    // The per-user cap is deliberately included: a form that refuses on submit without
    // having said there was a limit reads as a bug.
    return {
      requestsEnabled: c.requestsEnabled, paidEnabled: c.paidEnabled,
      priceCents: c.priceCents, currency: c.currency, maxOpenPerUser: c.maxOpenPerUser,
    };
  });

  // ── Mine ──
  app.get('/me/showcase-requests', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.showcaseRequest.findMany({ where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { requests: rows.map(ser) };
  });

  // ── Submit ──
  //
  // Verified e-mail, because a request is a conversation: it gets an answer, and a rejection
  // with a reason is useless if it cannot reach anybody.
  app.post('/showcase-requests', { preHandler: requireVerifiedEmail(), config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const c = await showcaseConfig(p);
    if (!c.requestsEnabled && !c.paidEnabled) return reply.code(403).send({ error: 'requests_closed' });

    const b = bodySchema.safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const d = b.data;

    // Which door was asked for, checked against which doors are open. A client that offers
    // the free form while only the paid one is on must not get a free listing request in.
    const wantsPaid = d.paid === true;
    if (wantsPaid && !c.paidEnabled) return reply.code(403).send({ error: 'paid_closed' });
    if (!wantsPaid && !c.requestsEnabled) return reply.code(403).send({ error: 'free_closed' });

    if (c.maxOpenPerUser > 0) {
      const open = await p.showcaseRequest.count({ where: { userId: req.user.uid, status: 'pending' } });
      if (open >= c.maxOpenPerUser) return reply.code(429).send({ error: 'too_many_open', max: c.maxOpenPerUser });
    }

    const slug = slugify(d.name);
    if (!slug) return reply.code(400).send({ error: 'name_has_no_usable_slug' });
    // Not a uniqueness check on ShowcaseRequest — two people may propose the same name and
    // both deserve an answer. It is a check against LIVE pages, because approving into an
    // existing slug would overwrite a real project.
    const clash = await p.showcaseProject.findUnique({ where: { slug }, select: { id: true } });

    const row = await p.showcaseRequest.create({
      data: {
        userId: req.user.uid,
        slug: clash ? `${slug}-${Math.random().toString(36).slice(2, 6)}` : slug,
        name: d.name, short: d.short, url: d.url, icon: d.icon,
        description: d.description, pitch: d.pitch,
        currency: c.currency,
        paidCents: wantsPaid ? c.priceCents : 0,
      },
    });

    if (!wantsPaid) return reply.code(201).send({ request: ser(row) });

    // Paid: a Stripe checkout, and the request sits pending until the webhook marks it paid.
    // It is created FIRST and on purpose — a checkout that has nothing to point at leaves a
    // payment with no request attached, which is the one failure nobody can untangle later.
    // `forPurchase`: this IS a new purchase, so it must respect the payments master switch.
    // Forgetting the flag here would keep the checkout live after payments were turned off.
    const sk = await stripe({ forPurchase: true });
    if (!sk) return reply.code(503).send({ error: 'payments_unavailable', request: ser(row) });
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const session = await sk.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: c.currency, unit_amount: c.priceCents, product_data: { name: `Showcase listing review — "${d.name}"` } } }],
      metadata: { type: 'showcase_request', requestId: row.id, userId: req.user.uid },
      success_url: `${siteUrl}/projects?request=ok`,
      cancel_url: `${siteUrl}/projects?request=cancel`,
    });
    return reply.code(201).send({ request: ser(row), checkoutUrl: session.url });
  });

  // ── Withdraw your own, while it is still pending ──
  app.delete('/showcase-requests/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const row = await p.showcaseRequest.findUnique({ where: { id: req.params.id } });
    if (!row || row.userId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (row.status !== 'pending') return reply.code(409).send({ error: 'already_reviewed' });
    // A PAID request is kept, marked withdrawn rather than deleted: money changed hands, and
    // deleting the only record of what it was for helps nobody.
    if (row.paid) {
      await p.showcaseRequest.update({ where: { id: row.id }, data: { status: 'rejected', reviewNote: 'Withdrawn by the applicant.' } });
      return { ok: true, kept: true };
    }
    await p.showcaseRequest.delete({ where: { id: row.id } });
    return { ok: true };
  });

  // ── Staff: the queue ──
  app.get('/admin/showcase-requests', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    const status = ['pending', 'approved', 'rejected'].includes(req.query?.status) ? req.query.status : undefined;
    const rows = await p.showcaseRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
    const counts = await p.showcaseRequest.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => []);
    return { requests: rows.map(ser), counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  });

  // ── Staff: approve — creates the page ──
  app.post('/admin/showcase-requests/:id/approve', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const row = await p.showcaseRequest.findUnique({ where: { id: req.params.id } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.status !== 'pending') return reply.code(409).send({ error: 'already_reviewed' });

    const b = z.object({
      // Staff can correct the slug and the label before it goes live — the applicant's are a
      // proposal, and a slug is a URL that cannot be changed painlessly afterwards.
      slug: z.string().trim().max(48).optional(),
      short: z.string().trim().max(8).optional(),
      note: z.string().trim().max(1000).optional().default(''),
      // Approved but not yet visible: the page is created unpublished so it can be filled in
      // before anybody sees it.
      publish: z.boolean().optional().default(false),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });

    const slug = slugify(b.data.slug || row.slug);
    if (!slug) return reply.code(400).send({ error: 'bad_slug' });
    const clash = await p.showcaseProject.findUnique({ where: { slug }, select: { id: true } });
    if (clash) return reply.code(409).send({ error: 'slug_taken' });

    const project = await p.showcaseProject.create({
      data: {
        slug, name: row.name, short: (b.data.short || row.short).slice(0, 8),
        icon: row.icon || null,
        published: b.data.publish === true,
        // Unlisted, not public, even when published: it appears at its own address and stays
        // out of the grid until somebody puts it there deliberately.
        visibility: 'unlisted',
      },
    });
    const saved = await p.showcaseRequest.update({
      where: { id: row.id },
      data: { status: 'approved', reviewNote: b.data.note, reviewedAt: new Date(), reviewerId: req.user.uid, projectId: project.id },
    });
    await logAudit(p, req.user.uid, 'showcase.approve', `${row.name} → /project/${slug}${row.paid ? ' (paid)' : ''}`, clientIp(req)).catch(() => {});
    return { ok: true, request: ser(saved), project: { id: project.id, slug: project.slug } };
  });

  // ── Staff: reject ──
  app.post('/admin/showcase-requests/:id/reject', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const row = await p.showcaseRequest.findUnique({ where: { id: req.params.id } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.status !== 'pending') return reply.code(409).send({ error: 'already_reviewed' });
    const b = z.object({ note: z.string().trim().max(1000).optional().default('') }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const saved = await p.showcaseRequest.update({
      where: { id: row.id },
      data: { status: 'rejected', reviewNote: b.data.note, reviewedAt: new Date(), reviewerId: req.user.uid },
    });
    await logAudit(p, req.user.uid, 'showcase.reject', `${row.name}${row.paid ? ' (paid — a refund may be owed)' : ''}`, clientIp(req)).catch(() => {});
    return { ok: true, request: ser(saved) };
  });
}
