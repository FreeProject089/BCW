import { z } from 'zod';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import archiver from 'archiver';
import { db, requireRole, optionalAuth, slugify, notify, repoLog, isValidRepoManifest, getGlobalAccessPolicy, getUserAccessPolicy, matchAccountList, safeEqual } from '../lib/lib.mjs';
import { presignPut, presignGet, getObject } from '../lib/storage.mjs';
import { repoMeter } from '../lib/monitor.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Cap on the admin "download whole repo as one zip" review endpoint. The export streams
// (archiver) so it's not a memory limit — it just bounds how large a single archived
// download can get (transfer + how many S3 reads are opened at once). Tunable via env for
// an operator who wants to allow bigger review bundles; default 250 MB, past which an
// admin should fetch files individually.
const REPO_EXPORT_MAX_BYTES = Math.max(1, Number(process.env.REPO_EXPORT_MAX_MB) || 250) * 1024 * 1024;

// Uploading a folder legitimately fires many presign+register calls in a burst, so
// the file endpoints get their own generous bucket instead of sharing the global one
// (which made big uploads trip 429). Still capped, just high enough for real uploads.
const FILE_RL = { rateLimit: { max: 6000, timeWindow: '1 minute' } };

const fileSer = (f) => ({ ...f, size: Number(f.size) });
const norm = (p) => p.replace(/\\/g, '/').replace(/^\/+/, '').split('/').map((s) => s.replace(/[^a-zA-Z0-9._-]/g, '_')).join('/').slice(0, 200);

// ── Runtime sandbox enforcement (the serving side of the sandbox) ──
// The real client IP as observed by our trusted proxy (Caddy appends it last).
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip;
}
// Record a consumer access event (fire-and-forget; never blocks or fails the response).
// Opportunistically prunes events older than 30 days so the table stays bounded.
function logAccess(p, repoId, req, path, kind, identity) {
  const ip = clientIp(req);
  const accessKey = (req.query?.key && String(req.query.key).slice(0, 128)) || null;
  p.repoAccessEvent.create({ data: { serverRepoId: repoId, ip: String(ip || '').slice(0, 64), accessKey, userId: identity?.userId || null, discordId: identity?.discordId || null, path: String(path).slice(0, 220), kind } })
    .then(async () => {
      if (Math.random() >= 0.02) return;
      // Retention: 30 days AND at most 5000 rows per repo (oldest overwritten).
      await p.repoAccessEvent.deleteMany({ where: { serverRepoId: repoId, createdAt: { lt: new Date(Date.now() - 30 * 864e5) } } });
      const excess = await p.repoAccessEvent.findMany({ where: { serverRepoId: repoId }, orderBy: { createdAt: 'desc' }, skip: 5000, take: 1000, select: { id: true } });
      if (excess.length) await p.repoAccessEvent.deleteMany({ where: { id: { in: excess.map((e) => e.id) } } });
    })
    .catch(() => { /* logging must never break serving */ });
}
// Resolve the connecting client's account identity from the X-Creator-ID header BMM
// sends on every repo request (fetch_repo_info + sync). No BMM-side secret/session is
// involved — it's the same creator id already used for the free-tier/telemetry link,
// looked up here against CreatorLink -> (optionally) DiscordLink.
async function resolveIdentity(p, req) {
  const creatorId = req.headers['x-creator-id'] ? String(req.headers['x-creator-id']).slice(0, 120) : null;
  // BMM identifies itself with X-Creator-ID; a BROWSER has no such header — it has a session.
  // Resolve that too, so the very same whitelist/ban entries that gate a BMM download also
  // gate a download straight from the repo's web page. Without this a signed-in, whitelisted
  // member is indistinguishable from an anonymous visitor and gets refused. Routes must run
  // optionalAuth() for req.user to be populated (an unauthenticated call just stays anonymous).
  const sessionUid = req.user?.uid || null;
  if (!creatorId && !sessionUid) return { creatorId: null, userId: null, discordId: null };

  let userId = sessionUid, discordId = null;
  if (creatorId) {
    const link = await p.creatorLink.findUnique({ where: { creatorId }, include: { user: { select: { discordLinks: { select: { discordId: true }, take: 1 } } } } });
    // A linked creator id names the account; fall back to the session when it isn't linked.
    if (link) { userId = link.userId; discordId = link.user.discordLinks[0]?.discordId || null; }
  }
  if (userId && !discordId) {
    const dl = await p.discordLink.findFirst({ where: { userId }, select: { discordId: true } }).catch(() => null);
    discordId = dl?.discordId || null;
  }
  return { creatorId, userId, discordId };
}
// Effective bandwidth cap (kbps): the owner's requested value clamped to the hard cap.
function effKbps(repo) {
  const cap = repo.uploadLimitKbps || 0;
  const req = repo.settings?.requestedUploadKbps;
  if (req == null || req <= 0) return cap;
  return Math.min(req, cap);
}
// Enforce bans + whitelist across THREE layers, all additive: the site-wide
// GlobalAccessPolicy, the repo owner's own UserAccessPolicy (applies to every repo
// THAT owner hosts), and this repo's own settings.access/settings.bans. A ban in
// any layer blocks everywhere; a whitelist is active if ANY layer requires one, and
// satisfied if ANY layer allows it. Returns false (and sends 403) when denied.
//
// NOTE: the two policy layers' `*Keys` arrays are matched against the resolved
// X-Creator-ID (identity.creatorId) — labeled "Creator ID" in the UI — NOT the
// sandbox `?key=` query param, which only this repo's own settings.access/bans
// still use. BMM always sends its creator id automatically, so this is far more
// practically useful at the policy level than the manually-configured sandbox key.
// The verdict, with no side effects — the repo's web page has to ASK "could this visitor
// download?" to render the right button, which it can't do through a function whose only
// output is a 403. sandboxGate() below is this plus the response, so the page and the
// download can never disagree about who's allowed.
export function sandboxVerdict(repo, req, policies, identity) {
  const s = repo.settings || {};
  const ip = clientIp(req);
  const key = req.query?.key;
  const { userId, discordId, creatorId } = identity;
  const bans = s.bans || { ips: [], keys: [], accounts: [] };
  const banned = policies.some((pol) => (pol.bannedIps || []).includes(ip) || (creatorId && (pol.bannedKeys || []).includes(creatorId)) || matchAccountList(pol.bannedAccounts, userId, discordId))
    || (bans.ips || []).includes(ip) || (key && (bans.keys || []).includes(key)) || matchAccountList(bans.accounts, userId, discordId);
  if (banned) return { ok: false, reason: 'banned' };
  const acc = s.access || {};
  const whitelistActive = policies.some((pol) => pol.whitelistOnly) || acc.whitelistEnabled;
  if (whitelistActive) {
    const ok = (acc.ips || []).includes(ip) || (key && (acc.keys || []).includes(key)) || matchAccountList(acc.accounts, userId, discordId)
      || policies.some((pol) => (pol.whitelistIps || []).includes(ip) || (creatorId && (pol.whitelistKeys || []).includes(creatorId)) || matchAccountList(pol.whitelistAccounts, userId, discordId));
    if (!ok) return { ok: false, reason: 'not_whitelisted', accountLinked: !!userId };
  }
  return { ok: true };
}

