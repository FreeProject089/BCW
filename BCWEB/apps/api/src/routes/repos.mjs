import { z } from 'zod';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { applyCampaign } from './campaigns.mjs';
import { db, requireRole, requireCap, optionalAuth, notify, isValidRepoManifest, accountEntrySchema, logAudit } from '../lib/lib.mjs';
import { purgeRepo } from '../lib/sweeper.mjs';
import { safeFetch } from '../lib/net.mjs';
import { repoFingerprint, normalizeFingerprint, loadOwnerIdentities, userBcId } from '../lib/repofingerprint.mjs';
import { mintAttestation, attestationPublicKeyHex, ATTESTATION_TTL_SECONDS } from '../lib/identity-attestation.mjs';
import { capacityStatus, capacityFactors, priceCents, termTotalCents, TERM_MONTHS, stripe, settings, ensureCustomer, recomputePoolBytes } from './hosting.mjs';
import { findBlock } from '../lib/urlblock.mjs';
import { reservedTermIn } from '../lib/reserved-names.mjs';

// A listed repo is a link like any other, so the blocklist reaches it too. Same shape of
// refusal as the catalog, so a client handles one error and not two.
async function repoUrlBlocked(p, url) {
  if (!url) return null;
  const rules = await p.blockedUrl.findMany({ select: { id: true, scope: true, pattern: true, allow: true } });
  const hit = findBlock(rules, [url]);
  if (!hit) return null;
  p.blockedUrl.update({ where: { id: hit.rule.id }, data: { hits: { increment: 1 }, lastHitAt: new Date() } })
    .catch(() => {});
  return hit;
}

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
        return { ...ser(rest2), ownerId, ownerBcId: userBcId(ownerId), fingerprint: repoFingerprint({ repoId: r.id, ownerId, ...idn }), featured: isFeat(r), favoriteCount: _count.favorites, favorited: myFavorites ? myFavorites.has(r.id) : false };
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

  // Constant-time share-key compare (both are base64url, so ASCII) — avoids leaking the
  // key a character at a time via response timing (mirrors the catalog/secret compares).
  const shareKeyOk = (given, real) => {
    if (!real || !given) return false;
    const a = Buffer.from(String(given)); const b = Buffer.from(real);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  // Public single-repo page (/r/:id). Visible when the repo is publicly listed+verified,
  // OR the caller presents the matching unlisted-share key (?k=). Metadata only — the
  // actual content is still served through the normal repo.json / hosting paths, so this
  // endpoint never exposes anything a listed repo wouldn't already show.
  app.get('/r/:id', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const r = await p.serverRepo.findUnique({
      where: { id: req.params.id },
      select: { id: true, ownerId: true, name: true, description: true, tags: true, links: true, publicUrl: true, repoUrl: true,
                status: true, hosted: true, hostPath: true, published: true, sha: true, listed: true, verified: true, pendingReview: true,
                category: true, shareKey: true, createdAt: true, owner: { select: { displayName: true } }, _count: { select: { favorites: true } } },
    });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const publicListed = r.listed && r.verified && !r.pendingReview;
    const viaKey = shareKeyOk(req.query?.k, r.shareKey);
    const isOwner = req.user?.uid === r.ownerId || ['ADMIN', 'SUPERADMIN'].includes(req.user?.role);
    if (!publicListed && !viaKey && !isOwner) return reply.code(404).send({ error: 'not_found' });
    const origin = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
    // NOT `|| r.publicUrl`: that field is the provisioner scaffold's placeholder
    // (`REPO_PUBLIC_BASE/<id>`, default `http://localhost/repos/<id>`) — a path that isn't a
    // route and a port nothing serves. Offering it as "View manifest" handed users a dead link
    // (NS_ERROR_NET_EMPTY_RESPONSE). A hosted-but-unpublished repo has no manifest yet, so
    // null is the honest answer and the page already renders "No manifest yet" for it.
    const repoJson = (r.hosted && r.hostPath && r.published) ? `${origin}/hosting/${r.hostPath}/repo.json` : (r.repoUrl || null);
    // The SERVER's manifest, generated from the files actually stored — a different
    // document from the owner's uploaded repo.json, and the one that always describes what
    // is really here. Only hosted repos have one: an external repo is somebody else's
    // server and we cannot describe its contents.
    const manifestJson = (r.hosted && r.hostPath && r.published) ? `${origin}/hosting/${r.hostPath}/manifest.json` : null;
    const filesBase = (r.hosted && r.hostPath && r.published) ? `${origin}/hosting/${r.hostPath}/files/` : null;
    const idn = (await loadOwnerIdentities(p, [r.ownerId])).get(r.ownerId) || {};
    // Star state for the signed-in viewer (the count was already here) — the page needs both
    // to render the button in the right state instead of only "how many others starred it".
    const mine = req.user?.uid
      ? await p.repoFavorite.findUnique({ where: { userId_serverRepoId: { userId: req.user.uid, serverRepoId: r.id } }, select: { id: true } })
      : null;
    return {
      repo: {
        id: r.id, name: r.name, description: r.description || '', tags: r.tags || [], links: r.links || null,
        hosted: !!r.hosted, status: r.status, category: r.category, verified: r.verified, listed: publicListed,
        author: r.owner?.displayName || null, ownerBcId: userBcId(r.ownerId),
        fingerprint: repoFingerprint({ repoId: r.id, ownerId: r.ownerId, ...idn }),
        favoriteCount: r._count.favorites, favorited: !!mine, repoJson, manifestJson, filesBase, createdAt: r.createdAt,
        // Present only to the owner/staff so they can manage the link; never to visitors.
        ...(isOwner ? { shared: !!r.shareKey } : {}),
      },
    };
  });

  // Owner/staff: enable (mint or return) a share link, rotate it, or disable it.
  app.post('/me/repos/:id/share', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ action: z.enum(['enable', 'rotate', 'disable']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
    if (b.data.action === 'disable') {
      await p.serverRepo.update({ where: { id: repo.id }, data: { shareKey: '' } });
      return { ok: true, shared: false, shareKey: '' };
    }
    // enable is idempotent (keeps an existing key); rotate always mints a fresh one.
    const shareKey = (b.data.action === 'enable' && repo.shareKey) ? repo.shareKey : randomBytes(12).toString('base64url');
    await p.serverRepo.update({ where: { id: repo.id }, data: { shareKey } });
    return { ok: true, shared: true, shareKey };
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
    // Same reason as GET /r/:id: publicUrl is the provisioner scaffold's placeholder, not a
    // manifest. This feed is what BMM consumes, so publishing it there fed the dead link to
    // every client, not just the web page.
    const repoJsonUrl = (r) => (r.hosted && r.hostPath && r.published) ? `${origin}/hosting/${r.hostPath}/repo.json` : (r.repoUrl || null);
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
    const groups = await p.hostingGroup.findMany({ where: { ownerId: req.user.uid }, include: { repos: true, catalogs: { select: { id: true, name: true, slug: true, storageQuotaBytes: true, storageUsedBytes: true } }, _count: { select: { subscriptions: { where: { status: 'active' } } } } }, orderBy: { createdAt: 'desc' } });
    return { groups: groups.map((g) => {
      // Storage is fungible: both repos and catalogs reserve from the same poolBytes.
      const repoBytes = g.repos.reduce((a, r) => a + r.storageQuotaBytes, 0n);
      const catBytes = g.catalogs.reduce((a, c) => a + c.storageQuotaBytes, 0n);
      return {
        id: g.id, name: g.name, color: g.color || '', poolBytes: Number(g.poolBytes), uploadLimitKbps: g.uploadLimitKbps, cpuShare: g.cpuShare, freePlan: g.freePlan,
        usedBytes: Number(repoBytes + catBytes), repoBytes: Number(repoBytes), catalogBytes: Number(catBytes),
        repoCount: g.repos.length, catalogCount: g.catalogs.length, subCount: g._count.subscriptions,
        repos: g.repos.map((r) => ({ id: r.id, name: r.name, quotaBytes: Number(r.storageQuotaBytes), usedBytes: Number(r.storageUsedBytes), status: r.status, hosted: r.hosted })),
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
    // Site-wide campaign. A one-time payment, so there is nothing to guard against here.
    const camp = await applyCampaign(p, total, 'hosting');
    const session = await sk.checkout.sessions.create({
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: camp.amount,
        product_data: { name: `"${repo.name}" upgrade → ${newStorageGB}GB — ${months} month${months > 1 ? 's' : ''}${camp.label}` },
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
    // A campaign discount is time-boxed, so it must never become a recurring price. Same
    // rule the pool-purchase checkout already applies: when one is live, auto-renew falls
    // back to a single payment for this term rather than locking the sale price in
    // forever. The user still gets the discount; they just re-arm auto-renew afterwards.
    const camp = await applyCampaign(p, total, 'hosting');
    const autoRenew = b.data.autoRenew && !camp.campaign;
    // Auto-renew → a real recurring Stripe subscription (charges again each term).
    // One-time → a single payment that also mints a genuine Stripe invoice/receipt.
    const session = await sk.checkout.sessions.create(autoRenew ? {
      mode: 'subscription', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, recurring: { interval: 'month', interval_count: months }, product_data: { name: `"${repo.name}" hosting — auto-renews every ${months} month${months > 1 ? 's' : ''}` } } }],
      subscription_data: { metadata: md },
      metadata: md,
      success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    } : {
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: camp.amount, product_data: { name: `"${repo.name}" renewal — ${months} month${months > 1 ? 's' : ''}${camp.label}` } } }],
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
      const existing = await p.subscription.findFirst({ where: { hostingGroupId: group.id } });
      if (existing) { await p.subscription.update({ where: { id: existing.id }, data: { status: 'active', currentPeriodEnd, warnedAt: null } }); }
      else {
        const plan = await p.hostingPlan.create({ data: { name: `Custom ${storageGB}GB pool (renewal)`, storageGB, uploadLimitKbps: group.uploadLimitKbps, cpuShare: group.cpuShare, priceMonthlyCents: monthly, active: false } });
        await p.subscription.create({ data: { userId: group.ownerId, hostingGroupId: group.id, planId: plan.id, status: 'active', poolContribBytes: group.poolBytes, currentPeriodEnd } });
      }
      await recomputePoolBytes(p, group.id);
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
    // A campaign discount is time-boxed, so it must never become a recurring price. Same
    // rule the pool-purchase checkout already applies: when one is live, auto-renew falls
    // back to a single payment for this term rather than locking the sale price in
    // forever. The user still gets the discount; they just re-arm auto-renew afterwards.
    const camp = await applyCampaign(p, total, 'hosting');
    const autoRenew = b.data.autoRenew && !camp.campaign;
    const session = await sk.checkout.sessions.create(autoRenew ? {
      mode: 'subscription', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, recurring: { interval: 'month', interval_count: months }, product_data: { name: `Pool "${group.name}" — auto-renews every ${months} month${months > 1 ? 's' : ''}` } } }],
      subscription_data: { metadata: md }, metadata: md,
      success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    } : {
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: camp.amount, product_data: { name: `Pool "${group.name}" renewal — ${months} month${months > 1 ? 's' : ''}${camp.label}` } } }],
      invoice_creation: { enabled: true }, metadata: md,
      success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    });
    return { url: session.url };
  });

  // Rename / recolour a storage pool (owner or staff).
  app.patch('/me/hosting/groups/:id', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(60).optional(), color: z.string().max(9).regex(/^(#[0-9a-fA-F]{3,8})?$/).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const g = await p.hostingGroup.findUnique({ where: { id: req.params.id } });
    if (!g) return reply.code(404).send({ error: 'not_found' });
    if (g.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return reply.code(403).send({ error: 'owner_only' });
    await p.hostingGroup.update({ where: { id: g.id }, data: b.data });
    return { ok: true };
  });

  // Admin: every user's storage pools (for the admin pool manager). Merge/rename/recolour
  // reuse the owner endpoints above (they already accept staff); split is admin-only below.
  app.get('/admin/hosting/groups', { preHandler: requireCap('manage_repos') }, async () => {
    const p = await db();
    const groups = await p.hostingGroup.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        repos: { select: { id: true, name: true, status: true, storageQuotaBytes: true } },
        catalogs: { select: { id: true, name: true, slug: true, storageQuotaBytes: true } },
        _count: { select: { subscriptions: { where: { status: 'active' } } } },
      },
    });
    return { groups: groups.map((g) => ({
      id: g.id, name: g.name, color: g.color || '', ownerId: g.ownerId,
      ownerName: g.owner?.displayName || g.owner?.email || '—', ownerBcId: userBcId(g.ownerId),
      poolBytes: Number(g.poolBytes), freePlan: g.freePlan, subCount: g._count.subscriptions,
      repos: g.repos.map((r) => ({ id: r.id, name: r.name, status: r.status, quotaBytes: Number(r.storageQuotaBytes) })),
      catalogs: g.catalogs.map((c) => ({ id: c.id, name: c.name, slug: c.slug, quotaBytes: Number(c.storageQuotaBytes) })),
    })) };
  });

  // Admin: split (unmerge) a merged pool. The first active sub stays on the pool; every
  // EXTRA active sub is moved to its own new pool sized to its contribution. Repos/catalogs
  // stay on the original pool (they can't be auto-reassigned) — the admin re-distributes
  // them afterward if needed.
  app.post('/admin/hosting/groups/:id/split', { preHandler: requireCap('manage_repos') }, async (req, reply) => {
    const p = await db();
    const g = await p.hostingGroup.findUnique({ where: { id: req.params.id } });
    if (!g) return reply.code(404).send({ error: 'not_found' });
    const subs = await p.subscription.findMany({ where: { hostingGroupId: g.id, status: 'active' }, orderBy: { currentPeriodEnd: 'desc' } });
    if (subs.length < 2) return reply.code(400).send({ error: 'nothing_to_split' });
    const [, ...extra] = subs;
    for (const s of extra) {
      const np = await p.hostingGroup.create({ data: { ownerId: g.ownerId, name: `${g.name} (split)`, poolBytes: s.poolContribBytes, uploadLimitKbps: g.uploadLimitKbps, cpuShare: g.cpuShare, freePlan: g.freePlan } });
      await p.subscription.update({ where: { id: s.id }, data: { hostingGroupId: np.id } });
      await recomputePoolBytes(p, np.id);
    }
    await recomputePoolBytes(p, g.id);
    await notify(p, g.ownerId, 'hosting_started', `An admin split pool "${g.name}" back into ${extra.length + 1} separate pools.`).catch(() => {});
    return { ok: true, created: extra.length };
  });

  // Owner-side: split (unmerge) a pool you merged yourself. Same mechanics as the admin
  // route above — the first active subscription keeps the pool, every EXTRA one moves to its
  // own new pool sized to its contribution — but guarded on ownership, because merging is a
  // self-service action (POST /me/hosting/groups/merge) and undoing it should be too.
  //
  // Repos and catalogs deliberately STAY on the original pool: which side each belongs to is
  // a judgement call, and silently scattering someone's repos across new pools would be far
  // worse than leaving them put. They can be re-distributed afterwards with
  // POST /me/hosting/groups/:id/repos.
  app.post('/me/hosting/groups/:id/split', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const g = await p.hostingGroup.findUnique({ where: { id: req.params.id } });
    if (!g) return reply.code(404).send({ error: 'not_found' });
    if (g.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return reply.code(403).send({ error: 'owner_only' });
    const subs = await p.subscription.findMany({ where: { hostingGroupId: g.id, status: 'active' }, orderBy: { currentPeriodEnd: 'desc' } });
    if (subs.length < 2) return reply.code(400).send({ error: 'nothing_to_split' });
    const [, ...extra] = subs;
    for (const sub of extra) {
      const np = await p.hostingGroup.create({ data: { ownerId: g.ownerId, name: `${g.name} (split)`, poolBytes: sub.poolContribBytes, uploadLimitKbps: g.uploadLimitKbps, cpuShare: g.cpuShare, freePlan: g.freePlan } });
      await p.subscription.update({ where: { id: sub.id }, data: { hostingGroupId: np.id } });
      await recomputePoolBytes(p, np.id);
    }
    await recomputePoolBytes(p, g.id);
    return { ok: true, created: extra.length };
  });

  // Merge one pool into another: the source's repos + catalogs move to the target, the
  // source's subscription(s) re-anchor to the target (each keeps billing separately), and
  // the source pool is deleted. The target's poolBytes becomes the sum of all active subs
  // (recomputePoolBytes) — one big pool, the discount of a larger plan applies on renewal.
  app.post('/me/hosting/groups/merge', { preHandler: requireRole() }, async (req, reply) => {
    // Accept one source (legacy `sourceId`) OR several (`sourceIds`) → merged into targetId.
    const b = z.object({
      sourceId: z.string().optional(),
      sourceIds: z.array(z.string()).max(50).optional(),
      targetId: z.string(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    // Normalise: unique source ids, none equal to the target.
    const srcIds = [...new Set([...(b.data.sourceIds || []), ...(b.data.sourceId ? [b.data.sourceId] : [])])].filter((id) => id !== b.data.targetId);
    if (srcIds.length === 0) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const [sources, tgt] = await Promise.all([
      p.hostingGroup.findMany({ where: { id: { in: srcIds } } }),
      p.hostingGroup.findUnique({ where: { id: b.data.targetId } }),
    ]);
    if (!tgt || sources.length !== srcIds.length) return reply.code(404).send({ error: 'not_found' });
    const staff = ['ADMIN', 'SUPERADMIN'].includes(req.user.role);
    // Every pool (target + all sources) must be owned by the caller (or caller is staff),
    // and all must share one owner — pooled storage/subs can't cross accounts.
    const allOwners = new Set([tgt.ownerId, ...sources.map((s) => s.ownerId)]);
    if (!staff && [...allOwners].some((o) => o !== req.user.uid)) return reply.code(403).send({ error: 'owner_only' });
    if (allOwners.size > 1) return reply.code(400).send({ error: 'different_owners' });
    // Move contents + force-re-anchor every subscription, then delete the drained sources.
    await p.$transaction([
      p.serverRepo.updateMany({ where: { groupId: { in: srcIds } }, data: { groupId: tgt.id } }),
      p.communityCatalog.updateMany({ where: { groupId: { in: srcIds } }, data: { groupId: tgt.id } }),
      p.subscription.updateMany({ where: { hostingGroupId: { in: srcIds } }, data: { hostingGroupId: tgt.id } }),
      p.hostingGroup.deleteMany({ where: { id: { in: srcIds } } }),
    ]);
    await recomputePoolBytes(p, tgt.id);
    const totalGB = Number(sources.reduce((a, s) => a + s.poolBytes, tgt.poolBytes)) / GiB;
    const names = sources.map((s) => `"${s.name}"`).join(', ');
    await notify(p, tgt.ownerId, 'hosting_started', `Merged ${sources.length} pool${sources.length > 1 ? 's' : ''} (${names}) into "${tgt.name}" — you now have one larger pool (${totalGB.toFixed(1)} GB).`).catch(() => {});
    return { ok: true, groupId: tgt.id, merged: sources.length };
  });

  // READ-ONLY consolidation quote for a merged pool that carries several separate paid
  // subscriptions. Shows what a SINGLE plan sized to the whole pool would cost vs. the
  // sum of the current subs, with the admin-tunable pricing.consolidationDiscount applied.
  // This performs NO billing change — the owner still consolidates manually through the
  // normal checkout (buy the bigger plan, cancel the small ones). It only surfaces the
  // saving so "one bigger pool = cheaper" is visible after a merge.
  app.get('/me/hosting/groups/:id/consolidation', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const g = await p.hostingGroup.findUnique({ where: { id: req.params.id }, select: { id: true, ownerId: true } });
    if (!g) return reply.code(404).send({ error: 'not_found' });
    if (g.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return reply.code(403).send({ error: 'owner_only' });
    const subs = await p.subscription.findMany({ where: { hostingGroupId: g.id, status: 'active' }, include: { plan: true } });
    // Only recurring paid subs (a live Stripe subscription) can actually be consolidated —
    // quote on the same set the execute path uses so the numbers match reality.
    const paid = subs.filter((s) => s.plan && s.plan.priceMonthlyCents > 0 && s.stripeSubId);
    if (paid.length < 2) return { eligible: false, subCount: subs.length };
    const s = await settings(p);
    const currentMonthlyCents = paid.reduce((a, x) => a + x.plan.priceMonthlyCents, 0);
    const sumGB = paid.reduce((a, x) => a + x.plan.storageGB, 0);
    const sumUploadMbps = paid.reduce((a, x) => a + x.plan.uploadLimitKbps, 0) / 1024;
    const sumCpu = paid.reduce((a, x) => a + x.plan.cpuShare, 0);
    // Consolidated base applies the free-GB floor ONCE (not once per sub) — that plus the
    // admin discount is where the saving comes from.
    const base = priceCents(s, sumGB, sumUploadMbps, sumCpu);
    const discount = Math.min(Math.max(Number(s['pricing.consolidationDiscount'] ?? 0), 0), 0.9);
    const consolidatedMonthlyCents = Math.round(base * (1 - discount));
    const savingCents = Math.max(0, currentMonthlyCents - consolidatedMonthlyCents);
    return {
      eligible: true, subCount: paid.length, sumGB,
      currentMonthlyCents, consolidatedMonthlyCents, savingCents,
      discountPct: Math.round(discount * 100),
      // The execute path also requires a real saving and a chargeable amount.
      canExecute: consolidatedMonthlyCents < currentMonthlyCents && consolidatedMonthlyCents >= 50,
    };
  });

  // Execute the consolidation: replace a pool's several RECURRING paid subs with one bigger
  // recurring plan via Stripe Checkout. Only recurring subs (live stripeSubId) are eligible —
  // this never forfeits a prepaid one-time term. The quote is recomputed server-side (never
  // trust the client), and we refuse if it wouldn't actually save money. On payment the
  // webhook (pool_consolidate) attaches the new sub and cancels the old ones with proration.
  app.post('/me/hosting/groups/:id/consolidate', { preHandler: requireRole() }, async (req, reply) => {
    if (!stripe) return reply.code(503).send({ error: 'stripe_not_configured' });
    const p = await db();
    const g = await p.hostingGroup.findUnique({ where: { id: req.params.id }, select: { id: true, ownerId: true, name: true, poolBytes: true } });
    if (!g) return reply.code(404).send({ error: 'not_found' });
    if (g.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return reply.code(403).send({ error: 'owner_only' });
    const subs = await p.subscription.findMany({ where: { hostingGroupId: g.id, status: 'active' }, include: { plan: true } });
    const recurring = subs.filter((x) => x.plan && x.plan.priceMonthlyCents > 0 && x.stripeSubId);
    if (recurring.length < 2) return reply.code(400).send({ error: 'not_consolidatable' });
    const s = await settings(p);
    const currentMonthlyCents = recurring.reduce((a, x) => a + x.plan.priceMonthlyCents, 0);
    const sumGB = recurring.reduce((a, x) => a + x.plan.storageGB, 0);
    const sumUploadMbps = recurring.reduce((a, x) => a + x.plan.uploadLimitKbps, 0) / 1024;
    const sumCpu = recurring.reduce((a, x) => a + x.plan.cpuShare, 0);
    const base = priceCents(s, sumGB, sumUploadMbps, sumCpu);
    const discount = Math.min(Math.max(Number(s['pricing.consolidationDiscount'] ?? 0), 0), 0.9);
    const consolidatedMonthlyCents = Math.round(base * (1 - discount));
    // Guard against a consolidation that would RAISE the bill (losing per-sub free floors),
    // and against a sub-minimum Stripe recurring charge.
    if (consolidatedMonthlyCents >= currentMonthlyCents) return reply.code(409).send({ error: 'no_saving' });
    if (consolidatedMonthlyCents < 50) return reply.code(409).send({ error: 'amount_too_low' });
    // Mint a hidden consolidated plan (inactive: not sold on the plans page).
    const plan = await p.hostingPlan.create({ data: { name: `Consolidated ${sumGB}GB pool`, storageGB: sumGB, uploadLimitKbps: Math.round(sumUploadMbps * 1024), cpuShare: sumCpu, priceMonthlyCents: consolidatedMonthlyCents, active: false } });
    const customer = await ensureCustomer(p, req.user.uid);
    const siteUrl = (process.env.SITE_URL || 'http://localhost').replace(/\/+$/, '');
    const md = { type: 'pool_consolidate', groupId: g.id, userId: g.ownerId, planId: plan.id,
      cancelSubIds: recurring.map((r) => r.id).join(','), cancelStripeSubIds: recurring.map((r) => r.stripeSubId).join(',') };
    // NO campaign discount here, on purpose. Consolidation exists to replace several
    // recurring subscriptions with one recurring subscription, so there is no one-time
    // branch to fall back to — and discounting the recurring price would carry a
    // time-boxed sale on for as long as the pool lives. The `no_saving` guard above also
    // compares against the CURRENT monthly bill, which a temporary discount would
    // misrepresent.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: consolidatedMonthlyCents, recurring: { interval: 'month' }, product_data: { name: `Consolidated hosting — ${sumGB}GB pool "${g.name}"` } } }],
      subscription_data: { metadata: md },
      metadata: md,
      success_url: `${siteUrl}/dashboard?hosting=consolidated`,
      cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
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

  // ── Move a repo's CONTENT into another repo ────────────────────────────────────────
  // "Content" is the RepoFile rows: re-point them at the destination. Two things make this
  // more than an updateMany:
  //   • RepoFile has @@unique([serverRepoId, path]), so any path present on BOTH sides would
  //     abort the whole transaction. We refuse up-front and hand back the colliding paths
  //     rather than overwriting a file the user still has — this is their hosted data.
  //   • storageUsedBytes is denormalised on each repo, so both sides are recomputed, and the
  //     destination's quota is checked before anything moves.
  // The destination is dropped back to unverified/unpublished afterwards: its contents are
  // not what was reviewed any more.
  async function moveContentPlan(p, fromRepo, toId, user) {
    if (fromRepo.id === toId) return { err: 400, code: 'same_repo' };
    const dest = await ownRepoMutable(p, toId, user);
    if (dest.err) return { err: dest.err, code: dest.code || 'dest_not_found' };
    const to = dest.repo;
    if (to.ownerId !== fromRepo.ownerId) return { err: 403, code: 'different_owner' };
    const [srcFiles, dstPaths] = await Promise.all([
      p.repoFile.findMany({ where: { serverRepoId: fromRepo.id }, select: { id: true, path: true, size: true } }),
      p.repoFile.findMany({ where: { serverRepoId: toId }, select: { path: true } }),
    ]);
    const taken = new Set(dstPaths.map((f) => f.path));
    const collisions = srcFiles.filter((f) => taken.has(f.path)).map((f) => f.path);
    const bytes = srcFiles.reduce((n, f) => n + BigInt(f.size || 0), 0n);
    const quota = to.groupId ? null : to.storageQuotaBytes;
    const overQuota = quota != null && quota > 0n && BigInt(to.storageUsedBytes || 0) + bytes > quota;
    return { to, srcFiles, collisions, bytes, overQuota };
  }

  // Dry run: what WOULD move, and what stands in the way. The UI calls this before offering
  // the action so the user is never told "failed" after the fact.
  app.get('/me/repos/:id/move-content/preflight', { preHandler: requireRole() }, async (req, reply) => {
    const to = String(req.query?.to || '');
    if (!to) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
    const plan = await moveContentPlan(p, repo, to, req.user);
    if (plan.err) return reply.code(plan.err).send({ error: plan.code });
    return {
      files: plan.srcFiles.length, bytes: Number(plan.bytes),
      collisions: plan.collisions.slice(0, 50), collisionCount: plan.collisions.length,
      overQuota: plan.overQuota, destination: { id: plan.to.id, name: plan.to.name },
    };
  });

  app.post('/me/repos/:id/move-content', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ to: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err, code } = await ownRepoMutable(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: code || (err === 404 ? 'not_found' : 'forbidden') });
    const plan = await moveContentPlan(p, repo, b.data.to, req.user);
    if (plan.err) return reply.code(plan.err).send({ error: plan.code });
    if (plan.collisions.length) {
      return reply.code(409).send({ error: 'path_collision', collisions: plan.collisions.slice(0, 50), collisionCount: plan.collisions.length });
    }
    if (plan.overQuota) return reply.code(413).send({ error: 'quota_exceeded' });
    if (!plan.srcFiles.length) return { ok: true, moved: 0 };

    await p.$transaction([
      p.repoFile.updateMany({ where: { serverRepoId: repo.id }, data: { serverRepoId: plan.to.id } }),
      p.serverRepo.update({ where: { id: repo.id }, data: { storageUsedBytes: 0n, sha: null, published: false } }),
      p.serverRepo.update({
        where: { id: plan.to.id },
        data: { storageUsedBytes: BigInt(plan.to.storageUsedBytes || 0) + plan.bytes, verified: false, published: false },
      }),
    ]);
    return { ok: true, moved: plan.srcFiles.length, bytes: Number(plan.bytes) };
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
    const blocked = await repoUrlBlocked(p, b.data.repoUrl);
    if (blocked) return reply.code(409).send({ error: 'url_blocked', url: blocked.url, scope: blocked.rule.scope });
    // A repo name may not claim an endorsement. BMM writes every imported repo as
    // `community` whatever its feed says, so the badge cannot be stolen — but the badge sits
    // next to a name the submitter chose, and the name was never checked.
    const reserved = reservedTermIn(b.data.name);
    if (reserved) return reply.code(409).send({ error: 'reserved_name', term: reserved });
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
    // A rename must face the same check as the creation, or the rule is decorative.
    if (b.data.name && req.user.role === 'USER') {
      const reservedEdit = reservedTermIn(b.data.name);
      if (reservedEdit) return reply.code(409).send({ error: 'reserved_name', term: reservedEdit });
    }
    const urlChanged = b.data.repoUrl && b.data.repoUrl !== repo.repoUrl;
    // Only when it CHANGED: re-checking an unchanged url would lock the owner out of
    // editing a description on a repo blocked for something they have since fixed.
    if (urlChanged) {
      const blocked = await repoUrlBlocked(p, b.data.repoUrl);
      if (blocked) return reply.code(409).send({ error: 'url_blocked', url: blocked.url, scope: blocked.rule.scope });
    }
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

    // Skipping the grace window: destroy now instead of scheduling.
    //
    // Gated on typing the repo's exact name, not a boolean. A flag is something a UI can
    // set by accident and something a stray client can send by default; typing the name
    // cannot happen without meaning to, and it is the only confirmation proportionate to
    // an action with no undo — the 72h window IS the undo everywhere else.
    //
    // Compared after trimming only. Not case-insensitively: two repos differing in case
    // are two different repos, and this is the last checkpoint before the bytes go.
    const body = z.object({ immediate: z.boolean().optional(), confirm: z.string().max(200).optional() })
      .safeParse(req.body || {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (body.data.immediate) {
      if ((body.data.confirm || '').trim() !== repo.name) {
        return reply.code(400).send({ error: 'confirm_mismatch', detail: 'Type the repository name exactly to delete it immediately.' });
      }
      // Re-read WITH files: ownRepoMutable does not include them, and purgeRepo needs the
      // keys to delete the stored bytes. Without this the row would go and the objects
      // would stay, billed to nobody and reachable by no one.
      const full = await p.serverRepo.findUnique({ where: { id: repo.id }, include: { files: true } });
      if (!full) return reply.code(404).send({ error: 'not_found' });
      await purgeRepo(p, full);
      await logAudit(p, req.user.uid, 'repo.delete.immediate', `${repo.name} (${repo.id}) — grace window skipped by owner`);
      return { ok: true, deleted: true };
    }

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

  // The ed25519 public key a self-hosted repo server needs in order to verify the
  // attestations below. Public by design — it verifies, it cannot mint.
  app.get('/repo-identity/public-key', async () => ({
    publicKey: await attestationPublicKeyHex(),
    format: 'ed25519-hex',
    ttlSeconds: ATTESTATION_TTL_SECONDS,
  }));

  // Mint a short-lived signed statement of who the CALLER is, for them to present to a
  // self-hosted repo server whose owner has allow/ban lists keyed on accounts.
  //
  // Only ever issued for req.user — there is no lookup-by-id form, because that would let
  // any caller resolve someone else's linked Discord ids. A user learning their own linkage
  // discloses nothing they did not already know.
  app.get('/me/repo-identity', { preHandler: requireRole() }, async (req, reply) => {
    const uid = req.user?.uid;
    if (!uid) return reply.code(401).send({ error: 'unauthorized' });
    const p = await db();
    const idn = (await loadOwnerIdentities(p, [uid])).get(uid) || { creatorIds: [], discordIds: [] };
    const { token, expiresAt } = await mintAttestation({
      bcid: userBcId(uid),
      creatorIds: idn.creatorIds,
      discordIds: idn.discordIds,
    });
    // Sent as a header value by BMM; never logged, and never placed in a URL.
    return { token, expiresAt };
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
    return { repos: repos.map((r) => ({ ...ser(r), ownerId: r.ownerId, ownerBcId: userBcId(r.ownerId) })) };
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
    // sha is cleared too. The column means "content hash of the last VERIFIED content", and
    // leaving it after a rejection leaves a record asserting that content was checked when a
    // moderator has just decided it was not. Re-listing runs autoVerify, which recomputes it
    // — so this loses nothing except a claim that had stopped being true.
    await p.serverRepo.update({ where: { id: repo.id }, data: { verified: false, pendingReview: false, listed: false, sha: null } });
    await notify(p, repo.ownerId, 'repo_rejected', `Your repo "${repo.name}" was removed from the public list: ${reason.data.reason}`);
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
    // Suspending is a DECISION about somebody's content, not a field edit. This route wrote
    // the status with no reason, no duration, no record and no notice to the owner — and the
    // sanction path already does all four, so the only thing keeping the two apart was that
    // nothing closed this door. POST /admin/sanctions/content is that path.
    if (b.data.status === 'SUSPENDED') {
      return reply.code(409).send({ error: 'use_sanction', targetType: 'repo' });
    }
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
