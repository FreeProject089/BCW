// Point-in-time backups you can actually hold: one file per snapshot, taken on demand.
//
// This is a different thing from the git repos in gitbackup.mjs, and the difference is the
// whole point. Those are a *history* — always growing, always the live copy, and a `git gc`
// or a corrupted object takes the lot. A snapshot is a frozen artefact with a name, a size
// and a signature, sitting next to its siblings, which is what "generate a backup" means to
// everyone who has ever asked for one.
//
// The two are not redundant: the snapshot is produced FROM the history (a git bundle of it),
// so the history stays the source of truth and the snapshot is the thing you can copy off
// the box, e-mail to yourself, or restore from after the box is gone.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { FILES_BACKUP_ROOT, DB_BACKUP_ROOT, bundleRepo } from './gitbackup.mjs';

export const SNAPSHOT_ROOT = path.resolve(process.env.SERVER_BACKUP_ROOT || '/app-backups', 'snapshots');

/** Where a call should WRITE.
 *
 *  `dir` is either the destination, or a list whose FIRST entry is the destination and whose
 *  tail is every place backups have been written before. Empty means the default.
 */
const writeDir = (dir) => {
  const first = Array.isArray(dir) ? dir[0] : dir;
  return first ? path.resolve(first) : SNAPSHOT_ROOT;
};

/** Where a call should LOOK — the destination, everywhere it has been, and the default.
 *
 *  All of them, always, and this is the whole reason the destination is safe to change:
 *  point backups at a mounted disk and the ones already on the internal disk stay listed,
 *  downloadable and restorable — and point it BACK, and the ones on the mounted disk do too.
 *
 *  That second direction is not hypothetical. Searching only [destination, default] passed
 *  every test I wrote and then lost a real backup the moment the destination was cleared:
 *  the file was still on disk, and the list was empty. A setting that hides existing backups
 *  is a setting that loses them, because the person who changed it will not go looking.
 */
function readDirs(dir) {
  const list = (Array.isArray(dir) ? dir : [dir]).filter(Boolean).map((d) => path.resolve(d));
  return [...new Set([...list, SNAPSHOT_ROOT])];
}

/** Refuse a destination that would break something rather than merely be unusual.
 *
 *  Not a sandbox: an elevated admin already has a file manager and a database console, so
 *  confining this to a whitelist would only stop the legitimate use (an external disk).
 *  It rejects the two that are actual mistakes — a relative path, which resolves against
 *  whatever the process's cwd happens to be, and a directory inside the tree being backed
 *  up, which would make each snapshot contain the previous ones.
 */
export function checkSnapshotDir(dir, filesRoot) {
  const raw = String(dir || '').trim();
  if (!raw) return { ok: true, dir: null };            // empty = the default, as before
  if (raw.includes('\0')) return { ok: false, reason: 'bad_path' };
  if (!path.isAbsolute(raw)) return { ok: false, reason: 'not_absolute' };
  const abs = path.resolve(raw);
  if (abs === path.parse(abs).root) return { ok: false, reason: 'is_root' };
  const inside = (parent, child) => {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (filesRoot && inside(path.resolve(filesRoot), abs)) return { ok: false, reason: 'inside_files_root' };
  return { ok: true, dir: abs };
}

export const SNAPSHOT_KINDS = ['files', 'db'];
const rootFor = (kind) => (kind === 'db' ? DB_BACKUP_ROOT : FILES_BACKUP_ROOT);

// Ids are generated here and never taken from a request, but they still arrive back as a
// URL segment — so they get a strict shape, and every lookup checks it before touching a
// path. An id that cannot contain a dot or a slash cannot walk out of the directory.
const ID_RE = /^(files|db)-\d{8}T\d{6}-[a-f0-9]{8}$/;
export const validSnapshotId = (id) => typeof id === 'string' && ID_RE.test(id);

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');

async function readMeta(id, dir) {
  for (const d of readDirs(dir)) {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(d, `${id}.json`), 'utf8'));
      // Where it actually is, not where the config currently points — a caller that then
      // deletes or downloads it must go back to the same directory.
      return { ...meta, dir: d };
    } catch { /* try the next directory */ }
  }
  return null;
}

/** Every snapshot on disk, newest first. Driven by the sidecars, not by the bundles: a
 *  bundle with no sidecar has no size, no author and no signature, so it is not something
 *  this can honestly list. */
