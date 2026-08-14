// Git-backed version history for two things an elevated admin can edit from
// "Advanced server management": files (server-control.mjs) and DB rows
// (server-control.mjs's DB viewer). Each has its own repo, mirroring just
// what's been touched (not a mirror of the whole filesystem/database) — every
// change commits the PRE-change content first, so the commit right before
// HEAD is always "what it looked like before this edit". Shells out to the
// real `git` CLI (installed in the api image) rather than a JS git library —
// simpler, and git's own gc/history is the actual feature being asked for.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { dirScan } from './native.mjs';

const execFileP = promisify(execFile);

// Confined to THIS container's own filesystem — no host mount, no Docker
// socket. Mirrors the same root the file manager itself browses/edits.
export const FILES_ROOT = path.resolve(process.env.SERVER_FILES_ROOT || '/app');
// Deliberately a SIBLING of FILES_ROOT, never nested inside it — the daily
// snapshot mirrors the entire FILES_ROOT tree into FILES_BACKUP_ROOT, and if
// the backup dir were inside the thing it's mirroring it would try to copy
// itself into itself (unbounded growth, at best; a copy error at worst).
export const FILES_BACKUP_ROOT = path.resolve(process.env.SERVER_BACKUP_ROOT || '/app-backups', 'files');
export const DB_BACKUP_ROOT = path.resolve(process.env.SERVER_BACKUP_ROOT || '/app-backups', 'db');

async function git(repoRoot, args) {
  return execFileP('git', args, { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
}

// CWE-22 guard: resolve a caller-supplied relative path against the repo root and
// refuse anything that escapes it (`../…`, absolute paths, symlink-y `..`). Defense
// in depth — callers are behind the elevated-admin gate, but a bad table/pk must
// never let a backup read/write outside its own git repo.
function safeJoin(repoRoot, relPath) {
  const root = path.resolve(repoRoot);
  const dest = path.resolve(root, String(relPath || ''));
  if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error('path_escapes_root');
  return dest;
}

async function ensureRepo(repoRoot) {
  await fs.mkdir(repoRoot, { recursive: true });
  try { await fs.access(path.join(repoRoot, '.git')); }
  catch {
    await git(repoRoot, ['init', '-q']);
    await git(repoRoot, ['config', 'user.email', 'backups@bettercommunity.local']);
    await git(repoRoot, ['config', 'user.name', 'BCWEB backups']);
  }
}

// Snapshot ONE file's current content into the backup repo (mirroring its
// relative path) and commit it — called with the PRE-change content, right
// before a write/delete is applied, so history reads "state before each edit".
export async function backupFile(repoRoot, relPath, content, message) {
  await ensureRepo(repoRoot);
  const dest = safeJoin(repoRoot, relPath); // rejects `../` traversal
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (content == null) { await fs.rm(dest, { force: true }); } // file didn't exist pre-change → nothing to snapshot
  else await fs.writeFile(dest, content);
  await git(repoRoot, ['add', '-A', '--', relPath]);
  // --allow-empty: two edits with identical content (or the "file didn't
  // exist" case) shouldn't fail the commit — the message itself is the record.
  await git(repoRoot, ['commit', '--allow-empty', '-q', '-m', message]);
  const { stdout } = await git(repoRoot, ['rev-parse', 'HEAD']);
  return stdout.trim();
}

// Directories that are either huge, irrelevant to "server files an admin
// might hand-edit", or (in node_modules' case) full of symlinks that trip up
// fs.cp's own recursive copy — excluded from the daily tree snapshot. The
// per-edit file backup (backupFile, above) is unaffected: it only ever
// touches the ONE file actually being edited, never a whole directory.
const SNAPSHOT_EXCLUDE = ['node_modules', '.git', '.backups'];

// A full-tree daily snapshot — mirrors the source directory (minus the
// excludes above) into the backup repo and commits whatever changed since
// yesterday in one commit, so there's always a same-day rollback point even
// if nobody touched anything through the file manager itself.
export async function snapshotTree(repoRoot, sourceRoot, message) {
  await ensureRepo(repoRoot);
  await fs.cp(sourceRoot, repoRoot, {
    recursive: true, force: true, dereference: true, // follow symlinks (e.g. node_modules/.bin) instead of copying them as links
    filter: (src) => {
      const rel = path.relative(sourceRoot, src);
      if (!rel || rel.startsWith('..')) return true; // sourceRoot itself
      const parts = rel.split(path.sep);
      return !SNAPSHOT_EXCLUDE.includes(parts[0]);
    },
  });
  await git(repoRoot, ['add', '-A']);
  const { stdout: status } = await git(repoRoot, ['status', '--porcelain']);
  if (!status.trim()) return null; // nothing changed since the last snapshot
  await git(repoRoot, ['commit', '-q', '-m', message]);
  const { stdout } = await git(repoRoot, ['rev-parse', 'HEAD']);
  return stdout.trim();
}

// History for one path — newest first.
export async function fileHistory(repoRoot, relPath, take = 30) {
  try {
    safeJoin(repoRoot, relPath); // reject a traversal path before it reaches git
    const { stdout } = await git(repoRoot, ['log', `-${take}`, '--format=%H|%ct|%s', '--', relPath]);
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [hash, ts, ...rest] = line.split('|');
      return { hash, at: new Date(Number(ts) * 1000).toISOString(), message: rest.join('|') };
    });
  } catch { return []; }
}

