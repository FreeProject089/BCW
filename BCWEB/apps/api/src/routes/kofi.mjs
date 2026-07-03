import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireRole, notify, safeEqual } from '../lib.mjs';

// Ko-fi's webhook POSTs a single `application/x-www-form-urlencoded` field
// named `data`, itself a JSON string — see https://ko-fi.com/manage/webhooks.
// { verification_token, message_id, timestamp, type, from_name, message,
//   amount, currency, email, is_subscription_payment, ... }
function genCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  return Array.from({ length: 10 }, () => a[crypto.randomInt(a.length)]).join('').replace(/(.{5})(.{5})/, '$1-$2');
}

const KOFI_PERCENT_OFF = 25;
const KOFI_MIN_MONTHS = 12;

// Shared grant logic — used by both the real webhook and the admin's manual
// fallback (for a donation that happened before the webhook was configured).
// Idempotent per account: only ever grants once (gated on kofiDonorAt).
async function grantKofiDiscount(p, email) {
  const user = await p.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (!user) return { error: 'no_matching_account' };
  if (user.kofiDonorAt) return { error: 'already_granted' };
  let code = genCode();
  for (let i = 0; i < 5 && (await p.promoCode.findUnique({ where: { code } })); i++) code = genCode();
  const promo = await p.promoCode.create({ data: {
    code, kind: 'discount', percentOff: KOFI_PERCENT_OFF, minMonths: KOFI_MIN_MONTHS,
    maxRedemptions: 1, perUserLimit: 1, note: `Ko-fi donor reward — ${user.email}`,
  } });
  await p.user.update({ where: { id: user.id }, data: { kofiDonorAt: new Date() } });
  await notify(p, user.id, 'kofi_reward', `Thanks for supporting us on Ko-fi! Here's a ${KOFI_PERCENT_OFF}% hosting discount code for a ${KOFI_MIN_MONTHS}+ month plan: ${promo.code}`);
  return { ok: true, promo, user };
}

export default async function kofiRoutes(app) {
  // Ko-fi posts `application/x-www-form-urlencoded` (a single `data` field
  // holding a JSON string) — nothing else in this API needs that content type,
  // so a tiny inline parser here is simpler than pulling in a whole plugin
  // just for one field.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(body))); }
    catch (e) { done(e); }
  });

  // Public — Ko-fi calls this directly, authenticated only by the shared
  // verification token (there's no request-signing scheme, just a shared
  // secret embedded in the payload, matching Ko-fi's own webhook design).
  app.post('/webhooks/kofi', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = await db();
    const tokenRow = await p.adminSetting.findUnique({ where: { key: 'kofi.token' } });
    const expected = tokenRow?.value?.token;
    if (!expected) return reply.code(503).send({ error: 'not_configured' });
    let payload;
    try { payload = JSON.parse(req.body?.data); }
    catch { return reply.code(400).send({ error: 'invalid_payload' }); }
    if (!safeEqual(payload.verification_token, expected)) return reply.code(401).send({ error: 'bad_token' });
    // Log every donation event for the public funding-goal widget (total raised +
    // tip count) — independent of whether it matches a BCWEB account. Ko-fi
    // retries webhooks at-least-once, so messageId dedupes via the unique index.
    if (payload.message_id && payload.amount) {
      await p.kofiDonation.create({
        data: {
          messageId: String(payload.message_id), fromName: String(payload.from_name || 'Anonymous').slice(0, 120),
          email: payload.email || null, amount: Number(payload.amount) || 0, currency: String(payload.currency || 'USD').slice(0, 8),
          isSubscription: payload.is_subscription_payment === true || payload.is_subscription_payment === 'true',
        },
      }).catch(() => {}); // duplicate messageId (retry) — ignore
    }
    if (!payload.email) return reply.code(400).send({ error: 'no_email' });
    const result = await grantKofiDiscount(p, payload.email);
    // Always 200 — Ko-fi retries on non-2xx, and "no matching account" /
    // "already granted" aren't failures Ko-fi should keep retrying over.
    return { ok: true, granted: !!result.ok, reason: result.error };
  });

  // Public — powers the homepage funding-goal widget. Only meaningful once an
  // admin has set a target via PUT /admin/kofi/goal; goal is null otherwise so
  // the frontend can hide the widget entirely.
  app.get('/kofi/stats', async () => {
    const p = await db();
    const [agg, goalRow] = await Promise.all([
      p.kofiDonation.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
      p.adminSetting.findUnique({ where: { key: 'kofi.goal' } }),
    ]);
    const goal = goalRow?.value?.targetAmount > 0 ? goalRow.value : null;
    return { totalAmount: agg._sum.amount || 0, tipCount: agg._count._all, currency: goalRow?.value?.currency || 'USD', goal };
  });

  // ── Admin: configure the webhook token, and a manual fallback grant ──
  app.get('/admin/kofi/settings', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'kofi.token' } });
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    return { configured: !!row?.value?.token, webhookUrl: `${siteUrl}/api/webhooks/kofi`, percentOff: KOFI_PERCENT_OFF, minMonths: KOFI_MIN_MONTHS };
  });

  app.put('/admin/kofi/settings', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ token: z.string().min(4).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'kofi.token' }, create: { key: 'kofi.token', value: { token: b.data.token } }, update: { value: { token: b.data.token } } });
    return { ok: true };
  });

  // ── Admin: the funding-goal target shown on the public widget ──
  app.get('/admin/kofi/goal', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const [row, agg] = await Promise.all([
      p.adminSetting.findUnique({ where: { key: 'kofi.goal' } }),
      p.kofiDonation.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
    ]);
    return { goal: row?.value || null, totalAmount: agg._sum.amount || 0, tipCount: agg._count._all };
  });

  app.put('/admin/kofi/goal', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ title: z.string().max(120).default(''), targetAmount: z.number().min(0).max(10_000_000), currency: z.string().min(1).max(8).default('USD') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'kofi.goal' }, create: { key: 'kofi.goal', value: b.data }, update: { value: b.data } });
    return { ok: true };
  });

  app.delete('/admin/kofi/goal', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    await p.adminSetting.delete({ where: { key: 'kofi.goal' } }).catch(() => {});
    return { ok: true };
  });

  // Manual grant — for a donation an admin verified by hand (e.g. seen in the
  // Ko-fi dashboard) before the webhook was set up. Same one-time gate applies.
  app.post('/admin/kofi/grant', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const result = await grantKofiDiscount(p, b.data.email);
    if (result.error) return reply.code(result.error === 'no_matching_account' ? 404 : 409).send({ error: result.error });
    return reply.code(201).send({ ok: true, code: result.promo.code });
  });
}
