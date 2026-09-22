// What `clear-demo` is allowed to delete.
//
// The bug this pins: both scripts found their rows by NAME — a `demo-` slug, a `demo-author-`
// address. A real catalog item submitted under a project keyed `demo` is slugged `demo-…`, so
// `npm run clear-demo` would have deleted somebody's real content, and `npm run seed:demo`
// would have replaced it on the next run. Silently, in both directions.
//
// The contract now: `seed:demo` records the ids it created in AdminSetting['seed.demoRows'],
// and `clear-demo` deletes by id, intersected with that record. A row that is not in the
// record is never deleted, whatever it is called.
//
// The script is run as a real child process (that is the thing being tested — the script, not
// a re-implementation of it). Fixtures are slugged with a unique tag and the real seed record
// is snapshotted and put back.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the demo seed-record tests';
const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, '..');

const TAG = `demo-seedrec-${Date.now()}-`;
let p, rec, savedRecord, project, owner;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  rec = await import('../src/lib/demo-seed-record.mjs');
  p = await lib.db();
  savedRecord = await p.adminSetting.findUnique({ where: { key: rec.SEED_RECORD_KEY } });
  project = await p.project.upsert({ where: { key: 'bmm' }, create: { key: 'bmm', name: 'Better Mods Manager' }, update: {} });
  owner = await p.user.upsert({
    where: { email: `${TAG}owner@bettercommunity.invalid` },
    create: { email: `${TAG}owner@bettercommunity.invalid`, displayName: 'seed-record fixture' },
    update: {},
  });
});

after(async () => {
  if (!RUN) return;
  await p.catalogItem.deleteMany({ where: { slug: { startsWith: TAG } } });
  await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
  if (savedRecord) await p.adminSetting.upsert({ where: { key: rec.SEED_RECORD_KEY }, create: savedRecord, update: { value: savedRecord.value } });
  else await p.adminSetting.deleteMany({ where: { key: rec.SEED_RECORD_KEY } });
  await p?.$disconnect?.();
});

const item = (slug) => p.catalogItem.create({
  data: { slug, name: slug, kind: 'APP', status: 'PUBLISHED', projectId: project.id, ownerId: owner.id },
  select: { id: true, slug: true },
});
const clearDemo = (args = []) => run(process.execPath, [path.join(API, 'src/clear-demo.mjs'), ...args], { cwd: API, env: process.env });

describe('clear-demo deletes only what seed:demo recorded (db)', { skip }, () => {
  test('a real item whose slug starts with demo- survives; the recorded one goes', async () => {
    // Same shape as the accident: a project keyed `demo` would slug every one of its items
    // like this. The tag keeps it out of the user's way; the `demo-` prefix is what matters.
    const real = await item(`${TAG}demo-real-item`);
    const seeded = await item(`${TAG}demo-seeded-item`);
    await rec.writeSeedRecord(p, { itemIds: [seeded.id], userIds: [] });

    const { stdout } = await clearDemo();
    assert.match(stdout, /deleted 1 catalog item/);

    assert.equal(await p.catalogItem.count({ where: { id: real.id } }), 1, 'a demo- slug is not proof the seeder made the row');
    assert.equal(await p.catalogItem.count({ where: { id: seeded.id } }), 0);
    // The record is consumed, so a second run has nothing to delete.
    assert.equal(await p.adminSetting.count({ where: { key: rec.SEED_RECORD_KEY } }), 0);
  });

  test('with no record it deletes nothing at all, and says why', async () => {
    const real = await item(`${TAG}demo-orphan-item`);
    await p.adminSetting.deleteMany({ where: { key: rec.SEED_RECORD_KEY } });

    const { stdout } = await clearDemo();
    assert.match(stdout, /no seed record/);
    assert.doesNotMatch(stdout, /deleted \d+ catalog item/);
    assert.equal(await p.catalogItem.count({ where: { id: real.id } }), 1);
  });

  test('--dry-run reports the recorded rows and deletes none of them', async () => {
    const seeded = await item(`${TAG}demo-dry-item`);
    await rec.writeSeedRecord(p, { itemIds: [seeded.id], userIds: [] });

    const { stdout } = await clearDemo(['--dry-run']);
    assert.match(stdout, /nothing deleted/);
    assert.equal(await p.catalogItem.count({ where: { id: seeded.id } }), 1);
    await p.adminSetting.deleteMany({ where: { key: rec.SEED_RECORD_KEY } });
  });

  test('the record round-trips, and junk in it is ignored rather than trusted', async () => {
    await p.adminSetting.upsert({
      where: { key: rec.SEED_RECORD_KEY },
      create: { key: rec.SEED_RECORD_KEY, value: { itemIds: ['a', 3, null, 'b', 'a'], userIds: 'nope' } },
      update: { value: { itemIds: ['a', 3, null, 'b', 'a'], userIds: 'nope' } },
    });
    const r = await rec.readSeedRecord(p);
    assert.deepEqual(r.itemIds, ['a', 'b', 'a'], 'non-strings dropped, order kept');
    assert.deepEqual(r.userIds, []);
    await p.adminSetting.deleteMany({ where: { key: rec.SEED_RECORD_KEY } });
  });

  test('neither script can reach a row by name any more', async () => {
    const fs = await import('node:fs');
    const clear = fs.readFileSync(path.join(API, 'src/clear-demo.mjs'), 'utf8');
    const code = clear.split('async function main()')[1];
    assert.doesNotMatch(code, /startsWith:\s*'demo-author-'/, 'deleting an account by the look of its address is the bug');
    // The one surviving `demo-` count is a read: it exists to SAY those rows are not deleted.
    assert.doesNotMatch(code, /deleteMany\(\{\s*where:\s*\{\s*slug/, 'a delete keyed on a slug prefix is the bug');
  });
});
