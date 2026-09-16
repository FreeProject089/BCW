// What the studio's component store accepts. No database: the validation is the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComponentList, readStored, storageKey, COMPONENT_LIMITS } from '../src/lib/studio-components.mjs';

const block = (over = {}) => ({ kind: 'box', x: 0, y: 0, w: 100, h: 50, z: 0, props: { bg: '#eee' }, ...over });
const comp = (over = {}) => ({ id: 'cmpabc', name: 'Card', w: 100, h: 50, blocks: [block()], createdAt: '2026-09-16T00:00:00.000Z', ...over });

test('a well-formed list is accepted as sent', () => {
  const r = parseComponentList({ components: [comp()] });
  assert.equal(r.ok, true);
  assert.equal(r.components.length, 1);
  assert.equal(r.components[0].blocks[0].props.bg, '#eee', 'block props pass through — the renderer decides what they mean');
});

test('the shape is checked: no blocks, a bad id, a missing name', () => {
  assert.equal(parseComponentList({ components: [comp({ blocks: [] })] }).error, 'invalid_input');
  assert.equal(parseComponentList({ components: [comp({ id: '../x' })] }).error, 'invalid_input');
  assert.equal(parseComponentList({ components: [comp({ name: '' })] }).error, 'invalid_input');
  assert.equal(parseComponentList({ components: [comp({ blocks: [block({ x: 'ten' })] })] }).error, 'invalid_input');
  assert.equal(parseComponentList({}).error, 'invalid_input');
  assert.equal(parseComponentList(null).error, 'invalid_input');
});

test('the limits hold: count, blocks per component, bytes', () => {
  const many = Array.from({ length: COMPONENT_LIMITS.count + 1 }, (_, i) => comp({ id: `c${i}` }));
  assert.equal(parseComponentList({ components: many }).error, 'invalid_input');
  const fat = comp({ blocks: Array.from({ length: COMPONENT_LIMITS.blocks + 1 }, () => block()) });
  assert.equal(parseComponentList({ components: [fat] }).error, 'invalid_input');
  const huge = comp({ blocks: [block({ props: { svg: 'x'.repeat(COMPONENT_LIMITS.bytes) } })] });
  assert.equal(parseComponentList({ components: [huge] }).error, 'too_large');
});

test('duplicate ids collapse to the first, and names are trimmed', () => {
  const r = parseComponentList({ components: [comp({ name: '  Hero ' }), comp({ name: 'Other' })] });
  assert.equal(r.ok, true);
  assert.equal(r.components.length, 1);
  assert.equal(r.components[0].name, 'Hero');
});

test('reading the store never throws on an odd value', () => {
  assert.deepEqual(readStored(null), []);
  assert.deepEqual(readStored({ components: 'nope' }), []);
  assert.deepEqual(readStored({ components: [null, { id: 'x', blocks: [] }, { id: 'ok', blocks: [block()] }] }).map((c) => c.id), ['ok']);
});

test('the storage key is per user', () => {
  assert.notEqual(storageKey('u1'), storageKey('u2'));
  assert.ok(storageKey('u1').startsWith('studio.components:'));
});
