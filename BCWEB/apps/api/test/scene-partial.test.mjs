// B11 — scenePartial sanitises a per-event scene override before it is stored, so a client
// POSTing junk cannot poison the scene config every visitor reads. Pure; no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenePartial } from '../src/routes/misc.mjs';

test('keeps only valid, clamped fields', () => {
  const out = scenePartial({ shape: 'gem', glow: 5, speed: -2, detail: 3.9, twinkles: 999, bogus: 1, enabled: false });
  assert.equal(out.shape, 'gem');
  assert.equal(out.glow, 1);        // clamped to max
  assert.equal(out.speed, 0);       // clamped to min
  assert.equal(out.detail, 4);      // rounded, within 0..5
  assert.equal(out.twinkles, 240);  // clamped
  assert.ok(!('bogus' in out));     // unknown dropped
  assert.ok(!('enabled' in out));   // never overridable per-event
});

test('rejects an invalid shape/enum silently (field dropped, not defaulted)', () => {
  const out = scenePartial({ shape: 'heart', surface: 'nope', glow: 0.5 });
  assert.ok(!('shape' in out));
  assert.ok(!('surface' in out));
  assert.equal(out.glow, 0.5);
});

test('an empty or non-object override yields null', () => {
  assert.equal(scenePartial({}), null);
  assert.equal(scenePartial(null), null);
  assert.equal(scenePartial({ bogus: 1 }), null);
});
