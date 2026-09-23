// What an author may put in a `style=` inside a B.MD body (a blog post, a doc page, a
// comment). Tested from here because this is where the runner is; the rule itself lives in
// packages/bmd/src/style-safe.js, which has no imports for exactly that reason.
//
// Pentest 2026-09-23, card 6. Two things the filter did:
//   · every one of its rules matched LITERAL text, so a CSS escape walked past all of them —
//     `position:\66 ixed` is `position:fixed` to a browser, and the refusal that exists to
//     stop a member covering the page with a fixed overlay matched nothing.
//   · the property name was used as a key on an object literal, so `style="constructor:1"`
//     found Object's own constructor, called `.test` on it, and threw — inside a tree walk,
//     which took the whole document's render down with it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { safeStyle } from '../../../packages/bmd/src/style-safe.js';

const BS = String.fromCharCode(92);

describe('safeStyle', () => {
  test('ordinary CSS goes through exactly as it was typed', () => {
    assert.equal(safeStyle('color: red; background: url(https://cdn.example/x.png)'),
      'color: red; background: url(https://cdn.example/x.png)');
    assert.equal(safeStyle('position: relative'), 'position: relative');
    assert.equal(safeStyle(''), '');
    assert.equal(safeStyle(null), '');
  });

  test('a declaration that takes over the page is refused', () => {
    assert.equal(safeStyle('position:fixed;inset:0'), 'inset:0');
    assert.equal(safeStyle('position:sticky'), '');
    assert.equal(safeStyle('behavior:url(x.htc)'), '');
    assert.equal(safeStyle('width:expression(1)'), '');
    assert.equal(safeStyle('background:url(javascript:alert(1))'), '');
  });

  test('a CSS escape is syntax: it is decoded before anything is judged', () => {
    // in the value…
    assert.equal(safeStyle('position:' + BS + '66 ixed;inset:0'), 'inset:0');
    // …and in the property name, which is an ident too
    assert.equal(safeStyle(BS + '70 osition:fixed'), '');
    assert.equal(safeStyle('be' + BS + '68 avior:url(x.htc)'), '');
    assert.equal(safeStyle('width:expre' + BS + '73 sion(1)'), '');
    // a line continuation joins the two halves, the same way a browser does
    assert.equal(safeStyle('position:fi' + BS + '\nxed'), '');
    // an escape that means a character keeps meaning it, and is not rewritten on the way out
    assert.equal(safeStyle('content:"' + BS + '201C"'), 'content:"' + BS + '201C"');
  });

  test('a property name borrowed from Object.prototype does not throw', () => {
    for (const p of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      assert.doesNotThrow(() => safeStyle(`${p}:1`), p);
    }
    assert.equal(safeStyle('constructor:1;color:red'), 'constructor:1; color:red');
  });
});
