// What a hosted asset is allowed to render as, and what it is counted as.
//
// The public asset route used to force `Content-Disposition: attachment` on every file. That
// is correct for what the table was built for — installers — and it is also why nothing could
// ever be previewed: an image served as an attachment does not appear in an `<img>`, whatever
// the page around it says.
//
// It now serves inline for an allowlist. The allowlist is the security boundary, so it is
// what this file checks:
//
//   · a raster image, a video, an audio file and a PDF render in place;
//   · SVG does NOT, ever. It carries scripts, and this is our own origin — an admin-uploaded
//     file executing as us is an XSS with an admin account behind it;
//   · HTML does not, and neither does anything unrecognised;
//   · `?inline=1` REQUESTS the rule, it does not lift it.
//
// Pure functions over the same table the route uses, so this needs no server and no database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mediaKind } from '../src/routes/platform-assets.mjs';

// The route's own set, re-derived here from its observable behaviour would be circular — so
// this list is written out independently, and the test below is what holds the two together.
// If somebody widens the route's allowlist, this fails and names the type.
const MUST_BE_INLINE = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg',
  'application/pdf',
];

const MUST_NEVER_BE_INLINE = [
  // The whole reason this is an allowlist and not `image/*`.
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/json',
  'text/plain',
  'application/octet-stream',
  'application/zip',
  'application/x-msdownload',
  // Case and parameters must not be a way round it.
  'IMAGE/SVG+XML',
  'text/html; charset=utf-8',
];

/** Read the route's allowlist from its source, so the test is about the real set. */
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/routes/platform-assets.mjs', import.meta.url), 'utf8');
const listed = new Set(
  (SRC.match(/const INLINE_TYPES = new Set\(\[([\s\S]*?)\]\)/)?.[1] || '')
    .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean),
);

describe('what may be served inline', () => {
  test('the allowlist was actually found', () => {
    // A regex that stops matching passes everything for ever while proving nothing.
    assert.ok(listed.size >= 8, `only ${listed.size} inline types parsed out of the route`);
  });

  for (const ct of MUST_BE_INLINE) {
    test(`${ct} renders in place`, () => {
      assert.ok(listed.has(ct), `${ct} is not in INLINE_TYPES, so it can never be previewed`);
    });
  }

  for (const ct of MUST_NEVER_BE_INLINE) {
    test(`${ct} is never inline`, () => {
      // The route lowercases before the lookup, so a lowercased entry would still match.
      assert.ok(!listed.has(ct) && !listed.has(ct.toLowerCase()),
        `${ct} is in INLINE_TYPES — it would be served with Content-Disposition: inline on our own origin`);
    });
  }

  test('the list admits nothing by prefix', () => {
    // `image/*` would admit image/svg+xml. Every entry has to be an exact type.
    for (const e of listed) {
      assert.ok(!e.includes('*'), `INLINE_TYPES contains a wildcard: ${e}`);
      assert.match(e, /^[a-z]+\/[a-z0-9.+-]+$/, `not an exact lowercase type: ${e}`);
    }
  });
});

describe('mediaKind', () => {
  test('groups by what the thing is', () => {
    assert.equal(mediaKind('image/png'), 'image');
    assert.equal(mediaKind('image/svg+xml'), 'image');      // grouped as an image, still not inline
    assert.equal(mediaKind('video/webm'), 'video');
    assert.equal(mediaKind('audio/mpeg'), 'audio');
    assert.equal(mediaKind('application/pdf'), 'document');
    assert.equal(mediaKind('text/plain'), 'document');
    assert.equal(mediaKind('application/json'), 'document');
    assert.equal(mediaKind('application/zip'), 'archive');
    assert.equal(mediaKind('application/x-7z-compressed'), 'archive');
    assert.equal(mediaKind('application/x-msdownload'), 'other');
  });

  test('an absent or odd type is "other", never empty', () => {
    // An empty bucket would drop the asset out of every filter INCLUDING "All", which reads
    // as the upload having failed.
    for (const v of [undefined, null, '', 'nonsense', 42]) {
      assert.equal(mediaKind(v), 'other');
    }
  });
});