function sandboxGate(repo, req, reply, policies, identity) {
  const v = sandboxVerdict(repo, req, policies, identity);
  if (v.ok) return true;
  if (v.reason === 'banned') reply.code(403).send({ error: 'banned' });
  else reply.code(403).send({ error: 'not_whitelisted', accountLinked: v.accountLinked });
  return false;
}
// Is any PER-REQUESTER restriction active on this repo (whitelist mode, or ban
// entries on the repo settings / global / owner policies)? If yes, responses must
// NOT be shared-cacheable — a CDN would serve the cached copy around sandboxGate
// (banned/non-whitelisted users getting the file). Open repos can cache freely.
function repoRestricted(repo, policies) {
  const s = repo.settings || {};
  const anyBans = (o) => ((o?.ips || []).length + (o?.keys || []).length + (o?.accounts || []).length) > 0;
  return !!(s.access?.whitelistEnabled || anyBans(s.bans)
    || policies.some((pol) => pol?.whitelistOnly
      || (pol?.bannedIps || []).length || (pol?.bannedKeys || []).length || (pol?.bannedAccounts || []).length));
}
// Paces a byte stream. `rate` is either a fixed kbps or a GETTER `() => kbps` that's
// re-read on every slice — so an in-flight download re-paces live as the smart governor
// (below) opens or closes the burst window. kbps <= 0 from the getter = full speed.
export function throttle(rate) {
  const getKbps = typeof rate === 'function' ? rate : () => rate;
  const slices = 20;
  return new Transform({
    transform(chunk, _enc, cb) {
      let off = 0;
      const pump = () => {
        if (off >= chunk.length) return cb();
        const kbps = getKbps();
        const perSlice = kbps > 0 ? Math.max(1, Math.floor((kbps * 128) / slices)) : chunk.length; // <=0 → flush the rest at once
        const end = Math.min(off + perSlice, chunk.length);
        this.push(chunk.subarray(off, end)); off = end;
        if (off >= chunk.length) return cb();
        setTimeout(pump, 1000 / slices);
      };
      pump();
    },
  });
}

