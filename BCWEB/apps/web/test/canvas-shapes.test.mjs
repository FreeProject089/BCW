// Studio v3: shapes and pasted SVG, patterns, the page stylesheet scoper, block classes / style.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCanvas, BLOCK_KINDS, SHAPES, presetBlocks, DESIGN_WIDTH, GRID } from '../src/lib/canvas.js';
import { sanitizeSvg, svgRefusals } from '../src/lib/svg-safe.js';
import { scopeCss, safeClasses, safeInlineStyle } from '../src/lib/css-scope.js';
import { PATTERNS, patternImage, patternStyle } from '../src/lib/patterns.js';

describe('shapes and svg blocks', () => {
  test('are kinds the renderer knows; a shape keeps its props; the page keeps its css', () => {
    assert.ok(BLOCK_KINDS.includes('shape') && BLOCK_KINDS.includes('svg'));
    assert.ok(SHAPES.length >= 10);
    const c = normalizeCanvas({ css: '.a{color:red}', blocks: [{ id: 's', kind: 'shape', x: 0, y: 0, w: 200, h: 200, props: { shape: 'star', fill: '#f00' } }] });
    assert.equal(c.blocks[0].kind, 'shape');
    assert.equal(c.blocks[0].props.shape, 'star');
    assert.equal(c.css, '.a{color:red}');
    assert.equal(normalizeCanvas({ css: 42 }).css, '');
  });
  test('the shapes preset is on the grid, inside the width, and uses the new kinds', () => {
    const blocks = normalizeCanvas({ blocks: presetBlocks('shapes') }).blocks;
    assert.ok(blocks.some((b) => b.kind === 'shape'));
    for (const b of blocks) { assert.equal(b.x % GRID, 0); assert.ok(b.x + b.w <= DESIGN_WIDTH); }
  });
});

describe('sanitizeSvg', () => {
  test('keeps drawing, drops everything that runs, fetches or frames', () => {
    const dirty = `<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
      <script>alert(1)</script><style>@import url(https://evil)</style>
      <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
      <rect width="10" height="10" fill="url(#g)" onclick="x()" style="fill:url(https://evil/x.png)"/>
      <a href="https://evil"><circle cx="5" cy="5" r="2"/></a>
      <image href="https://evil/x.png"/><foreignObject><div>hi</div></foreignObject>
      <use href="#g"/><use xlink:href="https://evil/#g"/>
      <text x="1" y="1">ok</text><animate attributeName="x"/>
    </svg>`;
    const out = sanitizeSvg(dirty);
    assert.ok(out.startsWith('<svg') && out.endsWith('</svg>'));
    for (const bad of ['script', 'onload', 'onclick', '<style', 'evil', '<image', 'foreignObject', '<a ', 'xlink:href="https', '<animate', '<?xml', 'DOCTYPE']) {
      assert.ok(!out.includes(bad), `${bad} survived: ${out}`);
    }
    assert.ok(out.includes('<rect') && out.includes('fill="url(#g)"') && out.includes('<circle') && out.includes('<text') && out.includes('<use href="#g"'));
    assert.deepEqual(svgRefusals(dirty).sort(), ['SMIL animation', 'embedded content', 'event handlers', 'external references', 'script', 'style blocks'].sort());
  });
  test('no svg root → nothing; a plain svg is unchanged in substance', () => {
    assert.equal(sanitizeSvg('<div>x</div>'), '');
    assert.equal(sanitizeSvg(''), '');
    const clean = '<svg viewBox="0 0 4 4"><path d="M0 0h4v4z" fill="#000"/></svg>';
    assert.equal(sanitizeSvg(clean), clean);
  });
});

