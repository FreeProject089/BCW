// The picture register: which pictures we hold, what they look like (pHash), and the
// flags raised when a new one looks like an older one from ANOTHER account.
//
//   recordUpload(p, …)      at presign — a pending row with the owner (the bytes come later)
//   sweepMediaHashes(p)     hashes pending rows (storage), links avatars, raises flags
//   backfillStorage(p)      stub rows for objects that predate the register (owner unknown)
//
// What counts as a match is a setting (`media.phash`: threshold, enabled): Hamming ≤ 8 is a
// safe default — the same picture re-saved lands at 0–4, a crop or a watermark at 6–10, an
// unrelated picture at 25+. A match between two uploads of the SAME account is not a flag:
// people re-upload their own artwork all the time.
import { getObject, presignGet } from './storage.mjs';
import { safeFetch } from './net.mjs';
import { RASTER, ARCHIVE, sha256, phashImage, archiveImageHashes, nearest } from './phash.mjs';

const SETTING = 'media.phash';
export const DEFAULTS = { threshold: 8, enabled: true };
const BATCH = 40;
const MAX_HASH_BYTES = 120 * 1024 * 1024; // beyond this the bytes are not pulled for a hash
// Avatar hosts we fetch from (the OAuth providers' CDNs). Anything else is left alone: the
// URL was typed by nobody we trust, and a fetch to it is a fetch to wherever they said.
const AVATAR_HOSTS = /^(cdn\.discordapp\.com|media\.discordapp\.net|avatars\.githubusercontent\.com|lh3\.googleusercontent\.com)$/i;

export async function phashSettings(p) {
  const row = await p.adminSetting.findUnique({ where: { key: SETTING } }).catch(() => null);
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  const threshold = Number.isFinite(Number(v.threshold)) ? Math.min(20, Math.max(0, Math.floor(Number(v.threshold)))) : DEFAULTS.threshold;
  return { threshold, enabled: v.enabled !== false };
}
export async function savePhashSettings(p, patch) {
  const cur = await phashSettings(p);
  const next = { ...cur, ...(patch.threshold != null ? { threshold: Math.min(20, Math.max(0, Math.floor(Number(patch.threshold)))) } : {}), ...(patch.enabled != null ? { enabled: !!patch.enabled } : {}) };
  await p.adminSetting.upsert({ where: { key: SETTING }, create: { key: SETTING, value: next }, update: { value: next } });
  return next;
}

/** A pending row for a presigned upload. Idempotent on the key; never throws (an upload must not fail because the register did). */
export async function recordUpload(p, { key, ownerId = null, kind = 'upload', refType = null, refId = null, contentType = '', bytes = 0 }) {
  if (!key) return null;
  try {
    return await p.mediaHash.upsert({
      where: { key },
      create: { key, kind, ownerId, refType, refId, contentType, bytes: Math.max(0, Math.floor(bytes) || 0) },
      update: {},
    });
  } catch { return null; }
}

async function bytesOf(row) {
  if (row.kind === 'avatar' || row.kind === 'team-avatar') {
    let u; try { u = new URL(row.key); } catch { return null; }
    if (!AVATAR_HOSTS.test(u.hostname)) return null;
    const res = await safeFetch(row.key, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res?.ok) return null;
    const ct = String(res.headers.get('content-type') || '');
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length < 12 * 1024 * 1024 ? { buf, contentType: ct } : null;
  }
  const { body, contentType } = await getObject(row.key);
  const chunks = []; for await (const c of body) chunks.push(c);
  return { buf: Buffer.concat(chunks), contentType: String(contentType || row.contentType || '') };
}

/** Hash one pending row: raster → phash; archive → sha + one row per image entry; else sha only. */
export async function hashRow(p, row) {
  if (row.bytes > MAX_HASH_BYTES) return p.mediaHash.update({ where: { id: row.id }, data: { status: 'skipped', error: 'too_large' } });
  let got;
  try { got = await bytesOf(row); } catch (e) { got = null; row._err = String(e?.message || e); }
  if (!got) {
    // Not there yet (a presign the browser never followed) — leave it pending a day, then give up.
    const age = Date.now() - new Date(row.createdAt).getTime();
    if (age < 24 * 3600e3 && !row._err) return null;
    return p.mediaHash.update({ where: { id: row.id }, data: { status: 'failed', error: row._err || 'missing' } });
  }
  const { buf, contentType } = got;
  const data = { sha256: sha256(buf), bytes: buf.length, contentType: contentType.split(';')[0], status: 'hashed', hashedAt: new Date(), error: null };
  if (RASTER.test(data.contentType)) {
    const h = await phashImage(buf);
    if (h) Object.assign(data, h); else data.status = 'skipped', data.error = 'undecodable';
  } else if (ARCHIVE.test(data.contentType) || /\.zip$/i.test(row.key)) {
    data.kind = 'archive';
    const entries = await archiveImageHashes(buf);
    for (const e of entries) {
      await p.mediaHash.upsert({
        where: { key: `${row.key}#${e.entry}` },
        create: { key: `${row.key}#${e.entry}`, kind: 'archive-entry', ownerId: row.ownerId, refType: row.refType, refId: row.refId, contentType: 'image/*', bytes: e.bytes, phash: e.phash, width: e.width, height: e.height, status: 'hashed', hashedAt: new Date() },
        update: { phash: e.phash, width: e.width, height: e.height, status: 'hashed', hashedAt: new Date() },
      }).catch(() => {});
    }
  }
  return p.mediaHash.update({ where: { id: row.id }, data });
}

/**
 * Flags for one hashed row against everything hashed before it: byte-identical (sha256) or
 * within the threshold (pHash), from another owner (or an unknown one). Returns how many.
 */
