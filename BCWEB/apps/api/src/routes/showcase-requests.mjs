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
import { getObject, deleteObject } from '../lib/storage.mjs';
import { stripe } from './hosting.mjs';

const KEYS = ['showcase.requestsEnabled', 'showcase.paidEnabled', 'showcase.priceCents', 'showcase.currency', 'showcase.maxOpenPerUser'];

// Estimated review wait, in hours, from how many requests are already pending. These are
// ESTIMATES and the form says so: a queue is people, not a machine, and paying buys PRIORITY,
// not a guarantee — a paid request can still wait. Free: a 24h–7d base that stretches as the
// queue grows; paid: a tighter window that grows only a little. Everything is capped so a
// backed-up queue never quotes an absurd number.
export function waitEstimate(pendingCount) {
  const n = Math.max(0, Number(pendingCount) || 0);
  return {
    pendingCount: n,
    freeLowH: Math.min(24 + n * 12, 24 * 21),   // ~1 day → cap 21 days
    freeHighH: Math.min(24 * 7 + n * 24, 24 * 45), // ~7 days → cap 45 days
    paidLowH: 24,                                // ~1 day, prioritised
    paidHighH: Math.min(72 + n * 6, 24 * 10),    // ~72h → cap 10 days
  };
}

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
  // ── Submission declarations ──
  isOpenSource: z.boolean(),
  license: z.string().trim().max(120).optional().default(''),
  ownership: z.enum(['owner', 'fan']),
  // A PRIVATE object key the applicant uploaded via /uploads/presign (kind PROOF). Validated
  // server-side to live under the caller's own uploads/<uid>/ prefix before it is trusted.
  proofKey: z.string().trim().max(300).optional().default(''),
  proofName: z.string().trim().max(160).optional().default(''),
  // Must be true — the button is gated client-side too, but the server is the real gate.
  tosAccepted: z.boolean(),
});

// NEVER exposes proofKey (the private storage key) — only whether a proof exists, plus its
// display name. contactReportId is the dashboard chat thread for this submission.
const ser = (r) => ({
  id: r.id, slug: r.slug, name: r.name, short: r.short, url: r.url, icon: r.icon,
  description: r.description, pitch: r.pitch, status: r.status,
  paid: r.paid, paidCents: r.paidCents, currency: r.currency,
  reviewNote: r.reviewNote, reviewedAt: r.reviewedAt, projectId: r.projectId,
  isOpenSource: r.isOpenSource, license: r.license, ownership: r.ownership,
  hasProof: !!r.proofKey, proofName: r.proofName,
  tosAcceptedAt: r.tosAcceptedAt, contactReportId: r.contactReportId,
  createdAt: r.createdAt,
  ...(r.user ? { user: { id: r.user.id, displayName: r.user.displayName, email: r.user.email } } : {}),
});

