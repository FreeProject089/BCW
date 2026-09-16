// Perceptual hashing: the same picture re-saved or resized hashes the same; a different one
// does not; the flag rule ignores an account's own re-uploads. No database, no storage —
// the pictures are drawn with @napi-rs/canvas and the register is a fake Prisma.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { phashOfGrey, hamming, phashImage, nearest, sha256, archiveImageHashes, RASTER, ARCHIVE } from '../src/lib/phash.mjs';

async function picture(draw, w = 256, h = 256, type = 'image/png') {
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  return type === 'image/jpeg' ? c.toBuffer('image/jpeg', 80) : c.toBuffer('image/png');
}
const logo = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#f59e0b'); g.addColorStop(1, '#1e293b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(w * 0.4, h * 0.45, w * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0ea5e9'; ctx.fillRect(w * 0.55, h * 0.6, w * 0.3, h * 0.25);
};
const other = (ctx, w, h) => {
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e11d48';
  for (let i = 0; i < 6; i++) ctx.fillRect((i * w) / 6, 0, w / 12, h);
  ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, h); ctx.lineTo(w / 2, h * 0.2); ctx.fill();
};

describe('phash arithmetic', () => {
  test('a flat plane and a gradient hash to fixed-width hex, and hamming counts bits', () => {
    const flat = new Float64Array(1024).fill(128);
    const grad = Float64Array.from({ length: 1024 }, (_, i) => (i % 32) * 8);
    const a = phashOfGrey(flat), b = phashOfGrey(grad);
    assert.match(a, /^[0-9a-f]{16}$/); assert.match(b, /^[0-9a-f]{16}$/);
    assert.equal(hamming(a, a), 0);
    assert.equal(hamming('0000000000000000', 'ffffffffffffffff'), 64);
    assert.equal(hamming('0000000000000001', '0000000000000003'), 1);
  });
  test('the raster and archive type guards', () => {
    assert.ok(RASTER.test('image/png') && RASTER.test('image/jpeg') && !RASTER.test('image/svg+xml'));
    assert.ok(ARCHIVE.test('application/zip') && !ARCHIVE.test('application/json'));
  });
});

describe('the same picture, differently saved', () => {
  test('resized and re-encoded copies stay close; a different picture is far', async () => {
    const a = await phashImage(await picture(logo, 256, 256));
    const b = await phashImage(await picture(logo, 96, 96));
    const c = await phashImage(await picture(logo, 400, 300, 'image/jpeg'));
    const d = await phashImage(await picture(other));
    assert.ok(a && b && c && d);
    assert.ok(hamming(a.phash, b.phash) <= 6, `resized: ${hamming(a.phash, b.phash)}`);
    assert.ok(hamming(a.phash, c.phash) <= 14, `jpeg + a squashed aspect: ${hamming(a.phash, c.phash)}`);
    assert.ok(hamming(a.phash, d.phash) >= 16, `different: ${hamming(a.phash, d.phash)}`);
    assert.equal(a.width, 256);
    assert.notEqual(sha256(await picture(logo, 256, 256)), sha256(await picture(logo, 96, 96)));
  });
  test('nearest ranks by distance and applies the threshold', async () => {
    const a = await phashImage(await picture(logo));
    const rows = [
      { id: 'far', phash: (await phashImage(await picture(other))).phash },
      { id: 'near', phash: (await phashImage(await picture(logo, 128, 128))).phash },
      { id: 'none', phash: null },
    ];
    const hits = nearest(a.phash, rows, 8);
    assert.deepEqual(hits.map((h) => h.row.id), ['near']);
    assert.equal(nearest(a.phash, rows, 64).length, 2);
  });
  test('the images inside a zip are hashed, bounded, non-images skipped', async () => {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    zip.addFile('assets/icon.png', await picture(logo, 64, 64));
    zip.addFile('assets/other.jpg', await picture(other, 64, 64, 'image/jpeg'));
    zip.addFile('readme.txt', Buffer.from('hello'));
    zip.addFile('empty.png', Buffer.alloc(0));
    const entries = await archiveImageHashes(zip.toBuffer(), { maxEntries: 1 });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].entry, 'assets/icon.png');
    const all = await archiveImageHashes(zip.toBuffer());
    assert.deepEqual(all.map((e) => e.entry).sort(), ['assets/icon.png', 'assets/other.jpg']);
  });
});

describe('the flag rule (fake register)', () => {
  test('flags another owner within the threshold, never the same owner, one flag per pair', async () => {
    const { flagRow } = await import('../src/lib/media-hash.mjs');
    const a = (await phashImage(await picture(logo))).phash;
    const b = (await phashImage(await picture(logo, 128, 128))).phash;
    const far = (await phashImage(await picture(other))).phash;
    const rows = [
      { id: 'mine', ownerId: 'u1', key: 'uploads/u1/a.png', phash: a, sha256: 'x', status: 'hashed' },
      { id: 'mine2', ownerId: 'u1', key: 'uploads/u1/b.png', phash: b, sha256: 'y', status: 'hashed' },   // my own re-upload
      { id: 'theirs', ownerId: 'u2', key: 'uploads/u2/c.png', phash: b, sha256: 'z', status: 'hashed' },  // someone else's lookalike
      { id: 'exact', ownerId: 'u3', key: 'blog/d.png', phash: far, sha256: 'x', status: 'hashed' },       // byte-identical, different picture hash (contrived)
      { id: 'faraway', ownerId: 'u4', key: 'blog/e.png', phash: far, sha256: 'w', status: 'hashed' },
    ];
    const flags = [];
    const p = {
      mediaHash: { findMany: async ({ where }) => rows.filter((r) => r.id !== where.id.not && (where.sha256 ? r.sha256 === where.sha256 : !!r.phash)) },
      mediaFlag: {
        findFirst: async ({ where }) => flags.find((f) => where.OR.some((o) => f.hashId === o.hashId && f.matchId === o.matchId)) || null,
        create: async ({ data }) => { flags.push(data); return data; },
      },
    };
    const n = await flagRow(p, rows[0], { threshold: 8 });
    assert.equal(n, 2);
    assert.deepEqual(flags.map((f) => [f.matchId, f.reason]).sort(), [['exact', 'exact'], ['theirs', 'near']]);
    // From the other side: the pair with `mine` already exists (no duplicate), but `theirs`
    // also looks like `mine2`, which is a new pair.
    assert.equal(await flagRow(p, rows[2], { threshold: 8 }), 1);
    assert.equal(flags.filter((f) => [f.hashId, f.matchId].includes('theirs') && [f.hashId, f.matchId].includes('mine')).length, 1);
    assert.ok(flags.some((f) => f.hashId === 'theirs' && f.matchId === 'mine2'));
  });
});
