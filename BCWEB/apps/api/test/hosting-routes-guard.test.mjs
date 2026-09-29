// hosting2 (agent-hosting): the doors of the term and loyalty routes, as the capability matrix
// reads them.
//
// capability-route-matrix.test.mjs sends real requests through every guard, but only with a
// database; this is the part that needs none. It pins, from the route source, that the two
// admin settings routes are behind manage_hosting (the capability that already owns plans and
// pools — the price list is a hosting decision) and that the member's status route needs a
// session and nothing more. The matrix itself then includes all of them automatically: it
// derives its route list from the same parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoutes } from '../src/lib/rbac-map.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', 'src', 'routes', 'hosting.mjs'), 'utf8');
const routes = parseRoutes('hosting.mjs', src);
const door = (verb, p) => routes.find((r) => r.verb === verb && r.path === p)?.guard || null;
const CAP = { kind: 'cap', capability: 'manage_hosting', alsoRoles: [] };

test('the prepaid-duration bounds: read and written by manage_hosting only', () => {
  assert.deepEqual(door('GET', '/admin/hosting/term'), CAP);
  assert.deepEqual(door('PUT', '/admin/hosting/term'), CAP);
});

test('the loyalty policy: read and written by manage_hosting only', () => {
  assert.deepEqual(door('GET', '/admin/hosting/loyalty'), CAP);
  assert.deepEqual(door('PUT', '/admin/hosting/loyalty'), CAP);
});

test('a member reads their own loyalty status with a session', () => {
  assert.deepEqual(door('GET', '/me/hosting/loyalty'), { kind: 'signed-in' });
});

test('the public price list stays public', () => {
  const plans = routes.find((r) => r.verb === 'GET' && r.path === '/hosting/plans');
  assert.ok(plans, 'GET /hosting/plans is parsed');
  assert.deepEqual(plans.guard, { kind: 'none' });
});
