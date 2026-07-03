import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db, requireRole, optionalAuth, notify, isValidRepoManifest, accountEntrySchema } from '../lib.mjs';
import { safeFetch } from '../net.mjs';
import { repoFingerprint, normalizeFingerprint, loadOwnerIdentities } from '../repofingerprint.mjs';
import { capacityStatus, capacityFactors, priceCents, termTotalCents, TERM_MONTHS, stripe, settings, ensureCustomer } from './hosting.mjs';

const SHA = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/i;
const GiB = 1024 ** 3;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const linksSchema = z.object({ discord: z.string().max(300), website: z.string().max(300), changelog: z.string().max(300) }).partial();

// A repo's sandboxed, owner-editable settings. Requested values are always clamped
// to the hard caps on the row — the owner can ask for more but never exceed the sandbox.
// `accounts` entries ({type:"bcweb"|"discord", id, label}) whitelist/ban a specific
// account rather than an IP/key; the site-wide GlobalAccessPolicy (access-policy.mjs)
// is enforced ON TOP of this, identically for every repo (see hosting-content.mjs).
export const DEFAULT_SETTINGS = { access: { whitelistEnabled: false, ips: [], keys: [], accounts: [] }, bans: { ips: [], keys: [], accounts: [] }, requestedUploadKbps: null };
export function effUpload(repo) {
  const cap = repo.uploadLimitKbps || 0;
  const req = repo.settings?.requestedUploadKbps;
  if (req == null || req <= 0) return cap; // unset / "unlimited" → the sandbox cap
  return Math.min(req, cap);               // never exceeds the sandbox cap
}
const serGroup = (g) => (g ? { ...g, poolBytes: Number(g.poolBytes) } : g);
// BigInt fields -> numbers for JSON; add sandbox-derived fields. NOTE: dashPassword
// (the dashboard password hash) is stripped here so it can never leak to a client.
const ser = (r) => {
  const { dashPassword, ...rest } = r;
  return {
    ...rest,
    storageQuotaBytes: Number(r.storageQuotaBytes), storageUsedBytes: Number(r.storageUsedBytes),
    settings: r.settings || DEFAULT_SETTINGS,
    effectiveUploadKbps: effUpload(r),
    hasDashPassword: !!dashPassword,
    ...(r.group !== undefined ? { group: serGroup(r.group) } : {}),
  };
};

// Ping a repo's URL → ONLINE/OFFLINE + validity + a content SHA (for .json manifests).
// A .json manifest must parse; anything else just needs to be reachable.
// Exported for the provisioner's poller. `valid` drives auto-verification.
export async function checkRepoHealth(repo) {
  const url = repo.repoUrl || repo.publicUrl;
  if (!url) return { status: 'OFFLINE', valid: false, reason: 'no_url' };
  try {
    const res = await safeFetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { status: 'OFFLINE', valid: false, reason: `http_${res.status}` };
    // A repo must expose a valid CURRENT-format repo.json to be verifiable — reachable,
    // or even parseable, is not enough (an old-format manifest must not be trusted).
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { return { status: 'ONLINE', valid: false, reason: 'not_a_manifest' }; }
    if (!isValidRepoManifest(parsed)) return { status: 'ONLINE', valid: false, reason: 'outdated_format', sha: sha256(text) };
    return { status: 'ONLINE', valid: true, sha: sha256(text) }; // auto content hash
  } catch (e) {
    return { status: 'OFFLINE', valid: false, reason: String(e?.name || e) };
  }
}

// Auto health-check a repo and reconcile status/sha/verified. Verification is now
// automatic: a reachable, valid repo.json (matching its content hash) is verified;
// an invalid/unreachable one is unverified. Admins can still force a revalidate.
async function autoVerify(p, repoId) {
  const repo = await p.serverRepo.findUnique({ where: { id: repoId } });
  if (!repo) return null;
  const h = await checkRepoHealth(repo);
  const data = { status: h.status };
  if (h.sha) data.sha = h.sha;
  if (repo.listed) { data.verified = !!h.valid; data.pendingReview = false; }
  const out = await p.serverRepo.update({ where: { id: repoId }, data });
  return { repo: out, health: h };
}

// Re-verify listed, URL-based repos (health + SHA + verified). Hosted repos verify
// from their uploaded repo.json and are managed by the provisioner, so they're skipped.
// Used by the periodic auto-check and the admin "Check all" button.
export async function recheckRepos() {
  const p = await db();
  const repos = await p.serverRepo.findMany({ where: { listed: true, hosted: false, repoUrl: { not: null } }, select: { id: true } });
  let verified = 0, online = 0;
  for (const r of repos) {
    try { const res = await autoVerify(p, r.id); if (res?.repo?.verified) verified++; if (res?.health?.status === 'ONLINE') online++; } catch { /* skip */ }
  }
  return { checked: repos.length, verified, online };
}

