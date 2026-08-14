import { z } from 'zod';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { signBytes, publicVerifyInfo } from '../lib/signing.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import pg from 'pg';
import { db, requireRole, requireCanControlServer, requireElevated, issueElevatedToken, logAudit, auditHash, safeEqual, readAnchors } from '../lib/lib.mjs';
import { verifyTotp } from '../lib/totp.mjs';
import { FILES_ROOT, FILES_BACKUP_ROOT, DB_BACKUP_ROOT, backupFile, fileHistory, fileAtCommit, repoSizeBytes, gcRepo, deletedFiles, bundleRepo, backupLog } from '../lib/gitbackup.mjs';

// A lightweight "type to confirm" server-side check — the frontend already
// makes the admin confirm twice (a dialog, then typing this exact word), but
// requiring the same literal here means a stray/scripted call can't silently
// trigger a real overwrite/delete/restore just by hitting the URL.
function requireConfirm(body) {
  return body?.confirmToken === 'CONFIRM';
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const DANGEROUS = [requireRole('ADMIN'), requireCanControlServer(), requireElevated()];

// Lazily-opened READ-ONLY connection to the BMM telemetry Postgres (a separate DB),
// so the Advanced DB viewer can inspect it too. Requires TELEMETRY_DATABASE_URL.
let _telemetryPool = null;
export function telemetryDb() {
  if (_telemetryPool) return _telemetryPool;
  const url = process.env.TELEMETRY_DATABASE_URL;
  if (!url) return null;
  _telemetryPool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30000 });
  return _telemetryPool;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip;
}
// Resolves a user-supplied relative path against FILES_ROOT and refuses anything
// that would escape it (CWE-22) — the one hard boundary the file manager has.
function safePath(rel) {
  const resolved = path.resolve(FILES_ROOT, String(rel || '').replace(/^\/+/, ''));
  if (resolved !== FILES_ROOT && !resolved.startsWith(FILES_ROOT + path.sep)) return null;
  return resolved;
}