// ── Smart, burstable bandwidth sharing ──
// A repo's upload cap is a FLOOR it's guaranteed, not a ceiling it's stuck at: when the
// server is quiet (few concurrent transfers) a repo may burst to cap × burstFactor —
// borrowing the idle capacity — and it tightens back to its plain cap as more transfers
// contend. So the server/repos share smartly: idle → everyone goes faster; busy → each
// repo is held to what it pays for. `hosting.burstFactor` / `hosting.burstUntilActive`
// are admin-tunable (0/1 disables bursting).
let activeTransfers = 0;
let _burst = { factor: 4, until: 3, at: 0 };
async function getBurst(p) {
  if (Date.now() - _burst.at < 30_000) return _burst;
  try {
    const rows = await p.adminSetting.findMany({ where: { key: { in: ['hosting.burstFactor', 'hosting.burstUntilActive'] } } });
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    _burst = { factor: Math.max(1, Number(m['hosting.burstFactor'] ?? 4)), until: Math.max(0, Number(m['hosting.burstUntilActive'] ?? 3)), at: Date.now() };
  } catch { _burst.at = Date.now(); }
  return _burst;
}

async function ownHosted(p, id, user) {
  const repo = await p.serverRepo.findUnique({ where: { id }, include: { files: true } });
  if (!repo) return { err: 404 };
  if (!repo.hosted) return { err: 400, msg: 'not_hosted' };
  if (repo.ownerId !== user.uid && user.role === 'USER') return { err: 403 };
  return { repo };
}
// A readable audit-log actor label for a logged-in user (owner card actions).
async function actorLabel(p, user) {
  if (!user) return 'unknown';
  if (user.role === 'ADMIN' || user.role === 'MOD' || user.role === 'SUPERADMIN') return 'admin';
  const u = await p.user.findUnique({ where: { id: user.uid }, select: { displayName: true } });
  return u?.displayName || 'owner';
}
async function recomputeUsage(p, repoId) {
  const agg = await p.repoFile.aggregate({ where: { serverRepoId: repoId }, _sum: { size: true } });
  const used = agg._sum.size || 0n;
  await p.serverRepo.update({ where: { id: repoId }, data: { storageUsedBytes: used } });
  return used;
}
// Pick a free public hostPath — the URL is managed for the owner. "<owner>/<repo>" is
// tried first; on collision a numeric suffix is appended so two repos never clash.
async function freeHostPath(p, base, repoId) {
  let hp = base; let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await p.serverRepo.findUnique({ where: { hostPath: hp }, select: { id: true } });
    if (!clash || clash.id === repoId) return hp;
    hp = `${base}-${++n}`;
  }
}

// ── Shared file/publish operations — the single source of truth used by the owner
// routes below AND the dedicated dashboard routes (repo-dashboard.mjs), so the two
// access surfaces can never drift. Each throws RepoOpError on a client error; the
// caller maps { code, http, extra } to an HTTP response. `repo` must include `files`.
export class RepoOpError extends Error {
  constructor(code, http = 400, extra) { super(code); this.code = code; this.http = http; this.extra = extra; }
}

export async function presignRepoFile(p, repo, { path: rawPath, size, contentType = 'application/octet-stream' }) {
  const path = norm(rawPath);
  const existing = repo.files.find((f) => f.path === path);
  const used = repo.files.reduce((a, f) => a + Number(f.size), 0) - (existing ? Number(existing.size) : 0);
  if (BigInt(used + size) > repo.storageQuotaBytes) throw new RepoOpError('quota_exceeded', 413, { quota: Number(repo.storageQuotaBytes), used });
  const key = `hosting/${repo.id}/${path}`;
  const url = await presignPut(key, contentType);
  return { key, url, path, expiresIn: 600 };
}

