// Heading / list / quote toggles for the selection toolbar.
//
// Toggling is the part that goes wrong, and it goes wrong quietly: `- - item` still renders as
// a list, `## # Title` still renders as a heading, so a broken toggle looks like it worked
// until somebody reads the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleHeading, toggleBullet, toggleOrdered, toggleQuote, expandToLines } from '../src/lib/md-lines.js';

test('a heading goes on, and the SAME level takes it off', () => {
  assert.deepEqual(toggleHeading(['Title'], 2), ['## Title']);
  assert.deepEqual(toggleHeading(['## Title'], 2), ['Title']);
});

test('a different level REPLACES, it does not stack', () => {
  // `## # Title` renders as a heading, so stacking looks fine until you read the source.
  assert.deepEqual(toggleHeading(['# Title'], 2), ['## Title']);
  assert.deepEqual(toggleHeading(['###### Deep'], 1), ['# Deep']);
});

test('a bullet goes on and off, and never doubles', () => {
  assert.deepEqual(toggleBullet(['one', 'two']), ['- one', '- two']);
  assert.deepEqual(toggleBullet(['- one', '- two']), ['one', 'two']);
  assert.deepEqual(toggleBullet(toggleBullet(['one'])), ['one'], 'twice is a no-op');
});

test('a MIXED selection picks one answer instead of inverting each line', () => {
  // Inverting per line leaves half a list, which is the state nobody asked for.
  assert.deepEqual(toggleBullet(['- one', 'two']), ['- one', '- two']);
  assert.deepEqual(toggleHeading(['## a', 'b'], 2), ['## a', '## b']);
});

test('markers never land on top of each other', () => {
  assert.deepEqual(toggleBullet(['## Title']), ['- Title'], 'the heading mark is removed first');
  assert.deepEqual(toggleHeading(['- item'], 3), ['### item']);
  assert.deepEqual(toggleOrdered(['- item']), ['1. item']);
});

test('a numbered list counts from one, so a re-ordered selection is not left wrong', () => {
  assert.deepEqual(toggleOrdered(['a', 'b', 'c']), ['1. a', '2. b', '3. c']);
  assert.deepEqual(toggleOrdered(['7. a', '9. b']), ['a', 'b'], 'and off again regardless of the numbers');
});

test('a quote takes the blank lines with it', () => {
  // A blockquote that skips its blank line is TWO blockquotes with a gap — not what was
  // selected, and it looks different.
  assert.deepEqual(toggleQuote(['one', '', 'two']), ['> one', '>', '> two']);
  assert.deepEqual(toggleQuote(['> one', '>', '> two']), ['one', '', 'two']);
});

test('indentation is preserved, because it means nesting', () => {
  assert.deepEqual(toggleBullet(['    deep']), ['    - deep']);
  assert.deepEqual(toggleHeading(['  x'], 1), ['  # x']);
});

test('blank lines are left alone by the list and heading toggles', () => {
  assert.deepEqual(toggleBullet(['a', '', 'b']), ['- a', '', '- b']);
  assert.deepEqual(toggleHeading(['a', '', 'b'], 2), ['## a', '', '## b']);
});

test('an empty selection does nothing rather than marking an empty line', () => {
  assert.deepEqual(toggleBullet(['']), ['']);
  assert.deepEqual(toggleHeading([''], 2), ['']);
});

test('the selection grows to whole lines', () => {
  // Applying a line transform to "the selected characters" would put `- ` in the middle of a
  // word: the user selected some text and meant the lines it sits on.
  const v = 'first line\nsecond line\nthird line';
  const mid = v.indexOf('cond');
  const r = expandToLines(v, mid, mid + 4);
  assert.deepEqual(r.lines, ['second line']);
  assert.equal(v.slice(r.start, r.end), 'second line');
});

test('a selection spanning two lines expands to both, and the last line has no newline', () => {
  const v = 'a\nb\nc';
  const r = expandToLines(v, 0, 3);
  assert.deepEqual(r.lines, ['a', 'b']);
  const last = expandToLines(v, 4, 5);
  assert.deepEqual(last.lines, ['c']);
  assert.equal(last.end, v.length);
});
