// Full audit Sept 24 2026 (web), W5: a formula may not paint outside its own box.
//
// Any B.MD surface renders `$$…$$` with KaTeX, comments included. KaTeX takes sizes from the
// author, caps none of them by default (`maxSize: Infinity`) and never caps a NEGATIVE one, so
// `$$\kern{-5em}\colorbox{red}{\text{…}}$$` drew a filled box over the words before it and
// `\smash{\raisebox{…}{…}}` over the paragraph above. Measured in Chromium on /dev/editor:
// elementFromPoint at the box's centre returned KaTeX's `mord` before the fix and the
// paragraph after, and ten ordinary formulas (integrals, limits, accents, matrices) keep every
// glyph within 3.2px of their `.base`, under the .35em clip margin.
//
// The CSS half cannot run in node, so it is asserted where it lives; the KaTeX half is run.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import katex from 'katex';

const kit = (f) => readFileSync(new URL(`../../../packages/bmd/src/${f}`, import.meta.url), 'utf8');

describe('math stays inside the formula', () => {
  test('every .base of a formula is paint-contained, with a margin for overhangs', () => {
    const css = kit('markdown.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /\.md-body\s+\.katex\s+\.base\s*\{([^}]*)\}/.exec(css);
    assert.ok(rule, 'no .md-body .katex .base rule in markdown.css');
    assert.match(rule[1], /contain:\s*paint/);
    assert.match(rule[1], /overflow-clip-margin:\s*\.?\d/);
  });

  test('the renderer caps positive sizes (KaTeX defaults to Infinity)', () => {
    const src = kit('index.jsx');
    const m = /output:\s*'html'[^\]]*?maxSize:\s*(\d+)/.exec(src);
    assert.ok(m, 'rehype-katex is configured without maxSize');
    const cap = Number(m[1]);
    assert.ok(cap > 0 && cap <= 40, `maxSize ${cap}`);
    // What the option does, run on KaTeX itself: a 900em rule is drawn at the cap.
    const html = katex.renderToString(String.raw`\rule{900em}{900em}`, { output: 'html', throwOnError: false, maxSize: cap });
    assert.ok(!/900em/.test(html) && new RegExp(`${cap}em`).test(html), html.slice(0, 200));
  });

  test('control: the negative size is still there, which is why the CSS half exists', () => {
    const html = katex.renderToString(String.raw`\kern{-900em}X`, { output: 'html', throwOnError: false, maxSize: 20 });
    assert.match(html, /margin-right:-900em/);
  });
});