// Files that were deleted through the manager and are still gone.
//
// The backup repo does NOT mirror the deletion — backupFile is called with the content as
// it was JUST BEFORE the delete, so the file lives on in git while vanishing from disk.
// That is what makes restoring possible at all, and also why a deleted file is invisible:
// it is absent from the only listing anyone looks at, so the one moment you need its
// history is the one moment you cannot navigate to it.
//
// Found by commit MESSAGE rather than by walking the tree: `backupFile` writes
// "<uid> deleted <path>" on a delete, and matching that is exact and cheap. Walking every
// tracked path and stat-ing it would also work and would cost a syscall per file in a
// repo that the daily tree snapshot fills with the entire application.
//
// Each candidate is then checked against the real root: a path that has since been
// re-created (restored, or simply written again) is no longer deleted and must not be
// offered for restore.
export async function deletedFiles(repoRoot, filesRoot, take = 200) {
  try {
    await fs.access(path.join(repoRoot, '.git'));
  } catch { return []; }
  let stdout;
  try { ({ stdout } = await git(repoRoot, ['log', `-${take}`, '--format=%H|%ct|%s'])); }
  catch { return []; }
  const seen = new Set();
  const out = [];
  for (const line of stdout.trim().split(String.fromCharCode(10)).filter(Boolean)) {
    const [hash, ts, ...rest] = line.split('|');
    const subject = rest.join('|');
    const m = /^(\S+) deleted (.+)$/.exec(subject);
    if (!m) continue;
    const [, by, rel] = m;
    // Only the most recent deletion of a given path matters; older ones are superseded.
    if (seen.has(rel)) continue;
    seen.add(rel);
    let stillGone = false;
    try { await fs.access(safeJoin(filesRoot, rel)); } catch { stillGone = true; }
    if (!stillGone) continue;
    out.push({ path: rel, hash, by, at: new Date(Number(ts) * 1000).toISOString() });
  }
  return out;
}

// The file's content exactly as it was at a given commit. `hash` must be a plain
// git object id (hex) and `relPath` must stay inside the repo — both are validated
// before being composed into the `git show <hash>:<path>` argument.
export async function fileAtCommit(repoRoot, hash, relPath) {
  if (!/^[0-9a-fA-F]{7,64}$/.test(String(hash || ''))) throw new Error('bad_hash');
  safeJoin(repoRoot, relPath); // reject `../` traversal in the tree path
  const { stdout } = await git(repoRoot, ['show', `${hash}:${relPath}`]);
  return stdout;
}

