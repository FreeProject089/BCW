// The live B.MD block host list: what it stores and what it refuses (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHost, readHosts, parseHosts, MAX_HOSTS } from '../src/lib/bmd-hosts.mjs';

test('a pasted URL keeps its host; case, trailing dot and path go', () => {
  assert.equal(normalizeHost('https://API.Example.com/v1/stats?x=1'), 'api.example.com');
  assert.equal(normalizeHost('stats.example.org.'), 'stats.example.org');
});

test('not a host name: refused', () => {
  for (const h of ['', 'localhost', '127.0.0.1', 'javascript:alert(1)', 'a b.com', '*.x.com', 'x.com:8080', '-a.com', 'x..com']) {
    assert.equal(normalizeHost(h), '', h);
  }
});

test('parseHosts is strict and names the bad line', () => {
  assert.deepEqual(parseHosts({ hosts: ['a.com', 'A.com', 'b.org'] }), { ok: true, hosts: ['a.com', 'b.org'] });
  assert.deepEqual(parseHosts({ hosts: ['a.com', 'nope'] }), { ok: false, error: 'bad_host', index: 1 });
  assert.equal(parseHosts({}).ok, false);
  assert.equal(parseHosts({ hosts: Array.from({ length: MAX_HOSTS + 1 }, (_, i) => `h${i}.com`) }).error, 'too_many');
});

test('readHosts tolerates whatever is stored and defaults to empty', () => {
  assert.deepEqual(readHosts(null), []);
  assert.deepEqual(readHosts({ hosts: ['ok.com', 'bad', 'ok.com'] }), ['ok.com']);
});
