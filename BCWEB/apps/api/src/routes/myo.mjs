import { z } from 'zod';
import { publishToThread, streamThread } from '../lib/threadbus.mjs';
import { db, requireRole, requireCap, hasCap, logAudit, clientIp } from '../lib/lib.mjs';
import { applyCampaign } from './campaigns.mjs';
import { stripe, ensureCustomer } from './hosting.mjs';

// ── "Make Your Own" (MYO) ─────────────────────────────────────────────────────────
// A paid consultation + commission service. Flow:
//   1. A logged-in user fills the intake (product name / objective / target / description)
//      and pays a small CONSULTATION fee ($5, or $10 for an urgent request). This is
//      explicitly a paid *avis* (advice) + a request to a consultant — NOT the product.
//   2. That opens a conversation. The admin gives advice and builds a real QUOTE (devis).
//   3. The user pays the quote → the request moves to "in production" (build starts).
//   4. The admin delivers the finished product back into the conversation (an uploaded
//      file and/or a link), flagged whether it includes source code.
// The whole staff side is gated by the `manage_myo` capability (see lib.mjs CAPABILITIES).

const SITE_URL = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
const TARGETS = ['personal', 'friends', 'community', 'nonprofit', 'commercial', 'other'];
const KINDS = ['discord_bot', 'app', 'website', 'custom', 'audit'];
const isStaff = (user) => hasCap(user, 'manage_myo');