// The whole repo as ONE file, history included.
//
// `git bundle` rather than a tar of the directory: a bundle is a single artefact that
// `git clone` accepts directly, so an admin who downloads one can open it years later
// with a tool they already have, on a machine that knows nothing about this application.
// A tar of `.git` would technically work and would be worse — it is only openable by
// someone who knows it is a git repo in disguise.
//
// `--all` covers every ref, so the download is the complete history rather than one
// branch's view of it.
export async function bundleRepo(repoRoot) {
  await fs.access(path.join(repoRoot, '.git')); // throws → caller answers 404
  const out = path.join(os.tmpdir(), `bcw-backup-${Date.now()}-${Math.random().toString(36).slice(2)}.bundle`);
  try {
    await git(repoRoot, ['bundle', 'create', out, '--all']);
    return { file: out, bytes: await fs.readFile(out) };
  } finally {
    // The temp file is read into memory and then dropped: leaving bundles behind in
    // /tmp would quietly become a second, unmanaged copy of every backup on the box.
    await fs.rm(out, { force: true }).catch(() => {});
  }
}


// ── Reading a bundle back ────────────────────────────────────────────────────

/** What is inside a bundle, and whether git will accept it.
 *
 *  `git bundle verify` is the real check and it is not a formality: a bundle is a pack
 *  file with a prerequisite list, and one that is truncated, corrupted, or made against a
 *  history this repo does not have will fail here rather than half-way through a restore.
 *  Verifying BEFORE anything is written is what makes "import" safe to offer at all.
 */
