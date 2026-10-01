// agent-bcw-nav: the pure half of Laya in the search bars (lib/search-ai.mjs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearch, normalizeQuery, cleanCandidates, searchCacheKey, intentQuestion, rerankQuestion,
  blendOrder, pickIntent, searchLimitKeys, cacheGet, cachePut, _clearSearchCacheForTests, SEARCH_DEFAULTS, INTENT_IDS,
} from '../src/lib/search-ai.mjs';
import { normalizeFeatures, FEATURES } from '../src/lib/ai-features.mjs';
import { normalizeQuestion } from '../src/lib/moderation/ai.mjs';

describe('settings', () => {
  test('defaults, and every value bounded', () => {
    assert.deepEqual(normalizeSearch(null), { ...SEARCH_DEFAULTS });
    const s = normalizeSearch({ anon: false, perUserPerMin: 0, perAnonPerMin: 9999, perIpPerMin: 'x', cacheTtlSec: -5 });
    assert.equal(s.anon, false);
    assert.equal(s.perUserPerMin, 1);
    assert.equal(s.perAnonPerMin, 120);
    assert.equal(s.perIpPerMin, SEARCH_DEFAULTS.perIpPerMin);
    assert.equal(s.cacheTtlSec, 0);
  });
  test('the feature exists, is off by default, open to everyone, and carries its limits', () => {
    assert.equal(FEATURES.search.kind, 'classifier');
    assert.equal(FEATURES.search.staffOnly, false);
    const cfg = normalizeFeatures(null);
    assert.equal(cfg.features.search.enabled, false);
    assert.equal(cfg.features.search.audience, 'all');
    assert.deepEqual(cfg.search, { ...SEARCH_DEFAULTS });
    assert.equal(normalizeFeatures({ search: { perIpPerMin: 7 } }).search.perIpPerMin, 7);
  });
});

describe('query and candidates', () => {
  test('the query is folded, one-spaced, bounded, without control characters', () => {
    assert.equal(normalizeQuery('  Dark\u0007   MODE \n'), 'dark mode');
    assert.equal(normalizeQuery('x'.repeat(500)).length, 200);
    assert.equal(normalizeQuery(null), '');
  });
  test('candidates: at most 8, no empty ids or titles, no duplicates', () => {
    const list = [{ id: 'a', title: 'A' }, { id: 'a', title: 'again' }, { id: '', title: 'x' }, { id: 'b', title: '  ' },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, title: `C ${i}` }))];
    const out = cleanCandidates(list);
    assert.equal(out.length, 8);
    assert.deepEqual(out.slice(0, 2), [{ id: 'a', title: 'A' }, { id: 'c0', title: 'C 0' }]);
  });
  test('the cache key changes with the scope, the query and the candidates, and hides the query', () => {
    const c = [{ id: 'a', title: 'A' }];
    const k = searchCacheKey('catalog', 'Dark Mode', c);
    assert.equal(k, searchCacheKey('catalog', ' dark   mode', c));
    assert.notEqual(k, searchCacheKey('blog', 'dark mode', c));
    assert.notEqual(k, searchCacheKey('catalog', 'dark mode', [{ id: 'b', title: 'A' }]));
    assert.ok(!k.includes('dark'));
  });
});

describe('questions', () => {
  test('both are valid choice questions for the layer', () => {
    const i = normalizeQuestion(intentQuestion());
    assert.equal(i.type, 'choice');
    assert.deepEqual(Object.keys(i.criteria).sort(), [...INTENT_IDS].sort());
    const r = normalizeQuestion(rerankQuestion([{ id: 'x1', title: 'One' }, { id: 'x2', title: 'Two' }]));
    assert.deepEqual(Object.keys(r.criteria), ['x1', 'x2']);
  });
});

describe('blendOrder', () => {
  const c = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  test('no probabilities: the page order stands', () => {
    assert.deepEqual(blendOrder(c, {}), ['a', 'b', 'c']);
  });
  test('a clearly better answer moves up', () => {
    assert.deepEqual(blendOrder(c, { c: 0.95, a: 0.02, b: 0.03 }), ['c', 'a', 'b']);
  });
  test('a weak preference does not overturn a strong word match', () => {
    assert.deepEqual(blendOrder(c, { c: 0.4, a: 0.3, b: 0.3 }), ['a', 'b', 'c']);
  });
  test('weight 0 is the page, weight 1 is the classifier', () => {
    assert.deepEqual(blendOrder(c, { c: 1 }, 0), ['a', 'b', 'c']);
    assert.deepEqual(blendOrder(c, { b: 0.9, c: 0.1 }, 1), ['b', 'c', 'a']);
  });
  test('empty in, empty out', () => { assert.deepEqual(blendOrder([], {}), []); });
});

describe('pickIntent', () => {
  test('a clear answer is kept, a vague or unknown one is not', () => {
    assert.deepEqual(pickIntent({ choice: 'catalog', p: 0.81 }), { id: 'catalog', p: 0.81 });
    assert.deepEqual(pickIntent({ choice: 'docs', probs: { docs: 0.7 } }), { id: 'docs', p: 0.7 });
    assert.equal(pickIntent({ choice: 'catalog', p: 0.2 }), null);
    assert.equal(pickIntent({ choice: 'weather', p: 0.99 }), null);
    assert.equal(pickIntent(null), null);
  });
});

describe('limits', () => {
  const cfg = normalizeSearch({ perUserPerMin: 5, perAnonPerMin: 2, perIpPerMin: 9, anonPerIpPerDay: 50 });
  test('signed in: the account and the address', () => {
    const k = searchLimitKeys(cfg, { uid: 'u1', ip: '1.2.3.4', now: 0 });
    assert.deepEqual(k.map((x) => [x.scope, x.max]), [['ip', 9], ['user', 5]]);
  });
  test('signed out: the address, the visitor per minute and per day', () => {
    const k = searchLimitKeys(cfg, { ip: '1.2.3.4', now: 0 });
    assert.deepEqual(k.map((x) => [x.scope, x.max]), [['ip', 9], ['anon', 2], ['anon_day', 50]]);
    assert.ok(k.every((x) => !x.k.includes('undefined')));
  });
});

describe('cache', () => {
  test('ttl 0 never stores; an entry expires', async () => {
    _clearSearchCacheForTests();
    cachePut('k', { ai: true }, 0);
    assert.equal(cacheGet('k', 0), null);
    cachePut('k', { ai: true }, 60);
    assert.deepEqual(cacheGet('k', 60), { ai: true });
  });
});
