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
  const dest = path.join(repoRoot, relPath);
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
    const { stdout } = await git(repoRoot, ['log', `-${take}`, '--format=%H|%ct|%s', '--', relPath]);
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [hash, ts, ...rest] = line.split('|');
      return { hash, at: new Date(Number(ts) * 1000).toISOString(), message: rest.join('|') };
    });
  } catch { return []; }
}

// The file's content exactly as it was at a given commit.
export async function fileAtCommit(repoRoot, hash, relPath) {
  const { stdout } = await git(repoRoot, ['show', `${hash}:${relPath}`]);
  return stdout;
}

// Recursive on-disk size of the backup repo (incl. .git — that's real disk
// usage too), for the Storage tab's ledger.
export async function repoSizeBytes(repoRoot) {
  async function walk(dir) {
    let total = 0;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return 0; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) total += await walk(full);
      else { const st = await fs.stat(full).catch(() => null); if (st) total += st.size; }
    }
    return total;
  }
  return walk(repoRoot);
}

// Best-effort space reclaim — compacts loose objects into packfiles. Never
// rewrites/drops history on its own (that would silently destroy the exact
// thing this system exists to keep) — if a repo is still over its configured
// limit after gc, the caller should stop taking new snapshots and tell an
// admin, not delete old ones automatically.
export async function gcRepo(repoRoot) {
  try { await git(repoRoot, ['gc', '--prune=now', '-q']); } catch { /* best effort */ }
}
