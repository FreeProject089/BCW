// canViewPage for a whitelisted page, called the way the routes call it: with the DB ROW,
// whose column is `visibilityWhitelist`. The function read `whitelist`, a name only the
// catalogue routes passed, so every whitelisted project and showcase page refused the very
// people on its list (found Sept 23 2026 while building project catalogues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canViewPage } from '../src/lib/lib.mjs';

const fakeDb = (discordId = null, creatorIds = []) => ({
  discordLink: { findUnique: async () => (discordId ? { discordId } : null) },
  creatorLink: { findMany: async () => creatorIds.map((creatorId) => ({ creatorId })) },
});
const row = (list) => ({ visibility: 'whitelist', visibilityWhitelist: list });
const as = (uid) => ({ user: { uid } });

test('a DB row: an account on the list may view the page', async () => {
  assert.equal(await canViewPage(fakeDb(), row([{ type: 'bcweb', id: 'u1' }]), as('u1')), true);
});
test('a DB row: a linked Discord id or creator id on the list may view it', async () => {
  assert.equal(await canViewPage(fakeDb('d9'), row([{ type: 'discord', id: 'd9' }]), as('u2')), true);
  assert.equal(await canViewPage(fakeDb(null, ['c7']), row([{ type: 'creator', id: 'c7' }]), as('u3')), true);
});
test('a DB row: someone not on the list, or signed out, may not', async () => {
  assert.equal(await canViewPage(fakeDb(), row([{ type: 'bcweb', id: 'u1' }]), as('u4')), false);
  assert.equal(await canViewPage(fakeDb(), row([{ type: 'bcweb', id: 'u1' }]), null), false);
});
test('the explicit { whitelist } shape the catalogue routes pass still works', async () => {
  assert.equal(await canViewPage(fakeDb(), { visibility: 'whitelist', whitelist: [{ type: 'bcweb', id: 'u1' }] }, as('u1')), true);
});
test('public, unlisted, private and unknown visibilities are unchanged', async () => {
  assert.equal(await canViewPage(fakeDb(), { visibility: 'public' }, null), true);
  assert.equal(await canViewPage(fakeDb(), { visibility: 'unlisted' }, null), true);
  assert.equal(await canViewPage(fakeDb(), { visibility: 'private', visibilityWhitelist: [{ type: 'bcweb', id: 'u1' }] }, as('u1')), false);
  assert.equal(await canViewPage(fakeDb(), { visibility: 'weird' }, as('u1')), false);
});