export async function registerRepoFile(p, repo, { path: rawPath, key, size, contentType = 'application/octet-stream', sha256: fileSha }, actor) {
  const path = norm(rawPath);
  await p.repoFile.upsert({
    where: { serverRepoId_path: { serverRepoId: repo.id, path } },
    create: { serverRepoId: repo.id, path, key, size: BigInt(size), contentType, sha256: fileSha || null },
    update: { key, size: BigInt(size), contentType, sha256: fileSha || null },
  });
  await recomputeUsage(p, repo.id);
  // Content changed → must be re-published to be served again. The manifest is
  // auto-hashed + auto-verified: a valid repo.json → verified, else not.
  const data = { published: false };
  // A LISTED repo's content change must be RE-REVIEWED before it re-appears in the
  // public list (external repos do the same in /push) — otherwise a verified listing
  // could be silently swapped. Notify mods once, on the transition into review, so a
  // multi-file upload (one call per file) doesn't spam them.
  if (repo.listed) {
    data.pendingReview = true;
    if (!repo.pendingReview) {
      const mods = await p.user.findMany({ where: { role: { in: ['MOD', 'ADMIN', 'SUPERADMIN'] } }, select: { id: true } });
      await Promise.all(mods.map((m) => notify(p, m.id, 'repo_review', `"${repo.name}" changed its hosted content and is back in the review queue.`).catch(() => {})));
    }
  } else {
    data.pendingReview = false;
  }
  if (isManifestPath(path)) {
    // Parse + validate against the CURRENT format — an old/invalid manifest is stored
    // (so the owner can see it) but stays UNVERIFIED, so it won't be listed publicly.
    try { const { body } = await getObject(key); const txt = await streamText(body); const parsed = JSON.parse(txt); data.repoJson = parsed; data.sha = sha256(txt); data.verified = isValidRepoManifest(parsed); }
    catch { data.verified = false; }
  }
  await p.serverRepo.update({ where: { id: repo.id }, data });
  if (actor) await repoLog(p, repo.id, actor, 'upload', path);
  return { ok: true, verified: !!data.verified };
}

// A repo's manifest may be named either way. `repo.json` is the original name and stays
// the one we advertise; `manifest.json` is accepted because it is what most people reach
// for, and being told "upload repo.json" after uploading a perfectly good manifest.json
// is a dead end with no error to explain it. Both parse identically — this is a filename
// alias, not a second format.
export const MANIFEST_NAMES = ['repo.json', 'manifest.json'];
export const isManifestPath = (path) => MANIFEST_NAMES.includes(String(path || '').trim());

export async function removeRepoFile(p, repo, fid, actor) {
  const removed = repo.files.find((f) => f.id === fid);
  await p.repoFile.deleteMany({ where: { id: fid, serverRepoId: repo.id } });
  await recomputeUsage(p, repo.id);
  const data = { published: false };
  if (isManifestPath(removed?.path)) { data.verified = false; data.repoJson = null; data.sha = null; }
  await p.serverRepo.update({ where: { id: repo.id }, data });
  if (actor) await repoLog(p, repo.id, actor, 'delete', removed?.path || fid);
  return { ok: true };
}

export async function publishRepo(p, repo, actor) {
  if (!repo.repoJson) throw new RepoOpError('no_repo_json', 400);
  if (!isValidRepoManifest(repo.repoJson)) throw new RepoOpError('invalid_manifest', 400); // old/invalid format
  const owner = await p.user.findUnique({ where: { id: repo.ownerId }, select: { displayName: true } });
  const base = `${slugify(owner?.displayName || 'user')}/${slugify(repo.name)}`;
  const hostPath = await freeHostPath(p, base, repo.id);
  await p.serverRepo.update({ where: { id: repo.id }, data: { published: true, status: 'ONLINE', hostPath } });
  await notify(p, repo.ownerId, 'repo_published', `Your hosted repo "${repo.name}" is online at /hosting/${hostPath}/repo.json`);
  if (actor) await repoLog(p, repo.id, actor, 'publish', hostPath);
  return { ok: true, published: true, status: 'ONLINE', hostPath, url: `/hosting/${hostPath}/repo.json` };
}

export async function unpublishRepo(p, repo, actor) {
  await p.serverRepo.update({ where: { id: repo.id }, data: { published: false, status: 'OFFLINE' } });
  if (actor) await repoLog(p, repo.id, actor, 'unpublish', '');
  return { ok: true, published: false, status: 'OFFLINE' };
}

