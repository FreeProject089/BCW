import { z } from 'zod';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import AdmZip from 'adm-zip';
import { db, repoLog, notify, accountEntrySchema } from '../lib.mjs';
import { effUpload, DEFAULT_SETTINGS } from './repos.mjs';
import { presignRepoFile, registerRepoFile, removeRepoFile, publishRepo, unpublishRepo } from './hosting-content.mjs';
import { getObject } from '../storage.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

// Same sandbox-settings shape the owner card uses (clamped to hard caps on save).
const settingsSchema = z.object({
  access: z.object({ whitelistEnabled: z.boolean(), ips: z.array(z.string().max(64)).max(2000), keys: z.array(z.string().max(128)).max(2000), accounts: z.array(accountEntrySchema).max(2000) }).partial(),
  bans: z.object({ ips: z.array(z.string().max(64)).max(10000), keys: z.array(z.string().max(128)).max(10000), accounts: z.array(accountEntrySchema).max(10000) }).partial(),
  requestedUploadKbps: z.number().int().min(0).max(10_000_000).nullable(),
}).partial();

const fileSer = (f) => ({ ...f, size: Number(f.size) });

// Resolve the caller's access to a repo → 'owner' | 'collab' | 'password' | null.
//  owner    = the owner, or an ADMIN/MOD (logged in)
//  collab   = a logged-in user whose email is in accessEmails
//  password = a valid per-repo unlock cookie (login-less)
async function accessLevel(req, p, repo) {
  let claims = null; try { claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET); } catch { /* not logged in */ }
  if (claims?.uid) {
    const u = await p.user.findUnique({ where: { id: claims.uid }, select: { email: true, displayName: true } });
    if (repo.ownerId === claims.uid || claims.role === 'ADMIN' || claims.role === 'MOD' || claims.role === 'SUPERADMIN') {
      const asAdmin = repo.ownerId !== claims.uid;
      return { level: 'owner', uid: claims.uid, actor: `${u?.displayName || 'owner'}${asAdmin ? ' (admin)' : ''}` };
    }
    const emails = (repo.accessEmails || []).map((e) => e.toLowerCase());
    if (u?.email && emails.includes(u.email.toLowerCase())) return { level: 'collab', uid: claims.uid, actor: u.email };
  }
  const tk = req.cookies?.[`bcw_rd_${repo.id}`];
  if (tk) { try { const t = jwt.verify(tk, JWT_SECRET); if (t.rid === repo.id && t.scope === 'rd') return { level: 'password', actor: 'password access' }; } catch { /* bad/expired token */ } }
  return { level: null };
}

// preHandler factory: load the repo (+files), gate on access, stash on req.
function resolve(opts = {}) {
  return async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id }, include: { files: true, owner: { select: { id: true, displayName: true } } } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    const { level, uid, actor } = await accessLevel(req, p, repo);
    if (!level) return reply.code(401).send({ error: repo.dashPassword ? 'password_required' : 'auth_required', name: repo.name });
    if (opts.ownerOnly && level !== 'owner') return reply.code(403).send({ error: 'owner_only' });
    req._p = p; req.repo = repo; req.level = level; req.uid = uid; req.actor = actor;
  };
}

