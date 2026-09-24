import { z } from 'zod';
import { ipOf } from '../lib/client-ip.mjs';
import { JWT_SECRET } from '../lib/jwt-secret.mjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { signBytes, publicVerifyInfo } from '../lib/signing.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import pg from 'pg';
import { db, requireRole, requireCanControlServer, requireElevated, issueElevatedToken, logAudit, auditHash, safeEqual, readAnchors, anchorEntry } from '../lib/lib.mjs';
import { verifyTotp } from '../lib/totp.mjs';
import { sealForOwner, openBackup } from '../lib/shred.mjs';
import { FILES_ROOT, FILES_BACKUP_ROOT, DB_BACKUP_ROOT, backupFile, fileHistory, fileAtCommit, repoSizeBytes, gcRepo, deletedFiles, bundleRepo, backupLog, snapshotTree, inspectBundle, restoreFromBundle, bundleTree, bundleFile } from '../lib/gitbackup.mjs';
import { createSnapshot, listSnapshots, snapshotBytes, deleteSnapshot, pruneSnapshots, validSnapshotId, SNAPSHOT_KINDS, importSnapshot, snapshotPath, checkSnapshotDir, SNAPSHOT_ROOT } from '../lib/snapshots.mjs';

// A lightweight "type to confirm" server-side check — the frontend already
// makes the admin confirm twice (a dialog, then typing this exact word), but
// requiring the same literal here means a stray/scripted call can't silently
// trigger a real overwrite/delete/restore just by hitting the URL.
function requireConfirm(body) {
  return body?.confirmToken === 'CONFIRM';
}

// Snapshots kept per kind before the oldest is rotated out. Ten because it has to be a
// number and this one spans a fortnight of daily runs; 0 disables rotation entirely.
const DEFAULT_KEEP = 10;

// What the automatic run backs up when nobody has said. Files only, because that is what
// it did before this setting existed — every default in this blob follows the same rule,
// so upgrading never changes what an install was already doing.
const DEFAULT_KINDS = ['files'];

/** The backup settings blob, with every default applied in ONE place.
 *
 *  Four callers used to each re-apply `?? 24` and `?? DEFAULT_KEEP` inline, and adding two
 *  more fields to that pattern is how the sweeper and the admin screen end up disagreeing
 *  about what "not set" means.
 */
async function backupCfg(p) {
  const v = (await p.adminSetting.findUnique({ where: { key: 'backup.maxBytes' } }))?.value || {};
  const kinds = Array.isArray(v.kinds) ? v.kinds.filter((k) => SNAPSHOT_KINDS.includes(k)) : null;
  return {
    maxBytes: v.maxBytes ?? null,
    keep: v.keep ?? DEFAULT_KEEP,
    // Absent means ON — see the note on the usage route.
    auto: v.auto !== false,
    everyHours: v.everyHours ?? 24,
    // An empty list is a real choice ("automatic backups on, but of nothing"), so only an
    // absent or unusable value falls back to the default.
    kinds: kinds || DEFAULT_KINDS,
    // null = the default directory. Stored as the admin typed it, resolved on use.
    dir: typeof v.dir === 'string' && v.dir.trim() ? v.dir.trim() : null,
    // Every place backups have ever been written, so changing the destination — in either
    // direction — never hides what is already on disk. Reads use this; writes use `dir`.
    pastDirs: Array.isArray(v.pastDirs) ? v.pastDirs.filter((d) => typeof d === 'string' && d.trim()) : [],
  };
}

/** The list to SEARCH: the destination first (so `writeDir` picks it), then everywhere else.
 *  SNAPSHOT_ROOT is appended by the store itself and does not need to be here. */
const searchDirs = (cfg) => [cfg.dir, ...cfg.pastDirs].filter(Boolean);

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