// Step-up 2FA + the SUPERADMIN-only grant of the canControlServer permission, plus
// the security log (login attempts + admin audit trail). The actual dangerous
// tools (perf dashboard mutations, Docker, terminal, power) live in their own
// route files and require [requireRole('ADMIN'), requireCanControlServer(),
// requireElevated()] as their preHandler chain.
export default async function serverControlRoutes(app) {
  app.post('/server/elevate', { preHandler: [requireRole('ADMIN'), requireCanControlServer()] }, async (req, reply) => {
    const b = z.object({ code: z.string().min(6).max(6) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.findUnique({ where: { id: req.user.uid }, select: { totpEnabled: true, totpSecret: true, email: true } });
    if (!user?.totpEnabled) return reply.code(400).send({ error: '2fa_not_enabled' });
    if (!verifyTotp(user.totpSecret, b.data.code)) return reply.code(401).send({ error: 'invalid_code' });
    const ttl = issueElevatedToken(reply, req.user.uid);
    await logAudit(p, req.user.uid, 'server.elevate', 'Stepped up to server-control tools', clientIp(req));
    return { ok: true, expiresInSec: ttl };
  });

  // A STATUS probe, so it answers rather than refuses. It used to sit behind
  // requireCanControlServer() — the very thing it reports — so anyone without the grant
  // got a 403 for a perfectly normal state, and the dashboard logged an error every time
  // it asked. Staff-only is still enforced; the grant is now part of the ANSWER.
  app.get('/server/elevate/status', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid }, select: { canControlServer: true } });
    const canControl = !!u?.canControlServer;
    if (canControl) {
      try {
        const claims = jwt.verify(req.cookies?.bcw_elevated, JWT_SECRET);
        if (claims.purpose === 'server-control' && claims.uid === req.user.uid) {
          return { elevated: true, canControl, expiresAt: claims.exp * 1000 };
        }
      } catch { /* not elevated */ }
    }
    return { elevated: false, canControl };
  });

  // ── SUPERADMIN: grant/revoke the server-control permission ──
  app.get('/admin/server-control/users', { preHandler: requireRole('SUPERADMIN') }, async () => {
    const p = await db();
    const users = await p.user.findMany({ where: { canControlServer: true }, select: { id: true, displayName: true, email: true, totpEnabled: true } });
    return { users };
  });

  app.put('/admin/server-control/:userId', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = z.object({ granted: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const target = await p.user.update({ where: { id: req.params.userId }, data: { canControlServer: b.data.granted } }).catch(() => null);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'server-control.grant', `${b.data.granted ? 'Granted' : 'Revoked'} for ${target.displayName}`, clientIp(req));
    return { ok: true };
  });

  // ── Security log: login attempts + admin audit trail ──
  app.get('/admin/security/logins', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const take = Math.min(Number(req.query?.take) || 500, 2000);
    const hours = Math.min(Number(req.query?.hours) || 24 * 30, 24 * 365);
    const since = new Date(Date.now() - hours * 3600e3);
    const attempts = await p.loginAttempt.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take, include: { user: { select: { displayName: true, role: true } } } });
    return { attempts };
  });

  app.get('/admin/security/audit', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const take = Math.min(Number(req.query?.take) || 500, 2000);
    const hours = Math.min(Number(req.query?.hours) || 24 * 30, 24 * 365);
    const since = new Date(Date.now() - hours * 3600e3);
    const entries = await p.auditLogEntry.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take, include: { actor: { select: { displayName: true } } } });
    return { entries };
  });

  // Verify the audit chain's integrity end-to-end: recompute each entry's HMAC (catches
  // field edits / forged rows) and check prevHash linkage (catches deleted/inserted
  // rows). Legacy rows written before hashing landed are reported separately, not as
  // tampering. Returns the first break so an admin can see exactly where trust ends.
  app.get('/admin/security/audit/verify', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const rows = await p.auditLogEntry.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, actorId: true, action: true, detail: true, createdAt: true, prevHash: true, hash: true } });
    let checked = 0, legacy = 0, expectedPrev = null, firstBreak = null;
    for (const e of rows) {
      if (!e.hash) { legacy++; expectedPrev = null; continue; } // pre-hashing row → restart linkage after it
      checked++;
      const recomputed = auditHash(e.prevHash, e);
      const hmacOk = safeEqual(recomputed, e.hash);
      const linkOk = expectedPrev === null || e.prevHash === expectedPrev;
      if (!hmacOk || !linkOk) { firstBreak = { id: e.id, at: e.createdAt, reason: !hmacOk ? 'content_altered' : 'chain_broken' }; break; }
      expectedPrev = e.hash;
    }
    // External anchor cross-check — catches END-truncation the in-DB chain can't: a
    // sensitive entry that was anchored (off-DB) but is now missing/altered in the DB,
    // and is newer than the retention horizon (so it wasn't just legitimately pruned).
    const oldest = rows.length ? rows[0].createdAt : null;
    const anchors = await readAnchors();
    const byId = new Map(rows.map((r) => [r.id, r.hash]));
    let anchorsChecked = 0, anchorBreak = null;
    for (const a of anchors) {
      if (oldest && new Date(a.at) < oldest) continue; // older than what we still retain → pruned, not tampering
      anchorsChecked++;
      const h = byId.get(a.id);
      if (h === undefined) { anchorBreak = { id: a.id, at: a.at, action: a.action, reason: 'anchored_entry_deleted' }; break; }
      if (h !== a.hash) { anchorBreak = { id: a.id, at: a.at, action: a.action, reason: 'anchored_entry_altered' }; break; }
    }
    return { ok: !firstBreak && !anchorBreak, total: rows.length, checked, legacy, firstBreak, anchorsChecked, anchorBreak };
  });

  // ── File manager — confined to FILES_ROOT (this container's own filesystem) ──
  app.get('/server/files', { preHandler: DANGEROUS }, async (req, reply) => {
    const dir = safePath(req.query?.path || '.');
    if (!dir) return reply.code(400).send({ error: 'bad_path' });
    try {
      const names = await fs.readdir(dir, { withFileTypes: true });
      const entries = await Promise.all(names.map(async (n) => {
        const full = path.join(dir, n.name);
        const st = await fs.stat(full).catch(() => null);
        return { name: n.name, isDir: n.isDirectory(), size: st ? Number(st.size) : 0, mtime: st?.mtime || null };
      }));
      entries.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
      return { root: FILES_ROOT, path: path.relative(FILES_ROOT, dir) || '.', entries };
    } catch (e) { return reply.code(400).send({ error: 'read_failed', detail: String(e.message) }); }
  });

  const MAX_TEXT_BYTES = 512 * 1024;
  app.get('/server/files/read', { preHandler: DANGEROUS }, async (req, reply) => {
    const file = safePath(req.query?.path);
    if (!file) return reply.code(400).send({ error: 'bad_path' });
    try {
      const st = await fs.stat(file);
      if (st.isDirectory()) return reply.code(400).send({ error: 'is_directory' });
      if (st.size > MAX_TEXT_BYTES) return reply.code(413).send({ error: 'too_large', maxBytes: MAX_TEXT_BYTES });
      const content = await fs.readFile(file, 'utf8');
      return { path: req.query.path, content, size: Number(st.size) };
    } catch (e) { return reply.code(404).send({ error: 'not_found', detail: String(e.message) }); }
  });

  app.put('/server/files/write', { preHandler: DANGEROUS }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1), content: z.string().max(MAX_TEXT_BYTES), confirmToken: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!requireConfirm(b.data)) return reply.code(400).send({ error: 'confirm_required' });
    const file = safePath(b.data.path);
    if (!file) return reply.code(400).send({ error: 'bad_path' });
    const p = await db();
    // Snapshot whatever's there NOW (or null if this is a brand-new file) before
    // overwriting it — the backup commit right before this one is always "how it
    // looked right before this edit".
    const before = await fs.readFile(file, 'utf8').catch(() => null);
    await backupFile(FILES_BACKUP_ROOT, b.data.path, before, `${req.user.uid} edited ${b.data.path}`).catch((e) => req.log?.warn?.({ e: String(e) }, 'file backup failed (continuing)'));
    await fs.writeFile(file, b.data.content, 'utf8');
    await logAudit(p, req.user.uid, 'server.file_write', b.data.path, clientIp(req));
    return { ok: true };
  });

  app.delete('/server/files', { preHandler: DANGEROUS }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1), confirmToken: z.string().optional() }).safeParse({ path: req.query?.path, confirmToken: req.query?.confirmToken });
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!requireConfirm(b.data)) return reply.code(400).send({ error: 'confirm_required' });
    const file = safePath(b.data.path);
    if (!file || file === FILES_ROOT) return reply.code(400).send({ error: 'bad_path' });
    const p = await db();
    const before = await fs.readFile(file, 'utf8').catch(() => null);
    if (before != null) await backupFile(FILES_BACKUP_ROOT, b.data.path, before, `${req.user.uid} deleted ${b.data.path}`).catch((e) => req.log?.warn?.({ e: String(e) }, 'file backup failed (continuing)'));
    await fs.rm(file, { recursive: true, force: true });
    await logAudit(p, req.user.uid, 'server.file_delete', b.data.path, clientIp(req));
    return { ok: true };
  });

  // ── File backup history (git-backed) ──
  app.get('/server/files/backups', { preHandler: DANGEROUS }, async (req, reply) => {
    const rel = req.query?.path;
    if (!safePath(rel)) return reply.code(400).send({ error: 'bad_path' });
    return { history: await fileHistory(FILES_BACKUP_ROOT, rel) };
  });

  // Files deleted through the manager that are still gone — the list you cannot reach by
  // browsing, because browsing only shows what exists.
  app.get('/server/files/deleted', { preHandler: DANGEROUS }, async () => {
    return { deleted: await deletedFiles(FILES_BACKUP_ROOT, FILES_ROOT) };
  });

  // Download any backed-up version as a file, rather than only being able to read it in
  // the browser. Useful precisely when the thing you want back is not text.
  app.get('/server/files/backups/:hash/download', { preHandler: DANGEROUS }, async (req, reply) => {
    const rel = req.query?.path;
    if (!safePath(rel)) return reply.code(400).send({ error: 'bad_path' });
    let content;
    try { content = await fileAtCommit(FILES_BACKUP_ROOT, req.params.hash, rel); }
    catch { return reply.code(404).send({ error: 'not_found' }); }
    // The basename only, and quoted: a path is attacker-adjacent input and a raw one in
    // this header is how a filename escapes into the response (CWE-79/113).
    const name = String(rel).split('/').pop().replace(/[^\w.\-]/g, '_');
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${name}.${req.params.hash.slice(0, 8)}"`);
    return reply.send(content);
  });

  app.get('/server/files/backups/:hash', { preHandler: DANGEROUS }, async (req, reply) => {
    const rel = req.query?.path;
    if (!safePath(rel)) return reply.code(400).send({ error: 'bad_path' });
    try { return { content: await fileAtCommit(FILES_BACKUP_ROOT, req.params.hash, rel) }; }
    catch { return reply.code(404).send({ error: 'not_found' }); }
  });

  // Restore a file to an older backed-up version — itself backs up the CURRENT
  // content first (so restoring is undoable too), and requires the same
  // double-confirmation token as write/delete.
  app.post('/server/files/backups/:hash/restore', { preHandler: DANGEROUS }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1), confirmToken: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!requireConfirm(b.data)) return reply.code(400).send({ error: 'confirm_required' });
    const file = safePath(b.data.path);
    if (!file) return reply.code(400).send({ error: 'bad_path' });
    const p = await db();
    let historical;
    try { historical = await fileAtCommit(FILES_BACKUP_ROOT, req.params.hash, b.data.path); }
    catch { return reply.code(404).send({ error: 'backup_not_found' }); }
    const before = await fs.readFile(file, 'utf8').catch(() => null);
    await backupFile(FILES_BACKUP_ROOT, b.data.path, before, `${req.user.uid} restored ${b.data.path} to ${req.params.hash.slice(0, 8)}`).catch(() => {});
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, historical, 'utf8');
    await logAudit(p, req.user.uid, 'server.file_restore', `${b.data.path} → ${req.params.hash.slice(0, 8)}`, clientIp(req));
    return { ok: true };
  });

  app.post('/server/files/mkdir', { preHandler: DANGEROUS }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const dir = safePath(b.data.path);
    if (!dir) return reply.code(400).send({ error: 'bad_path' });
    const p = await db();
    try { await fs.mkdir(dir, { recursive: false }); }
    catch (e) { return reply.code(400).send({ error: e.code === 'EEXIST' ? 'already_exists' : 'mkdir_failed' }); }
    await logAudit(p, req.user.uid, 'server.file_mkdir', b.data.path, clientIp(req));
    return { ok: true };
  });

  // Rename/move within the same parent directory only — the new name is a bare
  // filename (no '/' or '..'), never a fresh caller-supplied full path, so this
  // can't be used to hop elsewhere in the tree.
  app.put('/server/files/rename', { preHandler: DANGEROUS }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1), newName: z.string().min(1).max(255) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (/[\/\\]|^\.\.?$/.test(b.data.newName)) return reply.code(400).send({ error: 'bad_name' });
    const from = safePath(b.data.path);
    if (!from || from === FILES_ROOT) return reply.code(400).send({ error: 'bad_path' });
    const to = safePath(path.join(path.dirname(b.data.path), b.data.newName));
    if (!to) return reply.code(400).send({ error: 'bad_path' });
    const p = await db();
    try { await fs.rename(from, to); }
    catch (e) { return reply.code(400).send({ error: e.code === 'ENOENT' ? 'not_found' : 'rename_failed' }); }
    await logAudit(p, req.user.uid, 'server.file_rename', `${b.data.path} -> ${b.data.newName}`, clientIp(req));
    return { ok: true };
  });

  // Raw download — unlike /server/files/read (utf8-only, 512KB cap, for the
  // inline editor), this streams the exact bytes regardless of size/encoding so
  // binaries and large files can still be pulled off the container.
  app.get('/server/files/download', { preHandler: DANGEROUS }, async (req, reply) => {
    const file = safePath(req.query?.path);
    if (!file) return reply.code(400).send({ error: 'bad_path' });
    let st;
    try { st = await fs.stat(file); } catch { return reply.code(404).send({ error: 'not_found' }); }
    if (st.isDirectory()) return reply.code(400).send({ error: 'is_directory' });
    const p = await db();
    await logAudit(p, req.user.uid, 'server.file_download', req.query.path, clientIp(req));
    reply.header('Content-Disposition', `attachment; filename="${path.basename(file).replace(/"/g, '')}"`);
    reply.type('application/octet-stream');
    return reply.send(fsSync.createReadStream(file));
  });

  // ── Database viewer — no free-form SQL input at all (that's exactly what the
  // web terminal risked): table/column names are validated against the REAL
  // catalog from information_schema before ever reaching a query, so there's no
  // injection surface. Rate-limited and audit-logged on every read AND write —
  // if a session were ever hijacked, this bounds how fast the whole DB could be
  // paged out, and leaves a trail of exactly which tables were touched. ──
  const SENSITIVE_COL = /hash|secret|token|password|totp/i;
  // Tamper-evident audit/security tables: the DB viewer may READ them, but never
  // edit or restore a row — otherwise an admin could quietly neuter the very
  // trail that records what they did. Any attempt is refused AND itself logged.
  const PROTECTED_TABLES = new Set(['AuditLogEntry', 'LoginAttempt', 'RepoAuditLog']);

  app.get('/server/db/tables', { preHandler: DANGEROUS, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () => {
    const p = await db();
    const rows = await p.$queryRaw`
      SELECT c.relname AS name, GREATEST(c.reltuples, 0)::bigint AS approx_rows
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`;
    return { tables: rows.map((r) => ({ name: r.name, approxRows: Number(r.approx_rows) })) };
  });

  app.get('/server/db/table/:name', { preHandler: DANGEROUS, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = await db();
    const known = await p.$queryRaw`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    const names = new Set(known.map((r) => r.relname));
    if (!names.has(req.params.name)) return reply.code(404).send({ error: 'not_found' });
    const page = Math.max(0, Number(req.query?.page) || 0);
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize) || 25));
    // Same validate-against-the-real-catalog pattern as the table name above —
    // the sort column is checked against this table's actual columns before
    // ever being interpolated, so it can't become a SQL-injection surface.
    let orderBy = 'ORDER BY 1';
    const sortCol = req.query?.sort;
    if (sortCol) {
      const cols = await p.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${req.params.name}`;
      if (cols.some((c) => c.column_name === sortCol)) {
        const dir = req.query?.dir === 'desc' ? 'DESC' : 'ASC';
        orderBy = `ORDER BY "${sortCol}" ${dir} NULLS LAST`;
      }
    }
    // Table name is validated against the real catalog above (not user-composed
    // SQL) — safe to interpolate as a quoted identifier. Without an explicit
    // ORDER BY, Postgres doesn't guarantee row order stays stable across pages
    // (LIMIT/OFFSET alone can silently reshuffle rows between requests) — always
    // order by at least the ordinal position so pagination is deterministic.
    const rows = await p.$queryRawUnsafe(`SELECT * FROM "${req.params.name}" ${orderBy} LIMIT ${pageSize} OFFSET ${page * pageSize}`);
    const total = await p.$queryRawUnsafe(`SELECT count(*)::bigint AS n FROM "${req.params.name}"`);
    // BigInt/Date aren't JSON-safe by default — stringify them explicitly.
    const safeRows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v])));
    // Rich read trail: exactly what was paged out (table, page, size, sort,
    // rows returned) so a hijacked session's data exfiltration is fully
    // reconstructable from the audit log alone.
    const sortDesc = sortCol ? ` sort=${sortCol}:${req.query?.dir === 'desc' ? 'desc' : 'asc'}` : '';
    await logAudit(p, req.user.uid, 'server.db_read', `${req.params.name} page=${page} size=${pageSize}${sortDesc} rows=${rows.length}/${Number(total[0].n)}`, clientIp(req));
    const pkCol = await singlePkColumn(p, req.params.name);
    return { rows: safeRows, total: Number(total[0].n), page, pageSize, pkColumn: pkCol };
  });

  // ── BMM Telemetry SSO handoff ──
  // Mint a short-lived HMAC token (signed with the shared BC_LINK_SECRET that the
  // telemetry service also holds) so an ADMIN (requireRole already enforces 2FA)
  // can open the BMM telemetry dashboard without its static admin key. Returns the
  // telemetry URL carrying the token + a home link back to BCWEB.
  app.post('/admin/telemetry/token', { preHandler: requireRole('ADMIN'), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    // Same permission the edge forward_auth gate enforces (telemetry.mjs): the token
    // is useless without it, so refuse to mint one — keeps the button and the gate in
    // agreement. SUPERADMIN is always allowed.
    const me = await (await db()).user.findUnique({ where: { id: req.user.uid }, select: { canViewTelemetry: true, telemetryEpoch: true } });
    if (req.user.role !== 'SUPERADMIN' && !me?.canViewTelemetry) return reply.code(403).send({ error: 'no_telemetry_access' });
    const secret = process.env.BC_LINK_SECRET || process.env.LINK_LOOKUP_SECRET || 'dev-link-secret';
    // `ep` binds the token to the user's current logout epoch — logging out bumps it
    // (auth.mjs) so this token (and the cookie minted from it) stops validating.
    const payload = Buffer.from(JSON.stringify({ role: req.user.role, uid: req.user.uid, ep: me?.telemetryEpoch || 0, exp: Date.now() + 4 * 3600 * 1000 })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const token = `${payload}.${sig}`;
    const base = (process.env.TELEMETRY_PUBLIC_URL || 'http://telemetry.localhost').replace(/\/+$/, '');
    const home = process.env.SITE_URL || 'http://localhost:5176';
    // Token goes in BOTH the query (so the edge forward_auth gate can read it —
    // cookie-independent) AND the fragment (which the telemetry app's client reads).
    const tok = encodeURIComponent(token);
    return { url: `${base}/?bc=${tok}#bc=${tok}&home=${encodeURIComponent(home)}` };
  });

  // ── BMM Telemetry runtime config (storage limit / retention / erase delay) ──
  // Proxies the telemetry service's ADMIN_KEY-gated /api/admin/config so an ADMIN
  // can change these LIVE from BCWEB's Hosting settings — no .env edit or restart.
  // Needs TELEMETRY_INTERNAL_URL (server-to-server, e.g. http://telemetry:8900) and
  // TELEMETRY_ADMIN_KEY (= the telemetry service's ADMIN_KEY) in the api env.
  const teleBase = () => (process.env.TELEMETRY_INTERNAL_URL || '').replace(/\/+$/, '');
  const teleKey = () => process.env.TELEMETRY_ADMIN_KEY || process.env.TELEMETRY_ADMIN || '';
  app.get('/admin/telemetry/config', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    // Telemetry is an OPTIONAL companion service. When it isn't wired up or is down,
    // answer 200 with { available:false } instead of 503/502 — the admin panel treats
    // it as "offline" and it avoids a scary console error + a ~4s hang for an expected
    // absence. A short timeout makes an unreachable host fail fast.
    if (!teleBase() || !teleKey()) return reply.send({ available: false, error: 'telemetry_not_configured' });
    try {
      const r = await fetch(`${teleBase()}/api/admin/config`, { headers: { 'X-Admin-Key': teleKey() }, signal: AbortSignal.timeout(2500) });
      if (!r.ok) return reply.send({ available: false, error: 'telemetry_unreachable', status: r.status });
      return { available: true, ...(await r.json()) };
    } catch (e) { return reply.send({ available: false, error: 'telemetry_unreachable', detail: String(e?.message || e) }); }
  });
  app.put('/admin/telemetry/config', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    if (!teleBase() || !teleKey()) return reply.code(503).send({ error: 'telemetry_not_configured' });
    const b = z.object({
      storageLimitMb: z.number().min(128).max(10 ** 7).optional(),
      retentionDays: z.number().int().min(1).max(3650).optional(),
      deleteDelayH: z.number().int().min(0).max(720).optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const r = await fetch(`${teleBase()}/api/admin/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': teleKey() },
        body: JSON.stringify(b.data), signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) return reply.code(502).send({ error: 'telemetry_unreachable', status: r.status });
      const out = await r.json();
      // Mirror the storage limit into BCWEB's own adminSetting so the capacity
      // overview (which reads telemetry.storageLimitGB) stays in sync with reality.
      if (out?.config?.storageLimitMb != null) {
        const p = await db();
        await p.adminSetting.upsert({ where: { key: 'telemetry.storageLimitGB' }, create: { key: 'telemetry.storageLimitGB', value: out.config.storageLimitMb / 1024 }, update: { value: out.config.storageLimitMb / 1024 } }).catch(() => {});
      }
      await logAudit(await db(), req.user.uid, 'server.telemetry_config', JSON.stringify(b.data), clientIp(req)).catch(() => {});
      return out;
    } catch (e) { return reply.code(502).send({ error: 'telemetry_unreachable', detail: String(e?.message || e) }); }
  });

  // ── BMM Telemetry DB viewer (READ-ONLY) ──
  // Same validate-against-the-real-catalog pattern as the BCWEB DB viewer, but
  // against the separate telemetry Postgres and with no write/edit path.
  app.get('/server/telemetry-db/tables', { preHandler: DANGEROUS, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const pool = telemetryDb();
    if (!pool) return reply.code(503).send({ error: 'telemetry_db_not_configured' });
    const { rows } = await pool.query(`SELECT c.relname AS name, c.reltuples::bigint AS approx_rows FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
    await logAudit(await db(), req.user.uid, 'server.telemetry_db_tables', `tables=${rows.length}`, clientIp(req));
    return { tables: rows.map((r) => ({ name: r.name, approxRows: Number(r.approx_rows) })) };
  });

  app.get('/server/telemetry-db/table/:name', { preHandler: DANGEROUS, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const pool = telemetryDb();
    if (!pool) return reply.code(503).send({ error: 'telemetry_db_not_configured' });
    const known = (await pool.query(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`)).rows;
    if (!new Set(known.map((r) => r.relname)).has(req.params.name)) return reply.code(404).send({ error: 'not_found' });
    const page = Math.max(0, Number(req.query?.page) || 0);
    const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize) || 25));
    let orderBy = 'ORDER BY 1';
    const sortCol = req.query?.sort;
    if (sortCol) {
      const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [req.params.name])).rows;
      if (cols.some((c) => c.column_name === sortCol)) orderBy = `ORDER BY "${sortCol}" ${req.query?.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
    }
    const rows = (await pool.query(`SELECT * FROM "${req.params.name}" ${orderBy} LIMIT ${pageSize} OFFSET ${page * pageSize}`)).rows;
    const total = Number((await pool.query(`SELECT count(*)::bigint AS n FROM "${req.params.name}"`)).rows[0].n);
    const safeRows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v])));
    await logAudit(await db(), req.user.uid, 'server.telemetry_db_read', `${req.params.name} page=${page} size=${pageSize} rows=${rows.length}/${total}`, clientIp(req));
    return { rows: safeRows, total, page, pageSize, readOnly: true };
  });

  // Resolves the table's single-column primary key (if it has exactly one) — a
  // multi-column PK isn't supported here, since the edit UI targets one row by
  // one value and that ambiguity isn't worth the extra complexity for an
  // internal admin tool.
  async function singlePkColumn(p, table) {
    const rows = await p.$queryRaw`
      SELECT kcu.column_name FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = ${table}
      ORDER BY kcu.ordinal_position`;
    return rows.length === 1 ? rows[0].column_name : null;
  }

  // Single-cell edit — the only write path this viewer has. Column is validated
  // against the real catalog (same pattern as everywhere else here), sensitive-
  // looking columns (password/secret/token/hash/totp) are refused outright, and
  // the value itself is always passed as a bound parameter, never interpolated.
  const serializeRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v]));

  app.put('/server/db/table/:name/cell', { preHandler: DANGEROUS, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ pk: z.union([z.string(), z.number()]), column: z.string().min(1).max(64), value: z.union([z.string(), z.number(), z.boolean(), z.null()]), confirmToken: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!requireConfirm(b.data)) return reply.code(400).send({ error: 'confirm_required' });
    const p = await db();
    const known = await p.$queryRaw`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    if (!known.some((r) => r.relname === req.params.name)) return reply.code(404).send({ error: 'not_found' });
    if (PROTECTED_TABLES.has(req.params.name)) {
      await logAudit(p, req.user.uid, 'server.db_write_blocked', `refused edit of protected log table ${req.params.name}.${b.data.column} (pk=${b.data.pk})`, clientIp(req));
      return reply.code(403).send({ error: 'table_protected', detail: 'Audit/log tables are read-only in the DB viewer.' });
    }
    if (SENSITIVE_COL.test(b.data.column)) return reply.code(403).send({ error: 'column_protected' });
    const cols = await p.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${req.params.name}`;
    if (!cols.some((c) => c.column_name === b.data.column)) return reply.code(400).send({ error: 'unknown_column' });
    const pkCol = await singlePkColumn(p, req.params.name);
    if (!pkCol) return reply.code(400).send({ error: 'no_single_pk' });
    // Snapshot the WHOLE row (git-committed as JSON) before the update — same
    // "commit right before HEAD is the pre-edit state" pattern as file backups.
    const oldRows = await p.$queryRawUnsafe(`SELECT * FROM "${req.params.name}" WHERE "${pkCol}" = $1`, b.data.pk);
    if (oldRows[0]) {
      await backupFile(DB_BACKUP_ROOT, `${req.params.name}/${b.data.pk}.json`, JSON.stringify(serializeRow(oldRows[0]), null, 2), `${req.user.uid} edited ${req.params.name}.${b.data.column} (pk=${b.data.pk})`)
        .catch((e) => req.log?.warn?.({ e: String(e) }, 'db backup failed (continuing)'));
    }
    try {
      await p.$executeRawUnsafe(`UPDATE "${req.params.name}" SET "${b.data.column}" = $1 WHERE "${pkCol}" = $2`, b.data.value, b.data.pk);
    } catch (e) { return reply.code(400).send({ error: 'update_failed', detail: String(e.message) }); }
    await logAudit(p, req.user.uid, 'server.db_write', `${req.params.name}.${b.data.column} (${pkCol}=${b.data.pk})`, clientIp(req));
    return { ok: true };
  });

  // ── DB row backup history (git-backed JSON snapshots) ──
  app.get('/server/db/backups', { preHandler: DANGEROUS }, async (req, reply) => {
    const table = req.query?.table; const pk = req.query?.pk;
    if (!table || !pk) return reply.code(400).send({ error: 'invalid_input' });
    return { history: await fileHistory(DB_BACKUP_ROOT, `${table}/${pk}.json`) };
  });

  // Restore a row to an older backed-up version — sensitive columns are never
  // written back even from a backup (same rule as live edits), and the
  // CURRENT row is snapshotted first so a restore is itself undoable.
  app.post('/server/db/backups/:hash/restore', { preHandler: DANGEROUS }, async (req, reply) => {
    const b = z.object({ table: z.string().min(1).max(64), pk: z.union([z.string(), z.number()]), confirmToken: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!requireConfirm(b.data)) return reply.code(400).send({ error: 'confirm_required' });
    const p = await db();
    const known = await p.$queryRaw`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    if (!known.some((r) => r.relname === b.data.table)) return reply.code(404).send({ error: 'not_found' });
    if (PROTECTED_TABLES.has(b.data.table)) {
      await logAudit(p, req.user.uid, 'server.db_restore_blocked', `refused restore of protected log table ${b.data.table} (pk=${b.data.pk})`, clientIp(req));
      return reply.code(403).send({ error: 'table_protected', detail: 'Audit/log tables are read-only in the DB viewer.' });
    }
    const pkCol = await singlePkColumn(p, b.data.table);
    if (!pkCol) return reply.code(400).send({ error: 'no_single_pk' });
    let historical;
    try { historical = JSON.parse(await fileAtCommit(DB_BACKUP_ROOT, req.params.hash, `${b.data.table}/${b.data.pk}.json`)); }
    catch { return reply.code(404).send({ error: 'backup_not_found' }); }
    const cols = await p.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${b.data.table}`;
    const colNames = new Set(cols.map((c) => c.column_name));
    const currentRows = await p.$queryRawUnsafe(`SELECT * FROM "${b.data.table}" WHERE "${pkCol}" = $1`, b.data.pk);
    if (!currentRows[0]) return reply.code(404).send({ error: 'row_not_found' });
    await backupFile(DB_BACKUP_ROOT, `${b.data.table}/${b.data.pk}.json`, JSON.stringify(serializeRow(currentRows[0]), null, 2), `${req.user.uid} restored ${b.data.table} (pk=${b.data.pk}) to ${req.params.hash.slice(0, 8)}`).catch(() => {});
    const restored = []; const skipped = [];
    for (const [col, val] of Object.entries(historical)) {
      if (col === pkCol) continue; // never rewrite the primary key itself
      if (!colNames.has(col) || SENSITIVE_COL.test(col)) { skipped.push(col); continue; }
      try { await p.$executeRawUnsafe(`UPDATE "${b.data.table}" SET "${col}" = $1 WHERE "${pkCol}" = $2`, val, b.data.pk); restored.push(col); }
      catch { skipped.push(col); }
    }
    await logAudit(p, req.user.uid, 'server.db_restore', `${b.data.table} (pk=${b.data.pk}) → ${req.params.hash.slice(0, 8)}`, clientIp(req));
    return { ok: true, restored, skipped };
  });

  // Restart-from-the-admin-UI was removed: the button is gone, and an endpoint that kills the
  // process on request has no business staying reachable with nothing calling it. Restart the
  // API the way you'd restart anything else in the stack — `docker compose restart api`.

  // ── Backup storage: usage + admin-configurable size limit. Exceeding the
  // limit doesn't delete anything automatically — see gcRepo()'s doc comment —
  // it just compacts via `git gc` and, if still over, stops taking NEW
  // snapshots (checked in sampleAndAlert-style fashion is overkill here; the
  // sweeper's daily snapshot checks this directly, see sweeper.mjs). ──
  // The signing identity is shared with the history export (lib/signing.mjs) — one key,
  // one public key to publish, one thing for an admin to check against.

  app.get('/server/backups/pubkey', { preHandler: DANGEROUS }, async () => {
    const p = await db();
    return publicVerifyInfo(p);
  });

  // What is actually inside the backups — not just how many bytes they take.
  app.get('/server/backups/list', { preHandler: DANGEROUS }, async () => {
    const [files, dbRows] = await Promise.all([backupLog(FILES_BACKUP_ROOT), backupLog(DB_BACKUP_ROOT)]);
    return { files, db: dbRows };
  });

  // Download one repo's ENTIRE history as a git bundle, signed.
  //
  // Held in memory rather than streamed because the signature covers the whole artefact:
  // signing a stream would mean either buffering it anyway or emitting a signature the
  // client cannot check until the download has finished. The size cap is what keeps that
  // honest — past it, the answer is `git gc` (or a smaller retention), not a 2 GB buffer.
  app.get('/server/backups/export', { preHandler: DANGEROUS }, async (req, reply) => {
    const which = req.query?.repo === 'db' ? 'db' : 'files';
    const root = which === 'db' ? DB_BACKUP_ROOT : FILES_BACKUP_ROOT;
    let bundle;
    try { bundle = await bundleRepo(root); }
    catch { return reply.code(404).send({ error: 'no_backups', detail: 'Nothing has been backed up yet.' }); }
    const MAX = 256 * 1024 * 1024;
    if (bundle.bytes.length > MAX) return reply.code(413).send({ error: 'too_large', bytes: bundle.bytes.length, maxBytes: MAX });
    const p = await db();
    const sig = await signBytes(bundle.bytes, p);
    await logAudit(p, req.user.uid, 'server.backup_export', `${which} (${bundle.bytes.length} bytes)`, clientIp(req));
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="bcweb-${which}-backup-${stamp}.bundle"`);
    reply.header('X-Backup-Signature', sig);
    reply.header('X-Backup-Signature-Alg', 'Ed25519');
    // Exposed explicitly or a browser fetch cannot read them — the signature would be
    // present on the wire and invisible to the page that needs it.
    reply.header('Access-Control-Expose-Headers', 'X-Backup-Signature, X-Backup-Signature-Alg');
    return reply.send(bundle.bytes);
  });

  app.get('/server/backups/usage', { preHandler: DANGEROUS }, async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'backup.maxBytes' } });
    const [filesBytes, dbBytes] = await Promise.all([repoSizeBytes(FILES_BACKUP_ROOT), repoSizeBytes(DB_BACKUP_ROOT)]);
    return { filesBytes, dbBytes, totalBytes: filesBytes + dbBytes, maxBytes: row?.value?.maxBytes ?? null };
  });

  app.put('/server/backups/limit', { preHandler: DANGEROUS }, async (req, reply) => {
    const b = z.object({ maxBytes: z.number().int().min(0).nullable() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'backup.maxBytes' }, create: { key: 'backup.maxBytes', value: { maxBytes: b.data.maxBytes } }, update: { value: { maxBytes: b.data.maxBytes } } });
    await logAudit(p, req.user.uid, 'server.backup_limit', `set to ${b.data.maxBytes ?? 'unlimited'} bytes`, clientIp(req));
    return { ok: true };
  });

  app.post('/server/backups/gc', { preHandler: DANGEROUS }, async (req) => {
    await Promise.all([gcRepo(FILES_BACKUP_ROOT), gcRepo(DB_BACKUP_ROOT)]);
    const p = await db();
    await logAudit(p, req.user.uid, 'server.backup_gc', '', clientIp(req));
    const [filesBytes, dbBytes] = await Promise.all([repoSizeBytes(FILES_BACKUP_ROOT), repoSizeBytes(DB_BACKUP_ROOT)]);
    return { ok: true, filesBytes, dbBytes };
  });
}
