// Every preset has to be a look the server would accept and a person could read.
//
// A preset is the one path where nobody types anything: you click a name and the whole site
// changes. So the two ways it can be wrong are both silent. A colour the API refuses means
// Apply fails with `invalid_input` and the panel looks broken rather than the preset being
// wrong. And a page/text pair below WCAG AA means a site nobody complains about because they
// simply stop reading it.
//
// Both are computable, so they are computed here rather than eyeballed once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_PRESETS } from '../src/ui/theme-presets.js';
import { safeColour } from '../src/ui/theme-colour.js';
import { gradientCss } from '../src/ui/theme-gradients.js';

const srgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (hex) => {
  const [r, g, b] = srgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('there are presets, and each has an id, a name and an accent pair', () => {
  assert.ok(THEME_PRESETS.length >= 8, `only ${THEME_PRESETS.length} presets`);
  const ids = new Set();
  for (const p of THEME_PRESETS) {
    assert.ok(p.id && p.name && p.sub !== undefined, JSON.stringify(p).slice(0, 60));
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.match(p.accent, /^#[0-9a-f]{6}$/i, p.id);
    assert.match(p.accent2, /^#[0-9a-f]{6}$/i, p.id);
  }
});

test('every colour a preset carries would survive the theme gate', () => {
  // The same allowlist the API enforces. A preset the server refuses is a button that fails.
  for (const p of THEME_PRESETS) {
    for (const [where, v] of [['accent', p.accent], ['accent2', p.accent2],
      ['light.bg', p.light?.bg], ['light.text', p.light?.text],
      ['dark.bg', p.dark?.bg], ['dark.text', p.dark?.text]]) {
      if (v == null) continue;
      assert.equal(safeColour(v), v, `${p.id} ${where} = ${v}`);
    }
  }
});

test('every gradient a preset carries actually builds', () => {
  for (const p of THEME_PRESETS) {
    for (const [name, spec] of Object.entries(p.gradients || {})) {
      assert.ok(gradientCss(spec), `${p.id} ${name} produced nothing`);
    }
  }
});

test('text on its page clears WCAG AA in BOTH modes', () => {
  // 4.5:1 for body text. This is the difference between a palette and a site people can read,
  // and it is the one property a designer cannot check by looking at swatches.
  for (const p of THEME_PRESETS) {
    for (const mode of ['light', 'dark']) {
      const m = p[mode];
      if (!m) continue;
      const r = contrast(m.bg, m.text);
      assert.ok(r >= 4.5, `${p.id} ${mode}: ${m.text} on ${m.bg} is ${r.toFixed(2)}:1, below AA`);
    }
  }
});

test('a light preset is actually light and a dark one actually dark', () => {
  // Swapping the two by accident produces a theme that "works" by every other measure and is
  // wrong in the one way a reader notices immediately.
  for (const p of THEME_PRESETS) {
    if (p.light) assert.ok(lum(p.light.bg) > 0.5, `${p.id}: the light page is not light`);
    if (p.dark) assert.ok(lum(p.dark.bg) < 0.15, `${p.id}: the dark page is not dark`);
  }
});

test('the default preset carries NO page colours or gradients', () => {
  // Picking "Default" has to give back what the stylesheet defines, including the amber third
  // stop in the heading gradient. A copy of the built-ins here would freeze them: a later
  // change to index.css would stop reaching anyone who had ever pressed this button.
  const def = THEME_PRESETS.find((p) => p.id === 'bcw');
  assert.ok(def, 'no default preset');
  assert.equal(def.light, undefined);
  assert.equal(def.dark, undefined);
  assert.equal(def.gradients, undefined);
});

test('a preset that sets page colours sets BOTH modes', () => {
  // Half a look is worse than none: the site would be themed in one scheme and shipped in the
  // other, and which one you got would depend on a toggle nobody associates with the preset.
  for (const p of THEME_PRESETS) {
    assert.equal(!!p.light, !!p.dark, `${p.id} defines only one mode`);
  }
});
