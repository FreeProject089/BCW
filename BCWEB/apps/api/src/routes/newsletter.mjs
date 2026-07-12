// Blog newsletter — GDPR-correct by design.
//   • Double opt-in: a signup is `pending` until the confirm link is clicked.
//   • One-click, no-login unsubscribe link (unsubToken) in every email.
//   • We store only email + status + timestamps + locale. No other PII.
//   • Sends are ADMIN-triggered (manual broadcast) — never an automatic mass-send on
//     publish — so a draft/typo can't blast every subscriber.
import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireRole } from '../lib.mjs';
import { sendMail, mailShell, emailEnabled, escapeHtml } from '../mail.mjs';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
const tok = () => crypto.randomBytes(24).toString('hex');

// Standalone landing page for the confirm / unsubscribe links (no SPA, no login).
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b0f1a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
.card{max-width:460px;padding:34px;text-align:center;background:#111827;border:1px solid #1f2937;border-radius:18px;margin:16px}
h1{font-size:20px;margin:0 0 10px}p{color:#94a3b8;line-height:1.6;margin:0 0 16px}a{color:#f59e0b;text-decoration:none;font-weight:600}</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${body}</p><a href="${SITE_URL}">← BetterCommunity</a></div></body></html>`;
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
    if (!token) return page('Invalid link', 'This confirmation link is invalid.');
    const p = await db();
    const rec = await p.newsletterSubscriber.findUnique({ where: { confirmToken: token } });
    if (!rec) return page('Link expired', 'This confirmation link is invalid or has already been used.');
    await p.newsletterSubscriber.update({ where: { id: rec.id }, data: { status: 'active', confirmedAt: new Date(), confirmToken: null } });
    return page('You’re subscribed 🎉', "You'll now receive BetterCommunity blog updates. Every email has a one-click unsubscribe link.");
  });

  // ── Public: unsubscribe (GET one-click, GDPR — no login required) ───────────
  app.get('/newsletter/unsubscribe', async (req, reply) => {
    reply.type('text/html');
    const token = String(req.query?.token || '');
    if (!token) return page('Invalid link', 'This unsubscribe link is invalid.');
    const p = await db();
    const rec = await p.newsletterSubscriber.findUnique({ where: { unsubToken: token } });
    if (!rec) return page('Already unsubscribed', 'This link is invalid, or you are already unsubscribed.');
    if (rec.status !== 'unsubscribed') await p.newsletterSubscriber.update({ where: { id: rec.id }, data: { status: 'unsubscribed', unsubscribedAt: new Date(), confirmToken: null } });
    return page('Unsubscribed', "You won't receive any more newsletter emails. You can re-subscribe anytime from the site.");
  });

  // ── Admin: list + counts ────────────────────────────────────────────────────
  app.get('/admin/newsletter', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const [subscribers, active, pending, unsubscribed] = await Promise.all([
      p.newsletterSubscriber.findMany({ orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, email: true, status: true, locale: true, createdAt: true, confirmedAt: true } }),
      p.newsletterSubscriber.count({ where: { status: 'active' } }),
      p.newsletterSubscriber.count({ where: { status: 'pending' } }),
      p.newsletterSubscriber.count({ where: { status: 'unsubscribed' } }),
    ]);
    return { subscribers, counts: { active, pending, unsubscribed } };
  });

  // ── Admin: manual broadcast to ACTIVE subscribers ──────────────────────────
  // Deliberately manual — no auto-send on publish, so nothing blasts everyone by
  // accident. Every email carries the one-click unsubscribe footer.
  app.post('/admin/newsletter/broadcast', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      subject: z.string().min(1).max(200), title: z.string().min(1).max(200),
      body: z.string().min(1).max(5000), url: z.string().url().max(500).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!emailEnabled()) return reply.code(400).send({ error: 'email_disabled' });
    const p = await db();
    const subs = await p.newsletterSubscriber.findMany({ where: { status: 'active' }, select: { email: true, unsubToken: true } });
    const safeBody = escapeHtml(b.data.body).replace(/\n/g, '<br>');
    let sent = 0;
    for (const s of subs) {
      const unsubUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${s.unsubToken}`;
      const footer = `<p style="font-size:12px;color:#6f685d;margin-top:24px">You receive this because you subscribed to BetterCommunity updates. <a href="${unsubUrl}" style="color:#a39b8f">Unsubscribe</a>.</p>`;
      const ok = await sendMail({
        to: s.email, subject: b.data.subject,
        html: mailShell(escapeHtml(b.data.title), safeBody + footer, b.data.url ? { url: b.data.url, label: 'Read on the blog' } : undefined),
      }).catch(() => false);
      if (ok !== false) sent++;
    }
    return { ok: true, sent, total: subs.length };
  });
}
