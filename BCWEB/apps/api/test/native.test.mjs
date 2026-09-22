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

// ── The inflate budget (CWE-409 / CWE-789) ───────────────────────────────────────────────
//
// zipReadAll materialises EVERY entry in memory. Every caller feeds it bytes from outside:
// a submitted catalogue item's download_url, an uploaded payload, a restored backup. Deflate
// reaches ~1000:1 on repetitive input, so a few kilobytes on the wire is gigabytes of Buffer
// in a container limited to 512 MB — and that is not an exception a route can catch, it is
// the process being OOM-killed with every other request in flight.
//
// npm audit's adm-zip finding (GHSA-7q85-xj36-vmfc) is the same class, and upgrading to
// 0.6.1 does NOT close it: that fix only stops an entry DECLARING zero from escaping zlib's
// cap. An entry that honestly declares four gigabytes is still inflated in full — by adm-zip
// and by the native Rust path, which is worse there because it reserves the declared size up
// front (`Vec::with_capacity(size)` in native/core), so merely CLAIMING 100 GB is enough.
//
// Hence the budget in lib/native.mjs. These prove it is real, that it is checked before any
// inflation, and that it does not refuse ordinary archives.

test('zipReadAll refuses a zip that DECLARES more than the budget, before inflating', async () => {
  // A real bomb shape, scaled down: 8 MB of zeros deflates to a few kilobytes.
  const z = new AdmZip();
  z.addFile('zeros.bin', Buffer.alloc(8 * 1024 * 1024));
  const buf = z.toBuffer();
  assert.ok(buf.length < 256 * 1024, `the archive is small on the wire (${buf.length} bytes) — that is the attack`);

  await assert.rejects(
    () => zipReadAll(buf, { maxTotalBytes: 1024 * 1024 }),
    (e) => e.code === 'zip_too_large',
    'a declared 8 MB against a 1 MB budget must be refused with zip_too_large',
  );

  // The refusal is the PRE-CHECK, not a failed inflate: raise the budget over the declared
  // total and the very same bytes read back in full.
  const ok = await zipReadAll(buf, { maxTotalBytes: 16 * 1024 * 1024 });
  assert.equal(ok.length, 1);
  assert.equal(Buffer.from(ok[0].data).length, 8 * 1024 * 1024);
});

test('the budget is a sum over entries, and ordinary archives pass the default', async () => {
  const z = new AdmZip();
  z.addFile('a', Buffer.alloc(1000, 0x41));
  z.addFile('b', Buffer.alloc(1000, 0x42));
  z.addFile('c', Buffer.alloc(1000, 0x43));
  const buf = z.toBuffer();
  await assert.rejects(() => zipReadAll(buf, { maxTotalBytes: 2999 }), (e) => e.code === 'zip_too_large',
    'no single entry exceeds the budget — only their sum does, and that is what counts');
  assert.equal((await zipReadAll(buf, { maxTotalBytes: 3000 })).length, 3, 'exactly at the budget is allowed');
  assert.equal((await zipReadAll(buf)).length, 3, 'and the shipped default lets a normal archive through');
});