describe('scopeCss', () => {
  const SCOPE = '[data-cv="c1"]';
  test('prefixes every selector and recurses into @media; keeps keyframes; maps :root/body to the page', () => {
    const { css, refused } = scopeCss('.a, .b:hover { color: red } @media (max-width: 600px) { .c { top: 0 } } @keyframes k { from { x: 0 } to { x: 1 } } :root { --x: 1 } body .d { y: 2 }', SCOPE);
    assert.equal(refused.length, 0);
    assert.ok(css.includes(`${SCOPE} .a, ${SCOPE} .b:hover{color: red}`));
    assert.ok(css.includes(`@media (max-width: 600px){\n${SCOPE} .c{top: 0}\n}`));
    assert.ok(css.includes('@keyframes k{ from { x: 0 } to { x: 1 } }'));
    assert.ok(css.includes(`${SCOPE}{--x: 1}`));
    assert.ok(css.includes(`${SCOPE} .d{y: 2}`));
  });
  test('refuses what reaches outside the page and says so', () => {
    const { css, refused } = scopeCss('@import url(https://evil/x.css); .a { background: url(https://evil/x.png); width: expression(1); behavior: url(x.htc) } .b { background: url(/ok.png) url(#a) url(data:image/png;base64,AAAA) }', SCOPE);
    assert.ok(refused.includes('@import') && refused.includes('expression()') && refused.includes('behavior:'));
    assert.ok(refused.some((r) => r.startsWith('url(https://evil')));
    assert.ok(!css.includes('evil') && !css.includes('expression('));
    assert.ok(css.includes('url(/ok.png)') && css.includes('url(#a)') && css.includes('url(data:image/png'));
  });
  // Three ways to name a third-party URL without writing the four letters `url(`. Each one
  // fetched, and the filter reported nothing, which is the worst of the two failure modes: the
  // author is told the stylesheet was accepted whole.
  test('a CSS escape is syntax, not value: \\75 rl( IS url(', () => {
    const { css, refused } = scopeCss('.a{background:\\75 rl(https://evil/p.png)}', SCOPE);
    assert.ok(!css.includes('evil'), 'the escape used to pass through untouched');
    assert.ok(refused.some((r) => r.startsWith('url(https://evil')));
    // An escape in ordinary content is decoded, not refused: it means the character it stands for.
    assert.ok(scopeCss('.a{content:"\\201C"}', SCOPE).css.includes('\u201C'));
  });
  test('image-set() and src() take a URL with no url() token', () => {
    for (const decl of ['background:image-set("https://evil/p.png" 1x)',
      'background:-webkit-image-set("https://evil/p.png" 1x)',
      'list-style-image:src("https://evil/p.png")']) {
      const { css, refused } = scopeCss(`.a{${decl}}`, SCOPE);
      assert.ok(!css.includes('evil'), decl);
      assert.ok(refused.some((r) => r.includes('evil')), decl);
    }
    // A same-origin one is untouched, and a url() inside an image-set still resolves normally.
    assert.ok(scopeCss('.a{background:image-set("/u/p.png" 1x)}', SCOPE).css.includes('/u/p.png'));
    assert.ok(scopeCss('.a{background:image-set(url(/u/p.png) 1x)}', SCOPE).css.includes('url(/u/p.png)'));
  });
  // Pentest 2026-09-23, card 6. The string scan inside image-set()/src() was a regex over the
  // literal text, so two ways of writing the SAME string defeated it: a CSS line continuation
  // (a backslash before a newline, which a browser deletes inside a string) and putting the
  // string in a custom property and substituting it with var(). Both fetched, both reported
  // nothing refused.
  test('a line continuation inside an image string is still that string', () => {
    const BS = String.fromCharCode(92);
    for (const decl of [`background:image-set("https:${BS}\n//evil/p.png" 1x)`,
      `background:src("https:${BS}\n//evil/p.png")`]) {
      const { css, refused } = scopeCss(`.a{${decl}}`, SCOPE);
      assert.ok(!css.includes('evil'), decl);
      assert.ok(refused.some((r) => r.includes('evil')), decl);
    }
  });
  test('an image function whose argument this cannot read is refused, not trusted', () => {
    for (const src of ['.a{--u:"https://evil/p.png";background:image-set(var(--u) 1x)}',
      '.a{--u:"https://evil/p.png";background:src(var(--u))}',
      '@property --u{syntax:"*";inherits:false;initial-value:"https://evil/p.png"}\n.a{background:image-set(var(--u) 1x)}']) {
      const { css, refused } = scopeCss(src, SCOPE);
      assert.ok(!/image-set\(\s*var|src\(\s*var/.test(css), src);
      assert.ok(refused.length, src);
    }
    // An image function nobody can close is refused without taking the rest of the sheet.
    {
      const { css, refused } = scopeCss('.a{background:image-set("x 1x)}\n.b{color:red}', SCOPE);
      assert.ok(refused.length);
      assert.ok(css.includes('color:red'), css);
    }
    // The shapes a real stylesheet uses keep working.
    assert.ok(scopeCss('.a{background:image-set("/u/p.png" 1x, "/u/p2.png" 2x)}', SCOPE).css.includes('/u/p2.png'));
    assert.ok(scopeCss('.a{background:image-set("/u/p.png" type("image/png"))}', SCOPE).css.includes('type("image/png")'));
  });
  test('classes and inline style are filtered the same way', () => {
    assert.equal(safeClasses('hero rounded-2xl md:flex bg-[#fff] <script> a"b'), 'hero rounded-2xl md:flex bg-[#fff]');
    assert.deepEqual(safeInlineStyle('letter-spacing: .04em; background-image: url(https://evil/x); color: red; --accent: #f00'), { letterSpacing: '.04em', color: 'red', '--accent': '#f00' });
    assert.deepEqual(safeInlineStyle('width: expression(1)'), {});
  });
  // The same three channels, on the OTHER door. safeInlineStyle matched `url(` in the raw text
  // and knew nothing about escapes or about the two functions that take a bare string, so a
  // block's own `style` reached the DOM with all three.
  test('an inline style is read the way the browser reads it', () => {
    const BS = String.fromCharCode(92);
    for (const decl of [`background:${BS}75 rl(https://evil/p.png)`,
      'background-image:image-set("https://evil/p.png" 1x)',
      'background-image:src("https://evil/p.png")',
      'background-image:image-set(var(--u) 1x)']) {
      assert.deepEqual(safeInlineStyle(decl), {}, decl);
    }
    // and the ordinary ones still arrive, exactly as typed
    assert.deepEqual(safeInlineStyle('background:url(/ok.png);background-image:image-set("/a.png" 1x)'),
      { background: 'url(/ok.png)', backgroundImage: 'image-set("/a.png" 1x)' });
  });
});

describe('patterns', () => {
  test('every pattern renders to a data-uri background, with size and opacity applied', () => {
    for (const p of PATTERNS) {
      const img = patternImage(p.id, { color: '#123456', size: 20 });
      assert.ok(img.startsWith('url("data:image/svg+xml;utf8,'), p.id);
      assert.ok(decodeURIComponent(img).includes('#123456'), p.id);
    }
    assert.equal(patternImage('nope'), '');
    const st = patternStyle({ id: 'dots', color: '#000000', size: 30, opacity: 0.5 });
    assert.equal(st.backgroundSize, '30px auto');
    assert.ok(decodeURIComponent(st.backgroundImage).includes('#00000080'), 'opacity baked into the hex');
    assert.deepEqual(patternStyle(null), {});
  });
  test('a colour cannot break out of the attribute', () => {
    const img = patternImage('grid', { color: '"><script>' });
    assert.ok(!decodeURIComponent(img).includes('<script>'));
  });
});

// Refusing something must not take the author's NEXT rule with it. `@import url(...)` used to
// be refused token by token, leaving `/*refused*/ none;` in the stream; the scoper reads that
// leftover as the head of the following rule, so the valid rule after an @import silently did
// nothing — and the author only saw ONE line reported.
test('a refused @import does not swallow the rule that follows it', () => {
  const SCOPE = '[data-cv="c1"]';
  const { css, refused } = scopeCss('@import url(https://evil/x.css); .a { color: red }', SCOPE);
  assert.ok(refused.includes('@import'));
  assert.ok(css.includes(`${SCOPE} .a{color: red}`), css);
  assert.ok(!css.includes('refused'), css);
});
