// The three rules a stored page tree has to obey, and why each one is checked.
//
// None of them are shapes zod can express: they are facts about a tree taken as a whole. The
// route checks them before writing, and each has a failure that is silent rather than loud —
// which is exactly the kind that ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unsafeUrlIn, BLOCKS, BLOCK_TYPES, VARIABLES, BUILDABLE } from '../src/routes/pagebuilder.mjs';

test('a javascript: href anywhere in the tree is refused', () => {
  // The front page of the site, with a button on it. `javascript:` in an href is a script the
  // visitor runs by clicking, and it arrives here through an admin form — a smaller threat
  // than an open one, and still not a reason to store a scheme nothing needs.
  const tree = [
    { id: 'a', type: 'section', props: {}, children: [
      { id: 'b', type: 'row', props: {}, children: [
        { id: 'c', type: 'button', props: { label: 'Click', href: 'javascript:alert(1)' } },
      ] },
    ] },
  ];
  assert.equal(unsafeUrlIn(tree), 'button.href');
});

test('a data: src is refused too, and at any depth', () => {
  // A `data:` document has its own origin. Same rule as the showcase, on purpose: two URL
  // guards on one site diverge, and the one that is wrong is whichever nobody tested.
  const tree = [{ id: 'a', type: 'section', props: {}, children: [
    { id: 'b', type: 'image', props: { src: 'data:text/html,<script>x</script>' } },
  ] }];
  assert.equal(unsafeUrlIn(tree), 'image.src');
});

test('ordinary links pass — relative, https, and empty', () => {
  const tree = [
    { id: 'a', type: 'button', props: { href: '/catalog' } },
    { id: 'b', type: 'button', props: { href: 'https://example.com' } },
    // Empty is the default a fresh block carries. Refusing it would make every newly dropped
    // button unsaveable until somebody filled it in.
    { id: 'c', type: 'button', props: { href: '' } },
    { id: 'd', type: 'image', props: { src: '/api/assets/hero.png' } },
  ];
  assert.equal(unsafeUrlIn(tree), null);
});

test('a protocol-relative //host is refused', () => {
  // `//evil.example` inherits the page's scheme and is a different origin. It looks like a
  // path, which is the whole problem with it.
  assert.equal(unsafeUrlIn([{ id: 'a', type: 'image', props: { src: '//evil.example/x.png' } }]), 'image.src');
});

test('the palette and the variable list are non-empty and well formed', () => {
  // The editor is built FROM these: an empty palette is an editor with no blocks, and a
  // `kind` the renderer does not switch on is a block that draws a blank rectangle on the
  // live site.
  assert.ok(BLOCK_TYPES.length >= 10, `${BLOCK_TYPES.length}`);
  for (const [type, def] of Object.entries(BLOCKS)) {
    assert.ok(['layout', 'content', 'dynamic'].includes(def.kind), `${type}: ${def.kind}`);
    assert.equal(typeof def.props, 'object', type);
  }
  assert.ok(VARIABLES.includes('members'));
  assert.deepEqual(BUILDABLE, ['home', 'dev']);
});

test('the orb is not a block', () => {
  // It is a site-wide backdrop mounted once in App.jsx. A block that "contained" it would be
  // a second orb behind the first, and the page-level setting is the honest control.
  assert.equal(BLOCKS.orb, undefined);
});
