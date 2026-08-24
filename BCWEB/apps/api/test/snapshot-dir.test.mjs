// Where backups are written, and — the part that actually matters — where they are read.
//
// Letting an admin choose a destination is easy. The failure mode is the one that shows up
// weeks later: they point backups at a mounted disk, and every backup taken before that
// silently disappears from the list. Nothing errors. The screen just gets shorter, and the
// person who changed the setting is the last one who would notice.
//
// So these tests are mostly about reads finding both places, and about the two destinations
// that are mistakes rather than merely unusual.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `bcweb-snapdir-${process.pid}`);
// SERVER_BACKUP_ROOT is the parent — the module appends 'snapshots' to it. Writing the
// fixtures one level too high made every read return nothing, which is exactly how this
// looks in production when the env var points at the wrong level.
const BACKUP_ROOT = path.join(TMP, 'default');
const DEFAULT_ROOT = path.join(BACKUP_ROOT, 'snapshots');
const ELSEWHERE = path.join(TMP, 'elsewhere');

// SNAPSHOT_ROOT is resolved at import time from the environment, so it has to be set before
// the module is loaded — which is why this is a dynamic import inside `before`.
let snap;
before(async () => {
  await fs.mkdir(DEFAULT_ROOT, { recursive: true });
  await fs.mkdir(ELSEWHERE, { recursive: true });
  process.env.SERVER_BACKUP_ROOT = BACKUP_ROOT;
  snap = await import('../src/lib/snapshots.mjs');
});
after(() => fs.rm(TMP, { recursive: true, force: true }));

/** Write a snapshot sidecar + bundle by hand.
 *
 *  createSnapshot() needs a git repo with a commit in it; what these tests are about is the
 *  directory logic on top, so the artefacts are placed directly.
 */
