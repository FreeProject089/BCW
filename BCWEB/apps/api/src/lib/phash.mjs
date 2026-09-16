// Perceptual hashing — "does this picture look like one we already have?"
//
// A cryptographic hash answers "is it the same file"; the copyright question is "is it the
// same picture", and a re-encoded, resized or lightly cropped copy has a different SHA and
// the same look. pHash (DCT-based, 64 bits): the image is shrunk to 32×32 grey, a 2-D DCT
// keeps the 8×8 lowest frequencies (the overall shapes, not the pixels), and each bit says
// whether that coefficient is above the median. Two hashes are compared by Hamming distance:
// 0–4 is the same picture, ≤ 10 is very probably the same picture with edits, ≥ 20 is a
// different one. Everything here is pure computation on a Buffer; decoding goes through
// @napi-rs/canvas (already a dependency for the OG images), archives through adm-zip.
import crypto from 'node:crypto';

export const HASH_BITS = 64;
const SIZE = 32;
const LOW = 8;

/** Hex sha256 of a buffer. */
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Raster types the decoder handles; SVG is text and is not hashed (it has no pixels to compare). */
export const RASTER = /^image\/(png|jpe?g|webp|gif|avif|bmp)$/i;
export const ARCHIVE = /^application\/(zip|x-zip-compressed|x-compressed)$|^multipart\/x-zip$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

// The DCT basis, computed once: cos((2x+1)·u·π / 2N) · c(u).
const BASIS = (() => {
  const b = [];
  for (let u = 0; u < SIZE; u++) {
    const row = new Float64Array(SIZE);
    const c = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < SIZE; x++) row[x] = c * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
    b.push(row);
  }
  return b;
})();

/**
 * The hash of a 32×32 grey plane (Float64Array/Array of 1024 luminance values, row-major).
 * Exported so a test can feed synthetic pixels without a decoder.
 */
export function phashOfGrey(grey) {
  if (!grey || grey.length !== SIZE * SIZE) throw new Error('phashOfGrey: expected 32×32');
  // Row pass then column pass, keeping only the LOW×LOW block of the result.
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const out = new Float64Array(LOW);
    for (let u = 0; u < LOW; u++) {
      let s = 0;
      const b = BASIS[u];
      for (let x = 0; x < SIZE; x++) s += grey[y * SIZE + x] * b[x];
      out[u] = s;
    }
    rows.push(out);
  }
  const coef = [];
  for (let v = 0; v < LOW; v++) {
    const b = BASIS[v];
    for (let u = 0; u < LOW; u++) {
      let s = 0;
      for (let y = 0; y < SIZE; y++) s += rows[y][u] * b[y];
      coef.push(s);
    }
  }
  // The DC term (index 0) is the average brightness: it says nothing about the picture and
  // would dominate the median, so it is left out of both the median and the bits.
  const ac = coef.slice(1);
  const sorted = [...ac].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  let bits = 0n;
  for (let i = 0; i < ac.length; i++) if (ac[i] > median) bits |= 1n << BigInt(i);
  // 63 AC coefficients → 63 bits; the top bit stays 0. Fixed-width hex so strings compare.
  return bits.toString(16).padStart(16, '0');
}

/** Hamming distance between two hex hashes (0 = identical, 63 = opposite). */
export function hamming(a, b) {
  if (!a || !b) return HASH_BITS;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) { x &= x - 1n; n++; }
  return n;
}

/** Decode a raster image buffer to its 32×32 grey plane, or null when it cannot be decoded. */
export async function greyPlane(buf) {
  let canvasMod;
  try { canvasMod = await import('@napi-rs/canvas'); } catch { return null; }
  const { createCanvas, loadImage } = canvasMod;
  let img;
  try { img = await loadImage(buf); } catch { return null; }
  if (!img || !img.width || !img.height) return null;
  const c = createCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; // transparency reads as white, the same way a browser shows it on a page
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const grey = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) grey[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return { grey, width: img.width, height: img.height };
}

/** `{ phash, width, height }` for a raster image buffer, or null. */
export async function phashImage(buf) {
  const plane = await greyPlane(buf);
  if (!plane) return null;
  return { phash: phashOfGrey(plane.grey), width: plane.width, height: plane.height };
}

/**
 * The images inside a zip, hashed: `[{ entry, phash, width, height, bytes }]`. Bounded — the
 * first `maxEntries` image entries under `maxBytes` each — because a modpack can hold
 * thousands of textures and the question is "did this bundle lift someone's artwork", which
 * the first few dozen answer as well as all of them.
 */
export async function archiveImageHashes(buf, { maxEntries = 24, maxBytes = 4 * 1024 * 1024 } = {}) {
  let AdmZip;
  try { AdmZip = (await import('adm-zip')).default; } catch { return []; }
  let zip;
  try { zip = new AdmZip(buf); } catch { return []; }
  const out = [];
  for (const e of zip.getEntries()) {
    if (out.length >= maxEntries) break;
    if (e.isDirectory || !IMAGE_EXT.test(e.entryName) || e.header.size > maxBytes || e.header.size === 0) continue;
    let data;
    try { data = e.getData(); } catch { continue; }
    const h = await phashImage(data);
    if (h) out.push({ entry: e.entryName, bytes: data.length, ...h });
  }
  return out;
}

/**
 * The rows within `maxDistance` of `hash`, nearest first. Linear over the candidates: at the
 * scale of one site's uploads (tens of thousands) this is a few milliseconds, and an index
 * that answers "within Hamming 8" needs a structure Postgres does not have.
 */
export function nearest(hash, rows, maxDistance) {
  const out = [];
  for (const r of rows) {
    if (!r.phash || r.phash === undefined) continue;
    const d = hamming(hash, r.phash);
    if (d <= maxDistance) out.push({ row: r, distance: d });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
