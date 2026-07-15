// Regression tests for the catalog's NOT_INVALID filter — the one that decides whether an
// item is publicly visible at all.
//
// The trap this guards: `NOT { meta.validation.valid = false }` READS like "not invalid", but
// SQL three-valued logic makes it "explicitly not false". When the json path is ABSENT the
// comparison is NULL, NOT NULL is NULL, and the row is silently dropped. Since meta.validation
// is only ever written by revalidatePlugin (PLUGIN kind only), that hid EVERY APP/THEME/PRESET
// — the whole non-plugin catalog — plus every plugin marked {unverified:true} (a dead download
// link, which revalidatePlugin deliberately does NOT treat as an integrity failure).
//
// These assert the INTENT stated in catalog.mjs: exclude only items explicitly marked
// valid:false; anything else (valid:true, unverified, no validation at all) is visible.
// Needs a throwaway Postgres (same contract as pool-billing.test.mjs); skipped without one.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run catalog-visibility tests';

let p, notInvalid, project, owner, tag;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  ({ notInvalid } = await import('../src/routes/catalog.mjs'));
  tag = `vis-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  owner = await p.user.create({ data: { email: `${tag}@test.local`, displayName: 'Vis Test' } });
  project = await p.project.upsert({ where: { key: 'bmm' }, create: { key: 'bmm', name: 'BMM' }, update: {} });
});
// Every test asserts on the FULL visible set of its own rows, so they must not inherit each
// other's items — drop them between tests rather than hand-crafting unique slugs per case.
beforeEach(async () => {
  if (!RUN) return;
  await p.catalogItem.deleteMany({ where: { slug: { startsWith: tag } } });
});
after(async () => {
  if (!RUN) return;
  await p.catalogItem.deleteMany({ where: { slug: { startsWith: tag } } });
  await p.user.delete({ where: { id: owner.id } }).catch(() => {});
  await p?.$disconnect?.();
});

// One published item with the given meta; returns its slug.
async function item(name, meta, kind = 'APP') {
  const slug = `${tag}-${name}`;
  await p.catalogItem.create({
    data: { projectId: project.id, ownerId: owner.id, kind, status: 'PUBLISHED', name, slug, meta },
  });
  return slug;
}
// The slugs this filter actually returns, restricted to this test's own rows.
async function visible(kind = 'APP') {
  const rows = await p.catalogItem.findMany({
    where: { status: 'PUBLISHED', kind, slug: { startsWith: tag }, ...(await notInvalid()) },
    select: { slug: true },
  });
  return rows.map((r) => r.slug).sort();
}

test('an item with NO validation key at all stays visible', { skip }, async () => {
  // This is every APP/THEME/PRESET ever submitted — revalidatePlugin only runs for plugins,
  // so nothing else ever gets a `validation` key. The old filter returned zero of these.
  const s = await item('no-validation', { download_url: 'u' });
  assert.deepEqual(await visible(), [s]);
});

test('an item explicitly marked valid:false is hidden', { skip }, async () => {
  // The filter's actual job — a tampered/failed-checksum package must not be served.
  await item('bad', { download_url: 'u', validation: { valid: false, reason: 'checksum mismatch' } });
  assert.deepEqual(await visible(), []);
});

test('valid:true, unverified and absent are all visible; only valid:false is hidden', { skip }, async () => {
  const ok = await item('ok', { download_url: 'u', validation: { valid: true, sha256: 'f'.repeat(64) } });
  // {unverified:true} has no `valid` key — a dead download link. revalidatePlugin's catch
  // records this precisely so the item is NOT badged invalid; it must stay in the catalog.
  const unver = await item('unverified', { download_url: 'u', validation: { unverified: true, reason: 'unreachable' } });
  const none = await item('none', { download_url: 'u' });
  await item('bad', { download_url: 'u', validation: { valid: false, reason: 'tampered' } });
  assert.deepEqual(await visible(), [ok, none, unver].sort());
});

test('the filter behaves identically for a non-APP kind (THEME)', { skip }, async () => {
  // Themes are never revalidated either — same shape, same expectation.
  const s = await item('theme-none', { download_url: 'u' }, 'THEME');
  await item('theme-bad', { download_url: 'u', validation: { valid: false } }, 'THEME');
  assert.deepEqual(await visible('THEME'), [s]);
});

test('the DB filter agrees with the in-process isInvalid() helper', { skip }, async () => {
  // catalog.mjs decides visibility two ways: this filter for list/feed queries, and
  // isInvalid(item) for a single fetched row. If they ever disagree, an item is listed but
  // 404s (or vice versa) — so pin them to the same verdict on the same fixtures.
  const { isInvalid } = await import('../src/routes/catalog.mjs');
  const metas = [
    { download_url: 'u' },
    { download_url: 'u', validation: { valid: true } },
    { download_url: 'u', validation: { unverified: true } },
    { download_url: 'u', validation: { valid: false } },
  ];
  const slugs = [];
  for (const [i, m] of metas.entries()) slugs.push(await item(`agree-${i}`, m));
  const vis = new Set(await visible());
  const rows = await p.catalogItem.findMany({ where: { slug: { in: slugs } } });
  for (const row of rows) {
    assert.equal(vis.has(row.slug), !isInvalid(row),
      `${row.slug}: DB filter says visible=${vis.has(row.slug)} but isInvalid() says ${isInvalid(row)}`);
  }
});