export default async function showcaseRequestRoutes(app) {
  // ── Public: is either door open, and what does the paid one cost? ──
  app.get('/showcase-requests/config', async () => {
    const p = await db();
    const c = await showcaseConfig(p);
    // The whole pending queue drives the wait estimate — shown on the form BEFORE paying, so
    // the average wait (and the "paying is priority, not a guarantee" caveat) is known up front.
    const pending = await p.showcaseRequest.count({ where: { status: 'pending' } });
    // The per-user cap is deliberately included: a form that refuses on submit without
    // having said there was a limit reads as a bug.
    return {
      requestsEnabled: c.requestsEnabled, paidEnabled: c.paidEnabled,
      priceCents: c.priceCents, currency: c.currency, maxOpenPerUser: c.maxOpenPerUser,
      estimate: waitEstimate(pending),
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

    // The terms are the gate. The button is disabled client-side until accepted, but that is a
    // convenience — this is where it actually counts.
    if (d.tosAccepted !== true) return reply.code(400).send({ error: 'tos_required' });

    // Declaration rules. We accept BOTH open- and closed-source, but:
    //  - a closed-source listing must come from the rights-HOLDER (never a fan), and
    //  - it must carry proof of rights (a private upload) — no proof, no listing.
    //  - an open-source listing should name its licence (fan or owner both fine).
    if (!d.isOpenSource) {
      if (d.ownership !== 'owner') return reply.code(400).send({ error: 'closed_needs_owner' });
      if (!d.proofKey) return reply.code(400).send({ error: 'closed_needs_proof' });
    } else if (!d.license) {
      return reply.code(400).send({ error: 'license_required' });
    }
    // A proof key is only trusted if it is one the CALLER uploaded: presign hands non-prefixed
    // kinds a key under uploads/<their uid>/, so anything else is a forged/borrowed reference.
    if (d.proofKey && !d.proofKey.startsWith(`uploads/${req.user.uid}/`)) {
      return reply.code(400).send({ error: 'bad_proof_key' });
    }

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
        isOpenSource: d.isOpenSource, license: d.isOpenSource ? d.license : '',
        ownership: d.ownership,
        proofKey: d.proofKey || '', proofName: d.proofKey ? (d.proofName || 'proof') : '',
        tosAcceptedAt: new Date(),
      },
    });

    // Open the contact thread (the dashboard "Reports & contact" chat box) so staff can ask
    // for more detail and the applicant can answer. Reuses the Report system; targetType marks
    // it as a submission so the UI can label it. A system note explains what the thread is for.
    const contact = await p.report.create({
      data: {
        targetType: 'showcase_request', targetId: row.id, targetLabel: d.name,
        reporterId: req.user.uid, reason: 'showcase_submission', status: 'open',
        staffUnread: true,
        messages: { create: [{ authorId: null, staff: true, body: `Submission received: "${d.name}". Staff may ask for more detail here — reply any time.` }] },
      },
    }).catch(() => null);
    if (contact) await p.showcaseRequest.update({ where: { id: row.id }, data: { contactReportId: contact.id } }).catch(() => {});
    const withContact = { ...row, contactReportId: contact?.id || null };

    if (!wantsPaid) return reply.code(201).send({ request: ser(withContact) });

    // Paid: a Stripe checkout, and the request sits pending until the webhook marks it paid.
    // It is created FIRST and on purpose — a checkout that has nothing to point at leaves a
    // payment with no request attached, which is the one failure nobody can untangle later.
    // `forPurchase`: this IS a new purchase, so it must respect the payments master switch.
    // Forgetting the flag here would keep the checkout live after payments were turned off.
    const sk = await stripe({ forPurchase: true });
    if (!sk) return reply.code(503).send({ error: 'payments_unavailable', request: ser(withContact) });
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const session = await sk.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: c.currency, unit_amount: c.priceCents, product_data: { name: `Showcase listing review — "${d.name}"` } } }],
      metadata: { type: 'showcase_request', requestId: row.id, userId: req.user.uid },
      success_url: `${siteUrl}/projects?request=ok`,
      cancel_url: `${siteUrl}/projects?request=cancel`,
    });
    return reply.code(201).send({ request: ser(withContact), checkoutUrl: session.url });
  });

  // ── Proof of rights (closed-source): a PRIVATE download, owner + staff only ──
  // Never public — the object lives under uploads/<uid>/ (the /media proxy refuses it), and
  // this route streams it as an attachment with nosniff, only to the applicant or review staff.
  app.get('/showcase-requests/:id/proof', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const row = await p.showcaseRequest.findUnique({ where: { id: req.params.id } });
    if (!row || !row.proofKey) return reply.code(404).send({ error: 'not_found' });
    const staff = ['MOD', 'ADMIN', 'SUPERADMIN'].includes(req.user.role);
    if (row.userId !== req.user.uid && !staff) return reply.code(403).send({ error: 'forbidden' });
    try {
      const { body, contentType } = await getObject(row.proofKey);
      return reply
        .header('Content-Type', contentType || 'application/octet-stream')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', `attachment; filename="${(row.proofName || 'proof').replace(/[^a-zA-Z0-9._-]/g, '_')}"`)
        .header('Cache-Control', 'private, no-store')
        .send(body);
    } catch { return reply.code(404).send({ error: 'gone' }); }
  });

  // ── Withdraw your own, while it is still pending ──
  app.delete('/showcase-requests/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const row = await p.showcaseRequest.findUnique({ where: { id: req.params.id } });
    if (!row || row.userId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (row.status !== 'pending') return reply.code(409).send({ error: 'already_reviewed' });
    // A PAID request is kept, marked withdrawn rather than deleted: money changed hands, and
    // deleting the only record of what it was for helps nobody. The proof (a sensitive private
    // document) is purged either way once the request is withdrawn — it is no longer needed.
    if (row.proofKey) await deleteObject(row.proofKey).catch(() => {});
    if (row.paid) {
      await p.showcaseRequest.update({ where: { id: row.id }, data: { status: 'rejected', reviewNote: 'Withdrawn by the applicant.', proofKey: '', proofName: '' } });
      return { ok: true, kept: true };
    }
    // Close the contact thread with the request (best-effort; it's a Report with no FK here).
    if (row.contactReportId) await p.report.update({ where: { id: row.contactReportId }, data: { status: 'closed' } }).catch(() => {});
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
      // "Approve & configure": the whole page as the New-project modal writes it, so the
      // listing is created finished instead of created bare and edited afterwards.
      project: z.object({
        name: z.string().min(2).max(60).optional(), short: z.string().min(1).max(8).optional(), icon: z.string().max(500).nullable().optional(),
        config: z.record(z.any()).optional(), published: z.boolean().optional(), pinTopbar: z.boolean().optional(),
        visibility: z.string().max(20).optional(), visibilityWhitelist: z.array(z.any()).max(500).optional(),
        announceEnabled: z.boolean().optional(), announceTitle: z.string().max(200).optional(), announceLogo: z.string().max(500).optional(),
        announceMarkdown: z.string().max(20000).optional(), announceRevealAt: z.string().nullable().optional(), announceShowPage: z.boolean().optional(),
        announceButtonLabel: z.string().max(80).optional(), announceButtonUrl: z.string().max(500).optional(),
      }).optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });

    const slug = slugify(b.data.slug || row.slug);
    if (!slug) return reply.code(400).send({ error: 'bad_slug' });
    const clash = await p.showcaseProject.findUnique({ where: { slug }, select: { id: true } });
    if (clash) return reply.code(409).send({ error: 'slug_taken' });

    const pj = b.data.project || null;
    const project = await p.showcaseProject.create({
      data: {
        slug, name: pj?.name || row.name, short: (pj?.short || b.data.short || row.short).slice(0, 8),
        icon: pj?.icon ?? row.icon ?? null,
        published: pj ? !!pj.published : b.data.publish === true,
        // Unlisted, not public, even when published: it appears at its own address and stays
        // out of the grid until somebody puts it there deliberately — unless the reviewer
        // configured the page in full and chose otherwise.
        visibility: pj?.visibility || 'unlisted',
        ...(pj ? {
          config: pj.config || {}, pinTopbar: !!pj.pinTopbar, visibilityWhitelist: pj.visibilityWhitelist || [],
          announceEnabled: !!pj.announceEnabled, announceTitle: pj.announceTitle || '', announceLogo: pj.announceLogo || '', announceMarkdown: pj.announceMarkdown || '',
          announceRevealAt: pj.announceRevealAt ? new Date(pj.announceRevealAt) : null, announceShowPage: !!pj.announceShowPage,
          announceButtonLabel: pj.announceButtonLabel || '', announceButtonUrl: pj.announceButtonUrl || '',
        } : {}),
      },
    });
    // Approved → the listing is live, so the proof-of-rights document has served its purpose;
    // purge it (GDPR data minimisation). The declaration (owner, licence) stays on the record.
    if (row.proofKey) await deleteObject(row.proofKey).catch(() => {});
    const saved = await p.showcaseRequest.update({
      where: { id: row.id },
      data: { status: 'approved', reviewNote: b.data.note, reviewedAt: new Date(), reviewerId: req.user.uid, projectId: project.id, proofKey: '', proofName: '' },
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
    // Rejected → the decision is made, so purge the sensitive proof document (GDPR: no reason
    // to keep an uploaded licence/ID once we've said no).
    if (row.proofKey) await deleteObject(row.proofKey).catch(() => {});
    const saved = await p.showcaseRequest.update({
      where: { id: row.id },
      data: { status: 'rejected', reviewNote: b.data.note, reviewedAt: new Date(), reviewerId: req.user.uid, proofKey: '', proofName: '' },
    });
    await logAudit(p, req.user.uid, 'showcase.reject', `${row.name}${row.paid ? ' (paid — a refund may be owed)' : ''}`, clientIp(req)).catch(() => {});
    return { ok: true, request: ser(saved) };
  });
}