export async function flagRow(p, row, { threshold }) {
  if (row.status !== 'hashed') return 0;
  const other = (m) => !(row.ownerId && m.ownerId && row.ownerId === m.ownerId) && m.id !== row.id && !(m.key.startsWith(row.key.split('#')[0] + '#'));
  const found = new Map();
  if (row.sha256) {
    const same = await p.mediaHash.findMany({ where: { sha256: row.sha256, id: { not: row.id } }, select: { id: true, ownerId: true, key: true, phash: true } });
    for (const m of same) if (other(m)) found.set(m.id, { distance: 0, reason: 'exact' });
  }
  if (row.phash) {
    const rows = await p.mediaHash.findMany({ where: { phash: { not: null }, id: { not: row.id } }, select: { id: true, ownerId: true, key: true, phash: true } });
    for (const { row: m, distance } of nearest(row.phash, rows, threshold)) if (other(m) && !found.has(m.id)) found.set(m.id, { distance, reason: 'near' });
  }
  let n = 0;
  for (const [matchId, { distance, reason }] of found) {
    // Both directions of the same pair are one flag.
    const dup = await p.mediaFlag.findFirst({ where: { OR: [{ hashId: row.id, matchId }, { hashId: matchId, matchId: row.id }] }, select: { id: true } });
    if (dup) continue;
    await p.mediaFlag.create({ data: { hashId: row.id, matchId, distance, reason } }).then(() => { n++; }).catch(() => {});
  }
  return n;
}

/** Link the OAuth avatars and team avatars that are not registered yet (a bounded batch). */
async function registerAvatars(p, limit = 30) {
  let n = 0;
  const users = await p.user.findMany({ where: { avatar: { not: null } }, orderBy: { updatedAt: 'desc' }, take: 400, select: { id: true, avatar: true } }).catch(() => []);
  for (const u of users) {
    if (n >= limit) break;
    const img = u.avatar && typeof u.avatar === 'object' ? u.avatar.image : null;
    if (!img || !/^https:\/\//i.test(img)) continue;
    let host; try { host = new URL(img).hostname; } catch { continue; }
    if (!AVATAR_HOSTS.test(host)) continue;
    const exists = await p.mediaHash.findUnique({ where: { key: img }, select: { id: true } });
    if (exists) continue;
    await recordUpload(p, { key: img, ownerId: u.id, kind: 'avatar', refType: 'user', refId: u.id, contentType: 'image/*' });
    n++;
  }
  const teams = await p.team.findMany({ where: { avatar: { not: null } }, take: 200, select: { id: true, avatar: true, ownerId: true } }).catch(() => []);
  for (const t of teams) {
    if (n >= limit) break;
    const img = t.avatar;
    if (!img || !/^https:\/\//i.test(img)) continue;
    let host; try { host = new URL(img).hostname; } catch { continue; }
    if (!AVATAR_HOSTS.test(host)) continue;
    const exists = await p.mediaHash.findUnique({ where: { key: img }, select: { id: true } });
    if (exists) continue;
    await recordUpload(p, { key: img, ownerId: t.ownerId, kind: 'team-avatar', refType: 'team', refId: t.id, contentType: 'image/*' });
    n++;
  }
  return n;
}

/** The sweeper's tick: register avatars, hash a batch of pending rows, flag what they match. */
export async function sweepMediaHashes(p, log, { limit = BATCH } = {}) {
  const cfg = await phashSettings(p);
  if (!cfg.enabled) return { hashed: 0, flagged: 0, skipped: true };
  await registerAvatars(p).catch(() => 0);
  const pending = await p.mediaHash.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: limit });
  let hashed = 0, flagged = 0;
  for (const row of pending) {
    let done;
    try { done = await hashRow(p, row); } catch (e) { await p.mediaHash.update({ where: { id: row.id }, data: { status: 'failed', error: String(e?.message || e).slice(0, 200) } }).catch(() => {}); continue; }
    if (!done) continue;
    hashed++;
    if (done.status === 'hashed') {
      flagged += await flagRow(p, done, cfg).catch(() => 0);
      if (done.kind === 'archive') {
        const entries = await p.mediaHash.findMany({ where: { key: { startsWith: row.key + '#' }, status: 'hashed' } });
        for (const e of entries) flagged += await flagRow(p, e, cfg).catch(() => 0);
      }
    }
  }
  if ((hashed || flagged) && log) log.info(`[media-hash] hashed ${hashed}, flagged ${flagged}`);
  return { hashed, flagged };
}

/** Stub rows for objects under the public media prefix that predate the register (owner unknown). */
export async function backfillStorage(p, { prefix = 'blog/', limit = 500 } = {}) {
  const { listObjects } = await import('./storage.mjs');
  if (typeof listObjects !== 'function') return 0;
  let n = 0;
  for await (const o of listObjects(prefix)) {
    if (n >= limit) break;
    if (!/\.(png|jpe?g|webp|gif|bmp|zip)$/i.test(o.key)) continue;
    const exists = await p.mediaHash.findUnique({ where: { key: o.key }, select: { id: true } });
    if (exists) continue;
    await recordUpload(p, { key: o.key, kind: 'upload', contentType: '', bytes: o.size || 0 });
    n++;
  }
  return n;
}

/** Where staff can look at a row's picture: a short-lived storage link, the avatar URL, or an entry served by the API. */
export async function previewOf(row) {
  if (row.kind === 'avatar' || row.kind === 'team-avatar') return { redirect: row.key };
  if (row.kind === 'archive-entry') return { entry: true };
  if (row.kind === 'archive') return null;
  try { return { redirect: await presignGet(row.key, 300) }; } catch { return null; }
}
