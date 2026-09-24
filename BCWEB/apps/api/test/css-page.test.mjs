// `@page` in member-written CSS (SECURITY_SUMMARY §9, "@page survives scopeCss").
//
// scopeCss confines a member's stylesheet by prefixing every selector with the block's scope.
// `@page` has no selector to prefix: kept as written, it set the margins and the page size of
// the WHOLE site whenever anybody printed it. It is refused now, and reported, like @import.
// The same sanitiser renders the studio pages and the charity page (packages/studio, re-exported
// by apps/web/src/lib/css-scope.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeCss } from '../../web/src/lib/css-scope.js';

const SCOPE = '[data-cv="c1"]';

test('@page is refused, in any spelling, and the rules around it survive', () => {
  for (const src of [
    '.a{color:red} @page { margin: 0; size: A3 landscape } .b{color:blue}',
    '.a{color:red} @PAGE :first { margin-top: 9cm } .b{color:blue}',
    '.a{color:red} @\\70 age { margin: 0 } .b{color:blue}',
  ]) {
    const { css, refused } = scopeCss(src, SCOPE);
    assert.ok(!/@page/i.test(css), `@page survived: ${css}`);
    assert.ok(refused.includes('@page'), `not reported: ${JSON.stringify(refused)}`);
    assert.ok(css.includes(`${SCOPE} .a{color:red}`) && css.includes(`${SCOPE} .b{color:blue}`), css);
  }
});

test('the at-rules that stay are still kept', () => {
  const { css } = scopeCss('@keyframes spin { to { transform: rotate(1turn) } } @media (max-width: 600px) { .c { top: 0 } }', SCOPE);
  assert.match(css, /@keyframes spin/);
  assert.match(css, /@media \(max-width: 600px\)\{/);
});
