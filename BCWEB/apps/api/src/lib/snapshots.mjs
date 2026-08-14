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

export const SNAPSHOT_KINDS = ['files', 'db'];
const rootFor = (kind) => (kind === 'db' ? DB_BACKUP_ROOT : FILES_BACKUP_ROOT);

// Ids are generated here and never taken from a request, but they still arrive back as a
// URL segment — so they get a strict shape, and every lookup checks it before touching a
// path. An id that cannot contain a dot or a slash cannot walk out of the directory.
const ID_RE = /^(files|db)-\d{8}T\d{6}-[a-f0-9]{8}$/;
export const validSnapshotId = (id) => typeof id === 'string' && ID_RE.test(id);

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');

async function readMeta(id) {
  try { return JSON.parse(await fs.readFile(path.join(SNAPSHOT_ROOT, `${id}.json`), 'utf8')); }
  catch { return null; }
}

/** Every snapshot on disk, newest first. Driven by the sidecars, not by the bundles: a
 *  bundle with no sidecar has no size, no author and no signature, so it is not something
 *  this can honestly list. */
export async function listSnapshots() {
  let names;
  try { names = await fs.readdir(SNAPSHOT_ROOT); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const id = n.slice(0, -5);
    if (!validSnapshotId(id)) continue;
    const meta = await readMeta(id);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Take one snapshot of one repo.
 *
 *  `sign` is passed in rather than imported so this module never reaches for the database —
 *  a backup routine that needs Postgres up to write a file is a backup routine that fails
 *  exactly when you need it.
 */
export async function createSnapshot(kind, { by = '', note = '', sign = null } = {}) {
  if (!SNAPSHOT_KINDS.includes(kind)) throw new Error('bad_kind');
  const bundle = await bundleRepo(rootFor(kind)); // throws when nothing has been backed up yet
  await fs.mkdir(SNAPSHOT_ROOT, { recursive: true });
  const id = `${kind}-${stamp(new Date())}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(path.join(SNAPSHOT_ROOT, `${id}.bundle`), bundle.bytes);
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
  await fs.writeFile(path.join(SNAPSHOT_ROOT, `${id}.json`), JSON.stringify(meta, null, 2));
  return meta;
}

export async function snapshotBytes(id) {
  if (!validSnapshotId(id)) return null;
  const meta = await readMeta(id);
  if (!meta) return null;
  try { return { meta, bytes: await fs.readFile(path.join(SNAPSHOT_ROOT, `${id}.bundle`)) }; }
  catch { return null; }
}

export async function deleteSnapshot(id) {
  if (!validSnapshotId(id)) return false;
  const hit = await readMeta(id);
  if (!hit) return false;
  await fs.rm(path.join(SNAPSHOT_ROOT, `${id}.bundle`), { force: true });
  await fs.rm(path.join(SNAPSHOT_ROOT, `${id}.json`), { force: true });
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
export async function pruneSnapshots(keep) {
  const n = Number(keep);
  if (!Number.isFinite(n) || n <= 0) return [];
  const all = await listSnapshots();
  const removed = [];
  for (const kind of SNAPSHOT_KINDS) {
    const mine = all.filter((s) => s.kind === kind); // already newest-first
    for (const old of mine.slice(n)) {
      if (await deleteSnapshot(old.id)) removed.push(old.id);
    }
  }
  return removed;
}
