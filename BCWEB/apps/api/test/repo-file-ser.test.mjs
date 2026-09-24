// O4 (SECURITY_SUMMARY §9): the repo file serialiser spread the whole RepoFile row, so its
// object-storage `key` reached everybody the repo dashboard admits (a whitelisted
// collaborator, anyone holding the dashboard password). Both copies — the dashboard's and the
// owner's file list — are now an explicit field list.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'repo-file-ser-secret';
const { fileSer: dashboardSer } = await import('../src/routes/repo-dashboard.mjs');
const { fileSer: hostingSer } = await import('../src/routes/hosting-content.mjs');

const row = {
  id: 'f1', serverRepoId: 'r1', path: 'mods/x.zip', key: 'hosting/r1/7f3e-secret-object-key.zip',
  size: 1234n, contentType: 'application/zip', sha256: 'ab'.repeat(32),
  createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-02T00:00:00Z'),
};

describe('fileSer names its fields (O4)', () => {
  for (const [name, ser] of [['repo-dashboard', dashboardSer], ['hosting-content', hostingSer]]) {
    test(`${name}: no storage key, and what the client uses is all there`, () => {
      const out = ser(row);
      assert.equal('key' in out, false, 'the object-storage key left the server');
      assert.ok(!JSON.stringify(out).includes(row.key));
      assert.deepEqual(Object.keys(out).sort(), ['contentType', 'createdAt', 'id', 'path', 'sha256', 'size', 'updatedAt']);
      assert.equal(out.size, 1234);
    });
  }
});
