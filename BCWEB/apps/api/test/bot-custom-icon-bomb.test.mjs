// An uploaded bot icon is bounded in PIXELS, not only in bytes.
//
// Pentest 2026-09-23, card 5. `MAX_SOURCE_BYTES` (2 MB) was the only cap on the image a
// custom icon carries, and bytes say nothing about what a decoder has to allocate: a PNG of
// one flat colour at 60000x60000 is a few kilobytes on the wire and ~14 GB once decoded.
// `prepareCustomIcon` handed it straight to `@napi-rs/canvas`'s `loadImage`, so one POST from
// a staff account with `manage_bot` could take the API process out of memory.
//
// Pure: no canvas, no database — the refusal happens on the header, before anything decodes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { imageSize, sniffImage, prepareCustomIcon, MAX_SOURCE_PIXELS } from '../src/lib/bot-custom-icons.mjs';

/** A PNG of `w`x`h`. `rows` false leaves the pixel data out: the refusal under test happens
 *  on the header, and a real 60000x60000 flat PNG is only ~400 KB anyway — small enough to
 *  post, large enough to end the process once a decoder has expanded it. */
function flatPng(w, h, rows = true) {
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit greyscale
  const raw = Buffer.alloc(rows ? h * (w + 1) : 0); // every row: filter 0 then w zero bytes
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

describe('custom bot icons: the size a decoder would have to allocate', () => {
  test('imageSize reads a PNG header without decoding it', () => {
    const png = flatPng(7, 5);
    assert.equal(sniffImage(png), 'image/png');
    assert.deepEqual(imageSize(png), { w: 7, h: 5 });
    assert.equal(imageSize(Buffer.from('not an image at all')), null);
    assert.deepEqual(imageSize(Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([0x40, 0x00, 0x20, 0x00, 0, 0, 0, 0])])), { w: 64, h: 32 });
  });

  test('a decompression bomb is refused on its header, small as it is', async () => {
    const bomb = flatPng(60000, 60000, false);
    assert.ok(bomb.length < 500 * 1024, `the bomb is ${bomb.length} bytes — it fits well under the byte cap`);
    assert.deepEqual(imageSize(bomb), { w: 60000, h: 60000 });
    const r = await prepareCustomIcon({ key: 'bomb', label: 'Bomb', source: 'image', image: dataUrl(bomb) });
    assert.equal(r.ok, false);
    assert.ok(r.issues.join(' ').includes(String(MAX_SOURCE_PIXELS)), r.issues.join(' '));
  });

  test('an image whose header states no size at all is refused, not decoded', async () => {
    // A valid PNG signature with a chunk that is not IHDR: sniffs as a PNG, states nothing.
    const liar = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 0x41)]);
    assert.equal(sniffImage(liar), 'image/png');
    assert.equal(imageSize(liar), null);
    const r = await prepareCustomIcon({ key: 'liar', label: 'Liar', source: 'image', image: dataUrl(liar) });
    assert.equal(r.ok, false);
  });
});
