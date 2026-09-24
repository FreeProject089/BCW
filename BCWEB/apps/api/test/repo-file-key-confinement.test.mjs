// A repo file's storage key is derived from the repo, not taken from the client
// (full audit, Sept 24 2026).
//
// `presignRepoFile` returns `hosting/<repoId>/<path>` and the browser PUTs the bytes there,
// then `registerRepoFile` records the row. It used to store whatever `key` the client sent
// back, and the serving path streams `getObject(file.key)` — so a repo owner (or a
// collaborator, or a dashboard-password holder) could register a row whose key points at a
// DIFFERENT repo's object, or any key in the one shared bucket, and have it served through
// their own repo's public URL: past the victim's sync password, whitelist and take-down
// status. The key is now recomputed at register, so a row can only ever name its own repo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the repo-file-key tests';
process.env.JWT_SECRET ||= 'repo-file-key-secret';

let p, registerRepoFile;
const MAIL = '@repokey.test';
let seq = 0;
const made = [];

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  ({ registerRepoFile } = await import('../src/routes/hosting-content.mjs'));
});

after(async () => {
  if (!RUN) return;
  const ids = (await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })).map((u) => u.id);
  await p.repoFile.deleteMany({ where: { serverRepoId: { in: made } } }).catch(() => {});
  await p.repoAuditLog.deleteMany({ where: { serverRepoId: { in: made } } }).catch(() => {});
  await p.serverRepo.deleteMany({ where: { OR: [{ id: { in: made } }, { ownerId: { in: ids } }] } }).catch(() => {});
  await p.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
});

async function mkRepo() {
  const u = await p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `rk-${seq}`, emailVerified: true, status: 'active' } });
  // `listed: false` on purpose. `listed` defaults to TRUE, and registering a file on a listed
  // repo notifies EVERY MOD/ADMIN on the database ("back in the review queue"). node --test runs
  // files in parallel, so that fan-out wrote Notification rows onto other files' staff fixtures
  // and their `user.deleteMany` cleanup failed on the foreign key (economy-history-admin,
  // project-catalogs, project-content went red in the full run, green alone). The key rule is
  // the same for a listed and an unlisted repo.
  const r = await p.serverRepo.create({ data: { name: `rk repo ${seq}`, ownerId: u.id, hosted: true, status: 'ONLINE', listed: false, repoUrl: 'https://example.org/r.json', contactEmail: `c${MAIL}`, files: {} } });
  made.push(r.id);
  return r;
}

describe('a registered file can only name its own repo namespace', { skip }, () => {
  test('a key aimed at another repo is confined to this repo', async () => {
    const victim = await mkRepo();
    const attacker = await p.serverRepo.findUnique({ where: { id: (await mkRepo()).id }, include: { files: true } });
    const hostileKey = `hosting/${victim.id}/private-secret.zip`;
    await registerRepoFile(p, attacker, { path: 'loot.zip', key: hostileKey, size: 10, contentType: 'application/zip', sha256: null }, 'attacker');
    const row = await p.repoFile.findUnique({ where: { serverRepoId_path: { serverRepoId: attacker.id, path: 'loot.zip' } } });
    assert.ok(row, 'the file registered');
    assert.equal(row.key, `hosting/${attacker.id}/loot.zip`, `the stored key still points where the caller aimed it: ${row.key}`);
    assert.ok(!row.key.includes(victim.id), 'the stored key names the victim repo');
  });

  test('an arbitrary bucket key (a feedback attachment) is confined too', async () => {
    const attacker = await p.serverRepo.findUnique({ where: { id: (await mkRepo()).id }, include: { files: true } });
    await registerRepoFile(p, attacker, { path: 'x.bin', key: 'feedback/whatever/00000000-secret', size: 5, contentType: 'application/octet-stream', sha256: null }, 'a');
    const row = await p.repoFile.findUnique({ where: { serverRepoId_path: { serverRepoId: attacker.id, path: 'x.bin' } } });
    assert.equal(row.key, `hosting/${attacker.id}/x.bin`, `an arbitrary key was stored verbatim: ${row.key}`);
  });

  test('control: the honest presigned key round-trips unchanged', async () => {
    const repo = await p.serverRepo.findUnique({ where: { id: (await mkRepo()).id }, include: { files: true } });
    const honest = `hosting/${repo.id}/mods/pack.zip`;
    await registerRepoFile(p, repo, { path: 'mods/pack.zip', key: honest, size: 20, contentType: 'application/zip', sha256: null }, 'owner');
    const row = await p.repoFile.findUnique({ where: { serverRepoId_path: { serverRepoId: repo.id, path: 'mods/pack.zip' } } });
    assert.equal(row.key, honest, 'the legitimate upload key was altered');
  });
});
