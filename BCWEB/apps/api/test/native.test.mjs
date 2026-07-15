// Tests the native (Rust) acceleration wrapper and its JS fallback via lib/native.mjs.
// These run WITHOUT a DB. Whichever path is active (native addon built, or the adm-zip
// fallback), the wrapper must produce identical results, and validatePlugin — which now
// parses the zip through it — must still verify packages correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { zipReadAll, blake3Hex, hasNative } from '../src/lib/native.mjs';
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
