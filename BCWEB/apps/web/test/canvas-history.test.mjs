// Undo in a canvas editor.
//
// The interesting part is not the stack — it is the coalescing. A drag fires a state update
// on every pointer move, so without it one gesture becomes sixty undo entries and Ctrl+Z
// appears to do nothing. Tested here because "press undo and see" cannot tell you whether one
// press walked back a whole gesture or one frame of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistory, pushHistory, undo, redo, HISTORY_LIMIT, COALESCE_MS } from '../src/lib/canvas.js';

const S = (n) => ({ blocks: [{ id: 'b', x: n }] });   // a stand-in state, distinguishable by x

test('one gesture is one undo entry, however many frames it fired', () => {
  let h = emptyHistory();
  const before = S(0);
  // Sixty pointermoves, all part of "drag:b".
  for (let f = 0; f < 60; f++) h = pushHistory(h, S(f), 'drag:b', 1000 + f * 8);
  assert.equal(h.past.length, 1, 'sixty frames, one entry');
  assert.deepEqual(h.past[0], before, 'and it is the state from BEFORE the drag started');
});

test('a different gesture starts a new entry', () => {
  let h = emptyHistory();
  h = pushHistory(h, S(0), 'drag:a', 1000);
  h = pushHistory(h, S(1), 'drag:b', 1010);
  assert.equal(h.past.length, 2);
});

test('the window is IDLE time, not time since the gesture began', () => {
  // Sliding, deliberately. A fixed window from the first push would chop a slow ten-second
  // drag into fifteen undo entries — the exact problem coalescing exists to solve. What ends
  // a gesture is the author stopping, not the clock.
  let h = emptyHistory();
  let at = 1000;
  for (let i = 0; i < 20; i++) { at += COALESCE_MS - 50; h = pushHistory(h, S(i), 'type:b', at); }
  assert.equal(h.past.length, 1, 'still one gesture after 13 seconds of continuous editing');

  h = pushHistory(h, S(99), 'type:b', at + COALESCE_MS + 1);
  assert.equal(h.past.length, 2, 'went and made a coffee — a separate thing to undo');
});

test('a discrete action never coalesces', () => {
  // Adding two blocks in quick succession must be two undos, not one.
  let h = emptyHistory();
  h = pushHistory(h, S(0), null, 1000);
  h = pushHistory(h, S(1), null, 1001);
  assert.equal(h.past.length, 2);
});

test('undo walks back and redo walks forward', () => {
  let h = emptyHistory();
  h = pushHistory(h, S(0), null, 1);      // about to go to S(1)
  h = pushHistory(h, S(1), null, 2);      // about to go to S(2)
  const u1 = undo(h, S(2));
  assert.deepEqual(u1.value, S(1));
  const u2 = undo(u1.hist, u1.value);
  assert.deepEqual(u2.value, S(0));
  const r1 = redo(u2.hist, u2.value);
  assert.deepEqual(r1.value, S(1));
  const r2 = redo(r1.hist, r1.value);
  assert.deepEqual(r2.value, S(2), 'all the way back to where we started');
});

test('undo and redo report nothing to do rather than throwing', () => {
  assert.equal(undo(emptyHistory(), S(0)), null);
  assert.equal(redo(emptyHistory(), S(0)), null);
  assert.equal(undo(null, S(0)), null, 'a missing history is an empty one');
});

test('a new edit after an undo abandons the redo branch', () => {
  let h = emptyHistory();
  h = pushHistory(h, S(0), null, 1);
  const u = undo(h, S(1));
  assert.equal(u.hist.future.length, 1);
  const after = pushHistory(u.hist, u.value, null, 2);
  assert.equal(after.future.length, 0, 'the future being undone into no longer exists');
});

test('an edit right after an undo is its own entry, not a continuation', () => {
  // Otherwise undoing a drag and immediately nudging the block would coalesce into the
  // gesture that was just undone, and the next Ctrl+Z would jump two steps.
  let h = emptyHistory();
  h = pushHistory(h, S(0), 'drag:b', 1000);
  const u = undo(h, S(9));
  const after = pushHistory(u.hist, u.value, 'drag:b', 1001);
  assert.equal(after.past.length, 1, 'a fresh entry despite the same key and no pause');
});

test('history is bounded, and it is the OLDEST that goes', () => {
  let h = emptyHistory();
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = pushHistory(h, S(i), null, i);
  assert.equal(h.past.length, HISTORY_LIMIT);
  assert.deepEqual(h.past[h.past.length - 1], S(HISTORY_LIMIT + 9), 'the most recent is kept');
  assert.deepEqual(h.past[0], S(10), 'the oldest ten were dropped');
});
