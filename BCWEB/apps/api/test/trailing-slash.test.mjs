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
  test('the root is never redirected', () => {
    // `^(/.+)/$` requires at least one character before the final slash.
    const rules = caddy.match(/path_regexp tslash2? \S+/g) || [];
    assert.equal(rules.length, 2);
    for (const r of rules) assert.ok(r.endsWith('^(/.+)/$'), r);
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
