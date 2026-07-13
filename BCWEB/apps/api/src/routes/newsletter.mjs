// Blog newsletter — GDPR-correct by design.
//   • Double opt-in: a signup is `pending` until the confirm link is clicked.
//   • One-click, no-login unsubscribe link (unsubToken) in every email.
//   • We store only email + status + timestamps + locale. No other PII.
//   • Sends are ADMIN-triggered (manual broadcast) — never an automatic mass-send on
//     publish — so a draft/typo can't blast every subscriber.
import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireRole } from '../lib.mjs';
import { sendMail, mailShell, emailEnabled, escapeHtml, mdToEmailHtml } from '../mail.mjs';
import { BRAND_LOGO_DATA_URI } from '../brand-logo-data.mjs';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
const tok = () => crypto.randomBytes(24).toString('hex');

// Send one branded newsletter email to a single subscriber, with the one-click
// unsubscribe footer + List-Unsubscribe header. `sub` = { email, unsubToken }.
export async function sendNewsletterTo(sub, { subject, title, body, url }) {
  const unsubUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${sub.unsubToken}`;
  const footer = `<p class="bc-faint bc-hr" style="font-size:12px;color:#918a80;margin:28px 0 0;padding-top:18px;border-top:1px solid #eae4da">You receive this because you subscribed to BetterCommunity updates. <a href="${unsubUrl}" style="color:#c2410c">Unsubscribe in one click</a>.</p>`;
  // Body may contain markdown (incl. BetterCommunity custom blocks) — render it to HTML.
  const safeBody = mdToEmailHtml(body);
  return sendMail({
    to: sub.email, subject,
    html: mailShell(escapeHtml(title), safeBody + footer, url ? { url, label: 'Read on the blog' } : undefined),
    headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }).catch(() => false);
}

// Broadcast to a set of subscribers (default: all active). Returns { sent, total }.
// Shared by the admin broadcast route and the auto "new blog post" notification.
export async function sendNewsletter(p, { subject, title, body, url, where = { status: 'active' } }) {
  if (!emailEnabled()) return { sent: 0, total: 0, disabled: true };
  const subs = await p.newsletterSubscriber.findMany({ where, select: { email: true, unsubToken: true } });
  let sent = 0;
  for (const s of subs) { const ok = await sendNewsletterTo(s, { subject, title, body, url }); if (ok !== false) sent++; }
  return { sent, total: subs.length };
}

// Standalone, branded landing page for the confirm / unsubscribe links (no SPA, no
// login). `opts`: { tone: 'ok'|'info'|'muted', icon, cta:{href,label}, extra }.
function page(title, body, opts = {}) {
  const tone = opts.tone === 'muted' ? '#64748b' : opts.tone === 'info' ? '#38bdf8' : '#22c55e';
  const icon = opts.icon || (opts.tone === 'muted'
    ? '<path d="M18 6 6 18M6 6l12 12"/>'                                  // ✕
    : opts.tone === 'info' ? '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
    : '<path d="M20 6 9 17l-5-5"/>');                                     // ✓
  // href is always an internal (SITE_URL/token) link, but escape it anyway — attribute
  // context, defence-in-depth (CWE-79). `body`/`extra` are trusted internal HTML.
  const cta = opts.cta ? `<a class="btn" href="${escapeHtml(opts.cta.href)}">${escapeHtml(opts.cta.label)}</a>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — BetterCommunity</title>
<style>
  :root{--tone:${tone};--bg:#faf8f5;--card:#ffffff;--line:#eae4da;--text:#1a1714;--muted:#5d5750;--faint:#918a80;--link:#c2410c;--glowa:rgba(249,115,22,.14);--glowb:rgba(245,158,11,.12);--shadow:rgba(30,20,5,.22)}
  /* Follow the viewer's OS/browser theme — light default, dark when they prefer it. */
  @media (prefers-color-scheme: dark){:root{--bg:#0a0907;--card:#141210;--line:#242019;--text:#f3efe9;--muted:#a39b8f;--faint:#6f685d;--link:#fb923c;--glowa:rgba(249,115,22,.16);--glowb:rgba(245,158,11,.10);--shadow:rgba(0,0,0,.6)}}
  *{box-sizing:border-box}
  body{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:radial-gradient(58rem 42rem at 80% -12%,var(--glowa),transparent 60%),radial-gradient(46rem 40rem at -6% 6%,var(--glowb),transparent 56%),var(--bg);color:var(--text);display:grid;place-items:center;min-height:100vh;margin:0;padding:20px}
  .card{width:100%;max-width:460px;padding:40px 36px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:24px;box-shadow:0 30px 80px -32px var(--shadow)}
  .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:15px;margin-bottom:24px;color:var(--text)}
  .brand b{color:#f97316}
  .brand img{width:26px;height:26px;border-radius:7px}
  .ico{width:62px;height:62px;margin:0 auto 20px;border-radius:18px;display:grid;place-items:center;background:color-mix(in srgb,var(--tone) 14%,transparent);color:var(--tone)}
  .ico svg{width:31px;height:31px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  h1{font-size:23px;margin:0 0 10px;letter-spacing:-.02em;font-weight:800}
  p{color:var(--muted);line-height:1.66;margin:0 0 20px;font-size:15px}
  .btn{display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:700;padding:13px 28px;border-radius:12px;transition:filter .15s;box-shadow:0 8px 22px -8px rgba(249,115,22,.5)}
  .btn:hover{filter:brightness(1.06)}
  .home{display:inline-block;margin-top:18px;color:var(--faint);text-decoration:none;font-size:13px}
  .home:hover{color:var(--text)}
  .extra{margin-top:16px;font-size:13px;color:var(--faint)}.extra a{color:var(--link);text-decoration:none;font-weight:600}
</style></head>
<body><div class="card">
  <div class="brand" translate="no"><img src="${BRAND_LOGO_DATA_URI}" alt=""> <span><b>Better</b>Community</span></div>
  <div class="ico"><svg viewBox="0 0 24 24">${icon}</svg></div>
  <h1>${escapeHtml(title)}</h1>
  <p>${body}</p>
  ${cta}
  ${opts.extra ? `<div class="extra">${opts.extra}</div>` : ''}
  <div><a class="home" href="${SITE_URL}">← Back to BetterCommunity</a></div>
</div></body></html>`;
}

export default async function newsletterRoutes(app) {
  // ── Public: subscribe (starts the double opt-in) ────────────────────────────
  app.post('/newsletter/subscribe', async (req, reply) => {
    const b = z.object({ email: z.string().email().max(160), locale: z.enum(['en', 'fr']).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_email' });
    const email = b.data.email.trim().toLowerCase();
    const locale = b.data.locale || 'en';
    const p = await db();
    const existing = await p.newsletterSubscriber.findUnique({ where: { email } });
    if (existing?.status === 'active') return { ok: true }; // idempotent; don't leak status
    const confirmToken = tok();
    const unsubToken = existing?.unsubToken || tok();
    if (existing) await p.newsletterSubscriber.update({ where: { email }, data: { status: 'pending', confirmToken, unsubToken, locale } });
    else await p.newsletterSubscriber.create({ data: { email, locale, confirmToken, unsubToken } });
    // Confirmation email (double opt-in). If email is disabled the pending row still
    // exists for the admin, it just can't be confirmed until SMTP is configured.
    if (emailEnabled()) {
      const url = `${SITE_URL}/api/newsletter/confirm?token=${confirmToken}`;
      const fr = locale === 'fr';
      await sendMail({
        to: email,
        subject: fr ? 'Confirme ton inscription à la newsletter' : 'Confirm your newsletter subscription',
        html: mailShell(
          fr ? 'Confirme ton inscription' : 'Confirm your subscription',
          fr ? "Tu as demandé à recevoir les nouveautés du blog BetterCommunity. Confirme ci-dessous — si ce n'était pas toi, ignore cet email, tu ne recevras rien."
             : "You asked to receive BetterCommunity blog updates. Confirm below — if this wasn't you, ignore this email and you'll receive nothing.",
          { url, label: fr ? 'Confirmer' : 'Confirm' },
        ),
      }).catch(() => {});
    }
    return { ok: true };
  });

  // ── Public: confirm (GET, from the email link) ──────────────────────────────
  app.get('/newsletter/confirm', async (req, reply) => {
    reply.type('text/html');
    const token = String(req.query?.token || '');
    if (!token) return page('Invalid link', 'This confirmation link is invalid.', { tone: 'muted' });
    const p = await db();
    const rec = await p.newsletterSubscriber.findUnique({ where: { confirmToken: token } });
    if (!rec) return page('Link expired', 'This confirmation link is invalid or has already been used.', { tone: 'muted' });
    await p.newsletterSubscriber.update({ where: { id: rec.id }, data: { status: 'active', confirmedAt: new Date(), confirmToken: null } });
    const unsubUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${rec.unsubToken}`;
    return page('You’re subscribed', "You'll now get BetterCommunity blog updates in your inbox.", {
      tone: 'ok',
      cta: { href: `${SITE_URL}/blog`, label: 'Read the blog' },
      extra: `Changed your mind? <a href="${unsubUrl}">Unsubscribe in one click</a> — the link is also in every email.`,
    });
  });

  // ── Public: unsubscribe (GET one-click, GDPR — no login required) ───────────
  app.get('/newsletter/unsubscribe', async (req, reply) => {
    reply.type('text/html');
    const token = String(req.query?.token || '');
    if (!token) return page('Invalid link', 'This unsubscribe link is invalid.', { tone: 'muted' });
    const p = await db();
    const rec = await p.newsletterSubscriber.findUnique({ where: { unsubToken: token } });
    if (!rec) return page('Already unsubscribed', 'This link is invalid, or you are already unsubscribed.', { tone: 'muted' });
    if (rec.status !== 'unsubscribed') await p.newsletterSubscriber.update({ where: { id: rec.id }, data: { status: 'unsubscribed', unsubscribedAt: new Date(), confirmToken: null } });
    return page('You’re unsubscribed', "You won't receive any more newsletter emails. Sorry to see you go!", {
      tone: 'muted',
      cta: { href: `${SITE_URL}/blog`, label: 'Browse the blog' },
      extra: 'Changed your mind? Re-subscribe anytime from the box at the bottom of the blog.',
    });
  });

  // ── Admin: list + counts ────────────────────────────────────────────────────
  app.get('/admin/newsletter', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const [subscribers, active, pending, unsubscribed, activeEn, activeFr] = await Promise.all([
      p.newsletterSubscriber.findMany({ orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, email: true, status: true, locale: true, createdAt: true, confirmedAt: true } }),
      p.newsletterSubscriber.count({ where: { status: 'active' } }),
      p.newsletterSubscriber.count({ where: { status: 'pending' } }),
      p.newsletterSubscriber.count({ where: { status: 'unsubscribed' } }),
      p.newsletterSubscriber.count({ where: { status: 'active', locale: 'en' } }),
      p.newsletterSubscriber.count({ where: { status: 'active', locale: 'fr' } }),
    ]);
    return { subscribers, counts: { active, pending, unsubscribed, activeEn, activeFr } };
  });

  // ── Admin: add a subscriber directly (bypasses double opt-in) ───────────────
  // For manually importing an address the admin already has consent for.
  app.post('/admin/newsletter/add', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ email: z.string().email().max(160), locale: z.enum(['en', 'fr']).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_email' });
    const email = b.data.email.trim().toLowerCase();
    const locale = b.data.locale || 'en';
    const p = await db();
    const existing = await p.newsletterSubscriber.findUnique({ where: { email } });
    const sub = existing
      ? await p.newsletterSubscriber.update({ where: { email }, data: { status: 'active', confirmedAt: existing.confirmedAt || new Date(), confirmToken: null, locale } })
      : await p.newsletterSubscriber.create({ data: { email, locale, status: 'active', confirmedAt: new Date(), unsubToken: tok() } });
    return { ok: true, subscriber: { id: sub.id, email: sub.email, status: sub.status, locale: sub.locale } };
  });

  // ── Admin: remove a subscriber (hard delete) ────────────────────────────────
  app.delete('/admin/newsletter/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    await p.newsletterSubscriber.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });

  // ── Admin: manual broadcast / custom email ─────────────────────────────────
  // Deliberately manual — no auto-send on publish, so nothing blasts everyone by
  // accident. Send to every ACTIVE subscriber, or to a chosen subset (`emails`).
  // Every message carries a one-click unsubscribe footer AND a List-Unsubscribe
  // header (native "Unsubscribe" button in Gmail/Outlook).
  app.post('/admin/newsletter/broadcast', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      subject: z.string().min(1).max(200), title: z.string().min(1).max(200),
      body: z.string().min(1).max(5000), url: z.string().url().max(500).optional(),
      emails: z.array(z.string().email()).max(5000).optional(), // subset; omitted = all active
      locale: z.enum(['en', 'fr']).optional(),                  // language segment (all EN / all FR)
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!emailEnabled()) return reply.code(400).send({ error: 'email_disabled' });
    const p = await db();
    const where = { status: 'active' };
    if (b.data.emails?.length) where.email = { in: b.data.emails.map((e) => e.trim().toLowerCase()) };
    else if (b.data.locale) where.locale = b.data.locale; // whole-segment send (no hand-picking)
    const { sent, total } = await sendNewsletter(p, { subject: b.data.subject, title: b.data.title, body: b.data.body, url: b.data.url, where });
    return { ok: true, sent, total };
  });

  // ── Admin: send a TEST of the composed email to the admin's own inbox ────────
  // So the newsletter can be verified end-to-end even with zero active subscribers.
  app.post('/admin/newsletter/test', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      subject: z.string().min(1).max(200), title: z.string().min(1).max(200),
      body: z.string().min(1).max(5000), url: z.string().url().max(500).optional(),
      to: z.string().email().max(200).optional(), // deliverable address to test against
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!emailEnabled()) return reply.code(400).send({ error: 'email_disabled' });
    const p = await db();
    let to = b.data.to?.trim().toLowerCase();
    if (!to) { const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { email: true } }); to = me?.email; }
    if (!to) return reply.code(400).send({ error: 'no_email' });
    // sendMail can throw (e.g. the SMTP server rejects a non-deliverable address like the
    // seed admin's *.local) — surface that instead of a bare 502 so the admin knows to use
    // a real inbox.
    try {
      const ok = await sendNewsletterTo({ email: to, unsubToken: 'test' }, { subject: `[TEST] ${b.data.subject}`, title: b.data.title, body: b.data.body, url: b.data.url });
      if (ok === false) return reply.code(502).send({ error: 'send_failed' });
      return { ok: true, to };
    } catch (e) {
      return reply.code(502).send({ error: 'send_failed', detail: String(e?.message || e).slice(0, 200) });
    }
  });
}
