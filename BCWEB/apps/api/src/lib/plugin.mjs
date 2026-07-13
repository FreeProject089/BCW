import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { safeFetch } from './net.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Validate a .bmmplug (a ZIP). Integrity model:
//  • the catalog entry's sha256 anchors the WHOLE package (set/verified by us),
//  • the internal checksums.json anchors EACH file.
// Tampering any file changes the zip bytes (outer sha) and/or a per-file sha, so a
// tampered package cannot be valid while its inner checksums stay valid.
export function validatePlugin(buf, expectedSha) {
  const outer = sha256(buf);
  if (expectedSha && String(expectedSha).toLowerCase() !== outer) {
    return { valid: false, sha256: outer, reason: 'package_checksum_mismatch', files: [], checkedAt: new Date().toISOString() };
  }
  let zip;
  try { zip = new AdmZip(buf); } catch { return { valid: false, sha256: outer, reason: 'not_a_zip', files: [], checkedAt: new Date().toISOString() }; }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const manifestEntry = entries.find((e) => e.entryName === 'plugin.json');
  if (!manifestEntry) return { valid: false, sha256: outer, reason: 'missing_plugin_json', files: entries.map((e) => e.entryName), checkedAt: new Date().toISOString() };
  let manifest = null;
  try { manifest = JSON.parse(manifestEntry.getData().toString('utf-8')); } catch { return { valid: false, sha256: outer, reason: 'invalid_plugin_json', files: [], checkedAt: new Date().toISOString() }; }
  const cksEntry = entries.find((e) => e.entryName === 'checksums.json');
  if (!cksEntry) return { valid: false, sha256: outer, reason: 'missing_checksums', manifest, files: entries.map((e) => e.entryName), checkedAt: new Date().toISOString() };
  let cks = {};
  try { cks = JSON.parse(cksEntry.getData().toString('utf-8')); } catch { return { valid: false, sha256: outer, reason: 'invalid_checksums', manifest, files: [], checkedAt: new Date().toISOString() }; }
  const map = cks.files || cks; // supports { files: {path:sha} } or a flat map

  const files = []; const invalid = [];
  for (const e of entries) {
    if (e.entryName === 'checksums.json') continue;
    const got = sha256(e.getData());
    const want = map[e.entryName] ? String(map[e.entryName]).toLowerCase() : null;
    const ok = !!want && want === got;
    files.push({ path: e.entryName, size: e.header.size, sha256: got, expected: want, ok });
    if (!ok) invalid.push(e.entryName);
  }
  const valid = invalid.length === 0 && files.every((f) => f.expected);
  return {
    valid, sha256: outer, manifest, files, invalid,
    reason: valid ? 'ok' : (invalid.length ? 'file_checksum_mismatch' : 'unlisted_files'),
    checkedAt: new Date().toISOString(),
  };
}

// Read a .bmmplug's bytes from our storage (key) or an external URL (self-hosted).
export async function fetchPluginBytes({ url, key, getObject }) {
  if (key && getObject) {
    const { body } = await getObject(key);
    const chunks = [];
    for await (const c of body) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
    return Buffer.concat(chunks);
  }
  if (url) {
    const res = await safeFetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('no_source');
}
