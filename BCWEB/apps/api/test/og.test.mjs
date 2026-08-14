// Tests for the OG/link-unfurl prerender (metaForPath + renderOgHtml). The pure
// routing/escaping tests always run; the dynamic-page tests need a throwaway Postgres
// (DATABASE_URL) and, most importantly, assert the PRIVACY gates — a private profile
// or an unlisted repo/catalog must fall back to the generic site card and never leak
// its name to an unauthenticated crawler.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { metaForPath, renderOgHtml } from '../src/routes/og.mjs';
import { track, cleanupFixtures } from './helpers/fixtures.mjs';

const FALLBACK_TITLE = 'BetterCommunity — The home for all Better* projects';

// ── pure: static routing + escaping (no DB) ──────────────────────────────────
test('static + fallback routing', async () => {
  assert.equal((await metaForPath('/')).title, FALLBACK_TITLE);
  assert.match((await metaForPath('/catalog')).title, /^Catalog —/);
  assert.match((await metaForPath('/faq')).title, /^FAQ —/);
  assert.match((await metaForPath('/contact')).title, /^Contact —/);
  assert.equal((await metaForPath('/some/unknown/page')).title, FALLBACK_TITLE);
  // query/hash are stripped before matching
  assert.match((await metaForPath('/catalog?x=1#y')).title, /^Catalog —/);
});
test('renderOgHtml escapes HTML in meta (no tag injection)', () => {
  const html = renderOgHtml({ title: '<script>x</script>', description: 'a "b" & c', image: 'i', url: 'u', type: 'website' });
  assert.ok(!html.includes('<script>x</script>'), 'raw script tag must be escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'title should be entity-escaped');
  assert.ok(html.includes('&quot;b&quot;') && html.includes('&amp;'), 'description should be escaped');
});

// ── dynamic pages + privacy gates (needs Postgres) ───────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run OG dynamic-page tests';
let p;
before(async () => { if (RUN) p = await (await import('../src/lib/lib.mjs')).db(); });
after(async () => { if (RUN) { await cleanupFixtures(p); await p?.$disconnect?.(); } });

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const mkUser = async (pub) => track('user', await p.user.create({ data: { email: `og-${uid()}@test.local`, displayName: `OG User ${uid()}`, profilePublic: pub } }));

test('public profile unfurls with the display name; private one falls back (no leak)', { skip }, async () => {
  const pub = await mkUser(true);
  const priv = await mkUser(false);
  const mPub = await metaForPath(`/u/${pub.id}`);
  assert.ok(mPub.title.includes(pub.displayName), 'public profile should expose the name');
  const mPriv = await metaForPath(`/u/${priv.id}`);
  assert.equal(mPriv.title, FALLBACK_TITLE, 'private profile must fall back');
  assert.ok(!mPriv.title.includes(priv.displayName) && !mPriv.description.includes(priv.displayName), 'private name must not leak');
});

test('listed+ACTIVE catalog unfurls; unlisted one falls back', { skip }, async () => {
  const owner = await mkUser(true);
  const group = await p.hostingGroup.create({ data: { ownerId: owner.id, name: 'pool' } });
  const base = { owner: { connect: { id: owner.id } }, group: { connect: { id: group.id } } };
  const listed = await p.communityCatalog.create({ data: { ...base, name: 'Public Cat', slug: `pc-${uid()}`, description: 'Hello', status: 'ACTIVE', listed: true } });
  const hidden = await p.communityCatalog.create({ data: { ...base, name: 'Secret Cat', slug: `sc-${uid()}`, status: 'ACTIVE', listed: false } });
  assert.ok((await metaForPath(`/c/${listed.slug}`)).title.includes('Public Cat'));
  const mHidden = await metaForPath(`/c/${hidden.slug}`);
  assert.equal(mHidden.title, FALLBACK_TITLE);
  assert.ok(!mHidden.title.includes('Secret Cat'), 'unlisted catalog name must not leak');
});

test('listed repo unfurls; unlisted repo falls back', { skip }, async () => {
  const owner = await mkUser(true);
  const group = await p.hostingGroup.create({ data: { ownerId: owner.id, name: 'pool' } });
  const base = { owner: { connect: { id: owner.id } }, group: { connect: { id: group.id } }, hosted: true };
  const listed = await p.serverRepo.create({ data: { ...base, name: 'PubRepo', description: 'd', listed: true } });
  const unlisted = await p.serverRepo.create({ data: { ...base, name: 'PrivRepo', listed: false } });
  assert.ok((await metaForPath(`/r/${listed.id}`)).title.includes('PubRepo'));
  const mUnlisted = await metaForPath(`/r/${unlisted.id}`);
  assert.equal(mUnlisted.title, FALLBACK_TITLE);
  assert.ok(!mUnlisted.title.includes('PrivRepo'), 'unlisted repo name must not leak');
});
