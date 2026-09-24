// Pentest round 2 (Sept 24 2026), card R8: the seed record is a DELETE LIST, so nothing on
// the web may write it.
//
// `npm run clear-demo` deletes every catalog item and every account whose id is listed in
// AdminSetting['seed.demoRows'] (lib/demo-seed-record.mjs). The header of that file said "no
// route writes this key — PUT /admin/settings/:key refuses unknown keys". It did not:
// `checkAdminSetting` accepts any key that is not a credential or SUPERADMIN-only, and the
// retired demo mode took its one reserved-namespace refusal (`isDemoKey`) with it. So any
// ADMIN could PUT a record naming real catalog items and real accounts (or ship it inside a
// content-backup zip, whose restore goes through the same check), and the next operator to
// run `clear-demo` deleted them with the script's database privileges.
//
// Two halves to the fix, both pinned here:
//  · the generic settings door (and every door that reuses its check) refuses the keys that
//    only a local script may write: `seed.*`, and the retired `demo.*` namespace;
//  · clear-demo deletes only rows that are BOTH in the record AND shaped like the seeder's
//    own output, and refuses NODE_ENV=production like seed:demo already did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAdminSetting } from '../src/routes/misc.mjs';
import { SECTIONS } from '../src/routes/content-backup.mjs';

const nullDb = { adminSetting: { findUnique: async () => null } };

test('the generic settings door refuses the seed record, even to a SUPERADMIN', async () => {
  for (const role of ['ADMIN', 'SUPERADMIN']) {
    const r = await checkAdminSetting(nullDb, 'seed.demoRows', { itemIds: ['x'], userIds: ['y'] }, { role });
    assert.equal(r.ok, false, `${role} wrote the clear-demo delete list through PUT /admin/settings/:key`);
    assert.equal(r.body?.error, 'reserved_setting');
  }
});

test('the retired demo.* namespace stays closed, and neighbours stay open', async () => {
  assert.equal((await checkAdminSetting(nullDb, 'demo.session', {}, { role: 'SUPERADMIN' })).ok, false);
  // Controls: a key that merely CONTAINS the words is not reserved, and ordinary rows pass.
  for (const k of ['site.home', 'hosting.seedBonus', 'seo.demo', 'catalog.seed']) {
    assert.equal((await checkAdminSetting(nullDb, k, { a: 1 }, { role: 'ADMIN' })).ok, true, k);
  }
});

test('a content-backup restore cannot plant the seed record either', async () => {
  const upserts = [];
  const p = { adminSetting: { findUnique: async () => null, upsert: (a) => { upserts.push(a.where.key); return {}; } } };
  const refused = [];
  await SECTIONS.settings.restore(p, [
    { key: 'seed.demoRows', value: { itemIds: ['real-item'], userIds: ['real-user'] } },
    { key: 'site.home', value: { hero: 'fine' } },
  ], { role: 'SUPERADMIN', refused });
  assert.deepEqual(upserts, ['site.home']);
  assert.deepEqual(refused.map((r) => `${r.key}:${r.error}`), ['seed.demoRows:reserved_setting']);
});

// The clear-demo half (a real child process on a real database) lives in
// demo-seed-record.test.mjs, beside the other clear-demo tests: node --test runs FILES in
// parallel and both would race on the one seed-record row.