// URL guards (CWE-79 / CWE-601): these strings end up in <a href> / <img src>, so a
// `javascript:` / `data:` value would be a stored-XSS sink. `httpUrlOpt` = an external
// http(s) URL or empty; `mediaUrlOpt` also allows our own relative /api/media path.
const httpUrlOpt = z.union([z.literal(''), z.string().max(500).regex(/^https?:\/\//i)]).nullable().optional();
const mediaUrlOpt = z.union([z.literal(''), z.string().max(500).regex(/^(https?:\/\/|\/[a-zA-Z0-9])/)]).nullable().optional();

// Consultation fee + toggle, admin-configurable via AdminSetting (scalar JSON values).
async function myoConfig(p) {
  const rows = await p.adminSetting.findMany({ where: { key: { in: ['myo.enabled', 'myo.consultationCents', 'myo.urgentConsultationCents', 'myo.currency'] } } });
  const get = (k) => rows.find((r) => r.key === k)?.value;
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    enabled: get('myo.enabled') !== false,
    consultationCents: num(get('myo.consultationCents'), 500),
    urgentConsultationCents: num(get('myo.urgentConsultationCents'), 1000),
    currency: typeof get('myo.currency') === 'string' ? get('myo.currency') : 'usd',
  };
}

const ser = {
  product: (r) => ({ id: r.id, kind: r.kind, name: r.name, tagline: r.tagline, description: r.description, icon: r.icon, basePriceCents: r.basePriceCents, options: r.options || [], includesSource: r.includesSource, active: r.active, featured: r.featured, order: r.order }),
  message: (m) => ({ id: m.id, authorId: m.authorId, staff: m.staff, body: m.body, images: m.images || [], createdAt: m.createdAt, author: m.author ? { id: m.author.id, displayName: m.author.displayName, avatar: m.author.avatar } : null }),
  quote: (q) => ({ id: q.id, title: q.title, note: q.note, lineItems: q.lineItems || [], totalCents: q.totalCents, currency: q.currency, includesSource: q.includesSource, validUntil: q.validUntil, status: q.status, createdAt: q.createdAt, paidAt: q.paidAt }),
  deliverable: (d) => ({ id: d.id, title: d.title, note: d.note, fileUrl: d.fileUrl, fileName: d.fileName, linkUrl: d.linkUrl, includesSource: d.includesSource, createdAt: d.createdAt }),
  request: (r, { withUser = false } = {}) => ({
    id: r.id, productId: r.productId, productKind: r.productKind, name: r.name, logo: r.logo,
    objective: r.objective, target: r.target, description: r.description, lang: r.lang, urgent: r.urgent,
    consultationPaid: r.consultationPaid, consultationCents: r.consultationCents, status: r.status,
    staffUnread: r.staffUnread, userUnread: r.userUnread, lastActivityAt: r.lastActivityAt,
    closedAt: r.closedAt, createdAt: r.createdAt,
    ...(withUser && r.user ? { user: { id: r.user.id, displayName: r.user.displayName, email: r.user.email, avatar: r.user.avatar } } : {}),
  }),
};

export default async function myoRoutes(app) {
  // ── Public catalog + fee display ────────────────────────────────────────────
  app.get('/myo/products', async () => {
    const p = await db();
    const cfg = await myoConfig(p);
    const products = cfg.enabled ? await p.myoProduct.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }) : [];
    return {
      enabled: cfg.enabled,
      consultationCents: cfg.consultationCents,
      urgentConsultationCents: cfg.urgentConsultationCents,
      currency: cfg.currency,
      products: products.map(ser.product),
    };
  });

  // ── Create a request (intake) + start the consultation checkout ─────────────
  const intake = z.object({
    productId: z.string().optional().nullable(),
    productKind: z.enum(KINDS).default('custom'),
    name: z.string().trim().min(2).max(120),
    logo: httpUrlOpt, // rendered as <img src> — http(s) only
    objective: z.string().trim().max(200).default(''),
    target: z.enum(TARGETS).default('personal'),
    description: z.string().trim().max(2000).default(''),
    lang: z.enum(['en', 'fr']).default('en'),
    urgent: z.boolean().default(false),
  });
  app.post('/myo/requests', { preHandler: requireRole(), config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = intake.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const p = await db();
    const cfg = await myoConfig(p);
    if (!cfg.enabled) return reply.code(403).send({ error: 'myo_disabled' });
    // Snapshot the chosen product's kind (if a catalog product was picked).
    let productId = null, productKind = b.data.productKind;
    if (b.data.productId) {
      const prod = await p.myoProduct.findUnique({ where: { id: b.data.productId }, select: { id: true, kind: true, active: true } });
      if (prod?.active) { productId = prod.id; productKind = prod.kind; }
    }
    const consultationCents = b.data.urgent ? cfg.urgentConsultationCents : cfg.consultationCents;
    const request = await p.myoRequest.create({ data: {
      userId: req.user.uid, productId, productKind,
      name: b.data.name, logo: b.data.logo || null, objective: b.data.objective, target: b.data.target,
      description: b.data.description, lang: b.data.lang, urgent: b.data.urgent,
      consultationCents, status: 'pending_payment',
    } });
    const url = await consultationCheckout(p, req.user.uid, request, cfg).catch(() => null);
    if (!url) return reply.code(503).send({ error: 'stripe_unconfigured', requestId: request.id });
    return reply.code(201).send({ request: ser.request(request), checkoutUrl: url });
  });

  // Resume/retry the consultation checkout for a still-unpaid request.
  app.post('/myo/requests/:id/pay', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const r = await p.myoRequest.findUnique({ where: { id: req.params.id } });
    if (!r || r.userId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (r.consultationPaid) return reply.code(400).send({ error: 'already_paid' });
    const cfg = await myoConfig(p);
    const url = await consultationCheckout(p, req.user.uid, r, cfg).catch(() => null);
    if (!url) return reply.code(503).send({ error: 'stripe_unconfigured' });
    return { checkoutUrl: url };
  });

  // ── List: the caller's own requests; staff can list all ─────────────────────
  app.get('/myo/requests', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.myoRequest.findMany({ where: { userId: req.user.uid }, orderBy: { lastActivityAt: 'desc' } });
    return { requests: rows.map((r) => ser.request(r)) };
  });

  // Full thread — owner or staff. Marks the reader's side read.
  app.get('/myo/requests/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const r = await p.myoRequest.findUnique({ where: { id: req.params.id }, include: { user: true } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const staff = isStaff(req.user);
    if (r.userId !== req.user.uid && !staff) return reply.code(403).send({ error: 'forbidden' });
    const [messages, quotes, deliverables] = await Promise.all([
      p.myoMessage.findMany({ where: { requestId: r.id }, orderBy: { createdAt: 'asc' }, include: { author: true } }),
      p.myoQuote.findMany({ where: { requestId: r.id }, orderBy: { createdAt: 'asc' } }),
      p.myoDeliverable.findMany({ where: { requestId: r.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    // Clear the unread flag for whichever side is reading.
    if (staff && r.staffUnread) await p.myoRequest.update({ where: { id: r.id }, data: { staffUnread: false } }).catch(() => {});
    if (!staff && r.userUnread) await p.myoRequest.update({ where: { id: r.id }, data: { userUnread: false } }).catch(() => {});
    return {
      request: ser.request(r, { withUser: staff }),
      messages: messages.map(ser.message),
      quotes: quotes.map(ser.quote),
      deliverables: deliverables.map(ser.deliverable),
      viewerIsStaff: staff,
    };
  });

  // Post a message (owner or staff). Only once the consultation is paid.
  app.post('/myo/requests/:id/messages', { preHandler: requireRole(), config: { rateLimit: { max: 40, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({ body: z.string().trim().max(4000).default(''), images: z.array(z.string().max(500).regex(/^(https?:\/\/|\/[a-zA-Z0-9])/)).max(6).default([]) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!b.data.body && !b.data.images.length) return reply.code(400).send({ error: 'empty' });
    const p = await db();
    const r = await p.myoRequest.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const staff = isStaff(req.user);
    if (r.userId !== req.user.uid && !staff) return reply.code(403).send({ error: 'forbidden' });
    if (!r.consultationPaid) return reply.code(402).send({ error: 'consultation_unpaid' });
    const msg = await p.myoMessage.create({ data: { requestId: r.id, authorId: req.user.uid, staff, body: b.data.body, images: b.data.images }, include: { author: true } });
    // Reopen a closed thread on a new message, and flag the other side unread.
    await p.myoRequest.update({ where: { id: r.id }, data: {
      lastActivityAt: new Date(),
      ...(staff ? { userUnread: true } : { staffUnread: true }),
      ...(r.status === 'closed' ? { status: 'open', closedAt: null } : {}),
    } });
    // Published only now: both the message and the thread update have committed, so nobody
    // is told about a message the database does not have.
    publishToThread('myo', r.id, { type: 'message', message: ser.message(msg) });
    return reply.code(201).send({ message: ser.message(msg) });
  });

  // Live thread (SSE). Authorised with the SAME rule as GET /myo/requests/:id — owner or
  // staff — so the stream can never deliver what a read would refuse.
  app.get('/myo/requests/:id/stream', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const r = await p.myoRequest.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.userId !== req.user.uid && !isStaff(req.user)) return reply.code(403).send({ error: 'forbidden' });
    streamThread(req, reply, 'myo', r.id);
  });

// A status change is part of the conversation, so it is written into it. Before this, a
// request moving to "in production" or being closed changed a badge and published nothing —
// the other side saw no reason, no author, no date, and nothing at all until a reload.
//
// `authorId: null` is the schema's own convention for a system note (see MyoMessage).
const MYO_STATUS_NOTE = {
  open: (who) => `${who} reopened this request.`,
  quoted: (who) => `${who} sent a quote.`,
  in_production: (who) => `${who} started production.`,
  delivered: (who) => `${who} marked this request delivered.`,
  closed: (who) => `${who} closed this request.`,
  cancelled: (who) => `${who} cancelled this request.`,
};

async function noteMyoStatus(p, request, status, actorName) {
  const body = (MYO_STATUS_NOTE[status] || ((w) => `${w} set the status to ${status}.`))(actorName);
  const msg = await p.myoMessage.create({
    data: { requestId: request.id, authorId: null, staff: false, body, images: [] },
  });
  publishToThread('myo', request.id, { type: 'message', message: ser.message(msg) });
  return msg;
}

async function actorName(p, uid, fallback) {
  const u = await p.user.findUnique({ where: { id: uid }, select: { displayName: true } }).catch(() => null);
  return u?.displayName || fallback;
}

  app.post('/myo/requests/:id/close', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const r = await p.myoRequest.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.userId !== req.user.uid && !isStaff(req.user)) return reply.code(403).send({ error: 'forbidden' });
    await p.myoRequest.update({ where: { id: r.id }, data: { status: 'closed', closedAt: new Date(), staffUnread: true, lastActivityAt: new Date() } });
    await noteMyoStatus(p, r, 'closed', await actorName(p, req.user.uid, 'The requester'));
    return { ok: true };
  });

  // Reopen one you closed yourself. Closing a request you no longer need should not be a
  // one-way door — and a reopened thread is cheaper for everyone than a duplicate one.
  app.post('/myo/requests/:id/reopen', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const r = await p.myoRequest.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.userId !== req.user.uid && !isStaff(req.user)) return reply.code(403).send({ error: 'forbidden' });
    if (r.status !== 'closed') return { ok: true };
    await p.myoRequest.update({ where: { id: r.id }, data: { status: 'open', closedAt: null, staffUnread: true, lastActivityAt: new Date() } });
    await noteMyoStatus(p, r, 'open', await actorName(p, req.user.uid, 'The requester'));
    return { ok: true };
  });

  // ── Pay a quote (the product itself) ────────────────────────────────────────
  app.post('/myo/quotes/:id/pay', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const q = await p.myoQuote.findUnique({ where: { id: req.params.id }, include: { request: true } });
    if (!q || !q.request) return reply.code(404).send({ error: 'not_found' });
    if (q.request.userId !== req.user.uid) return reply.code(403).send({ error: 'forbidden' });
    if (q.status === 'paid') return reply.code(400).send({ error: 'already_paid' });
    if (q.status !== 'sent') return reply.code(400).send({ error: 'quote_not_payable' });
    if (q.totalCents < 50) return reply.code(400).send({ error: 'amount_too_low' });
    try {
      const sk = await stripe();
      const customer = await ensureCustomer(p, sk, req.user.uid);
      // NO campaign discount. A quote is a price agreed with this customer in the thread
      // above, not a list price — silently charging less than the figure both sides
      // accepted would make the agreed total wrong, which is a worse surprise than
      // missing a sale. An admin who wants a quote discounted writes the discount into
      // the quote.
      const session = await sk.checkout.sessions.create({
        mode: 'payment', customer,
        line_items: [{ quantity: 1, price_data: { currency: q.currency || 'usd', unit_amount: q.totalCents, product_data: { name: `${q.title || q.request.name} — product build${q.includesSource ? ' (with source code)' : ''}`, description: 'Payment for the agreed product. Work begins once this is paid.' } } }],
        metadata: { type: 'myo_quote', quoteId: q.id, requestId: q.request.id, userId: req.user.uid },
        success_url: `${SITE_URL}/myo/${q.request.id}?quote=ok`,
        cancel_url: `${SITE_URL}/myo/${q.request.id}?quote=cancelled`,
      });
      await p.myoQuote.update({ where: { id: q.id }, data: { stripeSessionId: session.id } });
      return { checkoutUrl: session.url };
    } catch { return reply.code(503).send({ error: 'stripe_unconfigured' }); }
  });

  // ════════════════ Admin (manage_myo) ════════════════
  // Catalog product CRUD.
  app.get('/admin/myo/products', { preHandler: requireCap('manage_myo') }, async () => {
    const p = await db();
    const rows = await p.myoProduct.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    return { products: rows.map(ser.product) };
  });
  const productBody = z.object({
    kind: z.enum(KINDS),
    name: z.string().trim().min(2).max(120),
    tagline: z.string().max(200).default(''),
    description: z.string().max(4000).default(''),
    icon: z.string().max(500).nullable().optional(),
    basePriceCents: z.number().int().min(0).max(100_000_00).default(0),
    options: z.array(z.object({ label: z.string().max(120), priceCents: z.number().int().min(0).max(100_000_00).default(0), note: z.string().max(200).optional() })).max(20).default([]),
    includesSource: z.boolean().default(true),
    active: z.boolean().default(true),
    featured: z.boolean().default(false),
    order: z.number().int().default(0),
  });
  app.post('/admin/myo/products', { preHandler: requireCap('manage_myo') }, async (req, reply) => {
    const b = productBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const p = await db();
    const row = await p.myoProduct.create({ data: { ...b.data, icon: b.data.icon || null } });
    return reply.code(201).send({ product: ser.product(row) });
  });
  app.put('/admin/myo/products/:id', { preHandler: requireCap('manage_myo') }, async (req, reply) => {
    const b = productBody.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.myoProduct.update({ where: { id: req.params.id }, data: b.data }).catch(() => null);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { product: ser.product(row) };
  });
  app.delete('/admin/myo/products/:id', { preHandler: requireCap('manage_myo') }, async (req) => {
    const p = await db();
    await p.myoProduct.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });

  // Requests queue + filters.
  app.get('/admin/myo/requests', { preHandler: requireCap('manage_myo') }, async (req) => {
    const p = await db();
    const status = String(req.query?.status || '').trim();
    const q = String(req.query?.q || '').trim();
    const where = {};
    if (status) where.status = status;
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { user: { displayName: { contains: q, mode: 'insensitive' } } }, { user: { email: { contains: q, mode: 'insensitive' } } }];
    const rows = await p.myoRequest.findMany({ where, orderBy: { lastActivityAt: 'desc' }, take: 100, include: { user: true } });
    return { requests: rows.map((r) => ser.request(r, { withUser: true })) };
  });

  // Build + send a quote into a conversation.
  app.post('/admin/myo/requests/:id/quotes', { preHandler: requireCap('manage_myo') }, async (req, reply) => {
    const b = z.object({
      title: z.string().max(120).default(''),
      note: z.string().max(2000).default(''),
      lineItems: z.array(z.object({ label: z.string().min(1).max(160), priceCents: z.number().int().min(0).max(1_000_000_00) })).min(1).max(30),
      includesSource: z.boolean().default(false),
      validDays: z.number().int().min(1).max(365).optional(),
      currency: z.string().max(8).default('usd'),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const p = await db();
    const r = await p.myoRequest.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (!r.consultationPaid) return reply.code(400).send({ error: 'consultation_unpaid' });
    const totalCents = b.data.lineItems.reduce((s, l) => s + l.priceCents, 0);
    const validUntil = b.data.validDays ? new Date(Date.now() + b.data.validDays * 864e5) : null;
    const quote = await p.myoQuote.create({ data: { requestId: r.id, title: b.data.title, note: b.data.note, lineItems: b.data.lineItems, totalCents, currency: b.data.currency, includesSource: b.data.includesSource, validUntil, createdBy: req.user.uid, status: 'sent' } });
    await p.myoRequest.update({ where: { id: r.id }, data: { status: 'quoted', userUnread: true, lastActivityAt: new Date() } });
    await logAudit(p, req.user.uid, 'myo.quote', `${r.name}: ${(totalCents / 100).toFixed(2)} ${b.data.currency}`, clientIp(req));
    return reply.code(201).send({ quote: ser.quote(quote) });
  });
  app.post('/admin/myo/quotes/:id/withdraw', { preHandler: requireCap('manage_myo') }, async (req, reply) => {
    const p = await db();
    const q = await p.myoQuote.findUnique({ where: { id: req.params.id } });
    if (!q) return reply.code(404).send({ error: 'not_found' });
    if (q.status === 'paid') return reply.code(400).send({ error: 'already_paid' });
    await p.myoQuote.update({ where: { id: q.id }, data: { status: 'withdrawn' } });
    return { ok: true };
  });

  // Post a deliverable (finished product).
  app.post('/admin/myo/requests/:id/deliverables', { preHandler: requireCap('manage_myo') }, async (req, reply) => {
    const b = z.object({
      title: z.string().max(120).default(''),
      note: z.string().max(2000).default(''),
      fileUrl: mediaUrlOpt, // our /api/media path or an http(s) URL — never javascript:/data:
      fileName: z.string().max(200).nullable().optional(),
      linkUrl: httpUrlOpt, // rendered as <a href> — http(s) only
      includesSource: z.boolean().default(false),
    }).refine((v) => v.fileUrl || v.linkUrl, { message: 'need_file_or_link' }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.myoRequest.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const d = await p.myoDeliverable.create({ data: { requestId: r.id, title: b.data.title, note: b.data.note, fileUrl: b.data.fileUrl || null, fileName: b.data.fileName || null, linkUrl: b.data.linkUrl || null, includesSource: b.data.includesSource, createdBy: req.user.uid } });
    await p.myoRequest.update({ where: { id: r.id }, data: { status: 'delivered', userUnread: true, lastActivityAt: new Date() } });
    await logAudit(p, req.user.uid, 'myo.deliver', `${r.name}${b.data.includesSource ? ' (+source)' : ''}`, clientIp(req));
    return reply.code(201).send({ deliverable: ser.deliverable(d) });
  });

  // Set request status (in_production / delivered / closed / open …).
  app.put('/admin/myo/requests/:id/status', { preHandler: requireCap('manage_myo') }, async (req, reply) => {
    const b = z.object({ status: z.enum(['open', 'quoted', 'in_production', 'delivered', 'closed', 'cancelled']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.myoRequest.update({ where: { id: req.params.id }, data: { status: b.data.status, ...(b.data.status === 'closed' ? { closedAt: new Date() } : { closedAt: null }), userUnread: true, lastActivityAt: new Date() } }).catch(() => null);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    await noteMyoStatus(p, r, b.data.status, await actorName(p, req.user.uid, 'Staff'));
    return { ok: true, status: r.status };
  });

  // Fee settings.
  app.get('/admin/myo/settings', { preHandler: requireCap('manage_myo') }, async () => {
    const p = await db();
    return await myoConfig(p);
  });
  app.put('/admin/myo/settings', { preHandler: requireCap('manage_myo') }, async (req, reply) => {
    const b = z.object({
      enabled: z.boolean().optional(),
      consultationCents: z.number().int().min(0).max(100000).optional(),
      urgentConsultationCents: z.number().int().min(0).max(100000).optional(),
      currency: z.string().max(8).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const set = async (key, value) => { if (value !== undefined) await p.adminSetting.upsert({ where: { key }, create: { key, value }, update: { value } }); };
    await set('myo.enabled', b.data.enabled);
    await set('myo.consultationCents', b.data.consultationCents);
    await set('myo.urgentConsultationCents', b.data.urgentConsultationCents);
    await set('myo.currency', b.data.currency);
    return await myoConfig(p);
  });
}

// Create a Stripe consultation checkout session for a request; returns the URL or throws.
async function consultationCheckout(p, userId, request, cfg) {
  const sk = await stripe();
  const customer = await ensureCustomer(p, sk, userId);
  const listPrice = Math.max(50, request.urgent ? cfg.urgentConsultationCents : cfg.consultationCents);
  // The consultation fee is a LIST price, so a site-wide sale applies to it like any
  // other. (The quote further up is not: see the note there.)
  const camp = await applyCampaign(p, listPrice, 'myo');
  const amount = camp.amount;
  const session = await sk.checkout.sessions.create({
    mode: 'payment', customer,
    line_items: [{ quantity: 1, price_data: { currency: cfg.currency || 'usd', unit_amount: amount, product_data: {
      name: `Consultation — ${request.name}${request.urgent ? ' (urgent)' : ''}${camp.label}`,
      description: 'A paid consultation: expert advice + a quote for building your product. This fee is for the advice only — building the product starts after you approve and pay the separate quote.',
    } } }],
    metadata: { type: 'myo_consultation', requestId: request.id, userId },
    success_url: `${SITE_URL}/myo/${request.id}?paid=1`,
    cancel_url: `${SITE_URL}/myo/${request.id}?cancelled=1`,
  });
  await p.myoRequest.update({ where: { id: request.id }, data: { stripeSessionId: session.id } });
  return session.url;
}
