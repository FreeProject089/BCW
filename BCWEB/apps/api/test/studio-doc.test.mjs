// The studio document, checked on SAVE (lib/studio-doc.mjs) — and checked against the web.
//
// The renderer (apps/web/src/ui/canvas-view.jsx) filters every author value on the way out;
// the API refuses the same values on the way in. Since phase 3 of PLAN-STUDIO-2026 both read
// ONE module, the studio package (BCWEB/packages/studio): the PARITY block below asserts that
// the API's validator IS the package's function and the web's re-export IS the same one, and
// keeps the corpus comparison so a future second copy would still be caught.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { studioDocProblems, configStudioProblems, sectionsStudioProblems, safeLink, cssValueOk, pinsToViewport, ID_SHAPE } from '../src/lib/studio-doc.mjs';
import * as web from '../../web/src/lib/canvas.js';
import * as webCss from '../../web/src/lib/css-scope.js';
import * as pkg from '../../../packages/studio/src/index.js';

const BS = String.fromCharCode(92);
const HOSTILE_LINKS = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:x', '\x01javascript:x', 'java\nscript:x',
  'vbscript:x', 'data:text/html,x', '//evil.example', `/${BS}evil.example`, '/\t/evil.example', `${BS}${BS}evil.example`];
const OK_LINKS = ['/p/bmm', '#top', 'https://example.com/x', 'http://example.com', 'mailto:a@b.c'];
const HOSTILE_CSS = ['url(https://evil.example/p)', 'url("//evil.example/p")', `${BS}75 rl(https://evil.example/p)`,
  'image-set("https://evil.example/p" 1x)', 'expression(alert(1))', 'red;background:url(https://evil.example/p)', 'red}body{color:red',
  '#fff url(https://evil.example/p)', 'url(https://evil.example/p'];
const OK_CSS = ['#fff', 'rgba(0,0,0,.5)', 'var(--primary)', 'linear-gradient(90deg, #000, #fff)', 'url(/uploads/a.png) center/cover',
  'color-mix(in srgb, var(--primary) 10%, transparent)'];

const doc = (blocks, extra = {}) => ({ id: 'c1', title: 't', blocks, ...extra });
const reasons = (d) => studioDocProblems(d).map((p) => `${p.path}:${p.reason}`);

describe('one studio document', () => {
  test('S1: every author href goes through the link policy', () => {
    for (const bad of HOSTILE_LINKS) {
      assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'button', props: { action: { type: 'link', href: bad } } }])), ['blocks[0].props.action.href:unsafe_url'], JSON.stringify(bad));
      assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'button', props: { action: { type: 'download', href: bad } } }])), ['blocks[0].props.action.href:unsafe_url'], JSON.stringify(bad));
      assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'button', props: { variant: 'dropdown-down', items: [{ label: 'a', href: '/ok' }, { label: 'b', href: bad }] } }])), ['blocks[0].props.items[1].href:unsafe_url']);
      assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'box', link: bad }])), ['blocks[0].link:unsafe_url']);
    }
    for (const ok of OK_LINKS) assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'button', props: { action: { type: 'link', href: ok } } }])), [], ok);
    assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'button', props: { action: { type: 'download', href: '#x' } } }])), ['blocks[0].props.action.href:unsafe_url']);
  });

  test('S2: the api action is refused, and so is anything outside the vocabulary', () => {
    assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'button', props: { action: { type: 'api', path: '/admin/x', method: 'POST' } } }])), ['blocks[0].props.action.type:api_removed']);
    assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'button', props: { action: { type: 'eval' } } }])), ['blocks[0].props.action.type:unknown_action']);
    assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'button', props: { action: { type: 'scroll', target: 'body > div' } } }])), ['blocks[0].props.action.target:bad_scroll_target']);
    assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'button', props: { action: { type: 'scroll', target: '#plans' } } }])), []);
  });

  test('S3: a block or canvas id is a name', () => {
    const forged = 'x"]{}body{background:url(https://evil.example/id)}[data-anim="';
    assert.deepEqual(reasons(doc([{ id: forged, kind: 'box' }])), ['blocks[0].id:bad_id']);
    assert.deepEqual(reasons({ id: 'c"]{}*{x:y}', blocks: [] }), ['id:bad_id']);
    assert.deepEqual(reasons(doc([{ id: 'ok_1-a', kind: 'box' }, { kind: 'box' }])), [], 'a conforming or absent id is fine');
    assert.ok(ID_SHAPE.test('p1abc2'));
  });

  test('S4: colour and background fields refuse what fetches', () => {
    for (const bad of HOSTILE_CSS) {
      assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'box', props: { bg: bad } }])), ['blocks[0].props.bg:unsafe_css'], bad);
      assert.deepEqual(reasons(doc([], { bg: bad })), ['bg:unsafe_css'], bad);
      assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'box', themes: { dark: { props: { color: bad } } } }])), ['blocks[0].themes.dark.props.color:unsafe_css'], bad);
    }
    for (const k of ['border', 'color', 'fill', 'fill2', 'stroke', 'textColor']) {
      assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'shape', props: { [k]: 'url(https://evil.example/p)' } }])), [`blocks[0].props.${k}:unsafe_css`]);
    }
    assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'box', props: { pattern: { id: 'dots', color: '")url(https://evil.example/p)' } } }])), ['blocks[0].props.pattern.color:unsafe_css']);
    for (const ok of OK_CSS) assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'box', props: { bg: ok } }], { bg: ok })), [], ok);
  });

  test('S5: position fixed or sticky is refused in the page CSS and in a block style', () => {
    assert.deepEqual(reasons(doc([], { css: '.a{position:fixed;inset:0}' })), ['css:position_fixed']);
    assert.deepEqual(reasons(doc([], { css: `.a{position:${BS}66 ixed}` })), ['css:position_fixed']);
    assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'box', props: { style: 'position: sticky; top: 0' } }])), ['blocks[0].props.style:position_fixed']);
    assert.deepEqual(reasons(doc([], { css: '.a{position:relative}/* position: fixed */' })), []);
  });

  test('a document over the size ceiling is refused', () => {
    assert.deepEqual(reasons(doc([{ id: 'b1', kind: 'text', props: { md: 'x'.repeat(310_000) } }])), [':too_large']);
  });
});