export async function listSnapshots(dir) {
  const out = [];
  const seen = new Set();
  for (const d of readDirs(dir)) {
    let names;
    try { names = await fs.readdir(d); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const id = n.slice(0, -5);
      if (!validSnapshotId(id) || seen.has(id)) continue;
      seen.add(id);
      try {
        const meta = JSON.parse(await fs.readFile(path.join(d, n), 'utf8'));
        out.push({ ...meta, dir: d, atDefault: d === SNAPSHOT_ROOT });
      } catch { /* a sidecar we cannot read is not a snapshot we can honestly list */ }
    }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Take one snapshot of one repo.
 *
 *  `sign` is passed in rather than imported so this module never reaches for the database —
 *  a backup routine that needs Postgres up to write a file is a backup routine that fails
 *  exactly when you need it.
 */
export async function createSnapshot(kind, { by = '', note = '', sign = null, dir = null } = {}) {
  if (!SNAPSHOT_KINDS.includes(kind)) throw new Error('bad_kind');
  const bundle = await bundleRepo(rootFor(kind)); // throws when nothing has been backed up yet
  const target = writeDir(dir);
  await fs.mkdir(target, { recursive: true });
  const id = `${kind}-${stamp(new Date())}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(path.join(target, `${id}.bundle`), bundle.bytes);
  const meta = {
    id,
    kind,
    bytes: bundle.bytes.length,
    // Checkable with sha256sum and nothing else. The signature proves this server made it;
    // the digest proves the file did not rot on the way to wherever it ends up.
    sha256: crypto.createHash('sha256').update(bundle.bytes).digest('hex'),
    signature: sign ? await sign(bundle.bytes).catch(() => null) : null,
    signatureAlg: 'Ed25519',
    createdAt: new Date().toISOString(),
    by,
    note: String(note || '').slice(0, 200),
  };
  await fs.writeFile(path.join(target, `${id}.json`), JSON.stringify(meta, null, 2));
  return { ...meta, dir: target };
}


/** Where a snapshot's bundle lives. Exported so a restore can hand the PATH to git rather
 *  than re-writing megabytes through a temp file it already has on disk. */
export async function snapshotPath(id, dir) {
  if (!validSnapshotId(id)) throw new Error('bad_id');
  const meta = await readMeta(id, dir);
  if (!meta) throw new Error('not_found');
  return path.join(meta.dir, `${id}.bundle`);
}

/** Store a bundle that came from somewhere else.
 *
 *  Identical on disk to one we produced — same id shape, same sidecar — because a restore
 *  should not care where a backup came from. `by` records who brought it in, and the note
 *  defaults to saying it was imported, which is the one fact the file itself cannot carry.
 */
export async function importSnapshot(kind, bytes, { by = '', note = '', sign = null, dir = null } = {}) {
  if (!SNAPSHOT_KINDS.includes(kind)) throw new Error('bad_kind');
  const target = writeDir(dir);
  await fs.mkdir(target, { recursive: true });
  const id = `${kind}-${stamp(new Date())}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(path.join(target, `${id}.bundle`), bytes);
  const meta = {
    id, kind, bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    // Signed on arrival, which vouches for "this server holds this file", NOT for where it
    // came from. The sidecar says imported so the two are never confused.
    signature: sign ? await sign(bytes).catch(() => null) : null,
    signatureAlg: 'Ed25519',
    createdAt: new Date().toISOString(),
    by, note: String(note || 'imported').slice(0, 200),
    imported: true,
  };
  await fs.writeFile(path.join(target, `${id}.json`), JSON.stringify(meta, null, 2));
  return { ...meta, dir: target };
}

export async function snapshotBytes(id, dir) {
  if (!validSnapshotId(id)) return null;
  const meta = await readMeta(id, dir);
  if (!meta) return null;
  try { return { meta, bytes: await fs.readFile(path.join(meta.dir, `${id}.bundle`)) }; }
  catch { return null; }
}

export async function deleteSnapshot(id, dir) {
  if (!validSnapshotId(id)) return false;
  const hit = await readMeta(id, dir);
  if (!hit) return false;
  // hit.dir, not the configured one: a snapshot left behind at the old destination has to
  // be deletable from the same screen that lists it.
  await fs.rm(path.join(hit.dir, `${id}.bundle`), { force: true });
  await fs.rm(path.join(hit.dir, `${id}.json`), { force: true });
  return true;
}

/** Drop the oldest snapshots past `keep`, counted PER KIND.
 *
 *  Per kind because the alternative silently starves one of them: ten daily file snapshots
 *  would evict every db snapshot from a shared budget of ten, and the first person to
 *  notice would be someone restoring a database.
 *
 *  keep <= 0 means "never rotate" — and it means it. Rotation deletes backups, so the
 *  disabled state has to be the one that cannot surprise anybody.
 */
export async function pruneSnapshots(keep, dir) {
  const n = Number(keep);
  if (!Number.isFinite(n) || n <= 0) return [];
  const all = await listSnapshots(dir);
  const removed = [];
  for (const kind of SNAPSHOT_KINDS) {
    const mine = all.filter((s) => s.kind === kind); // already newest-first
    for (const old of mine.slice(n)) {
      if (await deleteSnapshot(old.id, dir)) removed.push(old.id);
    }
  }
  return removed;
}
