// One URL per page.
//
// Measured against the running stack before this was written: `/faq` and `/faq/` both
// answered 200 with byte-identical HTML, and `/api/health/` answered 404 while
// `/api/health` answered 200. Two different bugs wearing the same clothes — the site had
// every page at two addresses, and the API had one endpoint at one address only.
//
// The three rules that fix it live in three files, so this checks all three: the edge
// redirect, the API accepting both spellings, and the canonical that is written from the
// normalised path rather than from whatever the visitor typed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalPath } from '../src/routes/og.mjs';

const caddy = readFileSync(new URL('../../../infra/caddy/Caddyfile', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

describe('a path has one spelling', () => {
  test('the trailing slash is dropped, and the root keeps its own', () => {
    assert.equal(canonicalPath('/faq/'), '/faq');
    assert.equal(canonicalPath('/a/b/c/'), '/a/b/c');
    assert.equal(canonicalPath('/faq'), '/faq');
    assert.equal(canonicalPath('/'), '/');
    assert.equal(canonicalPath(''), '/');
    assert.equal(canonicalPath(undefined), '/');
    // A query or a fragment is not part of the path, and must not smuggle a slash through.
    assert.equal(canonicalPath('/faq/?a=1'), '/faq');
    assert.equal(canonicalPath('/faq/#s2'), '/faq');
    // Several slashes are still one page.
    assert.equal(canonicalPath('/faq///'), '/faq');
  });
});

describe('the edge redirects the slashed form away', () => {
  test('both branches exist: with a query and without', () => {
    // Two matchers, because Caddy has no "append the query only if there is one" — with a
    // single rule every redirect ends in a bare `?`. Verified live against the caddy binary.
    assert.match(caddy, /redir @tslash_q \{re\.tslash\.1\}\?\{query\} 308/);
    assert.match(caddy, /redir @tslash \{re\.tslash2\.1\} 308/);
  });
  // Both patterns are read out of the Caddyfile and RUN, rather than compared as text: what
  // matters is which paths they redirect. (Go's RE2 and JavaScript agree on everything these
  // patterns use: a class, `\x5c`, `\s`, `.*`.)
  const patterns = () => {
    const rules = [...caddy.matchAll(/path_regexp tslash2? (\S+)/g)].map((m) => m[1]);
    assert.equal(rules.length, 2);
    return rules.map((r) => new RegExp(r));
  };
  test('the root is never redirected', () => {
    for (const re of patterns()) {
      assert.equal(re.test('/'), false, re.source);
      assert.equal('/faq/'.match(re)?.[1], '/faq', re.source);
      assert.equal('/a/b/c/'.match(re)?.[1], '/a/b/c', re.source);
    }
  });
  test('no redirect sends the browser to another host', () => {
    // The Location is relative, and browsers read `/\evil.example` — and `/<TAB>/evil.example`,
    // tabs being dropped — as `//evil.example`, another host. `/%5Cevil.example/` was answered
    // `308 Location: /\evil.example` until the pattern refused a second `/`, a `\` or
    // whitespace after the first slash (found by the DAST job's nuclei run, 2026-09-25).
    for (const re of patterns()) {
      for (const p of ['/\\evil.example/', '//evil.example/', '/\t/evil.example/', '/\\\\evil.example/', '/ /evil.example/']) {
        assert.equal(re.test(p), false, `${re.source} must not redirect ${JSON.stringify(p)}`);
      }
    }
  });
  test('/api and /hosting are exempt, and for different reasons', () => {
    // /hosting: a trailing slash there is a directory listing of a hosted repo, which is not
    // the same resource as the file beside it. /api: a client should get its answer, not a
    // 308 it may or may not follow with its body intact.
    assert.equal((caddy.match(/not path \/api\/\* \/hosting\/\* \/og\/\*/g) || []).length, 2);
  });
});

describe('the API answers both spellings itself', () => {
  test('ignoreTrailingSlash is on', () => {
    assert.match(server, /ignoreTrailingSlash: true/);
  });
});
