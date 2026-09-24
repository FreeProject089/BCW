// Full audit Sept 24 2026 (web), W1: the studio SVG block's sanitiser, judged by what the HTML
// parser builds from its OUTPUT, not by what the output string contains.
//
// The block is rendered with dangerouslySetInnerHTML (ui/canvas-view.jsx), so the question is
// never "does the string still say <script>" but "which elements does innerHTML create". parse5
// is the HTML parser the markdown pipeline already ships (rehype-raw), and it implements the
// same tree-construction rules as the browser, foreign content and the <svg> breakout included.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment } from 'parse5';
import { sanitizeSvg } from '../src/lib/svg-safe.js';

// Every element innerHTML would build from `html`, with its namespace and attributes.
function elements(html) {
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes || []) {
      if (!c.tagName) continue;
      out.push({ ns: c.namespaceURI.split('/').pop(), tag: c.tagName, attrs: c.attrs || [] });
      walk(c.content || c);
    }
  };
  walk(parseFragment(html));
  return out;
}
const ALLOWED = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textpath',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath', 'mask', 'symbol', 'use', 'title', 'desc',
  'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'femerge', 'femergenode', 'feflood', 'fecomposite',
  'fedropshadow', 'feturbulence', 'fedisplacementmap', 'femorphology', 'fecomponenttransfer', 'fefunca', 'fefuncr', 'fefuncg', 'fefuncb',
  'marker', 'metadata']);

function assertInert(input) {
  const out = sanitizeSvg(input);
  for (const el of elements(out)) {
    assert.equal(el.ns, 'svg', `an HTML element <${el.tag}> was built from ${JSON.stringify(out)}`);
    assert.ok(ALLOWED.has(el.tag.toLowerCase()), `<${el.tag}> is not a drawing tag: ${JSON.stringify(out)}`);
    for (const a of el.attrs) {
      assert.ok(!/^on/i.test(a.name), `handler ${a.name} survived: ${JSON.stringify(out)}`);
      if (/href$/i.test(a.name)) assert.match(a.value, /^#[\w:-]+$/, `external ${a.name}: ${JSON.stringify(out)}`);
      // The attribute value as the parser DECODED it: that is what the CSS / URL machinery reads.
      assert.ok(!/url\s*\(\s*['"]?(?!#)|image-set\s*\(|javascript:|\\/i.test(a.value), `${a.name}="${a.value}" can fetch: ${JSON.stringify(out)}`);
      if (a.name === 'style') assert.ok(!/position\s*:\s*(fixed|sticky)/i.test(a.value), `style escapes the block: ${a.value}`);
    }
  }
  return out;
}

describe('sanitizeSvg, judged by the parsed tree', () => {
  test('removing an unknown tag cannot join two halves into a new tag', () => {
    // The removal of <x> used to leave "<" + "img …>" side by side: <img onerror> in the page.
    assertInert('<svg><<x>img src=x onerror=alert(1)></svg>');
    assertInert('<svg><title><<x>img src=x onerror=alert(1)></title></svg>');
    assertInert('<svg><<x>style>@import "https://evil.test/a.css";<<x>/style></svg>');
    assertInert('<svg><<!---->img src=x onerror=alert(1)></svg>');
    assertInert('<svg><<script></script>img src=x onerror=alert(1)></svg>');
    assertInert('<svg><scr<script/>ipt>alert(1)</script></svg>');
  });

  test('a stray < or > in text stays text', () => {
    const out = assertInert('<svg><text>a < b > c</text></svg>');
    assert.ok(out.includes('<text>') && out.includes('&lt;') && out.includes('&gt;'), out);
  });

  test('an attribute is judged after entity and escape decoding', () => {
    assertInert('<svg><rect style="background:u&#x72;l(https://evil.test/x.png)"/></svg>');
    assertInert('<svg><rect fill="u&#114l(https://evil.test/x.png)"/></svg>');
    assertInert('<svg><rect style="background:\\75 rl(https://evil.test/x.png)"/></svg>');
    assertInert('<svg style="background-image:image-set(\'https://evil.test/x.png\' 1x)"><rect/></svg>');
    assertInert('<svg><use href="&#x6a;avascript:alert(1)"/></svg>');
    assertInert('<svg><rect title="&quot; onmouseover=alert(1) x=&quot;"/></svg>');
  });

  test('the root cannot be pinned over the page', () => {
    assertInert('<svg style="position:fixed;inset:0;z-index:99999"><rect/></svg>');
    assertInert('<svg style="position:&#x66;ixed;inset:0"><rect/></svg>');
  });

  test('controls: legitimate drawing is kept', () => {
    const clean = '<svg viewBox="0 0 4 4"><path d="M0 0h4v4z" fill="#000"/></svg>';
    assert.equal(sanitizeSvg(clean), clean);
    const grad = '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect fill="url(#g)" style="opacity:0.5"/><use href="#g"/><text x="1">Tom &amp; Jerry</text></svg>';
    const out = assertInert(grad);
    for (const keep of ['fill="url(#g)"', 'style="opacity:0.5"', '<use href="#g"', 'Tom &amp; Jerry', '<linearGradient id="g">']) {
      assert.ok(out.includes(keep), `${keep} lost: ${out}`);
    }
    // The harness itself: an unsanitised payload IS seen as an HTML element with a handler.
    assert.ok(elements('<svg><img src=x onerror=alert(1)></svg>').some((e) => e.ns === 'xhtml' && e.tag === 'img'));
  });
});
