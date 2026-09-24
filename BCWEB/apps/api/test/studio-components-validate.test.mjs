// Pentest round 2, card R6 (Sept 24 2026): a saved studio component is imported data.
//
// A component reaches the store from a selection, from a paste of `{ bcwBlocks }` copied off
// anywhere (a Discord message, a web page), and soon from a `.bcwstudio.json` file and a shared
// project library (PLAN-STUDIO-2026 phase 7, D9). Its blocks are placed on public pages. The
// store used to check the SHAPE (`blockSchema.passthrough()`), so a component could keep a
// `javascript:` button, an `api` action, a CSS value that fetches, or any field at all, and hand
// it on to the next reader of the library. It now goes through the one rule every studio page
// goes through (`validateDoc` in packages/studio), and a problem already stored is tolerated so
// an old library can still be edited (the same rule as lib/studio-doc.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComponentList } from '../src/lib/studio-components.mjs';

const block = (over = {}) => ({ kind: 'box', x: 0, y: 0, w: 100, h: 50, z: 0, props: { bg: '#eee' }, ...over });
const comp = (over = {}) => ({ id: 'cmpabc', name: 'Card', w: 100, h: 50, blocks: [block()], createdAt: '2026-09-24T00:00:00.000Z', ...over });
const btn = (action) => block({ kind: 'button', props: { label: 'Go', action } });

const HOSTILE = [
  ['a javascript: button', btn({ type: 'link', href: 'javascript:alert(1)' })],
  ['a java\\tscript: button', btn({ type: 'link', href: 'java\tscript:alert(1)' })],
  ['a download to /\\host', btn({ type: 'download', href: '/\\evil.example/x.exe' })],
  ['the removed api action', btn({ type: 'api', href: '/api/admin/users' })],
  ['an unknown action type', btn({ type: 'eval', href: 'alert(1)' })],
  ['a scroll to a selector', btn({ type: 'scroll', target: 'body > *' })],
  ['a menu item to data:', block({ kind: 'button', props: { variant: 'dropdown-down', items: [{ label: 'x', href: 'data:text/html,<script>alert(1)</script>' }] } })],
  ['a block link to javascript:', block({ link: 'javascript:alert(1)' })],
  ['an unknown block field', block({ onclick: 'alert(1)' })],
  ['an unknown prop', block({ props: { srcdoc: '<script>alert(1)</script>' } })],
  ['a CSS value that fetches', block({ props: { bg: 'url(https://evil.example/t.png)' } })],
  ['a fixed overlay', block({ props: { style: 'position:fixed;inset:0' } })],
  ['an id that breaks a selector', block({ id: 'x"]{}*{display:none}' })],
];

for (const [name, b] of HOSTILE) {
  test(`refused: ${name}`, () => {
    const r = parseComponentList({ components: [comp({ blocks: [b] })] });
    assert.equal(r.ok, false, `${name} was stored`);
    assert.equal(r.error, 'invalid_studio_doc');
    assert.ok(r.problems?.length, 'the problems are named for the author');
  });
}

test('ordinary components are still accepted (control)', () => {
  const ok = [
    block(),
    block({ kind: 'text', props: { md: '**Hello** [docs](/docs)' } }),
    btn({ type: 'link', href: 'https://example.com/a' }),
    btn({ type: 'link', href: '/projects/bmm' }),
    btn({ type: 'copy', text: 'npm i x' }),
    btn({ type: 'scroll', target: '#top' }),
    block({ kind: 'shape', props: { shape: 'ellipse', fill: '#f00' }, link: '/about' }),
  ];
  const r = parseComponentList({ components: [comp({ blocks: ok })] });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('a problem ALREADY stored is tolerated, so an old library stays editable', () => {
  const legacy = comp({ blocks: [btn({ type: 'api', href: '/api/x' })] });
  const stored = { components: [legacy] };
  // The same component, renamed, and a new clean one: accepted.
  const r = parseComponentList({ components: [{ ...legacy, name: 'Renamed' }, comp({ id: 'cmpnew' })] }, stored);
  assert.equal(r.ok, true, JSON.stringify(r));
  // A NEW problem next to the tolerated one is still refused.
  const bad = parseComponentList({ components: [legacy, comp({ id: 'cmpnew', blocks: [btn({ type: 'link', href: 'javascript:alert(1)' })] })] }, stored);
  assert.equal(bad.ok, false);
  // The tolerated one moved to ANOTHER component id is new there.
  const moved = parseComponentList({ components: [{ ...legacy, id: 'cmpother' }] }, stored);
  assert.equal(moved.ok, false);
});