const clientIp = (req) => ipOf(req);
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
// The body PUT /admin/telemetry/config validates. Module-level and exported so the config import (lib/config-transfer.mjs) checks a seed with this schema rather than a copy of it.
export const TELEMETRY_CONFIG_BODY = z.object({
  storageLimitMb: z.number().min(128).max(10 ** 7).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  deleteDelayH: z.number().int().min(0).max(720).optional(),
});

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

  // The audit trail, filtered where the rows are rather than where they land.
  //
  // `hours` alone could only ever answer "the last N hours". An investigation starts from a
  // date — the day a key leaked, the window a customer complains about — and filtering 500
  // fetched rows in the browser silently answers a DIFFERENT question: it searches the most
  // recent 500 entries, not the log. On a busy week those 500 rows are two days.
  app.get('/admin/security/audit', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const take = Math.min(Number(req.query?.take) || 200, 1000);
    const skip = Math.max(0, Number(req.query?.skip) || 0);
    const where = { AND: [] };
    // An explicit range wins over the rolling window; `hours` stays for the quick buttons.
    const from = req.query?.from ? new Date(String(req.query.from)) : null;
    const to = req.query?.to ? new Date(String(req.query.to)) : null;
    if (from && !Number.isNaN(+from)) where.AND.push({ createdAt: { gte: from } });
    if (to && !Number.isNaN(+to)) where.AND.push({ createdAt: { lte: to } });
    if (!where.AND.length) {
      const hours = Math.min(Number(req.query?.hours) || 24 * 30, 24 * 365);
      where.AND.push({ createdAt: { gte: new Date(Date.now() - hours * 3600e3) } });
    }
    // `startsWith`, not equals: actions are namespaced (`server.file_download`), so
    // "server." is the filter an admin means when they pick a family.
    const action = String(req.query?.action || '').slice(0, 64);
    if (action) where.AND.push({ action: { startsWith: action } });
    const actorId = String(req.query?.actorId || '').slice(0, 64);
    if (actorId) where.AND.push({ actorId });
    const q = String(req.query?.q || '').trim().slice(0, 120);
    if (q) {
      where.AND.push({ OR: [
        { action: { contains: q, mode: 'insensitive' } },
        { detail: { contains: q, mode: 'insensitive' } },
        { ip: { contains: q } },
        { actor: { displayName: { contains: q, mode: 'insensitive' } } },
      ] });
    }
    const [entries, total] = await Promise.all([
      p.auditLogEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip, include: { actor: { select: { id: true, displayName: true, role: true } } } }),
      p.auditLogEntry.count({ where }),
    ]);
    return { entries, total, skip, take };
  });

  // What can be filtered ON, computed from the whole log rather than from the page in view.
  // A dropdown built out of the 200 rows currently on screen offers the admin exactly the
  // actions they can already see, which is the one list that is of no use.
  app.get('/admin/security/audit/facets', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const rows = await p.auditLogEntry.groupBy({ by: ['action'], _count: { action: true }, orderBy: { _count: { action: 'desc' } }, take: 200 });
    const actions = rows.map((r) => ({ action: r.action, count: r._count.action }));
    // The namespace before the first dot, which is what the family filter matches on.
    const families = new Map();
    for (const a of actions) {
      const fam = a.action.includes('.') ? a.action.split('.')[0] + '.' : a.action;
      families.set(fam, (families.get(fam) || 0) + a.count);
    }
    const actorRows = await p.auditLogEntry.groupBy({ by: ['actorId'], _count: { actorId: true }, orderBy: { _count: { actorId: 'desc' } }, take: 50 });
    const users = await p.user.findMany({ where: { id: { in: actorRows.map((r) => r.actorId) } }, select: { id: true, displayName: true, role: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const actors = actorRows.map((r) => ({ id: r.actorId, count: r._count.actorId, displayName: byId.get(r.actorId)?.displayName || null, role: byId.get(r.actorId)?.role || null }));
    const oldest = await p.auditLogEntry.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    return { actions, families: [...families].map(([family, count]) => ({ family, count })), actors, oldest: oldest?.createdAt || null };
  });

  // One entry, in full, with its place in the chain.
  //
  // The list truncates and shows no hash, so "what exactly did this say, and is THIS row
  // still the row that was written" had no answer short of reading the database. The
  // neighbours come back with it because a chain link is a statement about two rows.
  app.get('/admin/security/audit/entry/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const id = String(req.params?.id || '');
    const e = await p.auditLogEntry.findUnique({ where: { id }, include: { actor: { select: { id: true, displayName: true, role: true, email: true } } } });
    if (!e) return reply.code(404).send({ error: 'not_found' });
    const [prev, next] = await Promise.all([
      p.auditLogEntry.findFirst({ where: { createdAt: { lt: e.createdAt } }, orderBy: { createdAt: 'desc' }, select: { id: true, hash: true, action: true, createdAt: true } }),
      p.auditLogEntry.findFirst({ where: { createdAt: { gt: e.createdAt } }, orderBy: { createdAt: 'asc' }, select: { id: true, prevHash: true, action: true, createdAt: true } }),
    ]);
    // Legacy rows carry no hash at all; saying "unsigned" is the truth, and calling them
    // altered would cry wolf over entries written before the chain existed.
    const signed = !!e.hash;
    const hmacOk = signed ? safeEqual(auditHash(e.prevHash, e), e.hash) : null;
    const linkOk = signed && prev?.hash ? e.prevHash === prev.hash : null;
    const nextLinkOk = signed && next ? next.prevHash === e.hash : null;
    const anchor = (await readAnchors()).find((a) => a.id === e.id) || null;
    return { entry: e, prev, next, signed, hmacOk, linkOk, nextLinkOk, anchored: !!anchor, anchorMatches: anchor ? anchor.hash === e.hash : null };
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
    // "Since when" — the question an admin actually asks once a break is found. The break's
    // timestamp alone does not answer it: what matters is how much of the log sits after that
    // point, because none of it is evidence any more. `trustedUntil` is the last entry that
    // still verified, which is the true edge of what this log can be used to prove.
    const brk = firstBreak || anchorBreak;
    let sinceBreak = null;
    if (brk) {
      const at = new Date(brk.at);
      const idx = rows.findIndex((r) => r.id === brk.id);
      const trusted = idx > 0 ? rows[idx - 1] : null;
      sinceBreak = {
        at: brk.at,
        // Entries written from the break onwards. Not "suspect" — unverifiable, which is a
        // weaker and more accurate word: the chain says nothing about them either way.
        entriesAfter: rows.filter((r) => r.createdAt >= at).length,
        trustedUntil: trusted?.createdAt || null,
        // How long the log has been unverifiable, in whole hours, for the sentence on screen.
        hoursSince: Math.max(0, Math.floor((Date.now() - at.getTime()) / 3600e3)),
      };
    }
    return { ok: !firstBreak && !anchorBreak, total: rows.length, checked, legacy, firstBreak, anchorsChecked, anchorBreak, sinceBreak, verifiedAt: new Date().toISOString(), newest: rows.length ? rows[rows.length - 1].createdAt : null };
  });

  // ── What to do once it says the chain is broken ────────────────────────────
  //
  // Everything above this line detects. An admin who reads "Chain broken · 412 entries are
  // unverifiable" then has three questions, and the screen answered none of them: what do I
  // keep, how do I stop it getting worse, and how do I get a working log back.
  //
  // The order matters and is not obvious, so the endpoints are written in it. Take the
  // evidence off the machine FIRST — every other action here writes to the very database
  // under suspicion, and re-sealing before exporting destroys the only copy of what the
  // break looked like.

  /**
   * The evidence bundle. Read-only, signed, and meant to leave.
   *
   * Contains the verification result, the rows on both sides of the break, the external
   * anchors, and the server's clock at the moment of reading. Signed with the deployment's
   * signing key so the file can be shown to have come from here and not been edited after —
   * `publicVerifyInfo()` is what a reader checks it against.
   *
   * NOT keyed with AUDIT_SECRET: whoever forged the chain may hold that secret, and a bundle
   * signed with the compromised key proves nothing about the compromise.
   */
  app.get('/admin/security/audit/evidence', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const rows = await p.auditLogEntry.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, actorId: true, action: true, detail: true, ip: true, createdAt: true, prevHash: true, hash: true },
    });
    // Recompute here rather than calling the verify route: an evidence file whose verdict was
    // fetched over HTTP from itself is a verdict about a different read of the table.
    let expectedPrev = null; let firstBreak = null; let checked = 0; let legacy = 0;
    for (const e of rows) {
      if (!e.hash) { legacy++; expectedPrev = null; continue; }
      checked++;
      const hmacOk = safeEqual(auditHash(e.prevHash, e), e.hash);
      const linkOk = expectedPrev === null || e.prevHash === expectedPrev;
      if (!hmacOk || !linkOk) { firstBreak = { id: e.id, at: e.createdAt, reason: !hmacOk ? 'content_altered' : 'chain_broken' }; break; }
      expectedPrev = e.hash;
    }
    // The window around the break, in full. Fifty either side because the interesting row is
    // rarely the broken one — it is what somebody did just before, and what they did next.
    const idx = firstBreak ? rows.findIndex((r) => r.id === firstBreak.id) : -1;
    const window = idx >= 0 ? rows.slice(Math.max(0, idx - 50), idx + 51) : rows.slice(-100);
    const body = {
      kind: 'bcweb.audit.evidence',
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: req.user.uid,
      serverClock: new Date().toISOString(),
      total: rows.length,
      checked,
      legacy,
      firstBreak,
      // The whole anchor file, not the matching entries: which anchors are ABSENT from the
      // window is itself the finding when rows have been deleted.
      anchors: await readAnchors(5000),
      window,
      oldest: rows.length ? rows[0].createdAt : null,
      newest: rows.length ? rows[rows.length - 1].createdAt : null,
    };
    // The signed thing travels as a STRING, and the reader parses that string.
    //
    // Signing `body` and shipping `{...body, signature}` would produce a file that never
    // verifies: the reader re-serialises what they received, which now has two extra keys and
    // whatever key order this runtime chose, and gets different bytes. The signature would
    // fail on a perfectly authentic file — the worst possible outcome for a tool whose entire
    // job is to be believed.
    const json = JSON.stringify(body);
    const sig = await signBytes(Buffer.from(json, 'utf8')).catch(() => null);
    await logAudit(p, req.user.uid, 'security.audit.evidence', `entries=${rows.length} break=${firstBreak?.reason || 'none'}`, req.ip);
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="audit-evidence-${Date.now()}.json"`);
    return {
      kind: 'bcweb.audit.evidence',
      version: 1,
      signature: sig,
      verifyWith: await publicVerifyInfo().catch(() => null),
      // `printf %s "$(jq -r .bundle file.json)" > bundle.json` is the whole extraction step.
      bundle: json,
    };
  });

  /**
   * Anchor the current head, now.
   *
   * Anchors are written automatically for sensitive actions only, so a log full of ordinary
   * moderation has nothing outside the database to compare against — and deleting the newest
   * rows leaves no gap in a chain, by construction. This drops one {id,hash} onto the anchor
   * volume so that from this moment on, truncation back past it is detectable.
   *
   * The cheapest useful thing to do while an incident is open, and the only one that improves
   * the situation without writing to the table under suspicion.
   */
  app.post('/admin/security/audit/anchor', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const head = await p.auditLogEntry.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, hash: true, action: true, createdAt: true } });
    if (!head?.hash) return reply.code(409).send({ error: 'no_signed_head' });
    const ok = await anchorEntry({ at: head.createdAt.toISOString(), id: head.id, hash: head.hash, action: `manual:${head.action}` });
    if (!ok) return reply.code(500).send({ error: 'anchor_write_failed' });
    await logAudit(p, req.user.uid, 'security.audit.anchor', `head=${head.id}`, req.ip);
    return { ok: true, id: head.id, at: head.createdAt };
  });

  /**
   * Re-seal the chain forward from the first break.
   *
   * What it does: recomputes `prevHash` and `hash` for every entry from the break onwards, so
   * the chain verifies again and the NEXT alteration is detectable.
   *
   * What it does not do, and what the screen must say in these words: it does not make the
   * re-signed entries trustworthy. Their content is whatever the database holds right now,
   * including whatever an attacker put there. Re-sealing over a break destroys the evidence
   * that the break existed — which is why this endpoint refuses to run unless an evidence
   * bundle has been exported since the break was detected, and records in the log it is
   * repairing exactly what it did.
   *
   * SUPERADMIN and elevated: it is the one operation here that rewrites the tamper-evidence
   * itself, so it sits behind the same gate as writing to the database directly.
   */
  app.post('/admin/security/audit/reseal', { preHandler: [requireRole('SUPERADMIN'), requireElevated()] }, async (req, reply) => {
    if (!requireConfirm(req.body)) return reply.code(400).send({ error: 'confirm_required' });
    const p = await db();
    const rows = await p.auditLogEntry.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, actorId: true, action: true, detail: true, createdAt: true, prevHash: true, hash: true },
    });
    // Find the break the same way verify does.
    let expectedPrev = null; let from = -1; let reason = null;
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      if (!e.hash) { expectedPrev = null; continue; }
      const hmacOk = safeEqual(auditHash(e.prevHash, e), e.hash);
      const linkOk = expectedPrev === null || e.prevHash === expectedPrev;
      if (!hmacOk || !linkOk) { from = i; reason = !hmacOk ? 'content_altered' : 'chain_broken'; break; }
      expectedPrev = e.hash;
    }
    if (from < 0) return reply.code(409).send({ error: 'nothing_to_reseal' });

    // The evidence must already be out. Checked against the log itself: an export writes
    // `security.audit.evidence`, and it has to be NEWER than the break — an export from last
    // month describes a chain that had not broken yet.
    const brokenAt = rows[from].createdAt;
    const exported = await p.auditLogEntry.findFirst({
      where: { action: 'security.audit.evidence', createdAt: { gte: brokenAt } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!exported) return reply.code(409).send({ error: 'export_evidence_first', brokenAt });

    const affected = rows.slice(from);
    // One transaction: a partial re-seal leaves a chain that is broken in a NEW place, and
    // the admin cannot tell the two breaks apart afterwards.
    await p.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(918273645)`;
      let prev = from > 0 ? rows[from - 1].hash : 'GENESIS';
      for (const e of affected) {
        const hash = auditHash(prev, e);
        await tx.auditLogEntry.update({ where: { id: e.id }, data: { prevHash: prev, hash } });
        prev = hash;
      }
    });

    // Recorded in the log it just rewrote, which is the point: the re-seal is the last thing
    // anybody can prove about this period, so it had better say what it covered.
    await logAudit(p, req.user.uid, 'security.audit.reseal',
      `from=${brokenAt.toISOString()} reason=${reason} entries=${affected.length}`, req.ip);
    // And anchored, so this particular claim cannot be quietly removed either.
    const head = await p.auditLogEntry.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, hash: true, createdAt: true } });
    if (head?.hash) await anchorEntry({ at: head.createdAt.toISOString(), id: head.id, hash: head.hash, action: 'manual:security.audit.reseal' });
    return { ok: true, resealed: affected.length, from: brokenAt, reason };
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
    const b = TELEMETRY_CONFIG_BODY.safeParse(req.body || {});
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

  /**
   * Whose row is this?
   *
   * Read from the row itself rather than from a table-name list: a list has to be edited
   * every time a model gains an owner, and the day somebody forgets is the day a table of
   * personal data starts being backed up in the clear.
   *
   * The order matters. A BlogPost has an authorId; a ServerRepo has an ownerId; a Session
   * has a userId. A row with several is attributed to the FIRST one found, which is the one
   * naming the person the row is about rather than a moderator who touched it — `actorId` is
   * deliberately absent for exactly that reason.
   */
  const ownerOfRow = (row) => {
    for (const k of ['userId', 'ownerId', 'authorId']) {
      if (typeof row?.[k] === 'string' && row[k]) return row[k];
    }
    // The User table itself: the row IS the person.
    if (typeof row?.id === 'string' && typeof row?.email === 'string') return row.id;
    return null;
  };

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
      // Encrypted with the ROW OWNER's key when the row belongs to somebody, so a later
      // erasure request reaches this snapshot too — git is append-only and the alternative
      // is rewriting history, which invalidates every hash and every restore. A row with no
      // owner (a config, a setting) is written as before: nothing to erase, no key to keep.
      const payload = await sealForOwner(p, ownerOfRow(oldRows[0]), JSON.stringify(serializeRow(oldRows[0]), null, 2));
      await backupFile(DB_BACKUP_ROOT, `${req.params.name}/${b.data.pk}.json`, payload, `${req.user.uid} edited ${req.params.name}.${b.data.column} (pk=${b.data.pk})`)
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
    try {
      const raw = await fileAtCommit(DB_BACKUP_ROOT, req.params.hash, `${b.data.table}/${b.data.pk}.json`);
      const opened = await openBackup(p, raw);
      // "The owner asked to be erased" is a NORMAL answer here, not an error to swallow.
      // A restore screen that shows a parse failure where it should say this is a screen
      // that gets reported as broken — and it would also be the only place the erasure is
      // visible, so saying it plainly is the point.
      if (!opened.ok) {
        return reply.code(410).send({
          error: opened.reason === 'shredded' ? 'owner_erased' : 'unreadable',
          detail: opened.reason === 'shredded'
            ? 'This snapshot belonged to an account that has been erased. Its key was destroyed, so the contents can no longer be read — by anyone, including from a copy of this backup.'
            : 'The snapshot could not be decrypted. It was written for a different key, or the file was altered.',
        });
      }
      historical = JSON.parse(opened.text);
    } catch { return reply.code(404).send({ error: 'backup_not_found' }); }
    const cols = await p.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${b.data.table}`;
    const colNames = new Set(cols.map((c) => c.column_name));
    const currentRows = await p.$queryRawUnsafe(`SELECT * FROM "${b.data.table}" WHERE "${pkCol}" = $1`, b.data.pk);
    if (!currentRows[0]) return reply.code(404).send({ error: 'row_not_found' });
    await backupFile(DB_BACKUP_ROOT, `${b.data.table}/${b.data.pk}.json`,
      await sealForOwner(p, ownerOfRow(currentRows[0]), JSON.stringify(serializeRow(currentRows[0]), null, 2)),
      `${req.user.uid} restored ${b.data.table} (pk=${b.data.pk}) to ${req.params.hash.slice(0, 8)}`).catch(() => {});
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
    const cfg = await backupCfg(p);
    const [filesBytes, dbBytes, snaps] = await Promise.all([repoSizeBytes(FILES_BACKUP_ROOT), repoSizeBytes(DB_BACKUP_ROOT), listSnapshots(searchDirs(cfg))]);
    // Snapshots count towards the total because they sit on the same disk. A usage figure
    // that ignores half of what it wrote is the reason a box runs out of space.
    const snapshotBytesTotal = snaps.reduce((n, s) => n + (s.bytes || 0), 0);
    return {
      filesBytes, dbBytes, snapshotBytes: snapshotBytesTotal, snapshotCount: snaps.length,
      totalBytes: filesBytes + dbBytes + snapshotBytesTotal,
      ...cfg,
      // Absent `auto` means ON, absent `everyHours` means 24, absent `kinds` means files —
      // all applied in backupCfg(), because an install that predates a setting has been
      // backing itself up all along and an upgrade must not quietly change that.
      //
      // Where snapshots are written and where the default is, so the screen can show the
      // real path rather than the word "default".
      defaultDir: SNAPSHOT_ROOT,
      // How many of the listed snapshots are NOT at the current destination — the number
      // that explains why the total is larger than what the destination holds.
      elsewhere: cfg.dir ? snaps.filter((sn) => sn.atDefault).length : 0,
    };
  });

  app.put('/server/backups/limit', { preHandler: DANGEROUS }, async (req, reply) => {
    const b = z.object({
      maxBytes: z.number().int().min(0).nullable(),
      // How many snapshots to keep per kind before the oldest is overwritten. Optional so
      // an older client that only knows about maxBytes does not silently reset it to
      // something — an omitted field must never mean "turn off my rotation".
      keep: z.number().int().min(0).max(365).optional(),
      // Whether the sweeper takes its daily snapshot at all. Optional for the same reason as
      // `keep`: an older client that only sends maxBytes must not switch automatic backups off
      // as a side effect of saving a size limit.
      auto: z.boolean().optional(),
      // How often the automatic snapshot runs, in hours. Optional for the same reason as
      // the two above: an older client sending only a size limit must not silently reset
      // somebody's cadence to the default.
      everyHours: z.number().int().min(1).max(720).optional(),
      // WHAT the automatic run backs up. Optional like the rest; an empty array is allowed
      // and means "nothing", which is a different statement from turning `auto` off — one
      // says stop, the other says the schedule is fine but the selection is empty.
      kinds: z.array(z.enum(['files', 'db'])).optional(),
      // WHERE snapshots are written. Empty string clears it back to the default rather than
      // storing "", so there is one representation of "as before" and not two.
      dir: z.string().max(4096).nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const prev = (await p.adminSetting.findUnique({ where: { key: 'backup.maxBytes' } }))?.value || {};

    // Checked before it is stored: a destination that cannot be written is a setting that
    // silently stops the backups, and the first symptom is an empty list months later.
    let dir = prev.dir ?? null;
    if (b.data.dir !== undefined) {
      const v = checkSnapshotDir(b.data.dir, FILES_ROOT);
      if (!v.ok) return reply.code(400).send({ error: 'bad_dir', reason: v.reason });
      if (v.dir) {
        try {
          await fs.mkdir(v.dir, { recursive: true });
          // mkdir succeeding does not mean we can write INTO it (a read-only mount, a
          // directory owned by root). The only honest test is to write something.
          const probe = path.join(v.dir, '.bcweb-write-test');
          await fs.writeFile(probe, 'ok');
          await fs.rm(probe, { force: true });
        } catch (e) {
          return reply.code(400).send({ error: 'dir_not_writable', detail: String(e?.message || e).slice(0, 200) });
        }
      }
      dir = v.dir;
    }

    // Remember where backups used to go. Written on the CHANGE, because that is the only
    // moment the old value still exists — recovering it afterwards means guessing.
    const prevResolved = prev.dir ? path.resolve(prev.dir) : null;
    const pastDirs = [...new Set([
      ...(Array.isArray(prev.pastDirs) ? prev.pastDirs : []),
      ...(prevResolved && prevResolved !== (dir && path.resolve(dir)) ? [prevResolved] : []),
    ])].slice(-20);   // a bound, so a settings row cannot grow without limit

    const value = {
      maxBytes: b.data.maxBytes,
      keep: b.data.keep ?? prev.keep ?? DEFAULT_KEEP,
      auto: b.data.auto ?? prev.auto ?? true,
      everyHours: b.data.everyHours ?? prev.everyHours ?? 24,
      kinds: b.data.kinds ?? prev.kinds ?? DEFAULT_KINDS,
      dir,
      pastDirs,
    };
    await p.adminSetting.upsert({ where: { key: 'backup.maxBytes' }, create: { key: 'backup.maxBytes', value }, update: { value } });
    // Turning automatic backups OFF is the kind of change somebody needs to be able to find
    // six months later, when the question is "why is there nothing to restore" — so it is
    // spelled out in the audit line rather than left implicit in a size change.
    await logAudit(p, req.user.uid, 'server.backup_limit',
      `size ${b.data.maxBytes ?? 'unlimited'} bytes, keep ${value.keep || 'all'}, automatic ${value.auto ? 'on' : 'OFF'}, `
      + `every ${value.everyHours}h, backing up ${value.kinds.join('+') || 'NOTHING'}, to ${value.dir || 'the default location'}`,
      clientIp(req));
    // Lowering the count is an instruction about what to hold, so it takes effect now
    // rather than at the next snapshot — otherwise "keep 3" leaves twelve on disk until
    // someone happens to press the button.
    const removed = await pruneSnapshots(value.keep, [value.dir, ...(value.pastDirs || [])].filter(Boolean));
    return { ok: true, removed };
  });

  // ── Snapshots: the backups you can hold ─────────────────────────────────────
  // See lib/snapshots.mjs for why these exist alongside the git history rather than
  // instead of it.

  app.get('/server/backups/snapshots', { preHandler: DANGEROUS }, async () => {
    const p = await db();
    const cfg = await backupCfg(p);
    return {
      snapshots: await listSnapshots(searchDirs(cfg)),
      keep: cfg.keep,
      everyHours: cfg.everyHours,
      auto: cfg.auto,
      kinds: cfg.kinds,
      dir: cfg.dir,
      defaultDir: SNAPSHOT_ROOT,
    };
  });

  app.post('/server/backups/snapshots', { preHandler: DANGEROUS }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(['files', 'db', 'both']).default('both'),
      note: z.string().max(200).default(''),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const kinds = b.data.kind === 'both' ? SNAPSHOT_KINDS : [b.data.kind];

    // Refresh the file history first, so a manual snapshot captures the tree as it is right
    // now. Without this, pressing "back up now" would archive whatever the last daily run
    // saw — the one moment somebody presses that button is usually just after a change they
    // want covered.
    if (kinds.includes('files')) {
      await snapshotTree(FILES_BACKUP_ROOT, FILES_ROOT, `manual snapshot by ${req.user.uid}`).catch((e) => req.log?.warn?.({ e: String(e) }, 'pre-snapshot tree refresh failed (continuing)'));
    }

    const made = [];
    const skipped = [];
    for (const kind of kinds) {
      try {
        made.push(await createSnapshot(kind, { by: req.user.uid, note: b.data.note, sign: (bytes) => signBytes(bytes, p), dir: (await backupCfg(p)).dir }));
      } catch {
        // Nothing has ever been backed up for this kind — a real state on a fresh box, and
        // not a reason to fail the half that did work.
        skipped.push(kind);
      }
    }
    if (!made.length) return reply.code(404).send({ error: 'no_backups', detail: 'Nothing has been backed up yet.', skipped });

    const cfg = await backupCfg(p);
    const rotated = await pruneSnapshots(cfg.keep, searchDirs(cfg));
    await logAudit(p, req.user.uid, 'server.backup_snapshot', `${made.map((m) => m.kind).join('+')}${rotated.length ? `, rotated ${rotated.length}` : ''}`, clientIp(req));
    return { ok: true, made, skipped, rotated };
  });

  app.get('/server/backups/snapshots/:id/download', { preHandler: DANGEROUS }, async (req, reply) => {
    const p = await db();
    const hit = await snapshotBytes(req.params.id, searchDirs(await backupCfg(p)));
    if (!hit) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'server.backup_export', `snapshot ${hit.meta.id} (${hit.meta.bytes} bytes)`, clientIp(req));
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="bcweb-${hit.meta.id}.bundle"`);
    // The signature made when the snapshot was taken, not a fresh one: it is the artefact
    // on disk that is being vouched for, and re-signing on the way out would hide a file
    // that had been tampered with since.
    if (hit.meta.signature) reply.header('X-Backup-Signature', hit.meta.signature);
    reply.header('X-Backup-Signature-Alg', 'Ed25519');
    reply.header('X-Backup-Sha256', hit.meta.sha256);
    reply.header('Access-Control-Expose-Headers', 'X-Backup-Signature, X-Backup-Signature-Alg, X-Backup-Sha256');
    return reply.send(hit.bytes);
  });


  /** What is inside a stored snapshot, and whether git still accepts it.
   *
   *  Both halves matter and they answer different questions: `verify` says the file is
   *  intact, the commit list says WHICH backup this is. A restore offered without either
   *  is a button that asks you to guess.
   */
  app.get('/server/backups/snapshots/:id/inspect', { preHandler: DANGEROUS }, async (req, reply) => {
    const hit = await snapshotBytes(req.params.id, searchDirs(await backupCfg(await db())));
    if (!hit) return reply.code(404).send({ error: 'not_found' });
    const report = await inspectBundle(hit.bytes);
    // The digest recorded when it was written, checked against the file as it is now. This
    // is the half `git bundle verify` cannot do: git will happily accept a valid bundle
    // that is not the one we wrote.
    const sha256 = crypto.createHash('sha256').update(hit.bytes).digest('hex');
    return {
      ...report,
      meta: hit.meta,
      digestMatches: sha256 === hit.meta.sha256,
      signature: hit.meta.signature ? { present: true, alg: hit.meta.signatureAlg || 'Ed25519' } : { present: false },
    };
  });

  /** Browse a stored snapshot: one directory of it at a time.
   *
   *  The list said how big a backup was and that git still accepted it. Neither answers the
   *  question an admin has at the moment they reach for a backup — "is the file I lost in
   *  THIS one" — and the only way to find out was to restore it, which is what you do once
   *  you already know.
   */
  app.get('/server/backups/snapshots/:id/tree', { preHandler: DANGEROUS }, async (req, reply) => {
    const hit = await snapshotBytes(req.params.id, searchDirs(await backupCfg(await db())));
    if (!hit) return reply.code(404).send({ error: 'not_found' });
    try {
      return { ...(await bundleTree(hit.bytes, String(req.query?.path || ''))), meta: hit.meta };
    } catch (e) {
      const why = String(e?.message || e);
      return reply.code(why === 'bad_path' ? 400 : 404).send({ error: why === 'bad_path' ? 'bad_path' : 'not_found' });
    }
  });

  /** One file out of a stored snapshot. Text comes back as text; binary says it is binary. */
  app.get('/server/backups/snapshots/:id/file', { preHandler: DANGEROUS }, async (req, reply) => {
    const p = await db();
    const hit = await snapshotBytes(req.params.id, searchDirs(await backupCfg(p)));
    if (!hit) return reply.code(404).send({ error: 'not_found' });
    try {
      const out = await bundleFile(hit.bytes, String(req.query?.path || ''));
      // Reading one file out of a backup is a file read, and the file downloads beside it
      // are audited. A privileged read that leaves no trace is the gap an audit log exists
      // to close.
      await logAudit(p, req.user.uid, 'server.backup_read', `${hit.meta.id}:${out.path} (${out.bytes} bytes)`, clientIp(req));
      return out;
    } catch (e) {
      const why = String(e?.message || e);
      return reply.code(why === 'bad_path' ? 400 : 404).send({ error: why === 'bad_path' ? 'bad_path' : 'not_found' });
    }
  });

  /** Inspect an uploaded bundle WITHOUT storing it.
   *
   *  Import verified the file and then kept it, so the only way to find out what was in a
   *  bundle was to add it to the snapshot list — and a file that turns out to be the wrong
   *  backup then has to be deleted again. This is the same verification and the same tree
   *  listing, with nothing written anywhere.
   */
  app.post('/server/backups/snapshots/inspect-upload', { preHandler: DANGEROUS, bodyLimit: 96 * 1024 * 1024 }, async (req, reply) => {
    const b = z.object({ data: z.string().min(32), path: z.string().max(400).default('') }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    let bytes;
    try { bytes = Buffer.from(b.data.data, 'base64'); } catch { return reply.code(400).send({ error: 'invalid_input' }); }
    if (!bytes.length) return reply.code(400).send({ error: 'invalid_input' });
    const MAX_IMPORT = 64 * 1024 * 1024;
    if (bytes.length > MAX_IMPORT) return reply.code(413).send({ error: 'too_large', maxBytes: MAX_IMPORT });
    const report = await inspectBundle(bytes);
    // An unverifiable file has no tree to show, and saying so with git's own words is more
    // use than a listing that would be empty for two different reasons.
    let tree = null;
    if (report.valid) {
      try { tree = await bundleTree(bytes, b.data.path); } catch { tree = null; }
    }
    return { ...report, tree, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });

  /** Import a bundle from somewhere else — a copy taken off the box, or another server.
   *
   *  Verified BEFORE it is stored, so the snapshot list never contains something that
   *  cannot be restored. An unverifiable file is refused with git's own reason rather than
   *  a generic failure: "does not look like a v2/v3 bundle" tells the admin they uploaded
   *  the wrong file, which no wording of ours would.
   */
  // bodyLimit, or the route's own size check is unreachable: Fastify's default is 1 MiB and
  // it refuses the request before any handler runs — which is exactly what happened, a 413
  // on every real backup while the code below politely allowed 256 MB. base64 inflates by
  // 4/3, so the envelope has to be bigger than the file it carries.
  app.post('/server/backups/snapshots/import', { preHandler: DANGEROUS, bodyLimit: 96 * 1024 * 1024 }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(['files', 'db']),
      note: z.string().max(200).default(''),
      // base64 rather than multipart: the bundles this produces are megabytes, the endpoint
      // is behind the elevated-admin gate, and adding a file-upload parser to this module
      // for one route is a bigger surface than the encoding costs.
      data: z.string().min(32),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    let bytes;
    try { bytes = Buffer.from(b.data.data, 'base64'); } catch { return reply.code(400).send({ error: 'invalid_input' }); }
    if (!bytes.length) return reply.code(400).send({ error: 'invalid_input' });
    // Kept BELOW the bodyLimit above so the two agree: a file that squeezes through the
    // envelope must not then be refused here for a different reason with a different number.
    const MAX_IMPORT = 64 * 1024 * 1024;
    if (bytes.length > MAX_IMPORT) return reply.code(413).send({ error: 'too_large', maxBytes: MAX_IMPORT });

    const report = await inspectBundle(bytes);
    if (!report.valid) return reply.code(400).send({ error: 'invalid_bundle', detail: report.error || report.verify });

    const p = await db();
    const meta = await importSnapshot(b.data.kind, bytes, {
      by: req.user.uid,
      note: b.data.note || 'imported',
      sign: (bts) => signBytes(bts, p),
      // Imported into the same place new ones are written, so an admin who set a destination
      // finds everything in one directory rather than two.
      dir: (await backupCfg(p)).dir,
    });
    await logAudit(p, req.user.uid, 'server.backup_imported', `${meta.id} (${meta.bytes} bytes)`, clientIp(req));
    return { ok: true, snapshot: meta, report };
  });

  /** Roll back to a snapshot.
   *
   *  A safety snapshot of the CURRENT state is taken first, and the rollback is refused if
   *  that fails. The whole value of a rollback is that it is not a one-way door, and a
   *  rollback with no way back is just a restore performed hopefully.
   *
   *  `applyToDisk` is separate from the rollback itself. Resetting the backup repo is
   *  reversible; copying that tree over the live source directory is not, and it changes
   *  what the server is running. Both need the typed CONFIRM.
   */
  app.post('/server/backups/snapshots/:id/restore', { preHandler: DANGEROUS }, async (req, reply) => {
    if (!requireConfirm(req.body)) return reply.code(400).send({ error: 'confirm_required' });
    const p = await db();
    const cfg = await backupCfg(p);
    const hit = await snapshotBytes(req.params.id, searchDirs(cfg));
    if (!hit) return reply.code(404).send({ error: 'not_found' });

    const report = await inspectBundle(hit.bytes);
    if (!report.valid) return reply.code(400).send({ error: 'invalid_bundle', detail: report.verify });

    const kind = hit.meta.kind;
    const root = kind === 'db' ? DB_BACKUP_ROOT : FILES_BACKUP_ROOT;

    // The safety copy. Not best-effort: if this cannot be written there is no way back and
    // the rollback does not happen.
    let safety = null;
    try {
      safety = await createSnapshot(kind, { by: req.user.uid, note: `before restoring ${hit.meta.id}`, sign: (bts) => signBytes(bts, p), dir: cfg.dir });
    } catch (e) {
      return reply.code(409).send({ error: 'no_safety_snapshot', detail: 'Could not back up the current state, so nothing was rolled back.' });
    }

    const applyToDisk = req.body?.applyToDisk === true && kind === 'files';
    let result;
    try {
      result = await restoreFromBundle(root, await snapshotPath(hit.meta.id, searchDirs(cfg)), { applyToDisk: applyToDisk ? FILES_ROOT : null });
    } catch (e) {
      return reply.code(500).send({ error: 'restore_failed', detail: String(e?.message || e).slice(0, 300), safetySnapshot: safety.id });
    }

    await logAudit(p, req.user.uid, 'server.backup_restored',
      `${hit.meta.id} → ${result.head.slice(0, 8)}${applyToDisk ? `, ${result.copied} path(s) written to disk, ${(result.extra || []).length} left in place` : ''} (safety ${safety.id})`,
      clientIp(req));
    return { ok: true, restored: hit.meta.id, safetySnapshot: safety, head: result.head, wroteToDisk: applyToDisk, paths: result.copied, extra: result.extra || [] };
  });

  app.delete('/server/backups/snapshots/:id', { preHandler: DANGEROUS }, async (req, reply) => {
    if (!validSnapshotId(req.params.id)) return reply.code(400).send({ error: 'invalid_input' });
    if (!requireConfirm(req.body)) return reply.code(400).send({ error: 'confirm_required' });
    const p = await db();
    if (!(await deleteSnapshot(req.params.id, searchDirs(await backupCfg(p))))) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'server.backup_delete', req.params.id, clientIp(req));
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
