import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db, requireRole, requireCap, optionalAuth, notify, isValidRepoManifest, accountEntrySchema } from '../lib/lib.mjs';
import { safeFetch } from '../lib/net.mjs';
import { repoFingerprint, normalizeFingerprint, loadOwnerIdentities } from '../lib/repofingerprint.mjs';
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
  // Reconcile TECHNICAL validity only — pendingReview is a human-moderation flag
  // now (cleared by admin verify/reject), so sweeps must never touch it.
  if (repo.listed) { data.verified = !!h.valid; }
  const out = await p.serverRepo.update({ where: { id: repoId }, data });
  return { repo: out, health: h };
}

// When a LISTED repo's CONTENT changes (new SHA), it must be re-reviewed before it
// re-appears in the public list — otherwise a verified listing could be silently
// swapped for anything. The repo keeps serving; it just drops out of the public list
// (which requires pendingReview:false) until a mod re-approves. Staff-owned repos
// bypass the queue. Returns true if it re-entered review.
async function restartReviewIfListed(p, repo, user, oldSha, newSha) {
  const isStaff = ['MOD', 'ADMIN', 'SUPERADMIN'].includes(user.role);
  if (!repo.listed || isStaff || !newSha || newSha === oldSha || repo.pendingReview) return false;
  await p.serverRepo.update({ where: { id: repo.id }, data: { pendingReview: true } });
  const mods = await p.user.findMany({ where: { role: { in: ['MOD', 'ADMIN', 'SUPERADMIN'] } }, select: { id: true } });
  await Promise.all(mods.map((m) => notify(p, m.id, 'repo_review', `"${repo.name}" changed its content and is back in the review queue.`).catch(() => {})));
  await notify(p, repo.ownerId, 'repo_review', `Your change to "${repo.name}" is under review before it re-appears in the public list.`).catch(() => {});
  return true;
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
  app.post('/admin/repos/check-all', { preHandler: requireCap('manage_repos', 'MOD') }, async () => await recheckRepos());

  // Public list: only listed + verified repos. Featured (paid) ones float to the top.
  // optionalAuth so a logged-in caller also gets `favorited` per repo (and can use
  // the `favorited=1` filter below) — a logged-out visitor still gets the full list.
  app.get('/repos', { preHandler: optionalAuth() }, async (req) => {
    const p = await db();
    const now = new Date();
    const all = await p.serverRepo.findMany({
      where: { listed: true, verified: true, pendingReview: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ownerId: true, name: true, description: true, tags: true, links: true, publicUrl: true, repoUrl: true, status: true, hosted: true, hostPath: true, published: true,
                featuredUntil: true, storageQuotaBytes: true, storageUsedBytes: true, sha: true, verified: true, category: true, owner: { select: { displayName: true } },
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
    // Trust tiers float above everything: OFFICIAL (BMM team) first, then PARTNER, then
    // boosted community repos (rotated), then the rest. So the browser always leads with
    // the safest, curated repos.
    const official = filtered.filter((r) => r.category === 'official');
    const partner = filtered.filter((r) => r.category === 'partner');
    const community = filtered.filter((r) => r.category !== 'official' && r.category !== 'partner');
    const featured = community.filter(isFeat);
    const rest = community.filter((r) => !isFeat(r));
    // Fair boost rotation: boosted repos share the top slots. Shuffle them on every
    // request so no single booster permanently owns #1 — the more repos are boosted at
    // once, the smaller (and more rotating) each one's share of the top becomes.
    for (let i = featured.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [featured[i], featured[j]] = [featured[j], featured[i]]; }
    return {
      repos: [...official, ...partner, ...featured, ...rest].map((r) => {
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
      where: { listed: true, verified: true, pendingReview: false },
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
    const groups = await p.hostingGroup.findMany({ where: { ownerId: req.user.uid }, include: { repos: true, catalogs: { select: { id: true, name: true, slug: true, storageQuotaBytes: true, storageUsedBytes: true } } }, orderBy: { createdAt: 'desc' } });
    return { groups: groups.map((g) => {
      // Storage is fungible: both repos and catalogs reserve from the same poolBytes.
      const repoBytes = g.repos.reduce((a, r) => a + r.storageQuotaBytes, 0n);
      const catBytes = g.catalogs.reduce((a, c) => a + c.storageQuotaBytes, 0n);
      return {
        id: g.id, name: g.name, poolBytes: Number(g.poolBytes), uploadLimitKbps: g.uploadLimitKbps, cpuShare: g.cpuShare,
        usedBytes: Number(repoBytes + catBytes), repoBytes: Number(repoBytes), catalogBytes: Number(catBytes),
        repoCount: g.repos.length, catalogCount: g.catalogs.length,
        catalogs: g.catalogs.map((c) => ({ id: c.id, name: c.name, slug: c.slug, quotaBytes: Number(c.storageQuotaBytes), usedBytes: Number(c.storageUsedBytes) })),
      };
    }) };
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
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
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
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
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
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
    if (repo.ownerId !== req.user.uid) return reply.code(403).send({ error: 'owner_only' }); // billing action — owner only, not collaborators
    if (repo.groupId) return reply.code(400).send({ error: 'grouped', detail: 'Grouped repos resize for free within their pool — use /quota instead.' });
    if (!repo.hosted) return reply.code(400).send({ error: 'not_hosted' });
    const currentGB = Number(repo.storageQuotaBytes) / GiB;
    const curUploadMbps = (repo.uploadLimitKbps || 0) / 1024;
    // Never below what the repo already has — this endpoint only ever RAISES.
    const targetUploadMbps = Math.max(b.data.uploadMbps ?? 0, curUploadMbps);
    const targetCpuShare = Math.max(b.data.cpuShare ?? 0, repo.cpuShare || 0);
    const newStorageGB = Math.max(b.data['storageGB'], currentGB);
    // An upgrade must raise at least ONE resource — storage, upload speed, or CPU.
    if (newStorageGB <= currentGB && targetUploadMbps <= curUploadMbps && targetCpuShare <= (repo.cpuShare || 0)) {
      return reply.code(400).send({ error: 'not_an_upgrade', detail: 'Raise storage, upload speed, or CPU above the current values.' });
    }

    const cap = await capacityStatus(p);
    if (!cap.enabled) return reply.code(403).send({ error: 'hosting_disabled' });
    // Enforce the admin CPU/upload ceilings (unless the repo already exceeds them —
    // never force an existing repo DOWN, just don't let an upgrade push further past).
    const cfCaps = capacityFactors(cap);
    if ((targetUploadMbps > cfCaps.maxUploadMbps && targetUploadMbps > (repo.uploadLimitKbps || 0) / 1024)
      || (targetCpuShare > cfCaps.maxCpuShare && targetCpuShare > (repo.cpuShare || 0))) {
      return reply.code(409).send({ error: 'over_limit', maxUploadMbps: cfCaps.maxUploadMbps, maxCpuShare: cfCaps.maxCpuShare });
    }
    // This repo's CURRENT quota already counts toward allocatedGB — subtract it
    // before checking the delta, so upgrading doesn't get double-counted against
    // the pool (the exact same "reserved, no one else can use it" accounting that
    // already guards fresh repo creation, just netted against this repo's own slice).
    const deltaGB = newStorageGB - currentGB;
    if (cap.allocatedGB + deltaGB > cap.usableGB) return reply.code(409).send({ error: 'capacity_full', freeGB: cap.freeGB });

    const s = await settings(p);
    const plan = await p.hostingPlan.create({ data: {
      name: `Custom ${newStorageGB}GB (upgrade)`, storageGB: newStorageGB,
      uploadLimitKbps: Math.round(targetUploadMbps * 1024), cpuShare: targetCpuShare,
      priceMonthlyCents: priceCents(s, newStorageGB, targetUploadMbps, targetCpuShare), active: false,
    } });
    const cf = capacityFactors(cap);
    const months = b.data.months;
    const total = termTotalCents(plan.priceMonthlyCents, months, cf.priceMult);

    if (total <= 0) {
      await p.serverRepo.update({ where: { id: repo.id }, data: {
        storageQuotaBytes: BigInt(Math.round(newStorageGB * GiB)),
        uploadLimitKbps: plan.uploadLimitKbps, cpuShare: plan.cpuShare,
      } });
      // upsert, not create — every hosted repo already has a Subscription row
      // (serverRepoId is @unique), so a plain create() would throw here every time.
      await p.subscription.upsert({
        where: { serverRepoId: repo.id },
        create: { userId: req.user.uid, serverRepoId: repo.id, planId: plan.id, status: 'active', currentPeriodEnd: new Date(Date.now() + months * 30 * 864e5) },
        update: { planId: plan.id, status: 'active', currentPeriodEnd: new Date(Date.now() + months * 30 * 864e5) },
      });
      await notify(p, req.user.uid, 'hosting_started', `"${repo.name}" upgraded to ${newStorageGB} GB — free tier, no charge.`);
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
        product_data: { name: `"${repo.name}" upgrade → ${newStorageGB}GB — ${months} month${months > 1 ? 's' : ''}` },
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
    const b = z.object({ months: z.number().int().refine((m) => TERM_MONTHS.includes(m), 'invalid_term').default(1), autoRenew: z.boolean().optional() }).safeParse(req.body);
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
    const md = { type: 'repo_renew', kind: 'hosting', userId: req.user.uid, repoId: repo.id, months: String(months) };
    // Auto-renew → a real recurring Stripe subscription (charges again each term).
    // One-time → a single payment that also mints a genuine Stripe invoice/receipt.
    const session = await sk.checkout.sessions.create(b.data.autoRenew ? {
      mode: 'subscription', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, recurring: { interval: 'month', interval_count: months }, product_data: { name: `"${repo.name}" hosting — auto-renews every ${months} month${months > 1 ? 's' : ''}` } } }],
      subscription_data: { metadata: md },
      metadata: md,
      success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    } : {
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, product_data: { name: `"${repo.name}" renewal — ${months} month${months > 1 ? 's' : ''}` } } }],
      invoice_creation: { enabled: true },
      metadata: md,
      success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    });
    return { url: session.url };
  });

  // Renew a whole storage POOL (the current model) — extends the pool subscription's
  // term. Free tier applies immediately; a paid term goes through Stripe (webhook
  // pool_renew). Also the "resume" path: restores every repo + catalog in the pool.
  app.post('/me/hosting/groups/:id/renew', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ months: z.number().int().refine((m) => TERM_MONTHS.includes(m), 'invalid_term').default(1), autoRenew: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const group = await p.hostingGroup.findUnique({ where: { id: req.params.id } });
    if (!group) return reply.code(404).send({ error: 'not_found' });
    if (group.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return reply.code(403).send({ error: 'owner_only' });

    const storageGB = Number(group.poolBytes) / GiB;
    const uploadMbps = (group.uploadLimitKbps || 0) / 1024;
    const s = await settings(p);
    const cf = capacityFactors(await capacityStatus(p));
    const months = b.data.months;
    const monthly = priceCents(s, storageGB, uploadMbps, group.cpuShare || 0);
    const total = termTotalCents(monthly, months, cf.priceMult);
    const siteUrl = process.env.SITE_URL || 'http://localhost';

    const applyRenewal = async () => {
      const currentPeriodEnd = new Date(Date.now() + months * 30 * 864e5);
      // Restore everything the pool owns that a lapse had suspended/hidden.
      await p.serverRepo.updateMany({ where: { groupId: group.id, status: 'SUSPENDED' }, data: { status: 'ONLINE' } });
      await p.serverRepo.updateMany({ where: { groupId: group.id }, data: { deleteAt: null } });
      await p.communityCatalog.updateMany({ where: { groupId: group.id, status: 'HIDDEN' }, data: { status: 'ACTIVE', deleteAt: null } });
      const existing = await p.subscription.findUnique({ where: { hostingGroupId: group.id } });
      if (existing) { await p.subscription.update({ where: { hostingGroupId: group.id }, data: { status: 'active', currentPeriodEnd, warnedAt: null } }); return; }
      const plan = await p.hostingPlan.create({ data: { name: `Custom ${storageGB}GB pool (renewal)`, storageGB, uploadLimitKbps: group.uploadLimitKbps, cpuShare: group.cpuShare, priceMonthlyCents: monthly, active: false } });
      await p.subscription.create({ data: { userId: group.ownerId, hostingGroupId: group.id, planId: plan.id, status: 'active', currentPeriodEnd } });
    };

    if (total <= 0) {
      await applyRenewal();
      await notify(p, group.ownerId, 'hosting_started', `Pool "${group.name}" renewed for ${months} month${months > 1 ? 's' : ''} — free tier, no charge.`);
      return { ok: true, free: true, groupId: group.id };
    }
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const customer = await ensureCustomer(p, sk, req.user.uid);
    const md = { type: 'pool_renew', kind: 'hosting', userId: req.user.uid, groupId: group.id, months: String(months) };
    const session = await sk.checkout.sessions.create(b.data.autoRenew ? {
      mode: 'subscription', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, recurring: { interval: 'month', interval_count: months }, product_data: { name: `Pool "${group.name}" — auto-renews every ${months} month${months > 1 ? 's' : ''}` } } }],
      subscription_data: { metadata: md }, metadata: md,
      success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    } : {
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, product_data: { name: `Pool "${group.name}" renewal — ${months} month${months > 1 ? 's' : ''}` } } }],
      invoice_creation: { enabled: true }, metadata: md,
      success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    });
    return { url: session.url };
  });

  // Free switch: single hosted repo → multi (mints a pool sized to its quota), and back.
  app.post('/me/repos/:id/to-multi', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
    if (repo.groupId) return { ok: true, groupId: repo.groupId, mode: 'multi' };
    if (!repo.hosted) return reply.code(400).send({ error: 'not_hosted' });
    const group = await p.hostingGroup.create({ data: { ownerId: repo.ownerId, name: `${repo.name} pool`, poolBytes: repo.storageQuotaBytes, uploadLimitKbps: repo.uploadLimitKbps, cpuShare: repo.cpuShare } });
    await p.serverRepo.update({ where: { id: repo.id }, data: { groupId: group.id } });
    return { ok: true, groupId: group.id, mode: 'multi' };
  });
  app.post('/me/repos/:id/to-single', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
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
    // Storage is fungible: repos AND catalogs both draw from poolBytes.
    const catAgg = await p.communityCatalog.aggregate({ where: { groupId: group.id }, _sum: { storageQuotaBytes: true } });
    const used = group.repos.reduce((a, r) => a + r.storageQuotaBytes, 0n) + (catAgg._sum.storageQuotaBytes || 0n);
    const wantBytes = BigInt(Math.round(b.data.storageGB * GiB));
    if (used + wantBytes > group.poolBytes) return reply.code(409).send({ error: 'pool_exceeded', freeGB: Number(group.poolBytes - used) / GiB });
    const repo = await p.serverRepo.create({ data: {
      ownerId: group.ownerId, name: b.data.name, hosted: true, status: 'PROVISIONING',
      storageQuotaBytes: wantBytes, uploadLimitKbps: group.uploadLimitKbps, cpuShare: group.cpuShare, groupId: group.id,
      freePlan: group.freePlan, // inherit the pool's provenance — the gauge counts the pool, not this repo
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
    const gate = await repoCreateGate(p, req.user);
    if (!gate.ok) return reply.code(403).send({ error: gate.reason });
    let repo = await p.serverRepo.create({ data: { ...b.data, ownerId: req.user.uid, hosted: false, status: 'OFFLINE' } });
    // Auto health-check + auto content-SHA (like BMM's repo check) so status/sha are real from the start.
    if (repo.repoUrl) {
      const h = await checkRepoHealth(repo).catch(() => null);
      if (h) repo = await p.serverRepo.update({ where: { id: repo.id }, data: { status: h.status, ...(h.sha ? { sha: h.sha } : {}) } });
    }
    return reply.code(201).send({ repo: ser(repo) });
  });

  // Gate for creating a Server-Repo: a verified BMM creator id, a verified email, AND
  // 2FA — so every repo traces to a real, secured, BMM-linked identity. Staff bypass.
  // Returns { ok } or { ok:false, reason } (email_unverified | twofa_required |
  // creator_link_required) so the client can point the user at the exact missing step.
  async function repoCreateGate(p, user) {
    if (['MOD', 'ADMIN', 'SUPERADMIN'].includes(user.role)) return { ok: true };
    const u = await p.user.findUnique({ where: { id: user.uid }, select: { emailVerified: true, totpEnabled: true } });
    if (!u) return { ok: false, reason: 'not_found' };
    if (!u.emailVerified) return { ok: false, reason: 'email_unverified' };
    if (!u.totpEnabled) return { ok: false, reason: 'twofa_required' };
    const links = await p.creatorLink.count({ where: { userId: user.uid } });
    if (!links) return { ok: false, reason: 'creator_link_required' };
    return { ok: true };
  }

  async function ownRepo(p, id, user) {
    const repo = await p.serverRepo.findUnique({ where: { id } });
    if (!repo) return { err: 404 };
    if (repo.ownerId !== user.uid && user.role === 'USER') return { err: 403 };
    return { repo };
  }
  // Owner AND not frozen. A SUSPENDED repo is read-only for its owner — no list, edit,
  // delete, plan change, or online toggle. Staff still manage it via /admin/repos.
  // Returns `code: 'repo_suspended'` so the UI can explain the 403 precisely.
  async function ownRepoMutable(p, id, user) {
    const res = await ownRepo(p, id, user);
    if (res.err) return res;
    if (res.repo.status === 'SUSPENDED' && user.role === 'USER') return { err: 403, code: 'repo_suspended' };
    return res;
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
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
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
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
    if (b.data.sizeBytes != null && BigInt(b.data.sizeBytes) > repo.storageQuotaBytes && repo.hosted) return reply.code(413).send({ error: 'quota_exceeded' });
    const data = {};
    if (b.data.sha) data.sha = b.data.sha; // manual override; otherwise auto-computed below
    if (b.data.sizeBytes != null) data.storageUsedBytes = BigInt(b.data.sizeBytes);
    if (Object.keys(data).length) await p.serverRepo.update({ where: { id: repo.id }, data });
    const res = await autoVerify(p, repo.id); // recompute sha + verify from the live content
    const reReview = await restartReviewIfListed(p, repo, req.user, repo.sha, res?.repo?.sha);
    return { ok: true, verified: !!res?.repo?.verified, reReview };
  });

  // Toggle public listing. Going public requires a valid manifest (SHA): if it isn't
  // valid, the repo is kept PRIVATE and a `sha_invalid` error is returned.
  app.post('/repos/:id/list', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ listed: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
    if (!b.data.listed) {
      await p.serverRepo.update({ where: { id: repo.id }, data: { listed: false, pendingReview: false } });
      return { ok: true, listed: false };
    }
    // Moderation queue: a regular user's repo passes the TECHNICAL checks here, then
    // waits for a MOD/ADMIN approval before it appears publicly (staff-owned repos
    // skip the queue). Admin approves via /admin/repos/:id/verify, rejects with reason.
    const isStaff = ['MOD', 'ADMIN', 'SUPERADMIN'].includes(req.user.role);
    const queue = isStaff ? {} : { pendingReview: true };
    const notifyMods = async () => {
      if (isStaff) return;
      const mods = await p.user.findMany({ where: { role: { in: ['MOD', 'ADMIN', 'SUPERADMIN'] } }, select: { id: true } });
      await Promise.all(mods.map((m) => notify(p, m.id, 'repo_review', `"${repo.name}" was submitted to the public list and awaits review.`).catch(() => {})));
    };
    // Hosted repos verify from their uploaded repo.json; others from the live URL.
    if (repo.hosted) {
      if (!repo.verified || !repo.repoJson) return reply.code(409).send({ error: 'sha_invalid', reason: 'no_valid_repo_json' });
      await p.serverRepo.update({ where: { id: repo.id }, data: { listed: true, ...queue } });
      await notifyMods();
      return { ok: true, listed: true, verified: true, pending: !isStaff };
    }
    // Listing must be set for autoVerify to compute `verified`; revert if it fails.
    await p.serverRepo.update({ where: { id: repo.id }, data: { listed: true, ...queue } });
    const res = await autoVerify(p, repo.id);
    if (!res?.repo?.verified) {
      await p.serverRepo.update({ where: { id: repo.id }, data: { listed: false, pendingReview: false } });
      return reply.code(409).send({ error: 'sha_invalid', reason: res?.health?.reason || 'invalid_manifest' });
    }
    await notifyMods();
    return { ok: true, listed: true, verified: true, pending: !isStaff };
  });

  // On-demand health check → ONLINE/OFFLINE + validity + auto SHA + auto verify.
  app.post('/repos/:id/check', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
    const res = await autoVerify(p, repo.id);
    return { ...res.health, verified: !!res.repo.verified, sha: res.repo.sha };
  });

  // SOFT delete with a 72h grace window: the repo goes offline immediately but its
  // content is kept and the deletion is reversible (POST /me/repos/:id/delete/cancel)
  // until the sweeper hard-deletes the bytes + subscription + row after `deleteAt`.
  app.delete('/repos/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
    if (repo.ownerId !== req.user.uid) return reply.code(403).send({ error: 'owner_only' });
    const deleteAt = new Date(Date.now() + 72 * 3600 * 1000);
    await p.serverRepo.update({ where: { id: repo.id }, data: { deleteAt, status: repo.hosted ? 'SUSPENDED' : repo.status } });
    return { ok: true, deleteAt };
  });

  // Undo a pending self-delete within the 72h grace window (owner-scoped mirror of
  // /admin/repos/:id/delete/cancel). Clears deleteAt and restores the repo.
  app.post('/me/repos/:id/delete/cancel', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownRepo(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: err === 404 ? 'not_found' : 'forbidden' });
    if (repo.ownerId !== req.user.uid) return reply.code(403).send({ error: 'owner_only' });
    if (!repo.deleteAt) return reply.code(400).send({ error: 'not_scheduled' });
    await p.serverRepo.update({ where: { id: repo.id }, data: { deleteAt: null, status: repo.status === 'SUSPENDED' ? 'ONLINE' : repo.status } });
    return { ok: true };
  });

  // ── Admin / mod ──
  // Admin: host a repo directly, no payment (free host). Optionally for another user.
  // mode 'multi' creates a shared storage pool (HostingGroup) + an initial repo.
  app.post('/admin/repos/host', { preHandler: requireCap('manage_repos') }, async (req, reply) => {
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
      // Empty storage pool — the owner fills it with repos and/or catalogs. No forced
      // first repo (that was the old "half the pool goes to repo-1" behaviour).
      const group = await p.hostingGroup.create({ data: {
        ownerId, name: b.data.name, poolBytes: BigInt(storageGB) * BigInt(GiB), uploadLimitKbps: uploadKbps, cpuShare,
      } });
      await notify(p, ownerId, 'hosting_started', `A storage pool "${b.data.name}" (${storageGB}GB) was provisioned for you (free host). Add repos or catalogs to it.`);
      return reply.code(201).send({ group: serGroup(group) });
    }

    const repo = await p.serverRepo.create({ data: {
      ownerId, name: b.data.name, hosted: true, status: 'PROVISIONING',
      storageQuotaBytes: BigInt(storageGB) * BigInt(GiB),
      uploadLimitKbps: uploadKbps, cpuShare, listed: !!b.data.listed,
    } });
    await notify(p, ownerId, 'hosting_started', `A hosted repo "${repo.name}" was provisioned for you (free host).`);
    return reply.code(201).send({ repo: ser(repo) });
  });

  app.get('/admin/repos', { preHandler: requireCap('manage_repos', 'MOD') }, async () => {
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
  app.get('/admin/repos/identify', { preHandler: requireCap('manage_repos', 'MOD') }, async (req, reply) => {
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

  // Admin: live traffic across every repo — the last 15 minutes of access events
  // (a "who is downloading what right now" feed) plus a 24h per-repo rollup.
  app.get('/admin/repos/traffic', { preHandler: requireCap('manage_repos', 'MOD') }, async () => {
    const p = await db();
    const since = new Date(Date.now() - 15 * 60e3);
    const day = new Date(Date.now() - 24 * 3600e3);
    const recent = await p.repoAccessEvent.findMany({
      where: { createdAt: { gt: since } }, orderBy: { createdAt: 'desc' }, take: 200,
      include: { repo: { select: { id: true, name: true } } },
    });
    const rollup = await p.repoAccessEvent.groupBy({ by: ['serverRepoId'], where: { createdAt: { gt: day } }, _count: { _all: true } });
    const repos = await p.serverRepo.findMany({ where: { id: { in: rollup.map((r) => r.serverRepoId) } }, select: { id: true, name: true, owner: { select: { displayName: true } } } });
    const nameMap = new Map(repos.map((r) => [r.id, r]));
    return {
      recent: recent.map((e) => ({ id: e.id, repoId: e.serverRepoId, repo: e.repo?.name || '?', ip: e.ip, path: e.path, kind: e.kind, userId: e.userId, discordId: e.discordId, at: e.createdAt })),
      rollup: rollup
        .map((r) => ({ repoId: r.serverRepoId, name: nameMap.get(r.serverRepoId)?.name || '?', owner: nameMap.get(r.serverRepoId)?.owner?.displayName || '—', count: r._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  });

  // Admin: manually re-run validation (recompute the content SHA + verify) for a repo.
  app.post('/admin/repos/:id/revalidate', { preHandler: requireCap('manage_repos', 'MOD') }, async (req, reply) => {
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

  app.post('/admin/repos/:id/verify', { preHandler: requireCap('manage_repos', 'MOD') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    await p.serverRepo.update({ where: { id: repo.id }, data: { verified: true, pendingReview: false } });
    await notify(p, repo.ownerId, 'repo_verified', `Your repo "${repo.name}" was verified and is now live in the list.`);
    return { ok: true };
  });

  app.post('/admin/repos/:id/reject', { preHandler: requireCap('manage_repos', 'MOD') }, async (req, reply) => {
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
  app.post('/admin/repos/:id/delete/cancel', { preHandler: requireCap('manage_repos') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    await p.serverRepo.update({ where: { id: repo.id }, data: { deleteAt: null, status: repo.status === 'SUSPENDED' ? 'ONLINE' : repo.status } });
    await notify(p, repo.ownerId, 'hosting_started', `"${repo.name}" deletion was cancelled by an admin — it's back online.`);
    return { ok: true };
  });

  // Set status / limits / classification (admin).
  app.patch('/admin/repos/:id', { preHandler: requireCap('manage_repos') }, async (req, reply) => {
    const b = z.object({
      status: z.enum(['PROVISIONING', 'ONLINE', 'SUSPENDED', 'OFFLINE']).optional(),
      category: z.enum(['community', 'official', 'partner']).optional(),
      storageGB: z.number().min(0).max(4000).optional(),
      uploadMbps: z.number().min(0).max(4000).optional(),
      uploadLimitKbps: z.number().int().min(0).optional(),
      cpuShare: z.number().min(0).max(64).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = {};
    if (b.data.status) data.status = b.data.status;
    if (b.data.category) data.category = b.data.category;
    if (b.data.storageGB != null) data.storageQuotaBytes = BigInt(Math.round(b.data.storageGB * 1024 ** 3));
    if (b.data.uploadMbps != null) data.uploadLimitKbps = Math.round(b.data.uploadMbps * 1024);
    if (b.data.uploadLimitKbps != null) data.uploadLimitKbps = b.data.uploadLimitKbps;
    if (b.data.cpuShare != null) data.cpuShare = b.data.cpuShare;
    const repo = await p.serverRepo.update({ where: { id: req.params.id }, data });
    if (b.data.category) await notify(p, repo.ownerId, 'repo_verified', b.data.category === 'community' ? `"${repo.name}" is now a community repo.` : `"${repo.name}" was designated ${b.data.category === 'official' ? 'an OFFICIAL' : 'a PARTNER'} repo by the team.`).catch(() => {});
    return { repo: ser(repo) };
  });

  // Admin easy-boost: grant (or extend) a free featured boost for N days — no payment.
  // For putting official/partner or great community repos on top instantly.
  app.post('/admin/repos/:id/feature', { preHandler: requireCap('manage_repos') }, async (req, reply) => {
    const b = z.object({ days: z.number().int().min(0).max(3650) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    // days=0 clears the boost; otherwise extend from the later of now / current expiry.
    const base = repo.featuredUntil && repo.featuredUntil > new Date() ? repo.featuredUntil : new Date();
    const featuredUntil = b.data.days === 0 ? null : new Date(base.getTime() + b.data.days * 864e5);
    const out = await p.serverRepo.update({ where: { id: repo.id }, data: { featuredUntil } });
    if (featuredUntil) await notify(p, repo.ownerId, 'feature_active', `"${repo.name}" was boosted by the team — featured until ${featuredUntil.toDateString()} (free).`).catch(() => {});
    return { repo: ser(out) };
  });
}