export async function inspectBundle(bytes) {
  const tmp = path.join(os.tmpdir(), `bcw-inspect-${Date.now()}-${Math.random().toString(36).slice(2)}.bundle`);
  const work = `${tmp}.d`;
  try {
    await fs.writeFile(tmp, bytes);
    await fs.mkdir(work, { recursive: true });
    // An empty repo to verify against: `git bundle verify` needs to run inside one, and a
    // fresh one has no history, so a self-contained bundle (--all from a full repo) checks
    // out while an incremental one honestly reports its missing prerequisites.
    await execFileP('git', ['init', '-q', work]);
    let heads = [];
    try {
      const { stdout } = await execFileP('git', ['bundle', 'list-heads', tmp], { cwd: work, maxBuffer: 8 * 1024 * 1024 });
      heads = stdout.trim().split(String.fromCharCode(10)).filter(Boolean).map((l) => {
        const [sha, ...ref] = l.split(/\s+/);
        return { sha, ref: ref.join(' ') };
      });
    } catch (e) {
      return { valid: false, error: String(e?.stderr || e?.message || e).slice(0, 400), heads: [], commits: [] };
    }
    let verifyOut = '';
    let valid = true;
    try {
      const r = await execFileP('git', ['bundle', 'verify', tmp], { cwd: work, maxBuffer: 8 * 1024 * 1024 });
      verifyOut = `${r.stdout}${r.stderr || ''}`.trim();
    } catch (e) {
      valid = false;
      verifyOut = String(e?.stderr || e?.message || e).slice(0, 400);
    }
    // The tip commits, so a human can recognise WHICH backup this is before restoring it.
    let commits = [];
    if (valid) {
      try {
        await execFileP('git', ['fetch', '-q', tmp, '+refs/*:refs/bundle/*'], { cwd: work, maxBuffer: 32 * 1024 * 1024 });
        const { stdout } = await execFileP('git', ['log', '-25', '--format=%H|%ct|%s', '--all'], { cwd: work, maxBuffer: 8 * 1024 * 1024 });
        commits = stdout.trim().split(String.fromCharCode(10)).filter(Boolean).map((line) => {
          const [hash, ts, ...rest] = line.split('|');
          return { hash, at: new Date(Number(ts) * 1000).toISOString(), message: rest.join('|') };
        });
      } catch { /* verified but unreadable: report it as verified with no log rather than failing */ }
    }
    return { valid, verify: verifyOut, heads, commits, bytes: bytes.length };
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Replace a backup repo's history with a bundle's, and optionally the files with it.
 *
 *  The repo is reset to the bundle's tip. `applyToDisk` additionally copies that tree over
 *  the live source directory — which is the part that actually changes what the server is
 *  running, and the reason it is a separate, explicit flag rather than part of "restore".
 *  Restoring history is reversible; overwriting /app is not.
 */
export async function restoreFromBundle(repoRoot, bundlePath, { applyToDisk = null } = {}) {
  await ensureRepo(repoRoot);
  await git(repoRoot, ['fetch', '-q', bundlePath, '+refs/heads/*:refs/restored/*']);
  const { stdout: refs } = await git(repoRoot, ['for-each-ref', '--format=%(refname)', 'refs/restored/']);
  const first = refs.trim().split(String.fromCharCode(10)).filter(Boolean)[0];
  if (!first) throw new Error('bundle_has_no_branch');
  await git(repoRoot, ['reset', '--hard', first]);
  const { stdout: head } = await git(repoRoot, ['rev-parse', 'HEAD']);

  let copied = 0;
  let extra = [];
  if (applyToDisk) {
    // Same exclusions as the snapshot that produced it — copying .git or node_modules back
    // over a running tree is how a restore becomes an outage.
    const entries = await fs.readdir(repoRoot, { withFileTypes: true });
    const restored = new Set();
    for (const e of entries) {
      if (SNAPSHOT_EXCLUDE.includes(e.name)) continue;
      restored.add(e.name);
      await fs.cp(path.join(repoRoot, e.name), path.join(applyToDisk, e.name), { recursive: true, force: true });
      copied++;
    }
    // What is on disk and NOT in the backup. This is a copy-over, not a wipe-and-replace,
    // so anything created after the snapshot survives it — which makes the result a merge
    // rather than the state the backup describes.
    //
    // Deleting them instead would be worse than the problem: this directory is the running
    // application, and a rollback that removes "unknown" paths removes uploads, caches and
    // anything a later version writes at runtime. So they are REPORTED, and the admin
    // decides. Silently leaving them is the only genuinely wrong option.
    const onDisk = await fs.readdir(applyToDisk, { withFileTypes: true }).catch(() => []);
    extra = onDisk.filter((e) => !SNAPSHOT_EXCLUDE.includes(e.name) && !restored.has(e.name)).map((e) => e.name);
  }
  return { head: head.trim(), ref: first, copied, extra };
}

// Recent commits in a backup repo (named backupLog, not repoLog: lib.mjs already
// exports a repoLog for per-repository audit entries, and two different "repo logs"
// imported into one file is a bug waiting for a tired afternoon) — what is actually stored, rather than only how many
// bytes it takes. A size with no contents is a number you cannot act on.
export async function backupLog(repoRoot, take = 50) {
  try {
    await fs.access(path.join(repoRoot, '.git'));
    const { stdout } = await git(repoRoot, ['log', `-${take}`, '--format=%H|%ct|%s']);
    return stdout.trim().split(String.fromCharCode(10)).filter(Boolean).map((line) => {
      const [hash, ts, ...rest] = line.split('|');
      return { hash, at: new Date(Number(ts) * 1000).toISOString(), message: rest.join('|') };
    });
  } catch { return []; }
}

// Recursive on-disk size of the backup repo (incl. .git — that's real disk usage too), for
// the Storage tab's ledger. The tree walk runs on a worker thread via the native dirScan
// (falls back to a JS readdir walk), so a big repo doesn't block the event loop.
export async function repoSizeBytes(repoRoot) {
  const files = await dirScan(repoRoot);
  return files.reduce((a, f) => a + (f.size || 0), 0);
}

// Best-effort space reclaim — compacts loose objects into packfiles. Never
// rewrites/drops history on its own (that would silently destroy the exact
// thing this system exists to keep) — if a repo is still over its configured
// limit after gc, the caller should stop taking new snapshots and tell an
// admin, not delete old ones automatically.
export async function gcRepo(repoRoot) {
  try { await git(repoRoot, ['gc', '--prune=now', '-q']); } catch { /* best effort */ }
}
