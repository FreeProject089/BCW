// agent-bcw-nav: the topbar's single projects menu (lib/nav-projects.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findProjectsGroup, otherProjectsFor, mobileProjectsLayout } from '../src/lib/nav-projects.js';

describe('findProjectsGroup', () => {
  test('the built-in group, by key', () => {
    assert.equal(findProjectsGroup([{ type: 'link', to: '/blog' }, { type: 'group', k: 'nav.projects', children: [] }]), 1);
    assert.equal(findProjectsGroup([{ type: 'group', k: 'nav.apps', children: [] }]), 0);
  });
  test('an admin group, by what it links to', () => {
    const items = [
      { type: 'group', label: 'Help', children: [{ to: '/docs' }] },
      { type: 'group', label: 'Projets', children: [{ to: '/p/bmm' }] },
    ];
    assert.equal(findProjectsGroup(items), 1);
    assert.equal(findProjectsGroup([{ type: 'group', label: 'X', children: [{ to: '/project/foo' }] }]), 0);
  });
  test('none: -1 (the separate button stays)', () => {
    assert.equal(findProjectsGroup([{ type: 'link', to: '/p/bmm' }]), -1);
    assert.equal(findProjectsGroup(null), -1);
  });
});

describe('otherProjectsFor', () => {
  const all = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  test('pinned first, else the first few, capped', () => {
    assert.deepEqual(otherProjectsFor({ pinned: [{ slug: 'b' }], all, max: 6 }).map((p) => p.slug), ['b']);
    assert.deepEqual(otherProjectsFor({ pinned: [], all, max: 2 }).map((p) => p.slug), ['a', 'b']);
  });
  test('never one the group already links to', () => {
    const out = otherProjectsFor({ groupChildren: [{ to: '/project/a' }], all, max: 6 });
    assert.deepEqual(out.map((p) => p.slug), ['b', 'c']);
  });
});

describe('mobileProjectsLayout', () => {
  test('fits one row: every project a tile, the row as wide as the count', () => {
    assert.deepEqual(mobileProjectsLayout(3, 4), { mode: 'row', tiles: 3, rest: 0, columns: 3 });
    assert.deepEqual(mobileProjectsLayout(4, 4), { mode: 'row', tiles: 4, rest: 0, columns: 4 });
  });
  test('too many: the first few and a "more" tile', () => {
    assert.deepEqual(mobileProjectsLayout(7, 4), { mode: 'more', tiles: 3, rest: 4, columns: 4 });
    assert.deepEqual(mobileProjectsLayout(5, 3), { mode: 'more', tiles: 2, rest: 3, columns: 3 });
  });
});
