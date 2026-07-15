// Optional native (Rust) acceleration for CPU-heavy work, running on a worker thread
// instead of the JS event loop. If the addon isn't built (fresh clone, or a platform with
// no prebuild) every function transparently falls back to the pure-JS path — so nothing
// breaks, it just runs on the main thread. Mirrors how Redis degrades to in-process.
// Build the addon with: (cd native && npm install && npm run build). See guides/RUST_WORKERS_PLAN.
import AdmZip from 'adm-zip';
import { createRequire } from 'node:module';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

let native = null;
// Look for the built addon in a few layout-independent spots: the repo's native/ during
// local dev, or a native/ next to the app root in a container image. Prefer napi's
// index.js loader; if that can't resolve the platform binary (its musl/glibc probe has
// edge cases), fall back to require-ing the .node file directly — which always works when
// it's present. A bad/absent addon just leaves `native` null → the JS fallbacks below run.
for (const rel of ['../../../../native', '../../native', '../../../native']) {
  const dir = join(here, rel);
  try {
    try { const m = require(join(dir, 'index.js')); if (m && m.zipReadAll) { native = m; break; } } catch { /* try direct */ }
    const nodeFile = readdirSync(dir).find((f) => f.endsWith('.node'));
    if (nodeFile) { const m = require(join(dir, nodeFile)); if (m && m.zipReadAll) { native = m; break; } }
  } catch { /* try the next candidate dir */ }
}

export const hasNative = !!(native && native.zipEntries);

// List a zip archive's entries as [{ name, size }]. Native path parses on a worker thread
// (never blocking the event loop); the fallback is adm-zip's synchronous parse. Both return
// the same shape — verified by test/native.test.mjs.
export async function zipEntries(buf) {
  if (native && native.zipEntries) return native.zipEntries(buf);
  const zip = new AdmZip(buf);
  return zip.getEntries().map((e) => ({ name: e.entryName, size: e.header.size }));
}

// Read a zip's non-directory entries WITH their bytes as [{ name, data: Buffer }]. Native
// parses + inflates on a worker thread; the fallback is adm-zip's synchronous read. Same
// shape both ways — verified by test/native.test.mjs. Replaces `new AdmZip(buf)` + getData().
export async function zipReadAll(buf) {
  if (native && native.zipReadAll) return native.zipReadAll(buf);
  const zip = new AdmZip(buf);
  return zip.getEntries().filter((e) => !e.isDirectory).map((e) => ({ name: e.entryName, data: e.getData() }));
}

// Extract ONE zip entry's bytes by name (null if missing or a directory). Native reads it
// on a worker thread; the fallback is adm-zip. Replaces `new AdmZip(buf).getEntry(name).getData()`.
export async function zipEntry(buf, name) {
  if (native && native.zipEntry) return native.zipEntry(buf, name);
  const e = new AdmZip(buf).getEntry(name);
  return (!e || e.isDirectory) ? null : e.getData();
}

// BLAKE3 hex hash on a worker thread — native-only (Node has no BLAKE3). Returns null when
// the addon isn't built, so callers must handle that (it's for future INTERNAL integrity
// keys — dedup / manifests / cache keys — never the public sha256 contract).
export async function blake3Hex(buf) {
  return native && native.blake3Hex ? native.blake3Hex(buf) : null;
}

// Build a zip (deflate) from [{ name, data }] on a worker thread; fallback adm-zip.
export async function zipCreate(files) {
  if (native && native.zipCreate) return native.zipCreate(files);
  const zip = new AdmZip();
  for (const f of files) zip.addFile(f.name, Buffer.from(f.data));
  return zip.toBuffer();
}

// Recursively list a directory's files as [{ path, size }] (relative, forward-slashed) on a
// worker thread; fallback a JS readdir walk. Used for size accounting off the event loop.
export async function dirScan(root) {
  if (native && native.dirScan) return native.dirScan(root);
  const out = []; const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { let size = 0; try { size = statSync(p).size; } catch { /* skip */ } out.push({ path: relative(root, p).replace(/\\/g, '/'), size }); }
    }
  }
  return out;
}

// zstd compress/decompress on a worker thread — native-only (Node 20 has no zstd). Returns
// null when the addon isn't built. For INTERNAL artifacts only; callers must handle null.
export async function zstdCompress(buf, level = 3) { return native && native.zstdCompress ? native.zstdCompress(buf, level) : null; }
export async function zstdDecompress(buf) { return native && native.zstdDecompress ? native.zstdDecompress(buf) : null; }

// Downscale a raster image to `width` and return { buffer, type } (or null to keep the
// original — never upscales). Native → JPEG on a worker thread; fallback @napi-rs/canvas → webp.
export async function imageThumb(buf, width) {
  if (native && native.imageResizeJpeg) {
    const out = await native.imageResizeJpeg(buf, width, 82);
    return out ? { buffer: Buffer.from(out), type: 'image/jpeg' } : null;
  }
  const { loadImage, createCanvas } = await import('@napi-rs/canvas');
  const img = await loadImage(buf);
  if (!img.width || img.width <= width) return null;
  const h = Math.max(1, Math.round(img.height * (width / img.width)));
  const canvas = createCanvas(width, h);
  canvas.getContext('2d').drawImage(img, 0, 0, width, h);
  return { buffer: await canvas.encode('webp', 82), type: 'image/webp' };
}