export default async function hostingContentRoutes(app) {
  // Pre-signed upload for a hosted repo file — refused if it would exceed the quota.
  app.post('/repos/:id/files/presign', { preHandler: requireRole(), config: FILE_RL }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1).max(220), size: z.number().int().positive(), contentType: z.string().max(120).default('application/octet-stream') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err, msg } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: msg || (err === 404 ? 'not_found' : 'forbidden') });
    try { return await presignRepoFile(p, repo, b.data); }
    catch (e) { return reply.code(e.http || 400).send({ error: e.code || 'failed', ...(e.extra || {}) }); }
  });

  // Register an uploaded file (after the PUT). Parses repo.json into the manifest.
  app.post('/repos/:id/files', { preHandler: requireRole(), config: FILE_RL }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1).max(220), key: z.string().max(300), size: z.number().int().nonnegative(), contentType: z.string().max(120).default('application/octet-stream'), sha256: z.string().max(80).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { repo, err, msg } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: msg || (err === 404 ? 'not_found' : 'forbidden') });
    return await registerRepoFile(p, repo, b.data, await actorLabel(p, req.user));
  });

  app.get('/repos/:id/files', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: 'not_found' });
    return {
      files: repo.files.map(fileSer),
      used: repo.files.reduce((a, f) => a + Number(f.size), 0), quota: Number(repo.storageQuotaBytes),
      // Everything the file manager needs to show the public URL + online state.
      name: repo.name, hosted: repo.hosted, published: repo.published, status: repo.status,
      verified: repo.verified, hostPath: repo.hostPath, sha: repo.sha, repoJson: repo.repoJson,
    };
  });

  // ── Owner: publish (go online) / take offline a hosted repo ──
  // The public URL is auto-managed (owner/repo slug). A valid uploaded repo.json is
  // required — files are served as bytes only, never executed.
  app.post('/repos/:id/publish', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err, msg } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: msg || (err === 404 ? 'not_found' : 'forbidden') });
    try { return await publishRepo(p, repo, await actorLabel(p, req.user)); }
    catch (e) { return reply.code(e.http || 400).send({ error: e.code || 'failed' }); }
  });

  app.post('/repos/:id/unpublish', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const { repo, err, msg } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: msg || (err === 404 ? 'not_found' : 'forbidden') });
    return await unpublishRepo(p, repo, await actorLabel(p, req.user));
  });

  app.delete('/repos/:id/files/:fid', { preHandler: requireRole(), config: FILE_RL }, async (req, reply) => {
    const p = await db();
    const { repo, err } = await ownHosted(p, req.params.id, req.user);
    if (err) return reply.code(err).send({ error: 'not_found' });
    return await removeRepoFile(p, repo, req.params.fid, await actorLabel(p, req.user));
  });

  // ── Admin review: inspect + download any hosted repo's content ──
  app.get('/admin/repos/:id/files', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id }, include: { files: true, owner: { select: { displayName: true, email: true } } } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    return {
      repo: { id: repo.id, name: repo.name, owner: repo.owner, published: repo.published, hostPath: repo.hostPath, verified: repo.verified, sha: repo.sha },
      files: repo.files.map(fileSer), repoJson: repo.repoJson,
      used: repo.files.reduce((a, f) => a + Number(f.size), 0), quota: Number(repo.storageQuotaBytes),
    };
  });
  app.get('/admin/repos/:id/files/:fid/download', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const file = await p.repoFile.findFirst({ where: { id: req.params.fid, serverRepoId: req.params.id } });
    if (!file) return reply.code(404).send({ error: 'not_found' });
    return { url: await presignGet(file.key), path: file.path, size: Number(file.size) };
  });

  // Admin: download the WHOLE repo's content as a single zip (for review). Streamed
  // (archiver), so memory stays bounded; a total-size cap still bounds the transfer.
  app.get('/admin/repos/:id/files/download-all', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id }, include: { files: true } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    if (!repo.files.length) return reply.code(404).send({ error: 'empty' });
    const total = repo.files.reduce((a, f) => a + Number(f.size), 0);
    if (total > REPO_EXPORT_MAX_BYTES) return reply.code(413).send({ error: 'too_large', detail: `Repo exceeds ${Math.round(REPO_EXPORT_MAX_BYTES / (1024 * 1024))} MB — download files individually.` });
    reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename="${slugify(repo.name) || 'repo'}.zip"`);
    // Stream the archive: append each file's S3 READ STREAM (not its buffered bytes) so peak
    // memory stays bounded to the in-flight chunks instead of the whole repo (up to 500 MB,
    // which could OOM the single-container VPS). archiver compresses + emits incrementally.
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', () => { try { reply.raw.destroy(); } catch { /* already closed */ } });
    for (const f of repo.files) {
      try { const { body } = await getObject(f.key); archive.append(body, { name: f.path }); } catch { /* skip unreadable file */ }
    }
    archive.finalize();
    return reply.send(archive);
  });

  // ── Admin review ──
  app.post('/admin/repos/:id/publish', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id }, include: { owner: { select: { displayName: true } } } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    if (!repo.repoJson) return reply.code(400).send({ error: 'no_repo_json' });
    const hostPath = `${slugify(repo.owner.displayName)}/${slugify(repo.name)}`;
    await p.serverRepo.update({ where: { id: repo.id }, data: { published: true, pendingReview: false, hostPath, status: 'ONLINE' } });
    await notify(p, repo.ownerId, 'repo_published', `Your hosted repo "${repo.name}" is live at /hosting/${hostPath}/repo.json`);
    return { ok: true, hostPath };
  });

  app.post('/admin/repos/:id/unpublish', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    await p.serverRepo.update({ where: { id: req.params.id }, data: { published: false } }).catch(() => {});
    return { ok: true };
  });

  // ── Public serving (validated content only; bytes only, never executed) ──
  // Enforces the repo's sandbox at request time: bans, whitelist, bandwidth cap.
  // Public: what's INSIDE a repo, for its web page — so a visitor can see the mods/profiles
  // and pull one straight from the browser instead of having to install BMM first.
  //
  // Access is decided by the SAME sandboxVerdict the actual download runs, so the page can
  // never offer a button that then 403s. An open repo (no whitelist, no bans anywhere) is
  // downloadable by anyone, signed in or not — that's the common case and it stays one click.
  // The moment ANY restriction applies, identity is required: a signed-out visitor gets
  // `login_required` (sign in, and their account/Discord is matched against the lists), and
  // the contents are withheld rather than leaked — repo.json is gated the same way.
  app.get('/r/:id/contents', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({
      where: { id: req.params.id },
      include: { files: { orderBy: { path: 'asc' } } },
    });
    if (!repo) return reply.code(404).send({ error: 'not_found' });

    // Visibility mirrors GET /r/:id exactly: listed+verified, or the share link, or owner/staff.
    const publicListed = repo.listed && repo.verified && !repo.pendingReview;
    // Constant-time, like the shareKeyOk() guarding GET /r/:id. A plain `===` short-circuits on
    // the first wrong byte, so this endpoint would have handed an attacker a timing oracle to
    // recover a repo's share key one byte at a time — and defeated the protection on the other
    // route, since both gate the SAME secret.
    const viaKey = !!(req.query?.k && repo.shareKey && safeEqual(req.query.k, repo.shareKey));
    const isOwner = req.user?.uid === repo.ownerId || ['ADMIN', 'SUPERADMIN'].includes(req.user?.role);
    if (!publicListed && !viaKey && !isOwner) return reply.code(404).send({ error: 'not_found' });

    const signedIn = !!req.user?.uid;
    const origin = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
    // Only OUR hosted, published repos have files we can serve; an externally-hosted repo
    // just points elsewhere, so there's nothing here to list or download.
    if (!repo.hosted || !repo.published || !repo.hostPath) {
      return { files: [], total: { count: 0, bytes: 0 }, access: { restricted: false, canDownload: false, reason: 'not_hosted', signedIn } };
    }

    const [globalPolicy, ownerPolicy, identity] = await Promise.all([
      getGlobalAccessPolicy(p), getUserAccessPolicy(p, repo.ownerId), resolveIdentity(p, req),
    ]);
    const restricted = repoRestricted(repo, [globalPolicy, ownerPolicy]);
    const verdict = sandboxVerdict(repo, req, [globalPolicy, ownerPolicy], identity);
    // The owner and staff always see their own contents, whatever the lists say.
    const allowed = verdict.ok || isOwner;

    if (!allowed) {
      if (verdict.reason === 'banned') return reply.code(403).send({ error: 'banned' });
      // Not whitelisted. Signing in is only a plausible fix when they haven't yet.
      return reply.header('Cache-Control', 'private, no-store').send({
        files: [], total: { count: 0, bytes: 0 },
        access: { restricted: true, canDownload: false, reason: signedIn ? 'not_whitelisted' : 'login_required', signedIn },
      });
    }

    const files = repo.files.map((f) => ({
      path: f.path,
      size: Number(f.size),
      contentType: f.contentType,
      sha256: f.sha256 || null,
      // Same URL BMM pulls: one gate, one code path, one set of bandwidth caps + counters.
      url: `${origin}/hosting/${repo.hostPath}/files/${f.path.split('/').map(encodeURIComponent).join('/')}`,
    }));
    // A restricted repo's listing is per-requester — never let a shared cache serve it on.
    reply.header('Cache-Control', restricted ? 'private, no-store' : 'public, max-age=60');
    return {
      files,
      total: { count: files.length, bytes: files.reduce((a, f) => a + f.size, 0) },
      access: { restricted, canDownload: true, reason: null, signedIn },
    };
  });

  // The manifest is served under BOTH names. Uploading `manifest.json` already works
  // (the parsed document is stored on the repo row, whichever filename it arrived as),
  // but a consumer that asks for the name it uploaded would have hit a 404 — the alias
  // exists so the two spellings are symmetric end to end, not just on the way in.
  // `repo.json` stays the canonical URL: it is what publish reports and what BMM asks for.

// ── nginx-format directory index ─────────────────────────────────────────────
// BMM already knows how to walk a plain HTTP file server: "Update from server" parses an
// nginx autoindex and uses the size and date on each row to skip re-hashing files that
// have not changed. Hosted repos could not be consumed that way — the only listing we
// offered was a JSON manifest — so a BCWEB-hosted repo was a second-class citizen next to
// somebody's own nginx.
//
// The FORMAT is the contract, and it is exact (src-tauri/src/commands/repo_autoindex.rs):
//
//   * one entry per LINE — the parser takes everything between </a> and the newline as
//     that row's metadata, so two entries on one line merge into nonsense;
//   * the href is a SINGLE path segment — anything containing "/" is skipped, and
//     directories end with "/";
//   * the size is the LAST bare integer on the line. A directory must therefore show
//     something that is not a number ("-"), or it would be read as a file of that size;
//   * the date is `dd-Mon-yyyy HH:MM` in UTC with an English month. Anything else parses
//     as "unknown", which is safe but forces a full re-hash — the very cost this exists
//     to avoid.
//
// Sizes are exact byte counts on purpose: a human-readable "1.2K" compared against an
// exact length marks every file as changed, which is worse than offering no size at all.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function nginxDate(d) {
  const t = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

/// Immediate children of `prefix` ('' = root), collapsed out of the flat file list.
function indexEntries(files, prefix) {
  const dirs = new Map();   // name -> newest mtime among its descendants
  const out = [];
  for (const f of files) {
    if (prefix && !f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      out.push({ name: rest, isDir: false, size: Number(f.size || 0), mtime: f.updatedAt || f.createdAt });
    } else {
      // A directory has no date of its own; the newest thing inside it is the honest
      // answer, and it is what a real filesystem would report.
      const name = rest.slice(0, slash);
      const cur = dirs.get(name);
      const m = f.updatedAt || f.createdAt;
      if (!cur || new Date(m) > new Date(cur)) dirs.set(name, m);
    }
  }
  for (const [name, mtime] of dirs) out.push({ name, isDir: true, size: null, mtime });
  // Directories first, then files, each case-insensitively — the order a directory index
  // is normally read in.
  out.sort((a, b) => (b.isDir - a.isDir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}

const htmlEscape = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderAutoindex(displayPath, entries) {
  const rows = [
    `<html><head><title>Index of ${htmlEscape(displayPath)}</title></head><body>`,
    `<h1>Index of ${htmlEscape(displayPath)}</h1><hr><pre><a href="../">../</a>`,
  ];
  for (const e of entries) {
    const link = e.isDir ? `${e.name}/` : e.name;
    // Percent-encode the href (names may contain spaces) but show the readable name.
    const href = encodeURIComponent(link).replace(/%2F/g, '/');
    const pad = ' '.repeat(Math.max(1, 52 - link.length));
    const size = e.isDir ? '-' : String(e.size);
    rows.push(`<a href="${href}">${htmlEscape(link)}</a>${pad}${nginxDate(e.mtime)} ${size.padStart(19)}`);
  }
  rows.push('</pre><hr></body></html>');
  return rows.join('\n');
}

  const serveManifest = async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { hostPath: `${req.params.owner}/${req.params.repo}` } });
    if (!repo || !repo.published || !repo.repoJson) return reply.code(404).send({ error: 'not_found' });
    const [globalPolicy, ownerPolicy, identity] = await Promise.all([getGlobalAccessPolicy(p), getUserAccessPolicy(p, repo.ownerId), resolveIdentity(p, req)]);
    if (!sandboxGate(repo, req, reply, [globalPolicy, ownerPolicy], identity)) return; // banned / not whitelisted
    logAccess(p, repo.id, req, 'repo.json', 'connect', identity); // consumer connected / imported the repo
    // no-store when restricted — a shared cache must never serve around the gate.
    const cc = repoRestricted(repo, [globalPolicy, ownerPolicy]) ? 'private, no-store' : 'public, max-age=60';
    return reply.header('Content-Type', 'application/json').header('Cache-Control', cc).send(repo.repoJson);
  };
  app.get('/hosting/:owner/:repo/repo.json', { preHandler: optionalAuth() }, serveManifest);
  app.get('/hosting/:owner/:repo/manifest.json', { preHandler: optionalAuth() }, serveManifest);

  // optionalAuth so a browser's session counts as identity here too (see resolveIdentity):
  // BMM sends no cookie and stays anonymous, so its behaviour is unchanged.
  app.get('/hosting/:owner/:repo/files/*', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { hostPath: `${req.params.owner}/${req.params.repo}` }, include: { files: true } });
    if (!repo || !repo.published) return reply.code(404).send({ error: 'not_found' });
    const [globalPolicy, ownerPolicy, identity] = await Promise.all([getGlobalAccessPolicy(p), getUserAccessPolicy(p, repo.ownerId), resolveIdentity(p, req)]);
    if (!sandboxGate(repo, req, reply, [globalPolicy, ownerPolicy], identity)) return; // banned / not whitelisted
    // A directory path lists; a file path downloads. The empty path and anything ending
    // in "/" are directories by definition; a bare name that matches no file but does
    // prefix some is one too, and gets nginx's own 301 to the trailing-slash form so the
    // relative hrefs in the listing resolve against the right base.
    const rel = req.params['*'] || '';
    const file = repo.files.find((f) => f.path === rel);
    if (!file) {
      const prefix = rel === '' || rel.endsWith('/') ? rel : `${rel}/`;
      const isDir = rel === '' || repo.files.some((f) => f.path.startsWith(prefix));
      if (!isDir) return reply.code(404).send({ error: 'not_found' });
      if (rel !== '' && !rel.endsWith('/')) {
        return reply.redirect(301, `/hosting/${repo.hostPath}/files/${rel}/`);
      }
      const entries = indexEntries(repo.files, prefix);
      const body = renderAutoindex(`/hosting/${repo.hostPath}/files/${prefix}`, entries);
      logAccess(p, repo.id, req, prefix || '/', 'connect', identity); // walked the listing
      const ccIdx = repoRestricted(repo, [globalPolicy, ownerPolicy]) ? 'private, no-store' : 'public, max-age=60';
      return reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', ccIdx).send(body);
    }
    logAccess(p, repo.id, req, file.path, 'download', identity); // consumer downloaded a file
    try {
      const { body } = await getObject(file.key);
      // Force a non-executable content type (never serve as HTML/JS).
      const ct = file.path.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      // CDN/browser caching — ONLY when the repo is truly open to everyone. If ANY
      // per-requester restriction is in play (whitelist mode, or ban entries on the
      // repo/global/owner policies), a shared cache would serve the file around the
      // sandbox gate (banned/non-whitelisted users getting the cached copy), so those
      // responses are marked no-store. Open repos get 5 min + an ETag (sha256):
      // hosted mod files change rarely, and a re-upload propagates within the window.
      const restricted = repoRestricted(repo, [globalPolicy, ownerPolicy]);
      reply.header('Content-Type', ct).header('Content-Disposition', 'attachment')
        .header('Cache-Control', restricted ? 'private, no-store' : 'public, max-age=300');
      if (!restricted && file.sha256) reply.header('ETag', `"${file.sha256}"`);
      const cap = effKbps(repo);
      // Meter bytes as they flow to the client → live per-repo upload rate on the
      // Server-perf dashboard (0 when idle, the real kbit/s while serving).
      if (cap <= 0) return reply.send(body.pipe(repoMeter(repo.id))); // uncapped repo → full speed, no governor
      // Smart sharing: burst above the cap while the server is quiet, tighten under load.
      const burst = await getBurst(p);
      activeTransfers++;
      let closed = false;
      const done = () => { if (!closed) { closed = true; activeTransfers = Math.max(0, activeTransfers - 1); } };
      reply.raw.on('close', done); reply.raw.on('finish', done);
      const getKbps = () => (activeTransfers <= burst.until ? Math.round(cap * burst.factor) : cap);
      reply.header('X-Sandbox-Upload-Kbps', String(cap));
      reply.header('X-Sandbox-Burst', String(activeTransfers <= burst.until ? burst.factor : 1));
      return reply.send(body.pipe(throttle(getKbps)).pipe(repoMeter(repo.id)));
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
}

// Read a Node stream (S3 body) to a string.
async function streamText(stream) {
  if (typeof stream.text === 'function') return stream.text();
  const chunks = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf-8');
}
