// B11 — the per-event scene merge rule. Pure; the whole safety property is "off stays off".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEventScene } from '../src/hero/scene-events.js';

const base = { enabled: true, shape: 'orb', glow: 0.4, reveal: 'rise', events: { ev1: { shape: 'gem', glow: 0.9 } } };

test('applies the matching event override', () => {
  const out = mergeEventScene(base, { id: 'ev1' });
  assert.equal(out.shape, 'gem');
  assert.equal(out.glow, 0.9);
  assert.equal(out.reveal, 'rise'); // untouched
});

test('a disabled scene is never re-enabled by an event', () => {
  const off = { ...base, enabled: false };
  const out = mergeEventScene(off, { id: 'ev1' });
  assert.equal(out.enabled, false);
  assert.equal(out.shape, 'orb'); // override NOT applied
});

test('an override cannot flip enabled or reveal', () => {
  const b2 = { ...base, events: { ev1: { enabled: false, reveal: 'zoom', shape: 'ring' } } };
  const out = mergeEventScene(b2, { id: 'ev1' });
  assert.equal(out.enabled, true);   // stripped
  assert.equal(out.reveal, 'rise');  // stripped
  assert.equal(out.shape, 'ring');   // real override kept
});

test('no active event, or no matching entry, returns the base unchanged', () => {
  assert.equal(mergeEventScene(base, null).shape, 'orb');
  assert.equal(mergeEventScene(base, { id: 'nope' }).shape, 'orb');
});
