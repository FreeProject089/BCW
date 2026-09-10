// What counts as a repo at the other end of a URL.
//
// The direction that matters is the false positive: marking something "valid" makes it verified
// and puts it in the public list, which is a claim that it works. "Contains links" describes
// every page on the web, so most of what follows is a normal page being refused.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRepoBody, looksLikeDirectoryIndex, looksLikeManifest } from '../src/lib/repokind.mjs';
import { checkRepoHealth } from '../src/routes/repos.mjs';

const MANIFEST = JSON.stringify({ name: 'x', version: '1', game_name: 'g', created_at: '2026-01-01', profiles: [] });

const NGINX = `<html><head><title>Index of /mods/</title></head><body>
<h1>Index of /mods/</h1><hr><pre><a href="../">../</a>
<a href="a.zip">a.zip</a>            10-Sep-2026 12:00    1024
<a href="b.zip">b.zip</a>            10-Sep-2026 12:01    2048
</pre><hr></body></html>`;

const APACHE = `<html><head><title>Index of /files</title></head><body><h1>Index of /files</h1>
<table><tr><td><a href="one.zip">one.zip</a></td></tr><tr><td><a href="two.zip">two.zip</a></td></tr></table>
</body></html>`;

const HOMEPAGE = `<html><head><title>My cool mods</title></head><body>
<h1>Welcome</h1><p>Find my work on <a href="https://github.com/me">GitHub</a> or
<a href="https://discord.gg/x">Discord</a>.</p></body></html>`;

describe('looksLikeManifest', () => {
  test('a current-format manifest', () => {
    assert.equal(looksLikeManifest(JSON.parse(MANIFEST)), true);
  });

  test('an old one, missing a required field, is not', () => {
    assert.equal(looksLikeManifest({ name: 'x', version: '1' }), false);
  });

  test('an array or null is not an object with those fields', () => {
    assert.equal(looksLikeManifest([]), false);
    assert.equal(looksLikeManifest(null), false);
  });
});

describe('looksLikeDirectoryIndex', () => {
  test('an nginx autoindex', () => {
    assert.equal(looksLikeDirectoryIndex(NGINX), true);
  });

  test('an Apache-style table index', () => {
    assert.equal(looksLikeDirectoryIndex(APACHE), true);
  });

  test('an ordinary homepage with links is NOT one', () => {
    // The important refusal. Accepting it would mark somebody's landing page as a working
    // repo, and verified means public.
    assert.equal(looksLikeDirectoryIndex(HOMEPAGE), false);
  });

  test('a page with one stray link in a pre block is not an index', () => {
    assert.equal(looksLikeDirectoryIndex('<pre><a href="x">x</a></pre>'), false);
  });

  test('"Index of" buried in a footer does not qualify the page', () => {
    const page = `<html><body>${'filler '.repeat(50_000)}<h1>Index of /</h1><a href=a></a><a href=b></a></body></html>`;
    assert.equal(looksLikeDirectoryIndex(page), false);
  });

  test('junk in is false, not a throw', () => {
    for (const x of ['', null, undefined, '{}']) assert.equal(looksLikeDirectoryIndex(x), false);
  });
});

describe('classifyRepoBody', () => {
  test('a manifest is a manifest', () => {
    assert.deepEqual(classifyRepoBody(MANIFEST), { kind: 'manifest', valid: true });
  });

  test('a directory index is a listing, and it is valid', () => {
    // This is the change: before, anything that was not JSON came back invalid, so a plain
    // file server with autoindex on could be registered and could never be listed publicly —
    // with no explanation of why.
    assert.deepEqual(classifyRepoBody(NGINX, 'text/html'), { kind: 'listing', valid: true });
  });

  test('valid JSON that is not a manifest says so', () => {
    const r = classifyRepoBody('{"hello":1}');
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'outdated_format');
  });

  test('a homepage is neither', () => {
    const r = classifyRepoBody(HOMEPAGE, 'text/html');
    assert.equal(r.valid, false);
    assert.equal(r.kind, 'unknown');
  });

  test('empty is empty, not a mystery', () => {
    assert.equal(classifyRepoBody('').reason, 'empty');
    assert.equal(classifyRepoBody('   ').reason, 'empty');
  });

  test('the content type is a hint, never the decision', () => {
    // A server claiming application/json over its 404 page must not make that page a manifest.
    const r = classifyRepoBody('<html>not json</html>', 'application/json');
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'bad_json');
    // And one claiming text/html over a real manifest must not stop it being one.
    assert.equal(classifyRepoBody(MANIFEST, 'text/html').kind, 'manifest');
  });
});

