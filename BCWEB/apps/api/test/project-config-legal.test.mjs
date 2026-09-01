// toCurrentShape's legal migration: a legacy legal OBJECT of paired keys becomes an
// array of one card per document. Regression cover for the "junk cards" bug — a blind
// Object.entries() had turned `license`/`licenseUrl` and each `tos`/`tosFr` pair into
// separate cards, producing a "License" card whose url was the string "GPL-3.0" and
// cards titled `licenseUrl`, `tosFr`, `privacyFr`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCurrentShape } from '../src/lib/project-config.mjs';

const LEGACY = {
  license: 'GPL-3.0',
  licenseUrl: 'https://example.com/LICENSE.md',
  tos: 'https://example.com/TOS.md',
  tosFr: 'https://example.com/TOS_FR.md',
  privacy: 'https://example.com/PRIVACY.md',
  privacyFr: 'https://example.com/PRIVACY_FR.md',
  readme: 'https://example.com/README.md',
};

test('legacy legal object migrates to one clean card per document', () => {
  const { out } = toCurrentShape({ name: 'X', key: 'x', legal: { ...LEGACY } });
  assert.ok(Array.isArray(out.legal), 'legal is now an array');
  // license + tos + privacy + readme = 4 documents; the *Fr twins are folded away.
  assert.equal(out.legal.length, 4);

  const byUrl = Object.fromEntries(out.legal.map((c) => [c.url, c]));
  // The license card links to licenseUrl and is titled by the license NAME, never "GPL-3.0" as a url.
  assert.ok(byUrl['https://example.com/LICENSE.md'], 'license card links to licenseUrl');
  assert.equal(byUrl['https://example.com/LICENSE.md'].title, 'GPL-3.0');
  assert.equal(byUrl['https://example.com/LICENSE.md'].icon, 'Scale');

  // No card is a bare name or a raw meta key.
  const titles = out.legal.map((c) => c.title);
  assert.ok(!titles.includes('licenseUrl'), 'no card titled licenseUrl');
  assert.ok(!titles.includes('tosFr'), 'no card titled tosFr');
  assert.ok(!titles.includes('privacyFr'), 'no card titled privacyFr');

  // No card has a non-URL as its url (the old bug put "GPL-3.0" there).
  for (const c of out.legal) assert.match(c.url, /^https?:\/\//, `${c.title} url is a real link`);

  // The French twins are dropped, not shown as separate documents.
  const urls = out.legal.map((c) => c.url);
  assert.ok(!urls.includes('https://example.com/TOS_FR.md'));
  assert.ok(!urls.includes('https://example.com/PRIVACY_FR.md'));

  // Cards present them means the tab is turned on.
  assert.equal(out.tabs?.legal, true);
});

test('an all-empty legacy legal object yields no cards and no tab', () => {
  const { out } = toCurrentShape({ name: 'X', key: 'x', legal: { license: '', tos: '', privacy: '' } });
  assert.deepEqual(out.legal, []);
  assert.notEqual(out.tabs?.legal, true);
});

test('an already-canonical legal array is left untouched', () => {
  const arr = [{ icon: 'Scale', title: 'License', url: 'https://example.com/L' }];
  const { out } = toCurrentShape({ name: 'X', key: 'x', legal: arr });
  assert.deepEqual(out.legal, arr);
});

test('an unknown legacy legal key with a URL still surfaces', () => {
  const { out } = toCurrentShape({ name: 'X', key: 'x', legal: { imprint: 'https://example.com/imprint' } });
  assert.equal(out.legal.length, 1);
  assert.equal(out.legal[0].url, 'https://example.com/imprint');
  assert.equal(out.legal[0].title, 'imprint');
});

// A row already migrated by the OLD buggy code: legal is an ARRAY of junk cards. The repair
// pass must consolidate it in place so `fix-project-config.mjs` cleans stored rows whose
// legacy object was already consumed.
const JUNK_ARRAY = [
  { icon: 'Scale', title: 'License', url: 'GPL-3.0' },                                  // name leaked into url
  { icon: 'ShieldCheck', title: 'licenseUrl', url: 'https://example.com/LICENSE.md' },  // real link, raw-key title
  { icon: 'ShieldCheck', title: 'Terms of service', url: 'https://example.com/TOS.md' },
  { icon: 'ShieldCheck', title: 'tosFr', url: 'https://example.com/TOS_FR.md' },
  { icon: 'ShieldCheck', title: 'privacyFr', url: 'https://example.com/PRIVACY_FR.md' },
  { icon: 'FileText', title: 'Readme', url: 'https://example.com/README.md' },
];

test('a junk-migrated legal array is repaired in place', () => {
  const { out, moved } = toCurrentShape({ name: 'X', key: 'x', legal: JUNK_ARRAY.map((c) => ({ ...c })) });
  assert.ok(moved.some((m) => m.startsWith('legal (repaired')), 'reports a legal repair');
  // License (name+link folded) + Terms + Readme = 3; the two *Fr twins are dropped.
  assert.equal(out.legal.length, 3);
  const lic = out.legal.find((c) => c.icon === 'Scale');
  assert.equal(lic.title, 'GPL-3.0');
  assert.equal(lic.url, 'https://example.com/LICENSE.md');
  const titles = out.legal.map((c) => c.title);
  assert.ok(!titles.includes('licenseUrl') && !titles.includes('tosFr') && !titles.includes('privacyFr'));
  for (const c of out.legal) assert.match(c.url, /^https?:\/\//);
});

test('a clean editor-authored legal array is left untouched (idempotent)', () => {
  const clean = [
    { icon: 'Scale', title: 'GPL-3.0', url: 'https://example.com/LICENSE.md' },
    { icon: 'ShieldCheck', title: 'Terms of service', url: 'https://example.com/TOS.md' },
  ];
  const { out, moved } = toCurrentShape({ name: 'X', key: 'x', legal: clean.map((c) => ({ ...c })) });
  assert.deepEqual(out.legal, clean);
  assert.ok(!moved.some((m) => m.startsWith('legal')), 'no legal change reported');
});
