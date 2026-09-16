// The scale a chart is drawn against.
//
// This is the part of MetricChart that can be wrong silently. The rendering can be judged by
// looking at it; a frame top of "peak × 1.15" cannot, because the chart still looks like a
// chart while meaning something different in each of the four panels beside it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The component imports React, which this runner has no business loading for one pure
// function, so the function is read out of the source and evaluated on its own.
const src = readFileSync(new URL('../src/ui/metric-chart.jsx', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('export function niceMax'), src.indexOf('\n}', src.indexOf('export function niceMax')) + 2);
// eslint-disable-next-line no-new-func
const niceMax = new Function(`${body.replace('export function', 'function')}; return niceMax;`)();

describe('the top of the frame is a number a person can read', () => {
  test('a percentage lands on one of four round tops', () => {
    for (const [peak, want] of [[3, 10], [9, 10], [12, 25], [24, 25], [30, 50], [48, 50], [60, 100], [99, 100], [100, 100]]) {
      assert.equal(niceMax(peak, { unit: '%', warnAt: null }), want, `peak ${peak}`);
    }
  });
  test('a percentage is never given a frame taller than 100', () => {
    // Cropping at 100 is what makes "how full is the disk" readable at a glance: three
    // quarters of the height IS three quarters full.
    assert.equal(niceMax(100, { unit: '%', warnAt: 90 }), 100);
  });
  test('the warning line always fits inside the frame', () => {
    // A threshold drawn outside the top would be invisible, which is the one thing it must
    // never be: the chart is coloured by whether the last reading crossed it.
    for (const warnAt of [10, 50, 85, 90, 200, 1500]) {
      const unit = warnAt > 100 ? ' ms' : '%';
      assert.ok(niceMax(1, { unit, warnAt }) >= warnAt, `warnAt ${warnAt}`);
    }
  });
  test('an unbounded measure gets a 1 / 2 / 2.5 / 5 top, above the peak', () => {
    for (const [peak, want] of [[0.4, 1], [8, 10], [140, 200], [230, 250], [420, 500], [900, 1000], [1800, 2000]]) {
      const got = niceMax(peak, { unit: ' ms', warnAt: null });
      assert.equal(got, want, `peak ${peak} gave ${got}`);
      assert.ok(got >= peak, 'the peak must be inside the frame');
    }
  });
  test('an all-zero series still has a frame, so the line is drawn on a baseline', () => {
    assert.equal(niceMax(0, { unit: '%', warnAt: null }), 10);
    assert.equal(niceMax(0, { unit: ' ms', warnAt: null }), 1);
  });
  test('half the height is half the top, which is the point of rounding it', () => {
    for (const unit of ['%', ' ms']) {
      for (const peak of [3, 17, 64, 230, 910]) {
        const max = niceMax(peak, { unit, warnAt: null });
        // Nothing stricter than "the half guide is not a number with a tail".
        assert.equal((max / 2) % 0.5, 0, `${unit} peak ${peak} → ${max}`);
      }
    }
  });
});