// ── the wiring, not just the classifier ──────────────────────────────────────────────────
//
// The classifier above is a pure function; this is the thing that calls it. Tested with an
// injected fetcher because safeFetch refuses loopback addresses — the SSRF guard doing its job
// — so a probe against a local test server gets a refusal that reads as the code being broken.
// That is what happened when I first tried it.
describe('checkRepoHealth', () => {
  const respond = (body, { status = 200, type = 'text/html' } = {}) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
    text: async () => body,
  });

  test('a directory index is ONLINE and valid, and says which kind it is', async () => {
    const h = await checkRepoHealth({ repoUrl: 'https://example.test/mods/' }, respond(NGINX));
    assert.equal(h.status, 'ONLINE');
    assert.equal(h.valid, true);
    assert.equal(h.kind, 'listing');
    assert.ok(h.sha);
  });

  test('a manifest still is what it always was', async () => {
    const h = await checkRepoHealth({ repoUrl: 'https://example.test/repo.json' }, respond(MANIFEST, { type: 'application/json' }));
    assert.equal(h.valid, true);
    assert.equal(h.kind, 'manifest');
  });

  test('a homepage is reachable but not a repo', async () => {
    const h = await checkRepoHealth({ repoUrl: 'https://example.test/' }, respond(HOMEPAGE));
    assert.equal(h.status, 'ONLINE');
    assert.equal(h.valid, false);
    assert.equal(h.reason, 'not_a_manifest');
  });

  test('a 404 is OFFLINE, not an invalid repo', async () => {
    const h = await checkRepoHealth({ repoUrl: 'https://example.test/gone' }, respond('no', { status: 404 }));
    assert.equal(h.status, 'OFFLINE');
    assert.equal(h.reason, 'http_404');
  });

  test('no URL at all is answered, not thrown', async () => {
    assert.equal((await checkRepoHealth({}, respond(''))).reason, 'no_url');
  });
});

// ── the cost of saying no ─────────────────────────────────────────────────────────────────
//
// This runs over a body fetched from a URL somebody registered, on create, on edit, and on the
// periodic recheck of every listed repo. The first version used two regexes that looked
// innocent and were quadratic: 200 KB of `<pre>` spam cost 1.7 seconds, and unclosed `<h1 `
// tags cost 3.2 — per health check, per repo, forever. A handful of such repos is a sweeper
// that never finishes.
//
// A time assertion is a blunt instrument and this one is deliberately loose: the fixed version
// answers in single-digit milliseconds, so a 500 ms ceiling cannot fail on a slow machine but
// catches any return to backtracking, which costs seconds.
describe('looksLikeDirectoryIndex is linear', () => {
  const hostile = [
    ['<pre> spam', '<pre>'.repeat(40_000)],
    ['nested <pre>', '<pre><pre><pre>'.repeat(15_000)],
    ['unclosed <title>', '<title'.repeat(30_000)],
    ['unclosed <h1 ', '<h1 '.repeat(50_000)],
    ['"Index of" spam', 'Index of '.repeat(22_000)],
    ['4 MB of <pre>', '<pre>'.repeat(800_000)],
  ];
  for (const [label, body] of hostile) {
    test(`${label} is answered promptly`, () => {
      const t = process.hrtime.bigint();
      looksLikeDirectoryIndex(body);
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      assert.ok(ms < 500, `took ${ms.toFixed(0)}ms — that is backtracking, not scanning`);
    });
  }
});
