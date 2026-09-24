// A studio page's background: a closed value (PLAN-STUDIO-2026 2.4, phase 4).
//
// The acceptance line this file exists for: NO background value can produce an external
// `url(`. Not "the values we thought of": every kind, every field, a corpus of hostile strings
// in every field, the legacy free-text `bg` read through the conversion, and a seeded fuzz over
// fragments that have each got through a CSS filter somewhere before. What reaches the page is
// `backgroundStyle(normalizeBackground(x))`, so that is what is inspected, value by value.
//
// Verified by mutation when written: making `bgColor` return whatever it is given turned 15
// assertions red (the corpus, the legacy reading and the fuzz among them), and deleting the
// same-site prefix rule of `bgImagePath` turned the fuzz red.
//
// Imported as a namespace and looked up INSIDE each test, so a missing export fails that test
// by name instead of throwing at import and taking the whole file down with one message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/lib/canvas.js';

/** Every url( in a CSS value, and whether it stays on this site (a path, or an inline image). */
function offsiteUrls(style) {
  const bad = [];
  for (const v of Object.values(style || {})) {
    const s = String(v);
    const opens = (s.match(/url\s*\(/gi) || []).length;
    const ok = [...s.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)];
    if (opens !== ok.length) bad.push(s);
    for (const m of ok) if (!/^(\/(?![/\\])|data:image\/svg\+xml;)/.test(m[2])) bad.push(m[2]);
    if (/image-set|\bsrc\s*\(|javascript:|expression\s*\(|[;{}<>]/i.test(s.replace(/url\("data:image\/svg\+xml;utf8,[^"]*"\)/g, ''))) bad.push(s);
  }
  return bad;
}

const HOSTILE = [
  'url(https://evil.example/a.png)', 'URL( "https://evil.example/b" )', "url('//evil.example/c')",
  '\\75 rl(https://evil.example/esc)', 'u\\72l(https://evil.example/esc2)', 'image-set("https://evil.example/s" 1x)',
  'red;background:url(https://evil.example/d)', 'red}body{background:url(https://evil.example/e)}',
  'var(--x, url(https://evil.example/f))', 'var(--primary);background-image:url(https://evil.example/g)',
  'javascript:alert(1)', 'expression(alert(1))', '"/><image href="https://evil.example/h"/>',
  '/api/media/../../evil', '/api/media/%2e%2e/%2fevil.example/p.png', '//evil.example/x.png', '/\\evil.example/x.png',
  'https://evil.example/x.png', '/api/media/x.png") , url("https://evil.example/i', '/uploads/a.png?u=https://evil.example',
  '#fff url(https://evil.example/j)', 'linear-gradient(red, url(https://evil.example/k))', '  #abc  ', 'var(--nope)',
];

const FIELDS = {
  color: ['color'], gradient: ['angle', 'stops'], image: ['src', 'fit', 'position'], pattern: ['id', 'color', 'size', 'opacity'],
  scene3d: ['shape', 'surface', 'position', 'detail', 'fps'], board: ['color', 'grid'], site: [],
};

test('no background value produces an external url(: every kind, every field, a hostile corpus', () => {
  const { normalizeBackground, backgroundStyle, BACKGROUND_TYPES } = C;
  for (const type of [...BACKGROUND_TYPES, 'nope', '', null]) {
    for (const field of FIELDS[type] || ['color']) {
      for (const h of HOSTILE) {
        const raw = { type, [field]: field === 'stops' ? [{ color: h, at: 0 }, { color: h, at: 100 }, { color: '#fff' }] : h };
        const style = backgroundStyle(normalizeBackground(raw));
        assert.deepEqual(offsiteUrls(style), [], `${type}.${field} = ${h} -> ${JSON.stringify(style)}`);
      }
    }
  }
});

test('the legacy free-text bg, read through the conversion, never produces one either', () => {
  const { backgroundFromLegacy, normalizeBackground, backgroundStyle, normalizeDoc } = C;
  for (const h of HOSTILE) {
    const { background } = backgroundFromLegacy(h);
    assert.deepEqual(offsiteUrls(backgroundStyle(normalizeBackground(background))), [], h);
    const doc = normalizeDoc({ id: 'c', bg: h, blocks: [] });
    assert.deepEqual(offsiteUrls(backgroundStyle(doc.background)), [], `normalizeDoc bg=${h}`);
  }
});

test('a seeded fuzz over the fragments that have fooled CSS filters before', () => {
  const { normalizeBackground, backgroundStyle, BACKGROUND_TYPES } = C;
  const bits = ['url(', 'https://evil.example/', '//', '\\', '75 ', '")', "'", ';', '}', '{', ' ', '#', 'fff', 'var(--', 'primary', ')',
    '/api/media/', '/uploads/', '..', '%2e', '%2f', 'image-set(', 'data:', 'text/html', ',', 'x.png', '\n', '\t', '(', 'deg'];
  let seed = 1234567;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const junk = () => Array.from({ length: 1 + rnd(8) }, () => bits[rnd(bits.length)]).join('');
  for (let i = 0; i < 4000; i++) {
    const type = BACKGROUND_TYPES[rnd(BACKGROUND_TYPES.length)];
    const raw = { type, color: junk(), src: junk(), id: junk(), shape: junk(), position: junk(), fit: junk(),
      stops: [{ color: junk(), at: junk() }, { color: junk() }], angle: junk(), size: junk(), grid: junk() };
    const style = backgroundStyle(normalizeBackground(raw));
    assert.deepEqual(offsiteUrls(style), [], `${JSON.stringify(raw)} -> ${JSON.stringify(style)}`);
  }
});

test('what a background CAN be: each kind, rebuilt from its fields', () => {
  const { normalizeBackground, backgroundStyle } = C;
  assert.deepEqual(backgroundStyle({ type: 'color', color: 'var(--surface-2)' }), { backgroundColor: 'var(--surface-2)' });
  assert.deepEqual(backgroundStyle({ type: 'color', color: '#ABCDEF' }), { backgroundColor: '#abcdef' });
  assert.equal(backgroundStyle({ type: 'gradient', angle: 90, stops: [{ color: '#000', at: 0 }, { color: 'var(--primary)', at: 100 }] }).backgroundImage,
    'linear-gradient(90deg, #000 0%, var(--primary) 100%)');
  const img = backgroundStyle({ type: 'image', src: '/api/media/abc/pic.webp', fit: 'tile', position: 'top' });
  assert.equal(img.backgroundImage, 'url("/api/media/abc/pic.webp")');
  assert.equal(img.backgroundRepeat, 'repeat');
  assert.match(backgroundStyle({ type: 'pattern', id: 'dots', color: '#f00', opacity: 0.5 }).backgroundImage, /^url\("data:image\/svg\+xml;utf8,/);
  assert.equal(backgroundStyle({ type: 'board', color: '#fafafa', grid: 0 }).backgroundImage, undefined);
  assert.match(backgroundStyle({ type: 'board', color: '#fafafa', grid: 16 }).backgroundSize, /^16px 16px$/);
  // Nothing to paint: the site shows through, and the 3D kind is drawn by its own layer.
  assert.deepEqual(backgroundStyle({ type: 'site' }), {});
  assert.deepEqual(backgroundStyle({ type: 'scene3d' }), {});
  // An image with no picture, a colour that is not one, an unknown kind: `site`, never half a value.
  for (const raw of [{ type: 'image', src: '' }, { type: 'color', color: 'rgb(1,2,3)' }, { type: 'gradient', stops: [{ color: '#000' }] }, { type: 'x' }, null, 'red']) {
    assert.deepEqual(normalizeBackground(raw), { type: 'site' }, JSON.stringify(raw));
  }
});

test('the 3D kind is the scene vocabulary, clamped per shape', () => {
  const { normalizeBackground, SCENE_SHAPES } = C;
  const s = normalizeBackground({ type: 'scene3d', shape: 'gem', detail: 5, fps: 1000, glow: -1, twinkles: 12.4, position: 'left' });
  assert.equal(s.shape, 'gem');
  assert.equal(s.detail, 2, 'the gem stops subdividing at 2');
  assert.equal(s.fps, 60);
  assert.equal(s.glow, 0);
  assert.equal(s.twinkles, 12);
  assert.equal(s.position, 'left');
  assert.equal(normalizeBackground({ type: 'scene3d', shape: 'nope' }).shape, 'orb');
  assert.ok(SCENE_SHAPES.includes('vase') && SCENE_SHAPES.length === 11);
});

test('the old bg string: what can be kept is kept, the rest is site and says so', () => {
  const { backgroundFromLegacy, normalizeDoc } = C;
  assert.deepEqual(backgroundFromLegacy('rgba(99,102,241,0.10)').background, { type: 'color', color: '#6366f11a' });
  assert.deepEqual(backgroundFromLegacy('var(--surface-2)').background, { type: 'color', color: 'var(--surface-2)' });
  assert.deepEqual(backgroundFromLegacy('linear-gradient(to right, #fff, rgb(0 0 0 / 50%))').background,
    { type: 'gradient', angle: 90, stops: [{ color: '#fff', at: 0 }, { color: '#00000080', at: 100 }] });
  assert.deepEqual(backgroundFromLegacy('url("/api/media/a.png") center / contain no-repeat').background,
    { type: 'image', src: '/api/media/a.png', fit: 'contain', position: 'center' });
  const odd = backgroundFromLegacy('color-mix(in srgb, var(--primary) 10%, transparent)');
  assert.deepEqual(odd, { background: { type: 'site' }, recognized: false });
  assert.equal(normalizeDoc({ id: 'c', bg: 'color-mix(in srgb, red 5%, blue)', blocks: [] }).bgNote, 'replaced');
  assert.equal(normalizeDoc({ id: 'c', bg: '#123', blocks: [] }).bgNote, '');
  // `background` wins over a stale `bg` on the same document.
  assert.deepEqual(normalizeDoc({ id: 'c', bg: '#123', background: { type: 'color', color: '#456' }, blocks: [] }).background, { type: 'color', color: '#456' });
});

test('saving writes the closed value and never bg; the validator accepts what is saved', () => {
  const { serializeDoc, normalizeDoc, validateDoc, BACKGROUND_TYPES } = C;
  const fromLegacy = serializeDoc(normalizeDoc({ id: 'c', bg: '#123456', blocks: [] }));
  assert.equal(fromLegacy.bg, undefined);
  assert.deepEqual(fromLegacy.background, { type: 'color', color: '#123456' });
  assert.deepEqual(validateDoc(fromLegacy), []);
  // `site` is the default and is not stored.
  assert.equal(serializeDoc(normalizeDoc({ id: 'c', blocks: [] })).background, undefined);
  // An old caller passing `extra.bg` still cannot write free text.
  assert.deepEqual(serializeDoc(normalizeDoc({ id: 'c', blocks: [] }), { bg: 'url(https://evil.example/x)' }).background, undefined);
  const samples = {
    site: { type: 'site' }, color: { type: 'color', color: 'var(--primary)' },
    gradient: { type: 'gradient', angle: 45, stops: [{ color: '#000', at: 0 }, { color: '#fff', at: 50 }, { color: 'var(--bg)', at: 100 }] },
    image: { type: 'image', src: '/uploads/x.png', fit: 'contain', position: 'bottom' },
    pattern: { type: 'pattern', id: 'hex', color: '#123', size: 30, opacity: 0.4 },
    scene3d: { type: 'scene3d', shape: 'spiral', surface: 'both', position: 'right', speed: 2 },
    board: { type: 'board', color: '', grid: 48 },
  };
  for (const type of BACKGROUND_TYPES) {
    const doc = serializeDoc(normalizeDoc({ id: 'c', blocks: [] }), { background: samples[type] });
    assert.deepEqual(validateDoc(doc), [], `${type}: ${JSON.stringify(doc.background)}`);
    assert.equal(normalizeDoc(doc).background.type, type);
  }
});

test('the validator refuses a hostile or unknown background, with the path of the field', () => {
  const { validateDoc } = C;
  const doc = (background) => ({ v: 2, id: 'c', frames: { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } }, background, blocks: [] });
  const why = (background) => validateDoc(doc(background)).map((p) => `${p.path}:${p.reason}`);
  assert.deepEqual(why({ type: 'image', src: 'https://evil.example/x.png' }), ['background.src:unsafe_url']);
  assert.deepEqual(why({ type: 'color', color: 'url(https://evil.example/x)' }), ['background.color:unsafe_css']);
  assert.deepEqual(why({ type: 'color', color: 'red' }), ['background.color:bad_value']);
  assert.deepEqual(why({ type: 'color', color: '#fff', css: 'x' }), ['background.css:unknown_field']);
  assert.deepEqual(why({ type: 'webgl' }), ['background.type:bad_value']);
  assert.deepEqual(why('#fff'), ['background:bad_type']);
  assert.deepEqual(why({ type: 'gradient', angle: 10, stops: [{ color: '#000' }, { color: '#fff' }, { color: '#000' }, { color: '#fff' }, { color: '#000' }] }), ['background.stops:too_many']);
  assert.deepEqual(why({ type: 'gradient', stops: [{ color: '#000', at: 0 }, { color: '\\75 rl(x)', at: 100 }] }), ['background.stops[1].color:unsafe_css']);
  assert.deepEqual(why({ type: 'pattern', id: 'dots', color: 'var(--primary)' }), ['background.color:bad_value']);
  assert.deepEqual(why({ type: 'scene3d', shape: 'prism', detail: 4 }), ['background.detail:out_of_bounds']);
  assert.deepEqual(why({ type: 'scene3d', fps: 10 }), ['background.fps:out_of_bounds']);
  assert.deepEqual(why({ type: 'board', grid: 7 }), ['background.grid:bad_value']);
});
