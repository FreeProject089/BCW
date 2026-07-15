// Tests the native (Rust) acceleration wrapper and its JS fallback via lib/native.mjs.
// These run WITHOUT a DB. Whichever path is active (native addon built, or the adm-zip
// fallback), the wrapper must produce identical results, and validatePlugin — which now
// parses the zip through it — must still verify packages correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipReadAll, zipEntry, zipCreate, dirScan, zstdCompress, zstdDecompress, imageThumb, blake3Hex, hasNative } from '../src/lib/native.mjs';
import { validatePlugin } from '../src/lib/plugin.mjs';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

test('zipReadAll matches adm-zip on names + bytes (native path or fallback)', async () => {
  const z = new AdmZip();
  z.addFile('plugin.json', Buffer.from('{"id":"demo"}'));
  z.addFile('sub/data.bin', Buffer.from([0, 1, 2, 3, 4, 5]));
  z.addFile('empty', Buffer.alloc(0)); // a legitimately empty file must survive
  const buf = z.toBuffer();
  const got = (await zipReadAll(buf)).sort((a, b) => a.name.localeCompare(b.name));
  const want = z.getEntries().filter((e) => !e.isDirectory).map((e) => ({ name: e.entryName, data: e.getData() })).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(got.map((f) => f.name), want.map((f) => f.name), 'same entry names, no directory rows');
  for (let i = 0; i < got.length; i++) assert.ok(Buffer.from(got[i].data).equals(want[i].data), `bytes for ${got[i].name}`);
});

test('zipEntry extracts one entry (bytes match adm-zip; null for missing / a dir)', async () => {
  const z = new AdmZip();
  z.addFile('plugin.json', Buffer.from('{"id":"x"}'));
  z.addFile('bin/data', Buffer.from([9, 8, 7, 6]));
  const buf = z.toBuffer();
  const got = await zipEntry(buf, 'bin/data');
  assert.ok(Buffer.from(got).equals(z.getEntry('bin/data').getData()), 'bytes match');
  assert.equal(await zipEntry(buf, 'does/not/exist'), null, 'missing → null');
});

test('validatePlugin accepts a well-formed package and rejects a tampered file', async () => {
  const files = { 'plugin.json': Buffer.from('{"id":"demo","name":"Demo"}'), 'main.lua': Buffer.from('print("hi")') };
  const checksums = { files: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, sha256(b)])) };
  const z = new AdmZip();
  for (const [n, b] of Object.entries(files)) z.addFile(n, b);
  z.addFile('checksums.json', Buffer.from(JSON.stringify(checksums)));
  const buf = z.toBuffer();
  const ok = await validatePlugin(buf, sha256(buf));
  assert.equal(ok.valid, true, `expected valid, got: ${ok.reason}`);
  assert.equal(ok.manifest.id, 'demo');

  // Same checksums.json, but main.lua's bytes differ → its per-file sha won't match.
  const z2 = new AdmZip();
  z2.addFile('plugin.json', files['plugin.json']);
  z2.addFile('main.lua', Buffer.from('print("evil")'));
  z2.addFile('checksums.json', Buffer.from(JSON.stringify(checksums)));
  const buf2 = z2.toBuffer();
  const bad = await validatePlugin(buf2, sha256(buf2));
  assert.equal(bad.valid, false, 'a tampered file must fail validation');

  // A wrong outer sha (package-level) is rejected up front.
  const mism = await validatePlugin(buf, 'deadbeef');
  assert.equal(mism.reason, 'package_checksum_mismatch');
});

test('zipCreate builds a readable zip (roundtrips through adm-zip)', async () => {
  const buf = Buffer.from(await zipCreate([{ name: 'a.txt', data: Buffer.from('hi') }, { name: 'd/b.bin', data: Buffer.from([1, 2, 3]) }]));
  const z = new AdmZip(buf);
  assert.deepEqual(z.getEntries().map((e) => e.entryName).sort(), ['a.txt', 'd/b.bin']);
  assert.equal(z.getEntry('a.txt').getData().toString(), 'hi');
});

test('dirScan lists files (relative, forward-slashed) with sizes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  writeFileSync(join(dir, 'x.txt'), 'hello'); // 5
  mkdirSync(join(dir, 'sub')); writeFileSync(join(dir, 'sub', 'y.bin'), Buffer.from([1, 2, 3])); // 3
  const files = (await dirScan(dir)).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(files.map((f) => f.path), ['sub/y.bin', 'x.txt']);
  assert.equal(files.reduce((a, f) => a + f.size, 0), 8);
});

test('zstd round-trips when the addon is built (null otherwise)', async () => {
  const orig = Buffer.from('z'.repeat(500));
  const c = await zstdCompress(orig, 3);
  if (hasNative) {
    assert.ok(c.length < orig.length, 'compresses');
    assert.ok(Buffer.from(await zstdDecompress(Buffer.from(c))).equals(orig), 'decompresses back');
  } else assert.equal(c, null);
});

test('imageThumb downscales a raster and never upscales', async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const cv = createCanvas(600, 400); cv.getContext('2d').fillRect(0, 0, 600, 400);
  const png = cv.toBuffer('image/png');
  const t = await imageThumb(png, 256);
  assert.ok(t && t.buffer.length > 0 && /^image\/(jpeg|webp)$/.test(t.type), 'produces a thumbnail');
  assert.equal(await imageThumb(png, 1024), null, 'width >= source → null (no upscale)');
});

test('blake3Hex: 64-hex + deterministic when the addon is built, null otherwise', async () => {
  const h = await blake3Hex(Buffer.from('BetterCommunity'));
  if (hasNative) {
    assert.equal(typeof h, 'string');
    assert.equal(h.length, 64);
    assert.equal(h, await blake3Hex(Buffer.from('BetterCommunity')), 'deterministic');
  } else {
    assert.equal(h, null, 'native-only: null when the addon is not built');
  }
});
