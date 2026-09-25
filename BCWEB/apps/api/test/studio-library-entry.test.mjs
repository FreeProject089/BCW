// Studio phase 7c: ONE rule for a library entry.
//
// An imported component or preset (.bcwstudio.json, packages/studio/src/io.js) is checked in
// the browser by `libraryEntryProblems` before it is offered to the library route; the route
// (lib/studio-library.mjs parseLibrary) must run the SAME function, not a copy of its rules,
// or the two drift and the browser promises what the server refuses (the lesson of the staff
// poll tally that went public). This proves both halves: the route answers exactly what the
// package function answers, entry by entry, and the route's source holds no second copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLibrary } from '../src/lib/studio-library.mjs';
import { libraryEntryProblems } from '../../../packages/studio/src/index.js';

const F = { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } };
const txt = (id, extra = {}) => ({ id, kind: 'text', x: 0, y: 0, w: 100, h: 40, props: { md: 'x' }, ...extra });
const inst = (id, cid) => ({ id, kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: cid } });

const CORPUS = [
  ['a background preset with blocks', { id: 'b1', name: 'B', sort: 'background', doc: { v: 2, frames: F, blocks: [txt('a')] } }],
  ['a section with no block', { id: 's1', name: 'S', sort: 'section', doc: { v: 2, frames: F, blocks: [] } }],
  ['a component of 41 blocks', { id: 'c1', name: 'C', sort: 'component', doc: { v: 2, frames: F, blocks: Array.from({ length: 41 }, (_, i) => txt(`t${i}`, { y: i * 50 })) }, exposed: [] }],
  ['a component that holds itself', { id: 'loop', name: 'L', sort: 'component', doc: { v: 2, frames: F, blocks: [inst('n', 'loop')], components: { loop: { name: 'L', scope: 'site', doc: { v: 2, frames: F, blocks: [txt('t')] }, exposed: [] } } }, exposed: [] }],
  ['exposed on a missing block', { id: 'c2', name: 'C', sort: 'component', doc: { v: 2, frames: F, blocks: [txt('a')] }, exposed: [{ key: 'k', block: 'zz', field: 'props.md' }] }],
  ['exposed on a preset that is no component', { id: 'p1', name: 'P', sort: 'page', doc: { v: 2, frames: F, blocks: [] }, exposed: [] }],
  ['a javascript: step', { id: 'p2', name: 'P', sort: 'page', doc: { v: 2, frames: F, blocks: [{ ...txt('a'), action: [{ type: 'navigate', to: 'javascript:alert(1)' }] }] } }],
  ['two blocks under one id', { id: 'p3', name: 'P', sort: 'page', doc: { v: 2, frames: F, blocks: [txt('a'), txt('a', { y: 60 })] } }],
  ['a reserved component id', { id: 'p4', name: 'P', sort: 'page', doc: { v: 2, frames: F, blocks: [inst('i', 'constructor')], components: { constructor: { name: 'X', scope: 'site', doc: { v: 2, frames: F, blocks: [txt('t')] }, exposed: [] } } } }],
  ['an unknown entry field, a bad name and sort', { id: 'p5', name: '', sort: 'script', doc: { v: 2, frames: F, blocks: [] }, extra: 1 }],
];

test('the library route refuses exactly what the package\'s entry rule refuses', () => {
  for (const [what, entry] of CORPUS) {
    const expected = libraryEntryProblems(entry, 'entries[0]');
    assert.ok(expected.length, `${what}: the package accepts it, the corpus proves nothing`);
    const r = parseLibrary({ entries: [entry], base: '' });
    assert.equal(r.ok, false, `${what}: the library route accepted it`);
    assert.deepEqual(r.body.problems, expected.slice(0, 20), `${what}: the route and the package disagree`);
  }
  // And what the rule accepts, the route accepts.
  const ok = { id: 'fine', name: 'Fine', sort: 'section', doc: { v: 2, frames: F, blocks: [txt('a')] } };
  assert.deepEqual(libraryEntryProblems(ok, 'entries[0]'), []);
  assert.equal(parseLibrary({ entries: [ok], base: '' }).ok, true);
  // The list's own rule stays the route's: two entries under one id.
  const dup = parseLibrary({ entries: [ok, ok], base: '' });
  assert.ok(dup.body.problems.some((p) => p.path === 'entries[1].id' && p.reason === 'duplicate'));
});

test('the route holds no second copy of the entry rule', () => {
  const src = readFileSync(new URL('../src/lib/studio-library.mjs', import.meta.url), 'utf8');
  assert.match(src, /libraryEntryProblems\(e, at, opts\)/, 'parseLibrary no longer calls the package\'s entry rule');
  for (const copy of [/'doc\.blocks', 'required'/, /'doc\.blocks', 'not_allowed'/, /studioDocProblems\(/, /exposedProblems\(/]) {
    assert.doesNotMatch(src, copy, `studio-library.mjs restates a rule of the package's entry check (${copy})`);
  }
});