describe('a config, against what is stored', () => {
  const hostile = { id: 'b9', kind: 'button', props: { action: { type: 'api', path: '/x' } } };
  test('a new problem is refused, with its path', () => {
    const got = configStudioProblems({ canvases: [doc([hostile])] }, { canvases: [doc([])] });
    assert.deepEqual(got, [{ path: 'canvases[0].blocks[0].props.action.type', reason: 'api_removed' }]);
  });
  test('the same legacy value, already stored, is tolerated even after a reorder', () => {
    const stored = { canvases: [doc([{ id: 'b1', kind: 'box' }, hostile])] };
    assert.deepEqual(configStudioProblems({ canvases: [doc([hostile, { id: 'b1', kind: 'box' }])], tagline: 'edited' }, stored), []);
    // ... but not the same value moved to ANOTHER block, nor a changed one.
    assert.equal(configStudioProblems({ canvases: [doc([{ ...hostile, id: 'b10' }])] }, stored).length, 1);
    assert.equal(configStudioProblems({ canvases: [doc([{ ...hostile, props: { action: { type: 'link', href: 'javascript:x' } } }])] }, stored).length, 1);
  });
  test('home sections are checked the same way', () => {
    assert.deepEqual(sectionsStudioProblems([{ id: 's1', canvas: doc([{ id: 'b1', kind: 'box', props: { bg: 'url(https://evil.example/p)' } }]) }], []),
      [{ path: 'customSections[0].canvas.blocks[0].props.bg', reason: 'unsafe_css' }]);
    assert.deepEqual(sectionsStudioProblems([{ id: 's1' }], null), []);
  });
  test('junk does not throw', () => {
    for (const bad of [null, undefined, 'x', 42, { canvases: 'x' }, { canvases: [null, 3, 'x'] }]) {
      assert.deepEqual(configStudioProblems(bad, bad), []);
    }
  });
});

