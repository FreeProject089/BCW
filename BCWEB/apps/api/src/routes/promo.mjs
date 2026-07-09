import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireRole, notify } from '../lib.mjs';

const GiB = 1024 ** 3;
function genCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  return Array.from({ length: 10 }, () => a[crypto.randomInt(a.length)]).join('').replace(/(.{5})(.{5})/, '$1-$2');
}

// Does `userId` match a code's assignment (gift/targeted codes)? A code is
// "restricted" when it has any assignedUserIds OR assignedTokens; then only a
// matching user may redeem. Tokens are typed identifiers resolved to the redeeming
// account AT REDEEM TIME (so a code can target an email / Discord id / creator id /
// BCWEB id that isn't linked yet — the moment that person signs in and their
// account carries the identifier, the code unlocks). `d` is a Prisma client or tx.
export async function assignmentMatches(d, promo, userId) {
  const restricted = (promo.assignedUserIds?.length || promo.assignedTokens?.length);
  if (!restricted) return true;          // open code — anyone may redeem
  if (!userId) return false;
  if (promo.assignedUserIds?.includes(userId)) return true;
  const toks = promo.assignedTokens || [];
  if (!toks.length) return false;
  if (toks.includes(`bcid:${userId}`)) return true;
  const u = await d.user.findUnique({ where: { id: userId }, select: { email: true, creatorLinks: { select: { creatorId: true } }, discordLinks: { select: { discordId: true } } } });
  if (!u) return false;
  if (u.email && toks.includes(`email:${u.email.toLowerCase()}`)) return true;
  if (u.creatorLinks.some((c) => toks.includes(`creator:${c.creatorId}`))) return true;
  if (u.discordLinks.some((dl) => toks.includes(`discord:${dl.discordId}`))) return true;
  return false;
}

// Validate a code for a user: active, not expired, not depleted, within per-user limit.
// Exported so the hosting/boost checkout can apply a 'discount' code too.
// NOTE: this is a pre-flight/informational check only (e.g. GET /me/promo/validate,
// or checkout code preview) — it does NOT reserve the redemption. Anything that
// actually GRANTS something must go through redeemPromoAtomic() below, or two
// concurrent requests can both pass this check and over-redeem (see there).
export async function validatePromo(p, rawCode, userId) {
  const code = String(rawCode || '').toUpperCase().replace(/\s+/g, '');
  if (!code) return { error: 'invalid' };
  const promo = await p.promoCode.findUnique({ where: { code } });
  if (!promo || !promo.active) return { error: 'invalid' };
  if (promo.expiresAt && promo.expiresAt < new Date()) return { error: 'expired' };
  if (promo.maxRedemptions != null && promo.redeemedCount >= promo.maxRedemptions) return { error: 'depleted' };
  // Gift/targeted codes: assigned to specific users/identifiers → only they redeem.
  if (!(await assignmentMatches(p, promo, userId))) return { error: 'not_yours' };
  if (userId) { const mine = await p.promoRedemption.count({ where: { promoId: promo.id, userId } }); if (mine >= promo.perUserLimit) return { error: 'already_used' }; }
  return { promo };
}

/** Atomically validate + reserve a redemption, then run `grant(tx, promo)` to apply
 *  the actual effect (create a repo, boost a repo, …) and return its result. Runs
 *  as one Serializable transaction so two concurrent redeems (same code, or same
 *  user hammering perUserLimit=1) can't both pass the check and both commit — the
 *  loser gets a clean 'race_lost' error to retry/report, instead of silently
 *  over-redeeming a code past maxRedemptions (was a real check-then-increment
 *  TOCTOU: both requests read redeemedCount before either incremented it). */
export async function redeemPromoAtomic(p, rawCode, userId, grant) {
  const code = String(rawCode || '').toUpperCase().replace(/\s+/g, '');
  if (!code) return { error: 'invalid' };
  try {
    return await p.$transaction(async (tx) => {
      const promo = await tx.promoCode.findUnique({ where: { code } });
      if (!promo || !promo.active) return { error: 'invalid' };
      if (promo.expiresAt && promo.expiresAt < new Date()) return { error: 'expired' };
      if (!(await assignmentMatches(tx, promo, userId))) return { error: 'not_yours' };
      const mine = await tx.promoRedemption.count({ where: { promoId: promo.id, userId } });
      if (mine >= promo.perUserLimit) return { error: 'already_used' };
      // Conditional UPDATE re-checks maxRedemptions AT THE DATABASE, inside the
      // same serializable transaction — the classic "check then increment" bug
      // this replaces let two racing requests both read the same redeemedCount.
      // NOTE: with maxRedemptions null (unlimited), `redeemedCount: { lt: null }`
      // is an INVALID Prisma filter and threw a 500 on every unlimited code — so
      // the cap condition is only added when a cap actually exists.
      const inc = await tx.promoCode.updateMany({
        where: promo.maxRedemptions == null
          ? { id: promo.id }
          : { id: promo.id, redeemedCount: { lt: promo.maxRedemptions } },
        data: { redeemedCount: { increment: 1 } },
      });
      if (inc.count === 0) return { error: 'depleted' };
      const result = await grant(tx, promo);
      if (result?.error) return result; // grant() can still veto (e.g. needs_repo) — rolls back the increment too
      await tx.promoRedemption.create({ data: { promoId: promo.id, userId, detail: result.detail || '' } });
      return { ok: true, promo, ...result };
    }, { isolationLevel: 'Serializable' });
  } catch (e) {
    // Serializable transactions can abort under real contention (Postgres error
    // 40001) — that IS the race being caught; surface it as a retryable error
    // rather than a generic 500.
    if (e?.code === 'P2034' || /could not serialize/i.test(String(e?.message))) return { error: 'race_lost' };
    throw e;
  }
}