export default async function repoRoutes(app) {
  // Admin: re-check every listed repo now (returns counts).
  app.post('/admin/repos/check-all', { preHandler: requireRole('MOD', 'ADMIN') }, async () => await recheckRepos());

  // Public list: only listed + verified repos. Featured (paid) ones float to the top.
  // optionalAuth so a logged-in caller also gets `favorited` per repo (and can use
  // the `favorited=1` filter below) — a logged-out visitor still gets the full list.
  app.get('/repos', { preHandler: optionalAuth() }, async (req) => {
    const p = await db();
    const now = new Date();
    const all = await p.serverRepo.findMany({
      where: { listed: true, verified: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ownerId: true, name: true, description: true, tags: true, links: true, publicUrl: true, repoUrl: true, status: true, hosted: true, hostPath: true, published: true,
                featuredUntil: true, storageQuotaBytes: true, storageUsedBytes: true, sha: true, verified: true, owner: { select: { displayName: true } },
                _count: { select: { favorites: true } } },
    });
    // Batch-load owner identities once (not per repo) so each row can carry its
    // unique Repo ID fingerprint (see repofingerprint.mjs).
    const identities = await loadOwnerIdentities(p, all.map((r) => r.ownerId));
    const myFavorites = req.user?.uid
      ? new Set((await p.repoFavorite.findMany({ where: { userId: req.user.uid, serverRepoId: { in: all.map((r) => r.id) } }, select: { serverRepoId: true } })).map((f) => f.serverRepoId))
      : null;
    const isFeat = (r) => r.featuredUntil && r.featuredUntil > now;
    let filtered = all;
    if (req.query?.online === '1') filtered = filtered.filter((r) => r.status === 'ONLINE');
    if (req.query?.favorited === '1' && myFavorites) filtered = filtered.filter((r) => myFavorites.has(r.id));
    const featured = filtered.filter(isFeat);
    const rest = filtered.filter((r) => !isFeat(r));
    // Fair boost rotation: boosted repos share the top slots. Shuffle them on every
    // request so no single booster permanently owns #1 — the more repos are boosted at
    // once, the smaller (and more rotating) each one's share of the top becomes.
    for (let i = featured.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [featured[i], featured[j]] = [featured[j], featured[i]]; }
    return {
      repos: [...featured, ...rest].map((r) => {
        const { _count, ownerId, ...rest2 } = r;
        const idn = identities.get(ownerId) || {};
        return { ...ser(rest2), fingerprint: repoFingerprint({ repoId: r.id, ownerId, ...idn }), featured: isFeat(r), favoriteCount: _count.favorites, favorited: myFavorites ? myFavorites.has(r.id) : false };
      }),
    };
  });

  // Toggle favoriting a repo (any logged-in user) — purely social, grants no access.
  app.post('/repos/:id/favorite', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    const existing = await p.repoFavorite.findUnique({ where: { userId_serverRepoId: { userId: req.user.uid, serverRepoId: repo.id } } });
    if (existing) await p.repoFavorite.delete({ where: { id: existing.id } });
    else await p.repoFavorite.create({ data: { userId: req.user.uid, serverRepoId: repo.id } });
    const favoriteCount = await p.repoFavorite.count({ where: { serverRepoId: repo.id } });
    return { favorited: !existing, favoriteCount };
  });

  // Public aggregate feed: a single repo.json-style index of every listed+verified
  // repo, so BMM (or anyone) can consume the whole BetterCommunity directory from one
  // URL. Each entry links to that repo's own repo.json manifest.
  app.get('/repos.json', async (req, reply) => {
    const p = await db();
    const now = new Date();
    // Fixed fallback (not the request Host) — this feed is public + cached, so building
    // URLs from a client-controlled Host header would allow cache poisoning (CWE-644).
    const origin = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
    const repos = await p.serverRepo.findMany({
      where: { listed: true, verified: true },
      orderBy: [{ featuredUntil: 'desc' }, { createdAt: 'desc' }],
      select: { name: true, description: true, tags: true, links: true, publicUrl: true, repoUrl: true, hosted: true, hostPath: true, published: true, featuredUntil: true, sha: true, owner: { select: { displayName: true } } },
    });
    const repoJsonUrl = (r) => (r.hosted && r.hostPath && r.published) ? `${origin}/hosting/${r.hostPath}/repo.json` : (r.repoUrl || r.publicUrl || null);
    reply.header('Cache-Control', 'public, max-age=300');
    return {
      name: 'BetterCommunity Server Repos',
      description: 'Verified community Server-Repos, aggregated from BetterCommunity.',
      url: `${origin}/repos`,
      generatedAt: now.toISOString(),
      count: repos.length,
      repos: repos.map((r) => ({
        name: r.name,
        description: r.description || '',
        repoJson: repoJsonUrl(r),
        tags: r.tags || [],
        author: r.owner?.displayName || null,
        hosted: !!r.hosted,
        verified: true,
        featured: !!(r.featuredUntil && r.featuredUntil > now),
        sha256: r.sha || null,
        links: r.links || null,
      })).filter((r) => r.repoJson),
    };
  });

  app.get('/me/repos', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { email: true } });
    const owned = await p.serverRepo.findMany({ where: { ownerId: req.user.uid }, orderBy: { createdAt: 'desc' }, include: { subscription: { include: { plan: true } }, group: true, _count: { select: { favorites: true } } } });
    // Repos shared with me via an authorized email (collaborator). Return a slim shape:
    // no other collaborators' emails, no sandbox internals — just enough to open the dashboard.
    const collab = me?.email
      ? await p.serverRepo.findMany({ where: { accessEmails: { has: me.email }, ownerId: { not: req.user.uid } }, orderBy: { createdAt: 'desc' }, include: { owner: { select: { displayName: true } } } })
      : [];
    const idn = (await loadOwnerIdentities(p, [req.user.uid])).get(req.user.uid) || {};
    return {
      repos: owned.map((r) => { const { _count, ...rest } = r; return { ...ser(rest), fingerprint: repoFingerprint({ repoId: r.id, ownerId: req.user.uid, ...idn }), access: 'owner', favoriteCount: _count.favorites }; }),
      shared: collab.map((r) => ({
        id: r.id, name: r.name, description: r.description, hosted: r.hosted, status: r.status,
        published: r.published, hostPath: r.hostPath, listed: r.listed, verified: r.verified,
        storageQuotaBytes: Number(r.storageQuotaBytes), storageUsedBytes: Number(r.storageUsedBytes),
        access: 'collab', ownerName: r.owner?.displayName || null,
      })),
    };
  });

  // A user's multi-repo storage pools, with usage.
  app.get('/me/hosting/groups', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const groups = await p.hostingGroup.findMany({ where: { ownerId: req.user.uid }, include: { repos: true }, orderBy: { createdAt: 'desc' } });
    return { groups: groups.map((g) => ({
      id: g.id, name: g.name, poolBytes: Number(g.poolBytes), uploadLimitKbps: g.uploadLimitKbps, cpuShare: g.cpuShare,
      usedBytes: Number(g.repos.reduce((a, r) => a + r.storageQuotaBytes, 0n)), repoCount: g.repos.length,
    })) };
  });

  // ── Sandboxed repo management (owner) ──
  const settingsSchema = z.object({
    access: z.object({ whitelistEnabled: z.boolean(), ips: z.array(z.string().max(64)).max(2000), keys: z.array(z.string().max(128)).max(2000), accounts: z.array(accountEntrySchema).max(2000) }).partial(),
    bans: z.object({ ips: z.array(z.string().max(64)).max(10000), keys: z.array(z.string().max(128)).max(10000), accounts: z.array(accountEntrySchema).max(10000) }).partial(),
    requestedUploadKbps: z.number().int().min(0).max(10_000_000).nullable(),
  }).partial();

  app.put('/me/repos/:id/settings', { preHandler: requireRole() }, async (req, reply) => {
    const b = settingsSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    const cur = repo.settings || DEFAULT_SETTINGS;
    const next = {
      access: { ...DEFAULT_SETTINGS.access, ...cur.access, ...(b.data.access || {}) },
      bans: { ...DEFAULT_SETTINGS.bans, ...cur.bans, ...(b.data.bans || {}) },
      requestedUploadKbps: b.data.requestedUploadKbps !== undefined ? b.data.requestedUploadKbps : (cur.requestedUploadKbps ?? null),
    };
    const out = await p.serverRepo.update({ where: { id: repo.id }, data: { settings: next } });
    // Return the CLAMPED effective upload so the UI can show "asked X, capped to Y".
    return { repo: ser(out), effectiveUploadKbps: effUpload(out), uploadCapKbps: out.uploadLimitKbps };
  });

  // Resize a repo's storage — only for grouped (multi) repos, bounded by the pool.
  app.put('/me/repos/:id/quota', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ storageGB: z.number().min(0.5).max(2000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (!repo.groupId) return reply.code(400).send({ error: 'not_grouped', detail: 'Single-repo hosting has a fixed quota.' });
    const group = await p.hostingGroup.findUnique({ where: { id: repo.groupId }, include: { repos: true } });
    const newBytes = BigInt(Math.round(b.data.storageGB * GiB));
    if (newBytes < repo.storageUsedBytes) return reply.code(409).send({ error: 'below_used' });
    const others = group.repos.filter((r) => r.id !== repo.id).reduce((a, r) => a + r.storageQuotaBytes, 0n);
    if (others + newBytes > group.poolBytes) return reply.code(409).send({ error: 'pool_exceeded', freeGB: Number(group.poolBytes - others) / GiB });
    const out = await p.serverRepo.update({ where: { id: repo.id }, data: { storageQuotaBytes: newBytes } });
    return { repo: ser(out) };
  });

  // Upgrade a SOLO (non-grouped) hosted repo past its current fixed quota — the
  // self-service path a user needs when an upload no longer fits: mints a custom
  // plan sized to the new target (storage always goes up; upload/CPU floor at the
  // repo's CURRENT allotment, so this can never silently downgrade them, only
  // raise), then either provisions it immediately (if it prices free, e.g. the
  // whole repo still fits under pricing.hostingFreeGB) or checks out a new
  // prepaid term through Stripe. On payment, the EXISTING repo is upgraded in
  // place — no new repo, no duplicate storage grant.
  app.post('/me/repos/:id/upgrade', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      storageGB: z.number().min(0.5).max(2000),
      uploadMbps: z.number().min(0.5).max(1000).optional(),
      cpuShare: z.number().min(0.1).max(8).optional(),
      months: z.number().int().refine((m) => TERM_MONTHS.includes(m), 'invalid_term').default(1),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (repo.ownerId !== req.user.uid) return reply.code(403).send({ error: 'owner_only' }); // billing action — owner only, not collaborators
    if (repo.groupId) return reply.code(400).send({ error: 'grouped', detail: 'Grouped repos resize for free within their pool — use /quota instead.' });
    if (!repo.hosted) return reply.code(400).send({ error: 'not_hosted' });
    const currentGB = Number(repo.storageQuotaBytes) / GiB;
    if (b.data.storageGB <= currentGB) return reply.code(400).send({ error: 'not_an_upgrade', detail: 'New size must be larger than the current quota.' });
    // Never below what the repo already has — this endpoint only ever raises.
    const targetUploadMbps = Math.max(b.data.uploadMbps ?? 0, (repo.uploadLimitKbps || 0) / 1024);
    const targetCpuShare = Math.max(b.data.cpuShare ?? 0, repo.cpuShare || 0);

    const cap = await capacityStatus(p);
    if (!cap.enabled) return reply.code(403).send({ error: 'hosting_disabled' });
    // This repo's CURRENT quota already counts toward allocatedGB — subtract it
    // before checking the delta, so upgrading doesn't get double-counted against
    // the pool (the exact same "reserved, no one else can use it" accounting that
    // already guards fresh repo creation, just netted against this repo's own slice).
    const deltaGB = b.data.storageGB - currentGB;
    if (cap.allocatedGB + deltaGB > cap.usableGB) return reply.code(409).send({ error: 'capacity_full', freeGB: cap.freeGB });

    const s = await settings(p);
    const plan = await p.hostingPlan.create({ data: {
      name: `Custom ${b.data.storageGB}GB (upgrade)`, storageGB: b.data.storageGB,
      uploadLimitKbps: Math.round(targetUploadMbps * 1024), cpuShare: targetCpuShare,
      priceMonthlyCents: priceCents(s, b.data.storageGB, targetUploadMbps, targetCpuShare), active: false,
    } });
    const cf = capacityFactors(cap);
    const months = b.data.months;
    const total = termTotalCents(plan.priceMonthlyCents, months, cf.priceMult);

    if (total <= 0) {
      await p.serverRepo.update({ where: { id: repo.id }, data: {
        storageQuotaBytes: BigInt(Math.round(b.data.storageGB * GiB)),
        uploadLimitKbps: plan.uploadLimitKbps, cpuShare: plan.cpuShare,
      } });
      // upsert, not create — every hosted repo already has a Subscription row
      // (serverRepoId is @unique), so a plain create() would throw here every time.
      await p.subscription.upsert({
        where: { serverRepoId: repo.id },
        create: { userId: req.user.uid, serverRepoId: repo.id, planId: plan.id, status: 'active', currentPeriodEnd: new Date(Date.now() + months * 30 * 864e5) },
        update: { planId: plan.id, status: 'active', currentPeriodEnd: new Date(Date.now() + months * 30 * 864e5) },
      });
      await notify(p, req.user.uid, 'hosting_started', `"${repo.name}" upgraded to ${b.data.storageGB} GB — free tier, no charge.`);
      return { ok: true, free: true, repoId: repo.id };
    }

    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const customer = await ensureCustomer(p, sk, req.user.uid);
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const session = await sk.checkout.sessions.create({
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: total,
        product_data: { name: `"${repo.name}" upgrade → ${b.data.storageGB}GB — ${months} month${months > 1 ? 's' : ''}` },
      } }],
      metadata: { type: 'repo_upgrade', userId: req.user.uid, repoId: repo.id, planId: plan.id, months: String(months) },
      success_url: `${siteUrl}/dashboard?hosting=ok`,
      cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    });
    return { url: session.url };
  });

  // Renew the CURRENT plan for more months — same size/speed/CPU, just extends
  // currentPeriodEnd. Also the "resume payment" path out of a lapsed term: clears
  // any pending 72h deleteAt and restores ONLINE if the sweeper had suspended it.
  app.post('/me/repos/:id/renew', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ months: z.number().int().refine((m) => TERM_MONTHS.includes(m), 'invalid_term').default(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (repo.ownerId !== req.user.uid) return reply.code(403).send({ error: 'owner_only' });
    if (!repo.hosted) return reply.code(400).send({ error: 'not_hosted' });

    const storageGB = Number(repo.storageQuotaBytes) / GiB;
    const uploadMbps = (repo.uploadLimitKbps || 0) / 1024;
    const s = await settings(p);
    const cap = await capacityStatus(p);
    const cf = capacityFactors(cap);
    const months = b.data.months;
    const monthly = priceCents(s, storageGB, uploadMbps, repo.cpuShare || 0);
    const total = termTotalCents(monthly, months, cf.priceMult);
    const siteUrl = process.env.SITE_URL || 'http://localhost';

    const applyRenewal = async () => {
      await p.serverRepo.update({ where: { id: repo.id }, data: { deleteAt: null, status: repo.status === 'SUSPENDED' ? 'ONLINE' : repo.status } });
      const existing = await p.subscription.findUnique({ where: { serverRepoId: repo.id } });
      const currentPeriodEnd = new Date(Date.now() + months * 30 * 864e5);
      if (existing) { await p.subscription.update({ where: { serverRepoId: repo.id }, data: { status: 'active', currentPeriodEnd } }); return; }
      // No Subscription row exists yet (shouldn't normally happen — every hosted
      // repo gets one at provisioning) — mint a plan matching the current specs so
      // Subscription.planId (required) is always satisfiable.
      const plan = await p.hostingPlan.create({ data: { name: `Custom ${storageGB}GB (renewal)`, storageGB, uploadLimitKbps: repo.uploadLimitKbps, cpuShare: repo.cpuShare, priceMonthlyCents: monthly, active: false } });
      await p.subscription.create({ data: { userId: req.user.uid, serverRepoId: repo.id, planId: plan.id, status: 'active', currentPeriodEnd } });
    };

    if (total <= 0) {
      await applyRenewal();
      await notify(p, req.user.uid, 'hosting_started', `"${repo.name}" renewed for ${months} month${months > 1 ? 's' : ''} — free tier, no charge.`);
      return { ok: true, free: true, repoId: repo.id };
    }
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const customer = await ensureCustomer(p, sk, req.user.uid);
    const session = await sk.checkout.sessions.create({
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, product_data: { name: `"${repo.name}" renewal — ${months} month${months > 1 ? 's' : ''}` } } }],
      metadata: { type: 'repo_renew', userId: req.user.uid, repoId: repo.id, months: String(months) },
      success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    });
    return { url: session.url };
  });

  // Free switch: single hosted repo → multi (mints a pool sized to its quota), and back.
  app.post('/me/repos/:id/to-multi', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (repo.groupId) return { ok: true, groupId: repo.groupId, mode: 'multi' };
    if (!repo.hosted) return reply.code(400).send({ error: 'not_hosted' });
    const group = await p.hostingGroup.create({ data: { ownerId: repo.ownerId, name: `${repo.name} pool`, poolBytes: repo.storageQuotaBytes, uploadLimitKbps: repo.uploadLimitKbps, cpuShare: repo.cpuShare } });
    await p.serverRepo.update({ where: { id: repo.id }, data: { groupId: group.id } });
    return { ok: true, groupId: group.id, mode: 'multi' };
  });
  app.post('/me/repos/:id/to-single', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (!repo.groupId) return { ok: true, mode: 'single' };
    const group = await p.hostingGroup.findUnique({ where: { id: repo.groupId }, include: { repos: true } });
    if (group && group.repos.length > 1) return reply.code(409).send({ error: 'pool_has_multiple_repos' });
    // Re-merge: the single repo reclaims the WHOLE pool's storage (the pool is dissolved),
    // so switching back doesn't silently shrink the repo to its in-pool slice.
    await p.serverRepo.update({ where: { id: repo.id }, data: { groupId: null, ...(group ? { storageQuotaBytes: group.poolBytes } : {}) } });
    if (group) await p.hostingGroup.delete({ where: { id: group.id } }).catch(() => {});
    return { ok: true, mode: 'single', storageGB: group ? Number(group.poolBytes) / GiB : undefined };
  });

  // Add another repo to a multi pool, drawing from the remaining pool storage.
  app.post('/me/hosting/groups/:id/repos', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ name: z.string().min(2).max(60), storageGB: z.number().min(0.5).max(2000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const group = await p.hostingGroup.findUnique({ where: { id: req.params.id }, include: { repos: true } });
    if (!group) return reply.code(404).send({ error: 'not_found' });
    if (group.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return reply.code(403).send({ error: 'forbidden' });
    const used = group.repos.reduce((a, r) => a + r.storageQuotaBytes, 0n);
    const wantBytes = BigInt(Math.round(b.data.storageGB * GiB));
    if (used + wantBytes > group.poolBytes) return reply.code(409).send({ error: 'pool_exceeded', freeGB: Number(group.poolBytes - used) / GiB });
    const repo = await p.serverRepo.create({ data: {
      ownerId: group.ownerId, name: b.data.name, hosted: true, status: 'PROVISIONING',
      storageQuotaBytes: wantBytes, uploadLimitKbps: group.uploadLimitKbps, cpuShare: group.cpuShare, groupId: group.id,
    } });
    return reply.code(201).send({ repo: ser(repo) });
  });

  // Create a (non-hosted) repo to list it.
  app.post('/repos', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(2).max(60), description: z.string().max(600).default(''),
      repoUrl: z.string().url().max(300).optional(),
      tags: z.array(z.string().max(24)).max(8).default([]),
      links: linksSchema.optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    let repo = await p.serverRepo.create({ data: { ...b.data, ownerId: req.user.uid, hosted: false, status: 'OFFLINE' } });
    // Auto health-check + auto content-SHA (like BMM's repo check) so status/sha are real from the start.
    if (repo.repoUrl) {
      const h = await checkRepoHealth(repo).catch(() => null);
      if (h) repo = await p.serverRepo.update({ where: { id: repo.id }, data: { status: h.status, ...(h.sha ? { sha: h.sha } : {}) } });
    }
    return reply.code(201).send({ repo: ser(repo) });
  });

  async function ownRepo(p, id, user) {
    const repo = await p.serverRepo.findUnique({ where: { id } });
    if (!repo) return { err: 404 };
    if (repo.ownerId !== user.uid && user.role === 'USER') return { err: 403 };
    return { repo };
  }

  // Edit content/metadata. Changing the source re-runs the auto check (status/sha/verify).
  app.patch('/repos/:id', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(2).max(60).optional(), description: z.string().max(600).optional(),
      repoUrl: z.string().url().max(300).optional(), tags: z.array(z.string().max(24)).max(8).optional(),
      links: linksSchema.optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    const urlChanged = b.data.repoUrl && b.data.repoUrl !== repo.repoUrl;
    await p.serverRepo.update({ where: { id: repo.id }, data: b.data });
    const out = urlChanged ? (await autoVerify(p, repo.id)).repo : await p.serverRepo.findUnique({ where: { id: repo.id } });
    return { repo: ser(out) };
  });

  // Push an update — re-runs the auto check; the content SHA is computed automatically.
  app.post('/repos/:id/push', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ sha: z.string().regex(SHA).optional(), sizeBytes: z.number().int().nonnegative().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (b.data.sizeBytes != null && BigInt(b.data.sizeBytes) > repo.storageQuotaBytes && repo.hosted) return reply.code(413).send({ error: 'quota_exceeded' });
    const data = {};
    if (b.data.sha) data.sha = b.data.sha; // manual override; otherwise auto-computed below
    if (b.data.sizeBytes != null) data.storageUsedBytes = BigInt(b.data.sizeBytes);
    if (Object.keys(data).length) await p.serverRepo.update({ where: { id: repo.id }, data });
    const res = await autoVerify(p, repo.id); // recompute sha + verify from the live content
    return { ok: true, verified: !!res?.repo?.verified };
  });

  // Toggle public listing. Going public requires a valid manifest (SHA): if it isn't
  // valid, the repo is kept PRIVATE and a `sha_invalid` error is returned.
  app.post('/repos/:id/list', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ listed: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (!b.data.listed) {
      await p.serverRepo.update({ where: { id: repo.id }, data: { listed: false } });
      return { ok: true, listed: false };
    }
    // Hosted repos verify from their uploaded repo.json; others from the live URL.
    if (repo.hosted) {
      if (!repo.verified || !repo.repoJson) return reply.code(409).send({ error: 'sha_invalid', reason: 'no_valid_repo_json' });
      await p.serverRepo.update({ where: { id: repo.id }, data: { listed: true } });
      return { ok: true, listed: true, verified: true };
    }
    // Listing must be set for autoVerify to compute `verified`; revert if it fails.
    await p.serverRepo.update({ where: { id: repo.id }, data: { listed: true } });
    const res = await autoVerify(p, repo.id);
    if (!res?.repo?.verified) {
      await p.serverRepo.update({ where: { id: repo.id }, data: { listed: false } });
      return reply.code(409).send({ error: 'sha_invalid', reason: res?.health?.reason || 'invalid_manifest' });
    }
    return { ok: true, listed: true, verified: true };
  });

  // On-demand health check → ONLINE/OFFLINE + validity + auto SHA + auto verify.
  app.post('/repos/:id/check', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    const res = await autoVerify(p, repo.id);
    return { ...res.health, verified: !!res.repo.verified, sha: res.repo.sha };
  });

  app.delete('/repos/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    await p.serverRepo.delete({ where: { id: repo.id } }).catch(() => {});
    return { ok: true };
  });

  // ── Admin / mod ──
  // Admin: host a repo directly, no payment (free host). Optionally for another user.
  // mode 'multi' creates a shared storage pool (HostingGroup) + an initial repo.
  app.post('/admin/repos/host', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(2).max(60),
      ownerEmail: z.string().email().optional(),
      planId: z.string().optional(),
      storageGB: z.number().min(1).max(2000).optional(),
      uploadMbps: z.number().min(1).max(2000).optional(),
      cpuShare: z.number().min(0.1).max(8).optional(),
      listed: z.boolean().optional(),
      mode: z.enum(['single', 'multi']).default('single'),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    let ownerId = req.user.uid;
    if (b.data.ownerEmail) {
      const u = await p.user.findUnique({ where: { email: b.data.ownerEmail } });
      if (!u) return reply.code(404).send({ error: 'user_not_found' });
      ownerId = u.id;
    }
    let storageGB = b.data.storageGB, uploadKbps = b.data.uploadMbps ? Math.round(b.data.uploadMbps * 1024) : undefined, cpuShare = b.data.cpuShare;
    if (b.data.planId) {
      const plan = await p.hostingPlan.findUnique({ where: { id: b.data.planId } });
      if (!plan) return reply.code(404).send({ error: 'unknown_plan' });
      storageGB = plan.storageGB; uploadKbps = plan.uploadLimitKbps; cpuShare = plan.cpuShare;
    }
    storageGB = storageGB || 10; uploadKbps = uploadKbps ?? 8192; cpuShare = cpuShare ?? 0.5;

    if (b.data.mode === 'multi') {
      const group = await p.hostingGroup.create({ data: {
        ownerId, name: b.data.name, poolBytes: BigInt(storageGB) * BigInt(GiB), uploadLimitKbps: uploadKbps, cpuShare,
      } });
      const firstGB = Math.max(1, Math.ceil(storageGB / 2));
      const repo = await p.serverRepo.create({ data: {
        ownerId, name: `${b.data.name}-1`, hosted: true, status: 'PROVISIONING',
        storageQuotaBytes: BigInt(firstGB) * BigInt(GiB), uploadLimitKbps: uploadKbps, cpuShare, groupId: group.id, listed: !!b.data.listed,
      }, include: { group: true } });
      await notify(p, ownerId, 'hosting_started', `A multi-repo pool "${b.data.name}" (${storageGB}GB) was provisioned for you (free host).`);
      return reply.code(201).send({ group: serGroup(group), repo: ser(repo) });
    }

    const repo = await p.serverRepo.create({ data: {
      ownerId, name: b.data.name, hosted: true, status: 'PROVISIONING',
      storageQuotaBytes: BigInt(storageGB) * BigInt(GiB),
      uploadLimitKbps: uploadKbps, cpuShare, listed: !!b.data.listed,
    } });
    await notify(p, ownerId, 'hosting_started', `A hosted repo "${repo.name}" was provisioned for you (free host).`);
    return reply.code(201).send({ repo: ser(repo) });
  });

  app.get('/admin/repos', { preHandler: requireRole('MOD', 'ADMIN') }, async () => {
    const p = await db();
    const repos = await p.serverRepo.findMany({
      orderBy: [{ pendingReview: 'desc' }, { createdAt: 'desc' }],
      include: {
        owner: { select: { displayName: true, email: true, stripeCustomerId: true } },
        // currentPeriodEnd/status drive the expiry + cancelled/expired badges;
        // stripeCustomerId (cheap, already on User) stands in for "can this user
        // even be charged again" without a live per-repo Stripe API call.
        subscription: { select: { currentPeriodEnd: true, status: true } },
      },
    });
    return { repos: repos.map(ser) };
  });

  // Admin: resolve a Repo ID fingerprint (BCR-XXXX-XXXX) back to the owning repo
  // and the full combined-identity picture behind it (BCWEB account, linked BMM
  // creator ids, linked Discord ids, Ko-fi donor status). Recomputes each repo's
  // fingerprint live and matches — repo counts are modest, so the scan is fine
  // and always agrees with whatever the user is currently seeing on their card.
  app.get('/admin/repos/identify', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const fp = normalizeFingerprint(req.query?.fp);
    if (!fp) return reply.code(400).send({ error: 'invalid_fingerprint' });
    const p = await db();
    const repos = await p.serverRepo.findMany({ select: { id: true, ownerId: true, name: true, hosted: true, listed: true, published: true, createdAt: true, owner: { select: { displayName: true, email: true, role: true } } } });
    const identities = await loadOwnerIdentities(p, repos.map((r) => r.ownerId));
    const match = repos.find((r) => repoFingerprint({ repoId: r.id, ownerId: r.ownerId, ...(identities.get(r.ownerId) || {}) }) === fp);
    if (!match) return reply.code(404).send({ error: 'not_found' });
    const idn = identities.get(match.ownerId) || { creatorIds: [], discordIds: [], kofi: false };
    return {
      fingerprint: fp,
      repo: { id: match.id, name: match.name, hosted: match.hosted, listed: match.listed, published: match.published, createdAt: match.createdAt },
      owner: { id: match.ownerId, displayName: match.owner?.displayName, email: match.owner?.email, role: match.owner?.role },
      identity: { creatorIds: idn.creatorIds, discordIds: idn.discordIds, kofiDonor: idn.kofi },
    };
  });

  // Admin: manually re-run validation (recompute the content SHA + verify) for a repo.
  app.post('/admin/repos/:id/revalidate', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    // Hosted repos verify against their stored repo.json manifest; others fetch the URL.
    if (repo.hosted) {
      const valid = isValidRepoManifest(repo.repoJson); // current-format check, not just "exists"
      const sha = repo.repoJson ? sha256(JSON.stringify(repo.repoJson)) : null;
      const out = await p.serverRepo.update({ where: { id: repo.id }, data: { verified: valid, pendingReview: false, ...(sha ? { sha } : {}) } });
      return { ok: true, verified: out.verified, sha: out.sha, valid };
    }
    const res = await autoVerify(p, repo.id);
    return { ok: true, verified: !!res.repo.verified, sha: res.repo.sha, valid: !!res.health.valid, reason: res.health.reason };
  });

  app.post('/admin/repos/:id/verify', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    await p.serverRepo.update({ where: { id: repo.id }, data: { verified: true, pendingReview: false } });
    await notify(p, repo.ownerId, 'repo_verified', `Your repo "${repo.name}" was verified and is now live in the list.`);
    return { ok: true };
  });

  app.post('/admin/repos/:id/reject', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const reason = z.object({ reason: z.string().min(1).max(400) }).safeParse(req.body);
    if (!reason.success) return reply.code(400).send({ error: 'reason_required' });
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    await p.serverRepo.update({ where: { id: repo.id }, data: { verified: false, pendingReview: false, listed: false } });
    await notify(p, repo.ownerId, 'repo_rejected', `Your repo "${repo.name}" was unlisted: ${reason.data.reason}`);
    return { ok: true };
  });

  // Admin override: cancel a repo's scheduled 72h deletion (e.g. the owner reached
  // out and paid outside the normal flow, or the suspension was a mistake) — mirrors
  // the existing /catalog/:id/delete/cancel for catalog items.
  app.post('/admin/repos/:id/delete/cancel', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    await p.serverRepo.update({ where: { id: repo.id }, data: { deleteAt: null, status: repo.status === 'SUSPENDED' ? 'ONLINE' : repo.status } });
    await notify(p, repo.ownerId, 'hosting_started', `"${repo.name}" deletion was cancelled by an admin — it's back online.`);
    return { ok: true };
  });

  // Set status / limits (admin).
  app.patch('/admin/repos/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      status: z.enum(['PROVISIONING', 'ONLINE', 'SUSPENDED', 'OFFLINE']).optional(),
      storageGB: z.number().min(0).optional(), uploadLimitKbps: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = {};
    if (b.data.status) data.status = b.data.status;
    if (b.data.storageGB != null) data.storageQuotaBytes = BigInt(Math.round(b.data.storageGB * 1024 ** 3));
    if (b.data.uploadLimitKbps != null) data.uploadLimitKbps = b.data.uploadLimitKbps;
    const repo = await p.serverRepo.update({ where: { id: req.params.id }, data });
    return { repo: ser(repo) };
  });
}
