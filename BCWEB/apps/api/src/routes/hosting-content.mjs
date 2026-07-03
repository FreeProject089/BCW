import { z } from 'zod';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { db, requireRole, slugify, notify, repoLog, isValidRepoManifest, getGlobalAccessPolicy, getUserAccessPolicy, matchAccountList } from '../lib.mjs';
import { presignPut, presignGet, getObject } from '../storage.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

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
    .then(() => { if (Math.random() < 0.02) return p.repoAccessEvent.deleteMany({ where: { serverRepoId: repoId, createdAt: { lt: new Date(Date.now() - 30 * 864e5) } } }); })
    .catch(() => { /* logging must never break serving */ });
}
// Resolve the connecting client's account identity from the X-Creator-ID header BMM
// sends on every repo request (fetch_repo_info + sync). No BMM-side secret/session is
// involved — it's the same creator id already used for the free-tier/telemetry link,
// looked up here against CreatorLink -> (optionally) DiscordLink.
async function resolveIdentity(p, req) {
  const creatorId = req.headers['x-creator-id'];
  if (!creatorId) return { creatorId: null, userId: null, discordId: null };
  const cid = String(creatorId).slice(0, 120);
  const link = await p.creatorLink.findUnique({ where: { creatorId: cid }, include: { user: { select: { discordLinks: { select: { discordId: true }, take: 1 } } } } });
  if (!link) return { creatorId: cid, userId: null, discordId: null };
  return { creatorId: cid, userId: link.userId, discordId: link.user.discordLinks[0]?.discordId || null };
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
function sandboxGate(repo, req, reply, policies, identity) {
  const s = repo.settings || {};
  const ip = clientIp(req);
  const key = req.query?.key;
  const { userId, discordId, creatorId } = identity;
  const bans = s.bans || { ips: [], keys: [], accounts: [] };
  const banned = policies.some((pol) => (pol.bannedIps || []).includes(ip) || (creatorId && (pol.bannedKeys || []).includes(creatorId)) || matchAccountList(pol.bannedAccounts, userId, discordId))
    || (bans.ips || []).includes(ip) || (key && (bans.keys || []).includes(key)) || matchAccountList(bans.accounts, userId, discordId);
  if (banned) { reply.code(403).send({ error: 'banned' }); return false; }
  const acc = s.access || {};
  const whitelistActive = policies.some((pol) => pol.whitelistOnly) || acc.whitelistEnabled;
  if (whitelistActive) {
    const ok = (acc.ips || []).includes(ip) || (key && (acc.keys || []).includes(key)) || matchAccountList(acc.accounts, userId, discordId)
      || policies.some((pol) => (pol.whitelistIps || []).includes(ip) || (creatorId && (pol.whitelistKeys || []).includes(creatorId)) || matchAccountList(pol.whitelistAccounts, userId, discordId));
    if (!ok) { reply.code(403).send({ error: 'not_whitelisted', accountLinked: !!userId }); return false; }
  }
  return true;
}
// Paces a byte stream to at most `kbps` kilobits/second (sandbox bandwidth shaping).
function throttle(kbps) {
  const bytesPerSec = Math.max(1, kbps * 128); // kbps*1000/8 ≈ kbps*128
  const slices = 20; const perSlice = Math.max(1, Math.floor(bytesPerSec / slices));
  return new Transform({
    transform(chunk, _enc, cb) {
      let off = 0;
      const pump = () => {
        if (off >= chunk.length) return cb();
        const end = Math.min(off + perSlice, chunk.length);
        this.push(chunk.subarray(off, end)); off = end;
        setTimeout(pump, 1000 / slices);
      };
      pump();
    },
  });
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
  const data = { published: false, pendingReview: false };
  if (path === 'repo.json') {
    // Parse + validate against the CURRENT format — an old/invalid manifest is stored
    // (so the owner can see it) but stays UNVERIFIED, so it won't be listed publicly.
    try { const { body } = await getObject(key); const txt = await streamText(body); const parsed = JSON.parse(txt); data.repoJson = parsed; data.sha = sha256(txt); data.verified = isValidRepoManifest(parsed); }
    catch { data.verified = false; }
  }
  await p.serverRepo.update({ where: { id: repo.id }, data });
  if (actor) await repoLog(p, repo.id, actor, 'upload', path);
  return { ok: true, verified: !!data.verified };
}

export async function removeRepoFile(p, repo, fid, actor) {
  const removed = repo.files.find((f) => f.id === fid);
  await p.repoFile.deleteMany({ where: { id: fid, serverRepoId: repo.id } });
  await recomputeUsage(p, repo.id);
  const data = { published: false };
  if (removed?.path === 'repo.json') { data.verified = false; data.repoJson = null; data.sha = null; }
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

  // Admin: download the WHOLE repo's content as a single zip (for review). Built in
  // memory (adm-zip), so guarded by a total-size cap to avoid OOM on huge repos.
  app.get('/admin/repos/:id/files/download-all', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id }, include: { files: true } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    if (!repo.files.length) return reply.code(404).send({ error: 'empty' });
    const total = repo.files.reduce((a, f) => a + Number(f.size), 0);
    if (total > 500 * 1024 * 1024) return reply.code(413).send({ error: 'too_large', detail: 'Repo exceeds 500 MB — download files individually.' });
    const zip = new AdmZip();
    for (const f of repo.files) {
      try { const { body } = await getObject(f.key); zip.addFile(f.path, await streamBuffer(body)); } catch { /* skip unreadable file */ }
    }
    reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename="${slugify(repo.name) || 'repo'}.zip"`);
    return reply.send(zip.toBuffer());
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
  app.get('/hosting/:owner/:repo/repo.json', async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { hostPath: `${req.params.owner}/${req.params.repo}` } });
    if (!repo || !repo.published || !repo.repoJson) return reply.code(404).send({ error: 'not_found' });
    const [globalPolicy, ownerPolicy, identity] = await Promise.all([getGlobalAccessPolicy(p), getUserAccessPolicy(p, repo.ownerId), resolveIdentity(p, req)]);
    if (!sandboxGate(repo, req, reply, [globalPolicy, ownerPolicy], identity)) return; // banned / not whitelisted
    logAccess(p, repo.id, req, 'repo.json', 'connect', identity); // consumer connected / imported the repo
    return reply.header('Content-Type', 'application/json').header('Cache-Control', 'public, max-age=60').send(repo.repoJson);
  });

  app.get('/hosting/:owner/:repo/files/*', async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { hostPath: `${req.params.owner}/${req.params.repo}` }, include: { files: true } });
    if (!repo || !repo.published) return reply.code(404).send({ error: 'not_found' });
    const [globalPolicy, ownerPolicy, identity] = await Promise.all([getGlobalAccessPolicy(p), getUserAccessPolicy(p, repo.ownerId), resolveIdentity(p, req)]);
    if (!sandboxGate(repo, req, reply, [globalPolicy, ownerPolicy], identity)) return; // banned / not whitelisted
    const file = repo.files.find((f) => f.path === req.params['*']);
    if (!file) return reply.code(404).send({ error: 'not_found' });
    logAccess(p, repo.id, req, file.path, 'download', identity); // consumer downloaded a file
    try {
      const { body } = await getObject(file.key);
      // Force a non-executable content type (never serve as HTML/JS).
      const ct = file.path.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      reply.header('Content-Type', ct).header('Content-Disposition', 'attachment');
      // Serve at the sandbox bandwidth cap — the owner cannot exceed it.
      const kbps = effKbps(repo);
      reply.header('X-Sandbox-Upload-Kbps', String(kbps));
      return reply.send(kbps > 0 ? body.pipe(throttle(kbps)) : body);
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
}

// Read a Node stream (S3 body) to a Buffer (binary-safe, for zipping).
async function streamBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  if (typeof stream.arrayBuffer === 'function') return Buffer.from(await stream.arrayBuffer());
  const chunks = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

// Read a Node stream (S3 body) to a string.
async function streamText(stream) {
  if (typeof stream.text === 'function') return stream.text();
  const chunks = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf-8');
}
