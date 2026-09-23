// The content backup's `settings` section is a settings READER and a settings WRITER, and
// both halves had a weaker idea of "secret" and "allowed" than the screen next to them.
//
// Pentest 2026-09-22, card 3. Two separate failures, one section:
//
//  · OUT. The export excluded the four credential KEYS and nothing else, so a credential
//    FIELD inside an ordinary row travelled — `codegraph.settings.<project>.secret` is the
//    example that exists, and the archive's own header promises "no API tokens". The config
//    transfer has always stripped fields as well as rows (lib/secret-guard.mjs); this did not.
//
//  · IN.  `restore` upserted whatever the zip said into whatever key it named, with no check.
//    `PUT /admin/settings/:key` runs every write through `checkAdminSetting`, which refuses
//    the credential keys, refuses `demo.*`, refuses the SUPERADMIN-only rows to an ADMIN and
//    validates a few values that break the site when they are wrong. This route is ADMIN +
//    server-control + elevated, not SUPERADMIN — so the zip was the wider door.
//
// Both assertions are made against the section object, not against the file's text: a comment
// saying the policy is applied is not the policy being applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS } from '../src/routes/content-backup.mjs';

/** A prisma stand-in: records the upserts a restore builds, answers reads from `store`. */
function fakeDb(store = {}) {
  const upserts = [];
  return {
    upserts,
    adminSetting: {
      findUnique: async ({ where }) => (where.key in store ? { key: where.key, value: store[where.key] } : null),
      findMany: async () => Object.entries(store).map(([key, value]) => ({ key, value })),
      upsert: (a) => { upserts.push({ key: a.where.key, value: a.create?.value ?? a.update?.value }); return { op: true }; },
    },
  };
}

test('the export strips a credential FIELD, not only a credential ROW', async () => {
  const p = fakeDb({
    'codegraph.settings.bmm': { url: 'https://example.com/hook', secret: 'shared-webhook-secret' },
    'site.home': { hero: 'hello' },
  });
  const sink = [];
  const rows = await SECTIONS.settings.read(p, sink);
  const cg = rows.find((r) => r.key === 'codegraph.settings.bmm');

  assert.equal(cg.value.url, 'https://example.com/hook', 'the harmless half must still travel');
  assert.ok(!('secret' in cg.value), 'the webhook secret went into the zip');
  assert.deepEqual(rows.find((r) => r.key === 'site.home').value, { hero: 'hello' }, 'an ordinary row is untouched');

  // And it is REPORTED. A backup that silently drops a field is how somebody restores it
  // elsewhere and spends a day wondering why the webhook never fires.
  assert.deepEqual(sink, [{ key: 'codegraph.settings.bmm', path: 'secret', reason: 'secret_field' }]);
});

test('an import is refused exactly where PUT /admin/settings/:key would refuse it', async () => {
  // Same four rows the probe used. Each is a different reason, and each one landed before.
  const p = fakeDb({});
  const refused = [];
  const ops = await SECTIONS.settings.restore(p, [
    { key: 'marketplace.feePercentBp', value: 0 },                       // SUPERADMIN-only
    { key: 'hosting.termMinMonths', value: 999 },                        // out of bounds
    { key: 'seo.gtmId', value: 'not-a-tag-id' },                         // not a tag id
    { key: 'bot.token', value: 'a-token' },                              // credential row
    { key: 'site.home', value: { hero: 'fine' } },                       // legitimate
  ], { role: 'ADMIN', refused });

  assert.deepEqual(ops.map(() => true).length && p.upserts.map((u) => u.key), ['site.home'],
    'only the legitimate row may be written');
  assert.deepEqual(refused.map((r) => `${r.key}:${r.error}`), [
    'marketplace.feePercentBp:superadmin_required',
    'hosting.termMinMonths:invalid_term_bound',
    'seo.gtmId:bad_gtm_id',
    // The section refuses the four credential rows by name before it asks, so this one is
    // reported as `credential` rather than as checkAdminSetting's `use_dedicated_route`.
    // Both doors are shut; the test names which one answered.
    'bot.token:credential',
  ]);
});

test('a SUPERADMIN importing the same zip gets the SUPERADMIN answer', async () => {
  // The gate is the caller's own role, not a constant. An import must not be a way UP, and it
  // must not be a way DOWN either: a superadmin restoring a backup of their own site should
  // get back what they exported.
  const p = fakeDb({});
  const refused = [];
  await SECTIONS.settings.restore(p, [{ key: 'marketplace.feePercentBp', value: 500 }], { role: 'SUPERADMIN', refused });
  assert.deepEqual(refused, []);
  assert.deepEqual(p.upserts.map((u) => u.key), ['marketplace.feePercentBp']);
});

test('restoring a stripped row keeps the secret this install already holds', async () => {
  // The other half of stripping on the way out: the zip carries `url` and no `secret`, and a
  // blind upsert of that value would erase the webhook secret of the install being restored.
  const p = fakeDb({ 'codegraph.settings.bmm': { url: 'https://old', secret: 'keep-me' } });
  await SECTIONS.settings.restore(p, [{ key: 'codegraph.settings.bmm', value: { url: 'https://new' } }], { role: 'ADMIN' });
  assert.deepEqual(p.upserts, [{ key: 'codegraph.settings.bmm', value: { url: 'https://new', secret: 'keep-me' } }]);
});

test('a restore still hands back operations rather than running them', async () => {
  // The route wraps them in one transaction per section. An async restore that awaited its
  // own writes would wrap an already-finished list and roll back nothing.
  const p = fakeDb({});
  const ops = await SECTIONS.settings.restore(p, [{ key: 'site.home', value: {} }], { role: 'ADMIN' });
  assert.ok(Array.isArray(ops));
  assert.equal(ops.length, 1);
});