export default async function promoRoutes(app) {
  // ── Admin: create / list / toggle / delete ──
  app.get('/admin/promo', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    return { codes: await p.promoCode.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { redemptions: true } } } }) };
  });

  app.post('/admin/promo', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      code: z.string().min(3).max(40).optional(),
      kind: z.enum(['discount', 'free_hosting', 'free_boost']),
      percentOff: z.number().int().min(1).max(100).nullable().optional(),
      freeMonths: z.number().int().min(0).max(24).nullable().optional(),
      minMonths: z.number().int().min(1).max(24).nullable().optional(),
      storageGB: z.number().int().min(1).max(2000).nullable().optional(),
      uploadMbps: z.number().int().min(1).max(2000).nullable().optional(),
      hostMonths: z.number().int().min(0).max(60).nullable().optional(),
      boostDays: z.number().int().min(1).max(3650).nullable().optional(),
      maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
      perUserLimit: z.number().int().min(1).max(1000).optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      stackable: z.boolean().optional(),
      // Gift/assign: restrict the code to specific people. `assignedUserIds` are raw
      // BCWEB ids (kept for gift-DM/giveaway paths). `assignedTokens` are typed and
      // do NOT require a linked account — "email:x" | "discord:x" | "creator:x" |
      // "bcid:x" — resolved to the redeemer at redeem time. `assignedEmails` is a
      // convenience that folds into email: tokens. Empty = anyone can redeem.
      assignedUserIds: z.array(z.string().max(40)).max(500).optional(),
      assignedTokens: z.array(z.string().max(220)).max(500).optional(),
      assignedEmails: z.array(z.string().max(200)).max(500).optional(),
      note: z.string().max(200).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;
    if (d.kind === 'discount' && !d.percentOff && !d.freeMonths) return reply.code(400).send({ error: 'discount_needs_value' });
    if (d.kind === 'free_hosting' && !d.storageGB) return reply.code(400).send({ error: 'hosting_needs_storage' });
    if (d.kind === 'free_boost' && !d.boostDays) return reply.code(400).send({ error: 'boost_needs_days' });
    const p = await db();
    const assignedUserIds = [...new Set((d.assignedUserIds || []).map((s) => s.trim()).filter(Boolean))];
    // Normalize typed assignment tokens (+ fold the email convenience list in). A
    // token is "<type>:<value>"; unknown types are dropped. Emails are lowercased.
    const TOK_TYPES = ['email', 'discord', 'creator', 'bcid'];
    const tokenSet = new Set();
    const pushTok = (type, val) => { val = String(val || '').trim(); if (!val) return; if (type === 'email') val = val.toLowerCase(); tokenSet.add(`${type}:${val}`); };
    for (const raw of (d.assignedTokens || [])) {
      const i = String(raw).indexOf(':'); if (i < 0) continue;
      const type = String(raw).slice(0, i).trim().toLowerCase();
      if (TOK_TYPES.includes(type)) pushTok(type, String(raw).slice(i + 1));
    }
    for (const e of (d.assignedEmails || [])) pushTok('email', e);
    const assignedTokens = [...tokenSet].slice(0, 500);
    let code = (d.code || genCode()).toUpperCase().replace(/\s+/g, '');
    if (d.code) {
      // An explicit code that already exists is an error (don't silently replace it)…
      if (await p.promoCode.findUnique({ where: { code } })) return reply.code(409).send({ error: 'code_exists' });
    } else {
      // …but an auto-generated one just retries until it's unique.
      for (let i = 0; i < 5 && (await p.promoCode.findUnique({ where: { code } })); i++) code = genCode();
    }
    try {
      const created = await p.promoCode.create({ data: {
        code, kind: d.kind, percentOff: d.percentOff ?? null, freeMonths: d.freeMonths ?? null, minMonths: d.minMonths ?? null,
        storageGB: d.storageGB ?? null, uploadMbps: d.uploadMbps ?? null, hostMonths: d.hostMonths ?? null,
        boostDays: d.boostDays ?? null, maxRedemptions: d.maxRedemptions ?? null, perUserLimit: d.perUserLimit ?? 1,
        expiresAt: d.expiresAt ? new Date(d.expiresAt) : null, stackable: d.stackable ?? false, assignedUserIds, assignedTokens, note: d.note || '',
      } });
      return reply.code(201).send({ code: created });
    } catch { return reply.code(409).send({ error: 'code_exists' }); }
  });

  app.patch('/admin/promo/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ active: z.boolean().optional(), stackable: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const data = {};
    if (b.data.active != null) data.active = b.data.active;
    if (b.data.stackable != null) data.stackable = b.data.stackable;
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'nothing_to_update' });
    const p = await db();
    const c = await p.promoCode.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    return { code: c };
  });

  app.delete('/admin/promo/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.promoCode.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });

  // Who redeemed a code + on what (detail: which repo for boost, plan for discount, etc.).
  app.get('/admin/promo/:id/redemptions', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const rows = await p.promoRedemption.findMany({ where: { promoId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 500 });
    const users = rows.length ? await p.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, displayName: true, email: true } }) : [];
    const umap = Object.fromEntries(users.map((u) => [u.id, u]));
    return { redemptions: rows.map((r) => ({ id: r.id, detail: r.detail, createdAt: r.createdAt, user: umap[r.userId] || { displayName: 'unknown' } })) };
  });

  // ── User: what does this code do? ──
  app.get('/me/promo/validate', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { promo, error } = await validatePromo(p, req.query?.code, req.user.uid);
    if (error) return reply.code(400).send({ error });
    return { promo: { code: promo.code, kind: promo.kind, percentOff: promo.percentOff, freeMonths: promo.freeMonths, minMonths: promo.minMonths, storageGB: promo.storageGB, uploadMbps: promo.uploadMbps, hostMonths: promo.hostMonths, boostDays: promo.boostDays } };
  });

  // ── User: redeem a GRANT code (discount codes are applied at checkout instead) ──
  // Rate-limited: unlike checkout (needs a valid Stripe session first), this is a
  // bare code+POST — without a limit it's brute-forceable to discover/drain every
  // active code (the "already_used"/"invalid"/"depleted" responses differ, so an
  // attacker can distinguish valid-but-exhausted from wrong guesses either way).
  app.post('/me/promo/redeem', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = z.object({ code: z.string().min(3).max(40), repoId: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // Peek at the kind first (informational only — the real check happens
    // atomically inside redeemPromoAtomic below) so obviously-wrong requests
    // (discount codes, missing repoId) fail fast without opening a transaction.
    const peek = await validatePromo(p, b.data.code, req.user.uid);
    if (peek.error) return reply.code(400).send({ error: peek.error });
    if (peek.promo.kind === 'discount') return reply.code(400).send({ error: 'use_at_checkout' });
    if (peek.promo.kind === 'free_boost' && !b.data.repoId) return reply.code(400).send({ error: 'needs_repo' });
    // A hosted repo (even a free one from a promo) requires a linked BMM creator id —
    // same rule as paid hosting checkout, so a repo is never created for an unlinked
    // account. (free_boost only touches an EXISTING owned repo, so it's fine.)
    if (peek.promo.kind === 'free_hosting' && await p.creatorLink.count({ where: { userId: req.user.uid } }) === 0) {
      return reply.code(403).send({ error: 'creator_link_required' });
    }

    const result = await redeemPromoAtomic(p, b.data.code, req.user.uid, async (tx, promo) => {
      if (promo.kind === 'free_hosting') {
        const uploadKbps = (promo.uploadMbps || 8) * 1024;
        const repo = await tx.serverRepo.create({ data: {
          ownerId: req.user.uid, name: `promo-${Date.now().toString(36)}`, hosted: true, status: 'PROVISIONING',
          storageQuotaBytes: BigInt(promo.storageGB) * BigInt(GiB), uploadLimitKbps: uploadKbps, cpuShare: 0.5,
          deleteAt: promo.hostMonths ? new Date(Date.now() + promo.hostMonths * 30 * 864e5) : null,
        } });
        return { kind: 'free_hosting', repoId: repo.id, detail: `free hosting ${promo.storageGB}GB → ${repo.name}` };
      }
      if (promo.kind === 'free_boost') {
        const repo = await tx.serverRepo.findUnique({ where: { id: b.data.repoId } });
        if (!repo || repo.ownerId !== req.user.uid) return { error: 'repo_not_found' };
        const base = repo.featuredUntil && repo.featuredUntil > new Date() ? repo.featuredUntil : new Date();
        const until = new Date(base.getTime() + promo.boostDays * 864e5);
        await tx.serverRepo.update({ where: { id: repo.id }, data: { featuredUntil: until } });
        return { kind: 'free_boost', featuredUntil: until, detail: `boost ${promo.boostDays}d → ${repo.name}` };
      }
      return { error: 'unsupported' };
    });
    if (result.error) return reply.code(result.error === 'repo_not_found' ? 404 : 400).send({ error: result.error });
    const msg = result.kind === 'free_hosting'
      ? `Promo "${result.promo.code}" redeemed — a free ${result.promo.storageGB} GB hosted repo was created.`
      : `Promo "${result.promo.code}" redeemed — a repo is boosted for ${result.promo.boostDays} days.`;
    await notify(p, req.user.uid, 'promo_redeemed', msg);
    return { ok: true, kind: result.kind, repoId: result.repoId, featuredUntil: result.featuredUntil };
  });
}
