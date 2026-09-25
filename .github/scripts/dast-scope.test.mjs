// Tests for .github/scripts/dast-scope.mjs: the check that runs BEFORE any DAST request.
//
//   node --test .github/scripts/dast-scope.test.mjs
//
// What must never happen: a ZAP or Nuclei run pointed at production. Production is
// bettercommunity.ch and everything under it; the scope check must refuse it in every
// spelling a person or a variable could produce (case, trailing dot, a subdomain, a userinfo
// prefix), refuse a staging host nobody put on the allowlist, and refuse a staging name that
// RESOLVES to production's address even though it is spelled differently.
//
// DNS is injected: these tests never resolve anything, and never send a request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkScope, HARD_DENY, HARD_DENY_ADDRS } from './dast-scope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// A fake resolver: production at 203.0.113.10, a separate staging box at 198.51.100.7, and a
// staging name that is really a CNAME to the production machine.
const DNS = {
  'bettercommunity.ch': ['203.0.113.10'],
  'www.bettercommunity.ch': ['203.0.113.10'],
  'staging.example.org': ['198.51.100.7'],
  'x.staging.example.org': ['198.51.100.8'],
  'sneaky-staging.example.org': ['203.0.113.10'],
  'vps-alias.example.org': ['45.145.164.20'],
};
const resolver = async (host) => {
  if (DNS[host]) return DNS[host];
  const e = new Error(`ENOTFOUND ${host}`);
  e.code = 'ENOTFOUND';
  throw e;
};

const ok = async (target, mode, env = {}) => checkScope({ target, mode, env, resolver });

test('production is on the hard deny list, by name and by address', () => {
  assert.ok(HARD_DENY.includes('bettercommunity.ch'));
  assert.ok(HARD_DENY_ADDRS.includes('45.145.164.20'));
});

test('the production VPS is refused as a literal address and as what a name resolves to', async () => {
  const lit = await ok('http://45.145.164.20:8080/', 'staging', { DAST_ALLOWED_HOSTS: '45.145.164.20' });
  assert.equal(lit.ok, false);
  assert.match(lit.reason, /production server/);
  assert.equal((await ok('http://45.145.164.20', 'local')).ok, false);
  const alias = await ok('https://vps-alias.example.org', 'staging', { DAST_ALLOWED_HOSTS: 'vps-alias.example.org' });
  assert.equal(alias.ok, false);
  assert.match(alias.reason, /production server/);
});

test('local mode accepts only this machine', async () => {
  for (const t of ['http://localhost:8080', 'http://127.0.0.1:8080/', 'http://[::1]:8080']) {
    assert.equal((await ok(t, 'local')).ok, true, t);
  }
  for (const t of ['http://staging.example.org', 'http://10.0.0.5:8080', 'http://localhost.example.org']) {
    assert.equal((await ok(t, 'local')).ok, false, t);
  }
});

test('production is refused in every spelling, in both modes, even when allowlisted', async () => {
  const env = { DAST_ALLOWED_HOSTS: 'bettercommunity.ch,www.bettercommunity.ch,api.bettercommunity.ch' };
  for (const t of [
    'https://bettercommunity.ch',
    'https://BetterCommunity.CH/',
    'https://bettercommunity.ch./',
    'https://www.bettercommunity.ch',
    'https://api.bettercommunity.ch:8443/x',
    'http://bettercommunity.ch:80',
  ]) {
    for (const mode of ['local', 'staging']) {
      const r = await ok(t, mode, env);
      assert.equal(r.ok, false, `${mode} ${t}`);
    }
    assert.match((await ok(t, 'staging', env)).reason, /production|deny/i, t);
  }
});

test('a look-alike that is not under the production domain is not confused with it', async () => {
  // Not production — but not allowlisted either, so still refused, for the right reason.
  const r = await ok('https://bettercommunity.ch.example.org', 'staging', { DAST_ALLOWED_HOSTS: 'staging.example.org' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /allow/i);
});

test('staging needs an allowlist, and the host must be on it exactly', async () => {
  assert.equal((await ok('https://staging.example.org', 'staging', {})).ok, false);
  assert.equal((await ok('https://staging.example.org', 'staging', { DAST_ALLOWED_HOSTS: '' })).ok, false);
  assert.equal((await ok('https://other.example.org', 'staging', { DAST_ALLOWED_HOSTS: 'staging.example.org' })).ok, false);
  // A subdomain of an allowlisted host is NOT allowlisted (it resolves, so only the list refuses it).
  const sub = await ok('https://x.staging.example.org', 'staging', { DAST_ALLOWED_HOSTS: 'staging.example.org' });
  assert.equal(sub.ok, false);
  assert.match(sub.reason, /not in DAST_ALLOWED_HOSTS/);
  const good = await ok('https://Staging.Example.org/', 'staging', { DAST_ALLOWED_HOSTS: ' staging.example.org , other.test ' });
  assert.equal(good.ok, true, good.reason);
  assert.equal(good.host, 'staging.example.org');
});

test('DAST_DENY_HOSTS wins over DAST_ALLOWED_HOSTS, subdomains included', async () => {
  const env = { DAST_ALLOWED_HOSTS: 'staging.example.org', DAST_DENY_HOSTS: 'example.org' };
  const r = await ok('https://staging.example.org', 'staging', env);
  assert.equal(r.ok, false);
  assert.match(r.reason, /DAST_DENY_HOSTS/);
});

test('a staging name that resolves to production is refused before any request', async () => {
  const r = await ok('https://sneaky-staging.example.org', 'staging', { DAST_ALLOWED_HOSTS: 'sneaky-staging.example.org' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /same address as/);
});

test('a staging name that does not resolve, or production that cannot be resolved, fails closed', async () => {
  const r = await ok('https://nowhere.example.org', 'staging', { DAST_ALLOWED_HOSTS: 'nowhere.example.org' });
  assert.equal(r.ok, false);
  const noProd = await checkScope({
    target: 'https://staging.example.org', mode: 'staging', env: { DAST_ALLOWED_HOSTS: 'staging.example.org' },
    resolver: async (h) => { if (h === 'staging.example.org') return ['198.51.100.7']; throw Object.assign(new Error('SERVFAIL'), { code: 'ESERVFAIL' }); },
  });
  assert.equal(noProd.ok, false);
  assert.match(noProd.reason, /could not resolve/);
});

test('URLs that are not plain http(s), or carry credentials, are refused', async () => {
  const env = { DAST_ALLOWED_HOSTS: 'staging.example.org' };
  for (const t of ['ftp://staging.example.org', 'file:///etc/passwd', 'https://user:pw@staging.example.org', 'not a url', '']) {
    assert.equal((await ok(t, 'staging', env)).ok, false, t);
  }
});

test('an unknown mode is refused', async () => {
  assert.equal((await ok('http://localhost:8080', 'prod')).ok, false);
});

test('CLI: exit 0 for the CI-local instance, 1 for production', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [join(HERE, 'dast-scope.mjs'), ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
  });
  const local = run(['--target', 'http://localhost:8080', '--mode', 'local']);
  assert.equal(local.status, 0, local.stdout + local.stderr);
  const prod = run(['--target', 'https://bettercommunity.ch', '--mode', 'staging'], { DAST_ALLOWED_HOSTS: 'bettercommunity.ch' });
  assert.equal(prod.status, 1, prod.stdout + prod.stderr);
  assert.match(prod.stdout + prod.stderr, /REFUSED/);
});