async function place(dir, id, extra = {}) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.bundle`), 'not-a-real-bundle');
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({
    id, kind: id.split('-')[0], bytes: 17, sha256: 'x'.repeat(64),
    createdAt: '2026-08-24T10:00:00.000Z', by: 'test', note: '', ...extra,
  }));
  return id;
}

describe('checkSnapshotDir', () => {
  test('empty means the default, and says so as null rather than as an error', () => {
    assert.deepEqual(snap.checkSnapshotDir('', '/app'), { ok: true, dir: null });
    assert.deepEqual(snap.checkSnapshotDir('   ', '/app'), { ok: true, dir: null });
    assert.deepEqual(snap.checkSnapshotDir(null, '/app'), { ok: true, dir: null });
  });

  test('a relative path is refused — it would resolve against whatever cwd happens to be', () => {
    const r = snap.checkSnapshotDir('backups', '/app');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not_absolute');
  });

  test('THE ONE: a directory inside the backed-up tree is refused', () => {
    // Each snapshot would contain the previous ones, so the disk usage squares. The first
    // symptom is a full disk, long after the setting was changed.
    const inside = path.join(path.resolve('/app'), 'backups');
    const r = snap.checkSnapshotDir(inside, '/app');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'inside_files_root');
  });

  test('the backed-up tree ITSELF is refused, not just a child of it', () => {
    assert.equal(snap.checkSnapshotDir(path.resolve('/app'), '/app').reason, 'inside_files_root');
  });

  test('a sibling whose name merely starts the same is allowed', () => {
    // /app-backups is not inside /app, and a naive startsWith() would say it is.
    const r = snap.checkSnapshotDir(path.resolve('/app-backups'), '/app');
    assert.equal(r.ok, true);
    assert.equal(r.dir, path.resolve('/app-backups'));
  });

  test('the root of the disk is refused', () => {
    const root = path.parse(path.resolve('/')).root;
    assert.equal(snap.checkSnapshotDir(root, '/app').reason, 'is_root');
  });

  test('a null byte is refused before anything touches the filesystem', () => {
    assert.equal(snap.checkSnapshotDir(`${path.resolve('/tmp')}\0/x`, '/app').reason, 'bad_path');
  });
});

describe('listing across the two locations', () => {
  test('with no destination set, only the default is read', async () => {
    await place(DEFAULT_ROOT, 'files-20260824T100000-aaaaaaaa');
    await place(ELSEWHERE, 'files-20260824T100001-bbbbbbbb');
    const ids = (await snap.listSnapshots(null)).map((s) => s.id);
    assert.ok(ids.includes('files-20260824T100000-aaaaaaaa'));
    assert.ok(!ids.includes('files-20260824T100001-bbbbbbbb'));
  });

  test('THE ONE: with a destination set, the ones at the old place are still listed', async () => {
    const ids = (await snap.listSnapshots(ELSEWHERE)).map((s) => s.id);
    assert.ok(ids.includes('files-20260824T100001-bbbbbbbb'), 'the new destination');
    assert.ok(ids.includes('files-20260824T100000-aaaaaaaa'), 'and the ones already taken');
  });

  test('each one says where it is, so a delete goes back to the same directory', async () => {
    const all = await snap.listSnapshots(ELSEWHERE);
    const atDefault = all.find((s) => s.id === 'files-20260824T100000-aaaaaaaa');
    const atNew = all.find((s) => s.id === 'files-20260824T100001-bbbbbbbb');
    assert.equal(atDefault.dir, DEFAULT_ROOT);
    assert.equal(atDefault.atDefault, true);
    assert.equal(atNew.dir, ELSEWHERE);
    assert.equal(atNew.atDefault, false);
  });

  test('newest first, across both directories rather than within each', async () => {
    await place(ELSEWHERE, 'files-20260824T235959-cccccccc', { createdAt: '2026-08-24T23:59:59.000Z' });
    const all = await snap.listSnapshots(ELSEWHERE);
    assert.equal(all[0].id, 'files-20260824T235959-cccccccc');
  });

  test('THE OTHER ONE: clearing the destination does not hide what was written to it', async () => {
    // The direction I did not think of, and the unit tests above did not cover: every test
    // here went default -> custom, and going BACK lost a real backup on the live server.
    // The file was still on disk; the list was simply empty.
    const ids = (await snap.listSnapshots([null, ELSEWHERE])).map((s) => s.id);
    assert.ok(ids.includes('files-20260824T100001-bbbbbbbb'), 'still listed after the destination was cleared');
  });

  test('a past location that no longer exists is skipped, not fatal', async () => {
    const gone = path.join(TMP, 'unplugged-usb-stick');
    const ids = (await snap.listSnapshots([ELSEWHERE, gone])).map((s) => s.id);
    assert.ok(ids.length > 0, 'the readable locations still answer');
  });

  test('the same directory listed twice does not duplicate a backup', async () => {
    const ids = (await snap.listSnapshots([ELSEWHERE, ELSEWHERE, `${ELSEWHERE}${path.sep}`])).map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('a name that is not a valid snapshot id is ignored, not listed as a broken row', async () => {
    await fs.writeFile(path.join(ELSEWHERE, 'notes.json'), '{}');
    await fs.writeFile(path.join(ELSEWHERE, 'files-nope.json'), '{}');
    const ids = (await snap.listSnapshots(ELSEWHERE)).map((s) => s.id);
    assert.ok(!ids.some((id) => id.includes('nope') || id.includes('notes')));
  });
});

describe('reaching one by id', () => {
  test('a backup at the old location can still be downloaded', async () => {
    const hit = await snap.snapshotBytes('files-20260824T100000-aaaaaaaa', ELSEWHERE);
    assert.ok(hit, 'found despite living in the other directory');
    assert.equal(hit.bytes.toString(), 'not-a-real-bundle');
    assert.equal(hit.meta.dir, DEFAULT_ROOT);
  });

  test('snapshotPath points at the file that exists, not at the configured directory', async () => {
    const p = await snap.snapshotPath('files-20260824T100000-aaaaaaaa', ELSEWHERE);
    assert.equal(p, path.join(DEFAULT_ROOT, 'files-20260824T100000-aaaaaaaa.bundle'));
  });

  test('an id that is not there is not found rather than resolved to a path', async () => {
    assert.equal(await snap.snapshotBytes('files-20260824T000000-deadbeef', ELSEWHERE), null);
    await assert.rejects(() => snap.snapshotPath('files-20260824T000000-deadbeef', ELSEWHERE));
  });

  test('an id shaped to escape the directory is refused by the shape check', async () => {
    assert.equal(snap.validSnapshotId('../../etc/passwd'), false);
    assert.equal(await snap.snapshotBytes('../../etc/passwd', ELSEWHERE), null);
    assert.equal(await snap.deleteSnapshot('../../etc/passwd', ELSEWHERE), false);
  });

  test('deleting removes the file from wherever it actually lives', async () => {
    assert.equal(await snap.deleteSnapshot('files-20260824T100000-aaaaaaaa', ELSEWHERE), true);
    await assert.rejects(() => fs.stat(path.join(DEFAULT_ROOT, 'files-20260824T100000-aaaaaaaa.bundle')));
    // and it is gone from the listing, not merely from the disk
    const ids = (await snap.listSnapshots(ELSEWHERE)).map((s) => s.id);
    assert.ok(!ids.includes('files-20260824T100000-aaaaaaaa'));
  });
});

describe('rotation', () => {
  test('counts per kind across both directories, and keeps the newest', async () => {
    for (const d of [DEFAULT_ROOT, ELSEWHERE]) {
      await fs.rm(d, { recursive: true, force: true });
      await fs.mkdir(d, { recursive: true });
    }
    // Three file snapshots split across the two locations, plus one db snapshot that must
    // survive a files-only rotation.
    await place(DEFAULT_ROOT, 'files-20260101T000000-11111111', { createdAt: '2026-01-01T00:00:00.000Z' });
    await place(ELSEWHERE, 'files-20260202T000000-22222222', { createdAt: '2026-02-02T00:00:00.000Z' });
    await place(ELSEWHERE, 'files-20260303T000000-33333333', { createdAt: '2026-03-03T00:00:00.000Z' });
    await place(ELSEWHERE, 'db-20260101T000000-44444444', { createdAt: '2026-01-01T00:00:00.000Z' });

    const removed = await snap.pruneSnapshots(2, ELSEWHERE);
    assert.deepEqual(removed, ['files-20260101T000000-11111111'], 'the oldest file one, wherever it was');

    const ids = (await snap.listSnapshots(ELSEWHERE)).map((s) => s.id);
    assert.ok(ids.includes('db-20260101T000000-44444444'), 'the db snapshot is not evicted by a shared budget');
    assert.equal(ids.filter((id) => id.startsWith('files-')).length, 2);
  });

  test('keep 0 means never rotate — the disabled state cannot delete anything', async () => {
    assert.deepEqual(await snap.pruneSnapshots(0, ELSEWHERE), []);
    assert.deepEqual(await snap.pruneSnapshots(-1, ELSEWHERE), []);
    assert.deepEqual(await snap.pruneSnapshots(undefined, ELSEWHERE), []);
  });
});
