import { z } from 'zod';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { db, requireRole, requireCanControlServer, requireElevated, issueElevatedToken, logAudit } from '../lib.mjs';
import { verifyTotp } from '../totp.mjs';
import { FILES_ROOT, FILES_BACKUP_ROOT, DB_BACKUP_ROOT, backupFile, fileHistory, fileAtCommit, repoSizeBytes, gcRepo } from '../gitbackup.mjs';

// A lightweight "type to confirm" server-side check — the frontend already
// makes the admin confirm twice (a dialog, then typing this exact word), but
// requiring the same literal here means a stray/scripted call can't silently
// trigger a real overwrite/delete/restore just by hitting the URL.
function requireConfirm(body) {
  return body?.confirmToken === 'CONFIRM';
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const DANGEROUS = [requireRole('ADMIN'), requireCanControlServer(), requireElevated()];

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

  app.get('/server/elevate/status', { preHandler: [requireRole('ADMIN'), requireCanControlServer()] }, async (req) => {
    try {
      const claims = jwt.verify(req.cookies?.bcw_elevated, JWT_SECRET);
      if (claims.purpose === 'server-control' && claims.uid === req.user.uid) return { elevated: true, expiresAt: claims.exp * 1000 };
    } catch { /* not elevated */ }
    return { elevated: false };
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

  // ── Restart this API process. No Docker socket needed: the compose service
  // already runs with `restart: unless-stopped`, so simply exiting lets Docker's
  // own supervisor bring it straight back up. ──
  app.post('/server/restart', { preHandler: DANGEROUS }, async (req, reply) => {
    const p = await db();
    await logAudit(p, req.user.uid, 'server.restart', '', clientIp(req));
    reply.send({ ok: true, message: 'Restarting…' });
    setTimeout(() => process.exit(0), 400); // let the response flush first
  });

  // ── Backup storage: usage + admin-configurable size limit. Exceeding the
  // limit doesn't delete anything automatically — see gcRepo()'s doc comment —
  // it just compacts via `git gc` and, if still over, stops taking NEW
  // snapshots (checked in sampleAndAlert-style fashion is overkill here; the
  // sweeper's daily snapshot checks this directly, see sweeper.mjs). ──
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
