// Links to files that stop working — the one mechanism behind MYO deliverables, mail
// attachments and dated assets.
//
//   createExpiringFile(p, { key, kind, … })  → the row (with its token)
//   statusOf(row, now)                        → 'ok' | 'expired' | 'revoked' | 'exhausted' | 'purged'
//   effectiveExpiry(row)                      → the Date the link dies, or null (never)
//   resolveToken(p, token, { userId })        → { ok, row, reason }
//   recordDownload(p, row)                    → the updated row (first download starts the 7-day clock)
//   revokeFor(p, kind, refId)                 → revoke + delete the objects behind a reference
//   sweepExpiringFiles(p, log)                → delete objects behind links dead for a week, forget old mail rows
//
// The rule for a deliverable — "a month after delivery, or a week after the first
// download, whichever comes first" — is two fields, `expiresAt` and `downloadAfterDays`;
// `effectiveExpiry` takes the earlier of the two once a first download exists.
import crypto from 'node:crypto';
import { deleteObject, presignGet } from './storage.mjs';

export const DEFAULTS = { myoDays: 30, myoAfterDownloadDays: 7, mailDays: 14 };
const DAY = 86400e3;

export const newToken = () => crypto.randomBytes(18).toString('base64url');

/** A storage key from the URLs the app stores (`/api/media/<key>`, `/media/<key>`), else null. */
export function keyFromMediaUrl(u) {
  const m = /^(?:https?:\/\/[^/]+)?\/(?:api\/)?media\/(.+)$/i.exec(String(u || '').split('?')[0]);
  if (!m || m[1].includes('..')) return null;
  return decodeURIComponent(m[1]);
}

export function effectiveExpiry(row) {
  const dates = [];
  if (row.expiresAt) dates.push(new Date(row.expiresAt).getTime());
  if (row.firstDownloadAt && row.downloadAfterDays) dates.push(new Date(row.firstDownloadAt).getTime() + row.downloadAfterDays * DAY);
  if (!dates.length) return null;
  return new Date(Math.min(...dates));
}

export function statusOf(row, now = new Date()) {
  if (row.purgedAt) return 'purged';
  if (row.revokedAt) return 'revoked';
  if (row.maxDownloads && row.downloads >= row.maxDownloads) return 'exhausted';
  const e = effectiveExpiry(row);
  if (e && e.getTime() <= now.getTime()) return 'expired';
  return 'ok';
}

/** What a page or a card shows about a link, without the token's secret parts. */
export function describe(row, now = new Date()) {
  return { status: statusOf(row, now), expiresAt: effectiveExpiry(row), firstDownloadAt: row.firstDownloadAt, downloads: row.downloads, fileName: row.fileName, bytes: row.bytes };
}

export async function createExpiringFile(p, { key, kind, refId = null, ownerId = null, fileName = '', contentType = '', bytes = 0, days = null, downloadAfterDays = null, maxDownloads = null, createdBy = null }) {
  const expiresAt = days ? new Date(Date.now() + Math.max(1, Math.min(3650, Math.floor(days))) * DAY) : null;
  return p.expiringFile.create({ data: { token: newToken(), key: String(key), kind, refId, ownerId, fileName: String(fileName || '').slice(0, 200), contentType: String(contentType || '').slice(0, 120), bytes: Math.max(0, Math.floor(bytes) || 0), expiresAt, downloadAfterDays: downloadAfterDays ? Math.max(1, Math.floor(downloadAfterDays)) : null, maxDownloads: maxDownloads ? Math.max(1, Math.floor(maxDownloads)) : null, createdBy } });
}

/** The link's public path. */
export const linkFor = (row) => `/f/${row.token}`;

export async function resolveToken(p, token, { userId = null } = {}) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(String(token || ''))) return { ok: false, reason: 'missing' };
  const row = await p.expiringFile.findUnique({ where: { token } });
  if (!row) return { ok: false, reason: 'missing' };
  const st = statusOf(row);
  if (st !== 'ok') return { ok: false, reason: st, row };
  if (row.ownerId && row.ownerId !== userId) return { ok: false, reason: 'forbidden', row };
  return { ok: true, row };
}

/** Where the bytes are: a short-lived storage link, or the URL the row points at. */
export async function downloadUrl(row) {
  if (/^https?:\/\//i.test(row.key)) return row.key;
  return presignGet(row.key, 300);
}

export async function recordDownload(p, row) {
  const first = !row.firstDownloadAt;
  return p.expiringFile.update({ where: { id: row.id }, data: { downloads: { increment: 1 }, ...(first ? { firstDownloadAt: new Date() } : {}) } });
}

/** Revoke every link behind a reference and delete the objects (the archive keeps no attachments). */
export async function revokeFor(p, kind, refId) {
  const rows = await p.expiringFile.findMany({ where: { kind, refId, purgedAt: null } });
  for (const r of rows) {
    if (!/^https?:\/\//i.test(r.key)) await deleteObject(r.key).catch(() => {});
    await p.expiringFile.update({ where: { id: r.id }, data: { revokedAt: r.revokedAt || new Date(), purgedAt: new Date() } }).catch(() => {});
  }
  return rows.length;
}

/**
 * Housekeeping: a link dead for a week loses its object (a deliverable nobody fetched in
 * time is not kept around on our storage), and mail-attachment rows two months past their
 * date are forgotten altogether. Deliverable rows stay — the card still says when it
 * expired and how many times it was fetched, which is the proof of delivery.
 */
export async function sweepExpiringFiles(p, log) {
  const now = Date.now();
  const candidates = await p.expiringFile.findMany({ where: { purgedAt: null, OR: [{ expiresAt: { lte: new Date(now - 7 * DAY) } }, { revokedAt: { not: null } }, { firstDownloadAt: { not: null }, downloadAfterDays: { not: null } }] }, take: 200 });
  let purged = 0;
  for (const r of candidates) {
    const e = effectiveExpiry(r);
    const dead = r.revokedAt || (e && e.getTime() <= now - 7 * DAY);
    if (!dead) continue;
    if (!/^https?:\/\//i.test(r.key)) await deleteObject(r.key).catch(() => {});
    await p.expiringFile.update({ where: { id: r.id }, data: { purgedAt: new Date() } }).catch(() => {});
    purged++;
  }
  const { count } = await p.expiringFile.deleteMany({ where: { kind: 'mail', purgedAt: { not: null, lte: new Date(now - 60 * DAY) } } }).catch(() => ({ count: 0 }));
  if ((purged || count) && log) log.info(`[expiring-files] purged ${purged} object(s), forgot ${count} mail link(s)`);
  return { purged, forgotten: count };
}
