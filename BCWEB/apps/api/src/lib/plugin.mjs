import { createHash } from 'node:crypto';
import { safeFetch } from './net.mjs';
import { zipReadAll } from './native.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Validate a .bmmplug (a ZIP). Integrity model:
//  • the catalog entry's sha256 anchors the WHOLE package (set/verified by us),
//  • the internal checksums.json anchors EACH file.
// Tampering any file changes the zip bytes (outer sha) and/or a per-file sha, so a
// tampered package cannot be valid while its inner checksums stay valid.
export async function validatePlugin(buf, expectedSha) {
  const outer = sha256(buf);
  if (expectedSha && String(expectedSha).toLowerCase() !== outer) {
    return { valid: false, sha256: outer, reason: 'package_checksum_mismatch', files: [], checkedAt: new Date().toISOString() };
  }
  // Parse + inflate the zip OFF the event loop (native Rust worker; falls back to adm-zip).
  // The sha256 integrity checks stay in JS — that's the client-facing contract.
  let entries;
  try { entries = await zipReadAll(buf); } catch { return { valid: false, sha256: outer, reason: 'not_a_zip', files: [], checkedAt: new Date().toISOString() }; }
  const names = () => entries.map((e) => e.name);
  const manifestEntry = entries.find((e) => e.name === 'plugin.json');
  if (!manifestEntry) return { valid: false, sha256: outer, reason: 'missing_plugin_json', files: names(), checkedAt: new Date().toISOString() };
  let manifest = null;
  try { manifest = JSON.parse(Buffer.from(manifestEntry.data).toString('utf-8')); } catch { return { valid: false, sha256: outer, reason: 'invalid_plugin_json', files: [], checkedAt: new Date().toISOString() }; }
  const cksEntry = entries.find((e) => e.name === 'checksums.json');
  if (!cksEntry) return { valid: false, sha256: outer, reason: 'missing_checksums', manifest, files: names(), checkedAt: new Date().toISOString() };
  let cks = {};
  try { cks = JSON.parse(Buffer.from(cksEntry.data).toString('utf-8')); } catch { return { valid: false, sha256: outer, reason: 'invalid_checksums', manifest, files: [], checkedAt: new Date().toISOString() }; }
  const map = cks.files || cks; // supports { files: {path:sha} } or a flat map

  const files = []; const invalid = [];
  for (const e of entries) {
    if (e.name === 'checksums.json') continue;
    const data = Buffer.from(e.data);
    const got = sha256(data);
    const want = map[e.name] ? String(map[e.name]).toLowerCase() : null;
    const ok = !!want && want === got;
    files.push({ path: e.name, size: data.length, sha256: got, expected: want, ok });
    if (!ok) invalid.push(e.name);
  }
  const valid = invalid.length === 0 && files.every((f) => f.expected);
  return {
    valid, sha256: outer, manifest, files, invalid,
    reason: valid ? 'ok' : (invalid.length ? 'file_checksum_mismatch' : 'unlisted_files'),
    checkedAt: new Date().toISOString(),
  };
}

// Read a .bmmplug's bytes from our storage (key) or an external URL (self-hosted).
// The most this will read from a remote `download_url`. A payload we hold ourselves (`key`,
// from object storage) is not subject to it: those bytes were already accepted by an upload
// path that has its own limits, and re-refusing them here would only break reading back
// something we chose to store.
export const PLUGIN_FETCH_MAX_BYTES = 256 * 1024 * 1024;

export async function fetchPluginBytes({ url, key, getObject, maxBytes = PLUGIN_FETCH_MAX_BYTES }) {
  if (key && getObject) {
    const { body } = await getObject(key);
    const chunks = [];
    for await (const c of body) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
    return Buffer.concat(chunks);
  }
  if (url) {
    const res = await safeFetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`http_${res.status}`);
    // `res.arrayBuffer()` buffers whatever the remote chooses to send, and `url` here is a
    // SUBMITTED item's download_url — a stranger's server. safeFetch decides WHERE we may
    // connect (SSRF); it does not decide how much we may read, and the 15 s timeout is no
    // bound either: a host on a fast link delivers gigabytes inside it. In a 512 MB
    // container that is an OOM kill, which takes every other in-flight request with it
    // (CWE-400). So read the stream and stop at the cap instead of trusting the sender.
    // Content-Length is checked first as a cheap early refusal, but it is only a HINT — a
    // hostile server can omit it or lie — so the counter below is the real bound.
    const hinted = Number(res.headers.get('content-length'));
    if (Number.isFinite(hinted) && hinted > maxBytes) throw new Error('too_large');
    const chunks = []; let total = 0;
    for await (const chunk of res.body) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += b.length;
      if (total > maxBytes) throw new Error('too_large');
      chunks.push(b);
    }
    return Buffer.concat(chunks, total);
  }
  throw new Error('no_source');
}