// ── PARITY with the renderer. ────────────────────────────────────────────────────────────
// For every value in the corpus: if the web neutralises it, the API must refuse it. (The API
// may be stricter; it may never be looser.)
describe('parity with the web renderer', () => {
  test('one validator: the API one IS the package one, and the web re-exports the same function', () => {
    assert.equal(studioDocProblems, pkg.validateDoc, 'the API validates with something other than the package');
    assert.equal(web.validateDoc, pkg.validateDoc, 'the web re-exports a different validateDoc');
    assert.equal(web.normalizeDoc, pkg.normalizeDoc);
    assert.equal(webCss.safeCssValue, pkg.safeCssValue, 'the web renders colours with a different filter');
    assert.equal(safeLink, pkg.safeLink); assert.equal(web.safeLink, pkg.safeLink);
  });
  const corpus = [...HOSTILE_LINKS, ...OK_LINKS, ...HOSTILE_CSS, ...OK_CSS, '', ' ', '#', '/', 'mailto:', 'https://', `/a${BS}b`, 'ftp://x', 'tel:1'];
  test('links', () => {
    for (const v of corpus) if (!web.safeLink(v)) assert.equal(safeLink(v), '', `web refuses ${JSON.stringify(v)}, the API accepts it`);
    for (const v of corpus) assert.equal(safeLink(v), web.safeLink(v), `the two link policies disagree on ${JSON.stringify(v)}`);
  });
  test('css values', () => {
    for (const v of corpus) if (v.trim() && !webCss.safeCssValue(v)) assert.equal(cssValueOk(v), false, `web refuses ${JSON.stringify(v)}, the API accepts it`);
  });
  test('position fixed', () => {
    for (const css of ['.a{position:fixed}', `.a{position:${BS}66 ixed}`, '.a{position: sticky !important}', '.a{position:relative}']) {
      const webKeeps = /position\s*:\s*(fixed|sticky)/i.test(webCss.scopeCss(css, '[data-cv="c"]').css);
      assert.equal(webKeeps, false, `the web kept ${css}`);
      assert.equal(pinsToViewport(css), /fixed|sticky|66/.test(css), `the API disagrees on ${css}`);
    }
  });
  test('ids', () => {
    for (const id of ['ok', 'a-b_c', 'x"]{}', 'a b', 'x'.repeat(61), '']) assert.equal(ID_SHAPE.test(id), web.ID_SHAPE.test(id), id);
  });
});

// ── v2 (PLAN-STUDIO-2026, phase 3): unknown fields refused, sizes capped. ─────────────────
describe('the v2 document: strict on write', () => {
  const v2 = (blocks, extra = {}) => ({ v: 2, id: 'c2', title: 't', frames: { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } }, blocks, ...extra });
  test('what serializeDoc writes is accepted, for every preset', () => {
    for (const p of pkg.CANVAS_PRESETS) {
      const stored = pkg.serializeDoc(pkg.normalizeDoc({ id: `c-${p.id}`, title: p.name, blocks: pkg.presetBlocks(p.id) }));
      assert.deepEqual(reasons(stored), [], p.id);
    }
  });
  test('an unknown field is refused wherever it is, with its path', () => {
    assert.deepEqual(reasons(v2([], { script: 'x' })), ['script:unknown_field']);
    assert.deepEqual(reasons(v2([], { height: 900 })), ['height:unknown_field'], 'a v1 field next to v2 frames is not silently ignored');
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'box', x: 0, y: 0, w: 10, h: 10, onclick: 'x' }])), ['blocks[0].onclick:unknown_field']);
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'box', x: 0, y: 0, w: 10, h: 10, props: { md: '# not a box prop' } }])), ['blocks[0].props.md:unknown_field']);
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'button', props: { action: { type: 'link', href: '/', method: 'POST' } } }])), ['blocks[0].props.action.method:unknown_field']);
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'box', themes: { dark: { x: 1, evil: 1 } } }])), ['blocks[0].themes.dark.evil:unknown_field']);
    assert.deepEqual(reasons(v2([], { frames: { desktop: { w: 1200, fit: 'content', z: 1 }, phone: { w: 390, fit: 'content', mode: 'stack' } } })), ['frames.desktop.z:unknown_field']);
  });
  test('the board is free, within the guard rail', () => {
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'box', x: -600, y: -40, w: 400, h: 100 }])), [], 'off the frame is a place');
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'box', x: 20_001, y: 0, w: 10, h: 10 }])), ['blocks[0].x:out_of_bounds']);
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'box', x: 0, y: 0, w: 0, h: 10 }])), ['blocks[0].w:out_of_bounds']);
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'box', x: '12', y: 0, w: 10, h: 10 }])), ['blocks[0].x:bad_type']);
    assert.deepEqual(reasons(v2([], { frames: { desktop: { w: 1300, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } } })), ['frames.desktop.w:bad_value'], 'a frame is 1200 wide, not what the author says');
  });
  test('sizes are capped', () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `b${i}`, kind: 'box', x: 0, y: 0, w: 8, h: 8 }));
    assert.deepEqual(reasons(v2(many)), ['blocks:too_many']);
    assert.deepEqual(reasons(v2([], { title: 'x'.repeat(201) })), ['title:too_long']);
    const items = Array.from({ length: 21 }, () => ({ label: 'a', href: '/' }));
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'button', props: { variant: 'dropdown-down', items } }])), ['blocks[0].props.items:too_many']);
    assert.deepEqual(reasons(v2([{ id: 'b1', kind: 'svg', props: { svg: 'x'.repeat(200_001) } }])), ['blocks[0].props.svg:too_long']);
  });
  test('a v1 document read from storage migrates to one the validator accepts', () => {
    const v1 = { id: 'c1', title: 'x', height: 600, phoneBoard: true, blocks: [{ id: 'a', kind: 'text', x: -40, y: 10, w: 1300, h: 99, props: { md: 'x', alt: 'junk' }, phone: { x: 500, y: 0 } }] };
    assert.deepEqual(reasons(pkg.serializeDoc(pkg.normalizeDoc(v1))), []);
  });
});

