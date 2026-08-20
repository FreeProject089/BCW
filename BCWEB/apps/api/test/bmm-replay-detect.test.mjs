// Format detection decides which reader runs, so the thing worth proving is that widening it
// to accept a bare rrweb array did not start claiming OTHER documents are replays. A detector
// that is too eager reports confident nonsense, which is worse than "unknown".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, inspectAny } from '../src/lib/bmm-formats.mjs';

/** A minimal but real-shaped rrweb stream: Meta (4) then FullSnapshot (2). */
const rrweb = (n = 4) => Array.from({ length: n }, (_, i) => ({
    type: i === 0 ? 4 : 2, timestamp: 1700000000000 + i * 100, data: {},
}));

test('a BMM replay document is still detected', () => {
    assert.equal(detectFormat({ events: rrweb(), console: [] }), 'bmmreplay');
    assert.equal(detectFormat({ events: rrweb(), rustLog: 'x' }), 'bmmreplay');
});

test('a replay WITHOUT console or rustLog is detected', () => {
    // The old rule required one of those two, so a recording taken with the console detached
    // was reported as "not a recognised BMM format" — about a file the player opens fine.
    assert.equal(detectFormat({ events: rrweb() }), 'bmmreplay');
});

test('a BARE rrweb array is detected', () => {
    assert.equal(detectFormat(rrweb()), 'bmmreplay');
});

test('a bare array is summarised, not just detected', () => {
    // Detection and description have to agree: reporting the format and then describing an
    // empty document is the drift this normalisation exists to prevent.
    const r = inspectAny(rrweb(6));
    assert.equal(r.ok, true);
    assert.equal(r.format, 'bmmreplay');
    const events = r.summary.find((x) => x.label === 'Events');
    assert.equal(events.value, '6');
    assert.ok(r.summary.some((x) => x.value === 'bare rrweb event array'));
});

test('an automation is NOT mistaken for a replay', () => {
    // Both are top-level arrays. This is the ordering the detector's own comment warns about.
    assert.equal(detectFormat([{ steps: [] }]), 'bmmpa');
    assert.equal(detectFormat({ magic: 'BMMPA', tasks: [{ steps: [] }] }), 'bmmpa');
});

test('arrays that are not rrweb stay unknown', () => {
    assert.equal(detectFormat([1, 2, 3]), null);
    assert.equal(detectFormat([{ a: 1 }, { b: 2 }]), null);
    // Right keys, wrong types — a JSON export that happens to use the word "type".
    assert.equal(detectFormat([{ type: 'click', timestamp: 'now' }, { type: 'click', timestamp: 'now' }]), null);
});

test('one event is not a recording', () => {
    // Every rrweb stream opens with a Meta AND a FullSnapshot; a single entry cannot play.
    assert.equal(detectFormat([{ type: 4, timestamp: 1 }]), null);
    assert.equal(detectFormat([]), null);
});

test('a mod list and a navbar config are unaffected', () => {
    assert.equal(detectFormat({ format_version: '1', mods: [] }), 'mm');
    assert.equal(detectFormat({ format: 'bmmnav' }), 'bmmnav');
});
