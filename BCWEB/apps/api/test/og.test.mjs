// Tests for the OG/link-unfurl prerender (metaForPath + renderOgHtml). The pure
// routing/escaping tests always run; the dynamic-page tests need a throwaway Postgres
// (DATABASE_URL) and, most importantly, assert the PRIVACY gates — a private profile
// or an unlisted repo/catalog must fall back to the generic site card and never leak
// its name to an unauthenticated crawler.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { metaForPath, metaForRequest, renderOgHtml } from '../src/routes/og.mjs';
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

// ── the pages added to the static table, and the card shape ─────────────────
//
// Half the site had no entry, and a page with no entry unfurls as the generic site card —
// so sharing /docs or /myo said nothing about what was shared. These are the ones somebody
// is most likely to paste.
test('the pages people actually share have their own card', async () => {
  const cases = [
    ['/docs', /^Docs —/], ['/dev', /^Developers —/], ['/myo', /^Make Your Own —/],
    ['/status', /^Status —/], ['/users', /^Members —/], ['/2fa', /^Authenticator —/],
    ['/legal/privacy', /^Privacy —/], ['/legal/terms', /^Terms —/],
    ['/legal/refunds', /^Payments & refunds —/], ['/legal/about', /^About —/],
  ];
  for (const [path, re] of cases) {
    const m = await metaForPath(path);
    assert.match(m.title, re, path);
    assert.notEqual(m.title, FALLBACK_TITLE, `${path} must not fall back`);
    // A description that repeats the title wastes the only two lines a preview gets.
    assert.ok(m.description.length > 30, `${path} needs a real description`);
    assert.ok(!m.description.startsWith(m.title), `${path} description must not restate the title`);
  }
});

test('a trailing slash matches the same page', async () => {
  assert.equal((await metaForPath('/docs/')).title, (await metaForPath('/docs')).title);
});

test('the card shape follows the picture, not a fixed choice', () => {
  // A logo in a large card is a small mark floating in a wide grey box; a real cover is
  // what the large shape is for.
  const cover = renderOgHtml({ title: 'T', description: 'd', image: 'https://x.example/c.png', url: 'https://u/', type: 'article' });
  const logo = renderOgHtml({ title: 'T', description: 'd', image: 'https://bettercommunity.ch/logo.png', url: 'https://u/', type: 'website' });
  assert.match(cover, /twitter:card" content="summary_large_image"/);
  assert.match(logo, /twitter:card" content="summary"/);
  // Dimensions belong to the large card only — declaring 1200x630 for a logo tells the
  // crawler to expect a shape it is not going to get.
  assert.match(cover, /og:image:width" content="1200"/);
  assert.ok(!/og:image:width/.test(logo), 'a summary card must not claim large-card dimensions');
});

test('the locale follows the language the link was shared in', () => {
  assert.match(renderOgHtml({ title: 'T', description: 'd', image: 'i', url: 'u', type: 'website' }, 'fr'), /og:locale" content="fr_FR"/);
  assert.match(renderOgHtml({ title: 'T', description: 'd', image: 'i', url: 'u', type: 'website' }, 'en'), /og:locale" content="en_GB"/);
});

test('every card names its image for a screen reader', () => {
  const html = renderOgHtml({ title: 'My Page', description: 'd', image: 'https://x/c.png', url: 'u', type: 'website' });
  assert.match(html, /og:image:alt" content="My Page"/);
  assert.match(html, /twitter:image:alt" content="My Page"/);
});

test('an unreachable database cannot take the unfurl down', async () => {
  // pageOverride reads AdminSetting. Without a DB it must fall through to the derived
  // card rather than throwing — a crawler getting a 500 is a link that unfurls as nothing.
  const m = await metaForRequest('/docs', 'en');
  assert.match(m.title, /^Docs —/);
});
