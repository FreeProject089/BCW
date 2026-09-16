// The dashboard search's ranking: accents, synonyms in both languages, prefixes, typos —
// and the rule that every word must land somewhere.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { norm, score, rankLeaves, within, expand } from '../src/lib/admin-search.js';

const P = { id: 'moderation', label: 'Moderation' };
const leaves = [
  { id: 'users', label: 'All accounts', parent: { id: 'users', label: 'Accounts' } },
  { id: 'sanctions', label: 'Sanctions', parent: P },
  { id: 'lookalikes', label: 'Lookalike pictures', parent: P },
  { id: 'hostingsettings', label: 'Hosting settings', parent: { id: 'repos', label: 'Repos & pools' } },
  { id: 'kofi', label: 'Ko-fi', parent: { id: 'kofi', label: 'Ko-fi & funding' } },
  { id: 'server', label: 'Performance', parent: { id: 'server', label: 'Server' } },
];
const kw = (id) => ({ hostingsettings: 'grace 72 hours before deletion free tier storage pools', kofi: 'donations tips charity' }[id] || '');

describe('admin search ranking', () => {
  test('accents and case fold', () => {
    assert.equal(norm('Réglages d’hébergement'), 'reglages d hebergement');
    assert.ok(expand('réglages').includes('settings'));
  });
  test('synonyms in the other language find the screen', () => {
    assert.equal(rankLeaves(leaves, 'comptes', kw)[0].id, 'users');
    assert.equal(rankLeaves(leaves, 'bannir', kw)[0].id, 'sanctions');
    assert.equal(rankLeaves(leaves, 'images ressemblantes', kw)[0].id, 'lookalikes');
    assert.equal(rankLeaves(leaves, 'dons', kw)[0].id, 'kofi');
  });
  test('prefixes, typos, the parent label and the guide text', () => {
    assert.equal(rankLeaves(leaves, 'sanct', kw)[0].id, 'sanctions');
    assert.equal(rankLeaves(leaves, 'sanctons', kw)[0].id, 'sanctions');
    assert.equal(rankLeaves(leaves, 'server', kw)[0].id, 'server');
    assert.equal(rankLeaves(leaves, '72 hours', kw)[0].id, 'hostingsettings');
    assert.ok(within('sanctons', 'sanctions', 1));
    assert.ok(!within('storage', 'goals', 2));
  });
  test('every word must match: an unrelated word empties the result', () => {
    assert.deepEqual(rankLeaves(leaves, 'sanctions zebra', kw), []);
    assert.ok(score('hosting', 'Hosting settings') > score('hosting', 'Server', 'hosting mentioned in passing'));
  });
});
