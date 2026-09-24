// B.MD live blocks fetch only from the site's origin plus an admin-set host list
// (policy.allowApiHosts, packages/bmd/src/url.js). SECURITY_SUMMARY §9, "apiUrl() has no host
// allowlist".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl } from '../../../packages/bmd/src/url.js';

const api = (u, policy) => safeUrl(u, { kind: 'api', policy });
const SITE = 'https://bettercommunity.ch';

test('an empty list: same origin only', () => {
  const policy = { allowApiHosts: [], origin: SITE };
  assert.equal(api('/api/stats', policy).ok, true, 'a same-origin path');
  assert.equal(api(`${SITE}/api/stats`, policy).ok, true, 'the site written absolute');
  assert.equal(api('https://evil.example/x.json', policy).ok, false);
  assert.equal(api('https://bettercommunity.ch.evil.example/x', policy).ok, false, 'a look-alike host');
  assert.equal(api('https://telemetry.bettercommunity.ch/x', policy).ok, false, 'another origin, even a subdomain');
});

test('listed hosts and their subdomains pass, nothing else', () => {
  const policy = { allowApiHosts: ['stats.example.org'], origin: SITE };
  assert.equal(api('https://stats.example.org/n.json', policy).ok, true);
  assert.equal(api('https://eu.stats.example.org/n.json', policy).ok, true);
  assert.equal(api('https://example.org/n.json', policy).ok, false, 'the parent is not listed');
});

test('null keeps the 3.0.0 behaviour (allowHosts decides, empty = any https host)', () => {
  assert.equal(api('https://anything.example/x', {}).ok, true);
  assert.equal(api('https://anything.example/x', { allowHosts: ['a.com'] }).ok, false);
});

test('links are untouched by allowApiHosts', () => {
  assert.equal(safeUrl('https://anything.example/x', { kind: 'link', policy: { allowApiHosts: [] } }).ok, true);
});
