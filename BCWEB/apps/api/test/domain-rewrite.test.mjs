// Serving a customer's hostname: the rewrite, and where it refuses to.
//
// This exists because the first version of the feature did not work at all. The rewrite lived in
// an onRequest hook, and Fastify's lifecycle is Request -> ROUTING -> onRequest — so mutating
// req.raw.url there happens after the handler has already been chosen. Every custom domain
// silently served the site's own 404, and nothing about the code looked wrong.
//
// So there are two kinds of test here: the pure rewrite, and a real Fastify instance proving the
// rewrite actually changes which handler runs. The second is the one that would have caught it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import http from 'node:http';
import { rewriteForTarget } from '../src/routes/domains.mjs';

const REPO = { kind: 'repo', hostPath: 'me/mods', id: 'r1' };
const CAT = { kind: 'catalog', slug: 'my-cat', id: 'c1' };

describe('rewriteForTarget', () => {
  test('the apex of a repo domain is its manifest', () => {
    // Somebody handed the bare hostname is asking for the repo, and the repo IS repo.json.
    assert.equal(rewriteForTarget(REPO, '/'), '/hosting/me/mods/repo.json');
    assert.equal(rewriteForTarget(REPO, ''), '/hosting/me/mods/repo.json');
  });

  test('a path becomes a file under that repo', () => {
    assert.equal(rewriteForTarget(REPO, '/a.zip'), '/hosting/me/mods/files/a.zip');
    assert.equal(rewriteForTarget(REPO, '/sub/dir/'), '/hosting/me/mods/files/sub/dir/');
  });

  test('the query survives', () => {
    assert.equal(rewriteForTarget(REPO, '/a.zip?password=x'), '/hosting/me/mods/files/a.zip?password=x');
    assert.equal(rewriteForTarget(REPO, '/?k=abc'), '/hosting/me/mods/repo.json?k=abc');
  });

  test('a catalogue domain serves its feed', () => {
    assert.equal(rewriteForTarget(CAT, '/'), '/c/my-cat/catalog.json');
    assert.equal(rewriteForTarget(CAT, '/items/x'), '/c/my-cat/items/x');
  });

  test('a `..` segment is REFUSED, not rewritten', () => {
    // Not exploitable downstream today — the wildcard is compared against exact stored paths and
    // never reaches a filesystem — but depending on a property of a module two files away is how
    // it quietly stops being true.
    for (const p of ['/../admin', '/a/../../admin', '/..', '/a/..']) {
      assert.equal(rewriteForTarget(REPO, p), p, `rewrote ${p}`);
    }
  });

  test('percent-encoded traversal is refused too', () => {
    // %2e%2e%2f survives the router's own decoding, so checking the raw path alone is not enough.
    assert.equal(rewriteForTarget(REPO, '/%2e%2e%2fadmin'), '/%2e%2e%2fadmin');
    assert.equal(rewriteForTarget(REPO, '/a/%2E%2E/b'), '/a/%2E%2E/b');
  });

  test('a filename that merely contains dots is fine', () => {
    // ".." only counts as a whole segment. `v1..2.zip` is a filename.
    assert.equal(rewriteForTarget(REPO, '/v1..2.zip'), '/hosting/me/mods/files/v1..2.zip');
    assert.equal(rewriteForTarget(REPO, '/a...b'), '/hosting/me/mods/files/a...b');
  });

  test('no target means no change', () => {
    assert.equal(rewriteForTarget(null, '/anything'), '/anything');
  });
});

// ── the part that was actually broken ─────────────────────────────────────────────────────
describe('the rewrite reaches the router', () => {
  const get = (port, path, host) => new Promise((res) => {
    // http.request, not fetch: undici refuses to set a Host header, which made an earlier probe
    // report this as not working when the client was the problem.
    const r = http.request({ port, path, host: '127.0.0.1', headers: { Host: host } }, (x) => {
      let b = ''; x.on('data', (c) => { b += c; }); x.on('end', () => res({ status: x.statusCode, body: b }));
    });
    r.on('error', () => res({ status: 0, body: '' }));
    r.end();
  });

  test('a customer host reaches the hosting handler, ours does not', async () => {
    const app = Fastify({
      rewriteUrl(req) {
        const host = String(req.headers.host || '').split(':')[0];
        return host === 'mods.example.test' ? rewriteForTarget(REPO, req.url) : req.url;
      },
    });
    app.get('/', async () => ({ who: 'site' }));
    app.get('/hosting/:owner/:repo/repo.json', async () => ({ who: 'manifest' }));
    app.get('/hosting/:owner/:repo/files/*', async (req) => ({ who: 'file', star: req.params['*'] }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = app.server.address().port;
    try {
      assert.match((await get(port, '/', 'localhost')).body, /"who":"site"/);
      assert.match((await get(port, '/', 'mods.example.test')).body, /"who":"manifest"/);
      assert.match((await get(port, '/a.zip', 'mods.example.test')).body, /"who":"file"/);
      // And the refusal, end to end: a traversal path is left alone, so it lands on the site's
      // own routing and 404s rather than reaching the file handler with `..` in the wildcard.
      const trav = await get(port, '/../../admin', 'mods.example.test');
      assert.equal(trav.status, 404);
      assert.equal(/"who":"file"/.test(trav.body), false);
    } finally { await app.close(); }
  });
});