// Phase 4: the page background is a CLOSED value (packages/studio/src/background.js). The
// routes that store studio pages (PUT /studio/..., PUT /projects/:key, PUT /admin/showcase/:id,
// PUT /admin/site/home) all go through configStudioProblems / sectionsStudioProblems / the page
// save, so this is what each of them answers.
describe('the page background (phase 4): closed on write', () => {
  const v2 = (background) => ({ v: 2, id: 'c3', title: 't', frames: { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } }, background, blocks: [] });
  test('every kind the studio writes is accepted', () => {
    for (const background of [
      { type: 'color', color: 'var(--surface-2)' },
      { type: 'gradient', angle: 90, stops: [{ color: '#000', at: 0 }, { color: '#ffffff80', at: 100 }] },
      { type: 'image', src: '/api/media/pages/hero.webp', fit: 'cover', position: 'center' },
      { type: 'pattern', id: 'dots', color: '#112233', size: 24, opacity: 0.2 },
      pkg.normalizeBackground({ type: 'scene3d', shape: 'halo', position: 'left' }),
      { type: 'board', color: '', grid: 24 },
    ]) assert.deepEqual(configStudioProblems({ canvases: [v2(background)] }, {}), [], JSON.stringify(background));
  });
  test('a background that fetches from elsewhere, or is not in the vocabulary, is refused with its path', () => {
    assert.deepEqual(configStudioProblems({ canvases: [v2({ type: 'image', src: 'https://evil.example/p.png' })] }, {}),
      [{ path: 'canvases[0].background.src', reason: 'unsafe_url' }]);
    assert.deepEqual(configStudioProblems({ canvases: [v2({ type: 'color', color: 'url(https://evil.example/p)' })] }, {}),
      [{ path: 'canvases[0].background.color', reason: 'unsafe_css' }]);
    assert.deepEqual(sectionsStudioProblems([{ id: 's1', canvas: v2({ type: 'webgl', src: 'x' }) }], []),
      [{ path: 'customSections[0].canvas.background.type', reason: 'bad_value' }]);
    assert.deepEqual(configStudioProblems({ canvases: [v2({ type: 'scene3d', shape: 'orb', fps: 240, extra: 1 })] }, {}).map((p) => p.path),
      ['canvases[0].background.extra', 'canvases[0].background.fps']);
  });
  test('a page saved before phase 4 keeps loading: its stored free-text bg is tolerated, and the next save converts it', () => {
    const old = { v: 2, id: 'c4', frames: { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } }, bg: 'rgba(0,0,0,.05)', blocks: [] };
    assert.deepEqual(configStudioProblems({ canvases: [old], tagline: 'edited' }, { canvases: [old] }), []);
    const saved = pkg.serializeDoc(pkg.normalizeDoc(old));
    assert.equal(saved.bg, undefined);
    assert.deepEqual(saved.background, { type: 'color', color: '#0000000d' });
    assert.deepEqual(configStudioProblems({ canvases: [saved] }, { canvases: [old] }), []);
  });
});
