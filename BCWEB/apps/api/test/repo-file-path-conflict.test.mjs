// A hosted repo path cannot be both a file and a folder (agent-s3-replace, Sept 24 2026).
//
// Object storage moved from MinIO to versitygw with its POSIX backend: every object is a real
// file on disk, so `mods` and `mods/a.zip` cannot both exist — the store answers the second PUT
// with 409 (ObjectParentIsFile / ExistingObjectIsDirectory). That PUT comes from the BROWSER,
// after the api had already handed out a presigned URL, so the owner saw an upload fail for no
// stated reason. MinIO took both and then listed only one of them, which was worse and silent.
// presignRepoFile now refuses the clash itself, with the path it collides with.
//
// No database and no storage: presignRepoFile reads the repo it is given and signs offline.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'repo-path-conflict-secret';
process.env.S3_PUBLIC_ENDPOINT ||= 'http://localhost:9000';
process.env.S3_ACCESS_KEY ||= 'test-access';
process.env.S3_SECRET_KEY ||= 'test-secret';

let presignRepoFile, RepoOpError;
before(async () => { ({ presignRepoFile, RepoOpError } = await import('../src/routes/hosting-content.mjs')); });

const repo = (...paths) => ({ id: 'r1', storageQuotaBytes: 10n ** 12n, files: paths.map((path) => ({ path, size: 1n })) });

async function refusal(r, path) {
  try { await presignRepoFile(null, r, { path, size: 1 }); return null; } catch (e) { return e; }
}

describe('presignRepoFile refuses a path that is also a folder', () => {
  test('a file under an existing FILE is refused, naming the file', async () => {
    const e = await refusal(repo('mods'), 'mods/a.zip');
    assert.ok(e instanceof RepoOpError, `expected a RepoOpError, got ${e}`);
    assert.equal(e.code, 'path_conflict');
    assert.equal(e.http, 409);
    assert.deepEqual(e.extra, { conflictsWith: 'mods' });
  });

  test('a file where an existing folder is, is refused', async () => {
    const e = await refusal(repo('mods/deep/a.zip'), 'mods');
    assert.equal(e?.code, 'path_conflict');
    assert.equal(e.extra.conflictsWith, 'mods/deep/a.zip');
  });

  test('control: re-uploading the same path is an overwrite, not a clash', async () => {
    const e = await refusal(repo('mods/a.zip'), 'mods/a.zip');
    assert.equal(e, null, `an overwrite was refused: ${e?.code}`);
  });

  test('control: a sibling that merely shares a prefix is fine', async () => {
    // `mods` vs `mods2/x` and `mods.zip`: a string prefix, not a path prefix.
    assert.equal(await refusal(repo('mods2/x.zip', 'mods.zip'), 'mods'), null);
    assert.equal(await refusal(repo('a/b.zip'), 'a/c.zip'), null);
  });

  test('control: the presign still returns the derived key', async () => {
    const out = await presignRepoFile(null, repo('a/b.zip'), { path: 'a/c.zip', size: 1 });
    assert.equal(out.key, 'hosting/r1/a/c.zip');
    // Path-style, on whatever endpoint and bucket this run is configured with.
    const u = new URL(out.url);
    assert.equal(u.origin, new URL(process.env.S3_PUBLIC_ENDPOINT).origin);
    assert.equal(u.pathname, `/${process.env.S3_BUCKET || 'bcweb'}/hosting/r1/a/c.zip`);
  });
});
