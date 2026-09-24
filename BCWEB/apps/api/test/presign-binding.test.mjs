// A presigned PUT is bound to the Content-Type and the exact size the API validated.
//
// It used to sign `host` only (X-Amz-SignedHeaders=host). The API checked the type allowlist
// and the byte cap, then handed out a URL the store accepted with ANY Content-Type and ANY
// number of bytes: measured 2026-09-25 against versitygw v1.8.0, a URL approved for a
// 1000-byte image/png stored 5000 bytes of text/html. The store recomputes the signature
// from the headers the uploader actually sends, so once `content-type` and `content-length`
// are in the signed headers a mismatched PUT is refused 403 SignatureDoesNotMatch by the
// storage server itself — the same measurement, after, refused wrong type, bigger body,
// smaller body, no Content-Length and no Content-Type, and stored the honest upload.
//
// That measurement needs a live gateway, which CI does not have. What this file pins is the
// part that decides it: the signed-header list in the URL, that an unbound presign cannot be
// produced, and that every caller (API and web) passes the size along.
//
// No database and no storage: presigning is offline signing.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.S3_PUBLIC_ENDPOINT ||= 'http://localhost:9000';
process.env.S3_ACCESS_KEY ||= 'test-access';
process.env.S3_SECRET_KEY ||= 'test-secret';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(HERE, '..', 'src');
const WEB_SRC = join(HERE, '..', '..', 'web', 'src');

let presignPut, PRESIGNED_PUT_SIGNED_HEADERS, presignRepoFile;
before(async () => {
  ({ presignPut, PRESIGNED_PUT_SIGNED_HEADERS } = await import('../src/lib/storage.mjs'));
  ({ presignRepoFile } = await import('../src/routes/hosting-content.mjs'));
});

const signedHeaders = (url) => new URL(url).searchParams.get('X-Amz-SignedHeaders');

describe('presignPut binds the type and the size', () => {
  test('the URL is signed over content-length, content-type and host', async () => {
    const url = await presignPut('blog/x.png', { contentType: 'image/png', size: 1234 });
    assert.equal(signedHeaders(url), 'content-length;content-type;host',
      'a header missing here is a header the store does not enforce');
    assert.equal(PRESIGNED_PUT_SIGNED_HEADERS.join(';'), 'content-length;content-type;host');
  });

  test('the type and size are not hoisted into the query (the uploader must SEND them)', async () => {
    const u = new URL(await presignPut('blog/x.png', { contentType: 'image/png', size: 1234 }));
    const keys = [...u.searchParams.keys()].map((k) => k.toLowerCase());
    assert.ok(!keys.includes('content-type') && !keys.includes('content-length'), keys.join(','));
  });

  test('an unbound presign cannot be produced', async () => {
    for (const [label, arg] of [
      ['no size', { contentType: 'image/png' }],
      ['size 0', { contentType: 'image/png', size: 0 }],
      ['negative size', { contentType: 'image/png', size: -1 }],
      ['fractional size', { contentType: 'image/png', size: 1.5 }],
      ['no type', { size: 10 }],
      // The pre-2026-09-25 signature: presignPut(key, contentType). Must not quietly sign
      // host-only with an undefined size.
      ['the old positional call', 'image/png'],
    ]) {
      await assert.rejects(() => presignPut('k', arg), TypeError, label);
    }
  });

  test('a hosted-repo file presign carries the same binding', async () => {
    const repo = { id: 'r1', storageQuotaBytes: 10n ** 9n, files: [] };
    const out = await presignRepoFile(null, repo, { path: 'mods/a.zip', size: 42, contentType: 'application/zip' });
    assert.equal(signedHeaders(out.url), 'content-length;content-type;host');
  });
});

// ── every caller passes the validated size ───────────────────────────────────

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

describe('every presign caller passes the size', () => {
  test('every presignPut( call in the API names a size', () => {
    const calls = [];
    for (const f of walk(API_SRC, ['.mjs'])) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bpresignPut\(([^;]*?)\)\s*;/g)) calls.push({ f, args: m[1] });
    }
    assert.ok(calls.length >= 4, `found only ${calls.length} presignPut calls — the scan stopped matching`);
    const bad = calls.filter((c) => !/\bsize\b/.test(c.args)).map((c) => `${c.f}: presignPut(${c.args})`);
    assert.deepEqual(bad, [], 'a presign without a size is refused at runtime (500), and was unbound before');
  });

  test('every web POST to a presign endpoint sends a size', () => {
    // The browser sets Content-Length from the body, so the only way a web client gets the
    // size wrong is by not telling the API what it is. A body without `size` is a 400 on
    // every presign route now.
    const posts = [];
    for (const f of walk(WEB_SRC, ['.js', '.jsx'])) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:\.post|\bpostRetry)\(\s*([`'"][^`'"]*\/presign[`'"])\s*,([\s\S]*?)\)\s*;/g)) posts.push({ f, path: m[1], body: m[2] });
    }
    // Every `/presign` string in the web must be one of these posts: a new caller written
    // another way (a bare fetch, a helper) would otherwise sit outside the scan.
    const mentions = walk(WEB_SRC, ['.js', '.jsx']).reduce((n, f) => n + (readFileSync(f, 'utf8').match(/\/presign[`'"]/g) || []).length, 0);
    assert.equal(posts.length, mentions, `${mentions} /presign mentions in the web, ${posts.length} recognised presign posts`);
    assert.ok(posts.length >= 8, `found only ${posts.length} presign posts — the scan stopped matching`);
    const bad = posts.filter((p) => !/\bsize\b/.test(p.body)).map((p) => `${p.f}: ${p.path}`);
    assert.deepEqual(bad, []);
  });
});