// Dedicated per-repo dashboard: a login-optional management surface gated by owner /
// authorized-email / dashboard-password. Reuses the same shared file/publish ops as the
// owner card, so behaviour (quota, auto-SHA, auto-verify, auto hostPath) is identical.
export default async function repoDashboardRoutes(app) {
  // ── Login-less unlock (dashboard password) — rate-limited + argon2 (slow) ──
  app.post('/repos/:id/dashboard/unlock', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id }, select: { id: true, dashPassword: true } });
    if (!repo || !repo.dashPassword) return reply.code(404).send({ error: 'not_found' });
    const ok = await argon2.verify(repo.dashPassword, b.data.password).catch(() => false);
    if (!ok) return reply.code(401).send({ error: 'invalid_password' });
    const token = jwt.sign({ rid: repo.id, scope: 'rd' }, JWT_SECRET, { expiresIn: '12h' });
    reply.setCookie(`bcw_rd_${repo.id}`, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600 });
    return { ok: true };
  });

  app.post('/repos/:id/dashboard/lock', async (req, reply) => {
    reply.clearCookie(`bcw_rd_${req.params.id}`, { path: '/' });
    return { ok: true };
  });

  // ── Full dashboard payload (any access level) ──
  app.get('/repos/:id/dashboard', { preHandler: resolve() }, async (req) => {
    const r = req.repo;
    const favoriteCount = await req._p.repoFavorite.count({ where: { serverRepoId: r.id } });
    return {
      id: r.id, name: r.name, description: r.description, hosted: r.hosted, status: r.status,
      published: r.published, listed: r.listed, verified: r.verified, hostPath: r.hostPath,
      repoUrl: r.repoUrl, links: r.links, tags: r.tags, sha: r.sha, repoJson: r.repoJson,
      ownerName: r.owner?.displayName || null, favoriteCount,
      storageUsedBytes: Number(r.storageUsedBytes), storageQuotaBytes: Number(r.storageQuotaBytes),
      uploadLimitKbps: r.uploadLimitKbps, effectiveUploadKbps: effUpload(r), cpuShare: r.cpuShare,
      settings: r.settings || DEFAULT_SETTINGS,
      files: r.files.map(fileSer), used: r.files.reduce((a, f) => a + Number(f.size), 0),
      level: req.level,
      // Access config is owner-only (never expose collaborators' emails or the password).
      access: req.level === 'owner' ? { emails: r.accessEmails || [], hasPassword: !!r.dashPassword } : undefined,
    };
  });

  // ── File ops (owner / collab / password) — hosted repos only ──
  app.post('/repos/:id/dashboard/files/presign', { preHandler: resolve(), config: { rateLimit: { max: 6000, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1).max(220), size: z.number().int().positive(), contentType: z.string().max(120).default('application/octet-stream') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!req.repo.hosted) return reply.code(400).send({ error: 'not_hosted' });
    try { return await presignRepoFile(req._p, req.repo, b.data); }
    catch (e) { return reply.code(e.http || 400).send({ error: e.code || 'failed', ...(e.extra || {}) }); }
  });

  app.post('/repos/:id/dashboard/files', { preHandler: resolve(), config: { rateLimit: { max: 6000, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1).max(220), key: z.string().max(300), size: z.number().int().nonnegative(), contentType: z.string().max(120).default('application/octet-stream'), sha256: z.string().max(80).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!req.repo.hosted) return reply.code(400).send({ error: 'not_hosted' });
    return await registerRepoFile(req._p, req.repo, b.data, req.actor);
  });

  app.delete('/repos/:id/dashboard/files/:fid', { preHandler: resolve(), config: { rateLimit: { max: 6000, timeWindow: '1 minute' } } }, async (req) => {
    return await removeRepoFile(req._p, req.repo, req.params.fid, req.actor);
  });

  // Bundle a selection of files (or the whole repo, if no ids given) into a single
  // .zip, preserving their relative paths — same access level as everything else
  // here (owner/collab/password), so this works for private, unpublished repos too
  // (the public repo.json download link only ever covers PUBLISHED repos).
  app.post('/repos/:id/dashboard/files/download-zip', { preHandler: resolve(), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = z.object({ ids: z.array(z.string()).max(2000).optional() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const wanted = b.data.ids?.length ? new Set(b.data.ids) : null;
    const files = req.repo.files.filter((f) => !wanted || wanted.has(f.id));
    if (!files.length) return reply.code(400).send({ error: 'no_files' });
    const totalBytes = files.reduce((a, f) => a + Number(f.size || 0), 0);
    if (totalBytes > 2 * 1024 ** 3) return reply.code(413).send({ error: 'selection_too_large', detail: 'Zip downloads are limited to 2 GB per request — select fewer files.' });
    const zip = new AdmZip();
    for (const f of files) {
      try {
        const { body } = await getObject(f.key);
        const chunks = []; for await (const c of body) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
        zip.addFile(f.path, Buffer.concat(chunks));
      } catch (e) { req.log?.warn?.({ path: f.path, e: String(e?.message || e) }, 'zip: failed to fetch file, skipping'); }
    }
    const buf = zip.toBuffer();
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${req.repo.name.replace(/[^a-zA-Z0-9._-]/g, '_')}.zip"`);
    return reply.send(buf);
  });

  // ── Publish / take offline (owner / collab / password) ──
  app.post('/repos/:id/dashboard/publish', { preHandler: resolve() }, async (req, reply) => {
    if (!req.repo.hosted) return reply.code(400).send({ error: 'not_hosted' });
    try { return await publishRepo(req._p, req.repo, req.actor); }
    catch (e) { return reply.code(e.http || 400).send({ error: e.code || 'failed' }); }
  });
  app.post('/repos/:id/dashboard/unpublish', { preHandler: resolve() }, async (req) => {
    return await unpublishRepo(req._p, req.repo, req.actor);
  });

  // ── Activity log (any access level) — recent audit entries ──
  app.get('/repos/:id/dashboard/activity', { preHandler: resolve() }, async (req) => {
    const logs = await req._p.repoAuditLog.findMany({ where: { serverRepoId: req.repo.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { activity: logs };
  });

  // ── Sandbox settings (owner / collab / password) — clamped to the hard caps ──
  app.put('/repos/:id/dashboard/settings', { preHandler: resolve() }, async (req, reply) => {
    const b = settingsSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const r = req.repo; const cur = r.settings || DEFAULT_SETTINGS;
    const next = {
      access: { ...DEFAULT_SETTINGS.access, ...cur.access, ...(b.data.access || {}) },
      bans: { ...DEFAULT_SETTINGS.bans, ...cur.bans, ...(b.data.bans || {}) },
      requestedUploadKbps: b.data.requestedUploadKbps !== undefined ? b.data.requestedUploadKbps : (cur.requestedUploadKbps ?? null),
    };
    const out = await req._p.serverRepo.update({ where: { id: r.id }, data: { settings: next } });
    await repoLog(req._p, r.id, req.actor, 'settings', 'sandbox settings updated');
    return { ok: true, settings: out.settings, effectiveUploadKbps: effUpload(out), uploadCapKbps: out.uploadLimitKbps };
  });

  // ── Traffic / connected users (owner / collab / password) ──
  // Aggregates recent consumer access events (BMM clients syncing the repo) by IP+key,
  // and flags which are currently banned, so the owner can see + ban abusers.
  app.get('/repos/:id/dashboard/traffic', { preHandler: resolve() }, async (req) => {
    const p = req._p; const repoId = req.repo.id;
    const since = new Date(Date.now() - 7 * 864e5);
    const events = await p.repoAccessEvent.findMany({ where: { serverRepoId: repoId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 800 });
    const bans = req.repo.settings?.bans || { ips: [], keys: [], accounts: [] };
    const bannedAccounts = bans.accounts || [];
    const map = new Map();
    for (const e of events) {
      const k = `${e.ip}|${e.accessKey || ''}`;
      let c = map.get(k);
      if (!c) { c = { ip: e.ip, accessKey: e.accessKey, connects: 0, downloads: 0, lastSeen: e.createdAt, firstSeen: e.createdAt, userId: null, discordId: null }; map.set(k, c); }
      if (e.kind === 'download') c.downloads++; else c.connects++;
      if (e.createdAt > c.lastSeen) c.lastSeen = e.createdAt;
      if (e.createdAt < c.firstSeen) c.firstSeen = e.createdAt;
      if (!c.userId && e.userId) { c.userId = e.userId; c.discordId = e.discordId; }
    }
    // Resolve display names for any client whose X-Creator-ID resolved to an account,
    // so the owner sees WHO is connecting, not just an IP — and can ban the account.
    const userIds = [...new Set([...map.values()].map((c) => c.userId).filter(Boolean))];
    const names = userIds.length
      ? Object.fromEntries((await p.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })).map((u) => [u.id, u.displayName]))
      : {};
    const clients = [...map.values()]
      .map((c) => {
        const account = c.userId ? { type: 'bcweb', id: c.userId, label: names[c.userId] || 'Unknown' } : null;
        const accountBanned = !!account && bannedAccounts.some((a) => (a.type === 'bcweb' && a.id === c.userId) || (a.type === 'discord' && a.id === c.discordId));
        return { ...c, account, banned: (bans.ips || []).includes(c.ip) || (!!c.accessKey && (bans.keys || []).includes(c.accessKey)) || accountBanned };
      })
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    // Daily-bucketed series for the traffic graph — built from the same events
    // already fetched above, no extra query needed. Zero-filled so quiet days show
    // as a real flat stretch instead of the chart silently having fewer points.
    const days = 7;
    const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
    const buckets = new Map();
    for (let i = 0; i < days; i++) { const d = new Date(Date.now() - i * 864e5); buckets.set(dayKey(d), { day: dayKey(d), connects: 0, downloads: 0 }); }
    for (const e of events) { const b = buckets.get(dayKey(e.createdAt)); if (b) { if (e.kind === 'download') b.downloads++; else b.connects++; } }
    const series = [...buckets.values()].reverse();

    return {
      clients,
      events: events.slice(0, 60),
      series,
      totals: { connects: events.filter((e) => e.kind !== 'download').length, downloads: events.filter((e) => e.kind === 'download').length, uniqueIps: new Set(events.map((e) => e.ip)).size },
    };
  });

  // Ban / unban an IP or key (adds/removes it in the sandbox bans, which the public
  // serving endpoints already enforce). Any dashboard access level can moderate.
  async function setBan(p, repo, actor, { ip, key, account }, add) {
    const s = repo.settings || DEFAULT_SETTINGS;
    const bans = { ips: [...(s.bans?.ips || [])], keys: [...(s.bans?.keys || [])], accounts: [...(s.bans?.accounts || [])] };
    const addTo = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
    const rm = (arr, v) => arr.filter((x) => x !== v);
    if (add) {
      addTo(bans.ips, ip); addTo(bans.keys, key);
      if (account && !bans.accounts.some((a) => a.type === account.type && a.id === account.id)) bans.accounts.push(account);
    } else {
      if (ip) bans.ips = rm(bans.ips, ip);
      if (key) bans.keys = rm(bans.keys, key);
      if (account) bans.accounts = bans.accounts.filter((a) => !(a.type === account.type && a.id === account.id));
    }
    await p.serverRepo.update({ where: { id: repo.id }, data: { settings: { ...s, bans } } });
    await repoLog(p, repo.id, actor, add ? 'ban' : 'unban', account?.label || ip || key || '');
  }
  const banBody = z.object({ ip: z.string().max(64).optional(), key: z.string().max(128).optional(), account: accountEntrySchema.optional() });
  app.post('/repos/:id/dashboard/ban', { preHandler: resolve() }, async (req, reply) => {
    const b = banBody.safeParse(req.body);
    if (!b.success || (!b.data.ip && !b.data.key && !b.data.account)) return reply.code(400).send({ error: 'invalid_input' });
    await setBan(req._p, req.repo, req.actor, b.data, true);
    return { ok: true };
  });
  app.post('/repos/:id/dashboard/unban', { preHandler: resolve() }, async (req, reply) => {
    const b = banBody.safeParse(req.body);
    if (!b.success || (!b.data.ip && !b.data.key && !b.data.account)) return reply.code(400).send({ error: 'invalid_input' });
    await setBan(req._p, req.repo, req.actor, b.data, false);
    return { ok: true };
  });

  // ── Access management (OWNER ONLY): collaborator emails + dashboard password ──
  app.put('/repos/:id/dashboard/access', { preHandler: resolve({ ownerOnly: true }) }, async (req, reply) => {
    const b = z.object({
      emails: z.array(z.string().email().max(160)).max(50).optional(),
      // password: a non-empty string sets it; '' or null clears it; undefined leaves it.
      password: z.string().max(200).nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = req._p; const repo = req.repo;
    const data = {};
    let added = [];
    if (b.data.emails !== undefined) {
      const before = new Set((repo.accessEmails || []).map((e) => e.toLowerCase()));
      data.accessEmails = [...new Set(b.data.emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];
      added = data.accessEmails.filter((e) => !before.has(e));
    }
    let pwChange = null;
    if (b.data.password !== undefined) { data.dashPassword = b.data.password ? await argon2.hash(b.data.password) : null; pwChange = b.data.password ? 'password set' : 'password removed'; }
    const out = await p.serverRepo.update({ where: { id: repo.id }, data });
    // Tell newly-authorized collaborators (only those who already have an account).
    if (added.length) {
      const users = await p.user.findMany({ where: { email: { in: added } }, select: { id: true } });
      for (const u of users) await notify(p, u.id, 'repo_access_granted', `You were given access to the repo "${repo.name}" dashboard.`);
    }
    const bits = [];
    if (added.length) bits.push(`+${added.length} email(s)`);
    if (b.data.emails !== undefined && !added.length) bits.push('emails updated');
    if (pwChange) bits.push(pwChange);
    await repoLog(p, repo.id, req.actor, 'access', bits.join(', ') || 'access updated');
    return { ok: true, emails: out.accessEmails, hasPassword: !!out.dashPassword };
  });
}
