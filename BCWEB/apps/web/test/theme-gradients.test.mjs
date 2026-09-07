// Gradients as stored data.
//
// These values are emitted into a <style> element served to every visitor, so the interesting
// cases are not "does it build a gradient" but "what does it do with a value it should not
// emit". A stop containing `}` would end the rule and everything after it would be
// attacker-chosen CSS — the same injection point the colour tokens already guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gradientCss, gradientVars, safeStop, defaultSpec, GRADIENT_PRESETS, GRADIENTS,
} from '../src/ui/theme-gradients.js';

test('a spec becomes a linear-gradient with its angle and stops', () => {
  const css = gradientCss({ angle: 90, stops: [{ color: '#ff0000' }, { color: '#0000ff' }] });
  assert.equal(css, 'linear-gradient(90deg, #ff0000, #0000ff)');
});

test('a stop position is emitted only when it was actually set', () => {
  // Guessing the even distribution would make "never touched" and "set to the even values"
  // two different stored themes that render identically — and then "reset" could not tell
  // them apart.
  assert.equal(gradientCss({ angle: 0, stops: [{ color: '#fff' }, { color: '#000', at: 70 }] }),
    'linear-gradient(0deg, #fff, #000 70%)');
});

test('the accent references survive, because that is what keeps a gradient themed', () => {
  const css = gradientCss({ angle: 120, stops: [{ color: 'var(--primary)' }, { color: 'var(--primary-2)' }] });
  assert.equal(css, 'linear-gradient(120deg, var(--primary), var(--primary-2))');
});

test('a stop that would break out of the declaration is dropped', () => {
  for (const bad of ['red;}body{display:none', 'url(http://x)', 'var(--anything)', 'expression(1)', '#fff}']) {
    assert.equal(safeStop(bad), null, bad);
  }
  // …and dropping it must not leave a half-gradient behind.
  assert.equal(gradientCss({ angle: 90, stops: [{ color: '#fff' }, { color: 'red;}x{y:z' }] }), null);
});

test('fewer than two usable stops emits nothing rather than a flat block', () => {
  // A one-stop "gradient" is a solid fill. Emitting it would silently replace a sweep with a
  // block, which reads as the feature being broken.
  assert.equal(gradientCss({ angle: 90, stops: [{ color: '#fff' }] }), null);
  assert.equal(gradientCss({ stops: [] }), null);
  assert.equal(gradientCss(null), null);
});

test('the angle and positions are clamped, not trusted', () => {
  assert.match(gradientCss({ angle: 9999, stops: [{ color: '#fff' }, { color: '#000' }] }), /^linear-gradient\(360deg,/);
  assert.match(gradientCss({ angle: -50, stops: [{ color: '#fff' }, { color: '#000' }] }), /^linear-gradient\(0deg,/);
  assert.match(gradientCss({ angle: 90, stops: [{ color: '#fff', at: 9999 }, { color: '#000' }] }), /#fff 200%/);
});

test('a missing angle falls back rather than emitting NaNdeg', () => {
  assert.match(gradientCss({ stops: [{ color: '#fff' }, { color: '#000' }] }), /^linear-gradient\(120deg,/);
});

test('only the known gradient names are emitted', () => {
  const out = gradientVars({ '--grad-primary': { angle: 45, stops: [{ color: '#111' }, { color: '#222' }] }, '--grad-evil': { angle: 45, stops: [{ color: '#111' }, { color: '#222' }] } });
  assert.ok(out.includes('--grad-primary:'));
  assert.ok(!out.includes('--grad-evil'));
});

test('an empty or absent bag emits nothing, so the stylesheet default stands', () => {
  assert.equal(gradientVars(null), '');
  assert.equal(gradientVars({}), '');
  assert.equal(gradientVars({ '--grad-text': null }), '');
});

test('the shipped default keeps the hardcoded amber that used to be unreachable', () => {
  // The point of the whole change: .gradient-text's third stop is now a value in the theme.
  // If this default drifts from the stylesheet fallback, "reset" would change the look.
  const spec = defaultSpec('--grad-text');
  assert.equal(spec.stops.length, 3);
  assert.equal(spec.stops[2].color, '#fbbf24');
  assert.equal(gradientCss(spec), 'linear-gradient(110deg, var(--primary), var(--primary-2) 70%, #fbbf24)');
});

test('every preset builds something emittable for every gradient', () => {
  for (const g of GRADIENTS) {
    for (const p of GRADIENT_PRESETS) {
      assert.ok(gradientCss(p.build(g)), `${p.id} on ${g.name}`);
    }
  }
});

test('every gradient carries both languages, so the editor is never half-English', () => {
  for (const g of GRADIENTS) {
    for (const k of ['label', 'affects']) {
      assert.ok(g[k]?.en && g[k]?.fr, `${g.name}.${k}`);
    }
  }
  for (const p of GRADIENT_PRESETS) assert.ok(p.label.en && p.label.fr, p.id);
});
