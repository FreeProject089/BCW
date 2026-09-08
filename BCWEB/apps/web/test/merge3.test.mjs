// The 3-way merge behind concurrent editing.
//
// This is the module where a bug loses somebody's writing. Every other failure in the editor
// shows up as something looking wrong; this one shows up as a paragraph that is simply not
// there any more, in a document that saved successfully, and the person who wrote it finds
// out days later if at all.
//
// So the tests are about what SURVIVES, not about what the algorithm does.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { merge3, merge3Hunks, assembleHunks, hasConflictMarkers, diffLines, lineStat } from '../src/lib/merge3.js';

const L = (...xs) => xs.join('\n');

describe('merge3 — non-overlapping edits merge with nobody losing anything', () => {
  test('two edits in different places both survive', () => {
    const base = L('a', 'b', 'c');
    const mine = L('A', 'b', 'c');
    const theirs = L('a', 'b', 'C');
    const r = merge3(base, mine, theirs);
    assert.equal(r.conflicts, 0);
    assert.equal(r.text, L('A', 'b', 'C'));
  });

  test('one side untouched means the other side wins outright', () => {
    const base = L('a', 'b');
    assert.equal(merge3(base, base, L('a', 'B')).text, L('a', 'B'));
    assert.equal(merge3(base, L('A', 'b'), base).text, L('A', 'b'));
  });

  test('the SAME edit made twice is not a conflict', () => {
    // Two people fixing the same typo the same way is the commonest collision there is, and
    // a merge that flagged it would teach people to click through conflict dialogs.
    const r = merge3(L('a', 'typo', 'c'), L('a', 'fixed', 'c'), L('a', 'fixed', 'c'));
    assert.equal(r.conflicts, 0);
    assert.equal(r.text, L('a', 'fixed', 'c'));
  });

  test('an insertion by each side, in different places, keeps both', () => {
    const r = merge3(L('a', 'b'), L('a', 'mine', 'b'), L('a', 'b', 'theirs'));
    assert.equal(r.conflicts, 0);
    assert.equal(r.text, L('a', 'mine', 'b', 'theirs'));
  });

  test('a deletion on one side and an untouched other side deletes', () => {
    const r = merge3(L('a', 'b', 'c'), L('a', 'c'), L('a', 'b', 'c'));
    assert.equal(r.conflicts, 0);
    assert.equal(r.text, L('a', 'c'));
  });
});

describe('merge3 — genuine collisions are marked, never guessed', () => {
  test('two different edits to the same line conflict, and BOTH texts are in the output', () => {
    const r = merge3(L('a', 'b', 'c'), L('a', 'MINE', 'c'), L('a', 'THEIRS', 'c'));
    assert.equal(r.conflicts, 1);
    assert.ok(r.text.includes('MINE'), 'my line must still be there');
    assert.ok(r.text.includes('THEIRS'), 'their line must still be there');
    assert.ok(hasConflictMarkers(r.text), 'and it must be detectable as unresolved');
  });

  test('the labels reach the markers, so the reader knows which half is whose', () => {
    const r = merge3('a', 'b', 'c', { mine: 'your draft', theirs: 'Ada' });
    assert.ok(r.text.includes('<<<<<<< your draft'));
    assert.ok(r.text.includes('>>>>>>> Ada'));
  });

  test('hasConflictMarkers only fires on a marker at the START of a line', () => {
    // A document about git that quotes "<<<<<<<" mid-sentence is not an unresolved merge, and
    // refusing to save it would be a bug in the guard rather than in the document.
    assert.equal(hasConflictMarkers('a line mentioning <<<<<<< in passing'), false);
    assert.equal(hasConflictMarkers(L('ok', '======= ')), false, 'the separator is a whole line');
    assert.equal(hasConflictMarkers(L('ok', '=======')), true);
  });
});

describe('merge3Hunks / assembleHunks', () => {
  const base = L('keep', 'old', 'tail');
  const mine = L('keep', 'MINE', 'tail');
  const theirs = L('keep', 'THEIRS', 'tail');

  test('a conflict becomes one hunk carrying all three versions', () => {
    const { hunks, conflicts } = merge3Hunks(base, mine, theirs);
    assert.equal(conflicts, 1);
    const c = hunks.find((h) => h.type === 'conflict');
    assert.deepEqual(c.mine, ['MINE']);
    assert.deepEqual(c.theirs, ['THEIRS']);
    assert.deepEqual(c.base, ['old'], 'the ancestor rides along so the UI can show what changed');
  });

  test('each choice assembles the text it names', () => {
    const { hunks } = merge3Hunks(base, mine, theirs);
    const i = hunks.findIndex((h) => h.type === 'conflict');
    assert.equal(assembleHunks(hunks, { [i]: 'mine' }), L('keep', 'MINE', 'tail'));
    assert.equal(assembleHunks(hunks, { [i]: 'theirs' }), L('keep', 'THEIRS', 'tail'));
    assert.equal(assembleHunks(hunks, { [i]: 'both' }), L('keep', 'MINE', 'THEIRS', 'tail'));
    assert.equal(assembleHunks(hunks, { [i]: 'theirs-mine' }), L('keep', 'THEIRS', 'MINE', 'tail'));
  });

  test('a hand-edited hunk wins over any preset choice', () => {
    const { hunks } = merge3Hunks(base, mine, theirs);
    const i = hunks.findIndex((h) => h.type === 'conflict');
    assert.equal(assembleHunks(hunks, { [i]: { lines: ['BOTH REWRITTEN'] } }), L('keep', 'BOTH REWRITTEN', 'tail'));
  });

  test('AN UNRESOLVED HUNK KEEPS BOTH SIDES, marked — it must never vanish', () => {
    // This is the one that matters. The modal disables Apply until every conflict is
    // resolved, so today nothing calls this with a gap — and that means one `disabled`
    // attribute is the only thing between a partial resolution and silently deleting both
    // people's text. Dropping it is unrecoverable; emitting markers is ugly and recoverable,
    // and `hasConflictMarkers` already exists to catch it before a save.
    const { hunks } = merge3Hunks(base, mine, theirs);
    const out = assembleHunks(hunks, {});
    assert.ok(out.includes('MINE'), 'my text must survive an unresolved hunk');
    assert.ok(out.includes('THEIRS'), 'their text must survive an unresolved hunk');
    assert.ok(hasConflictMarkers(out), 'and the result must be detectable as unresolved');
  });

  test('common hunks coalesce, so the UI is not a hundred one-line blocks', () => {
    const { hunks } = merge3Hunks(L('a', 'b', 'c'), L('a', 'b', 'c'), L('a', 'b', 'c'));
    assert.equal(hunks.length, 1);
    assert.deepEqual(hunks[0], { type: 'common', lines: ['a', 'b', 'c'] });
  });
});

describe('diffLines and lineStat', () => {
  test('a diff keeps every line of both sides, tagged', () => {
    const d = diffLines(L('a', 'b'), L('a', 'c'));
    assert.deepEqual(d, [
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'c' },
    ]);
  });

  test('an unchanged text is all "same" and counts as nothing', () => {
    assert.deepEqual(lineStat(L('a', 'b'), L('a', 'b')), { added: 0, removed: 0 });
  });

  test('a moved line counts once, not twice', () => {
    // The LCS is what makes this true; a naive line-set diff would report 0/0 for a
    // reordering, and a naive positional diff would report every line after the move.
    assert.deepEqual(lineStat(L('a', 'b', 'c'), L('b', 'c', 'a')), { added: 1, removed: 1 });
  });

  test('empty against empty is one same line, not a crash', () => {
    assert.deepEqual(lineStat('', ''), { added: 0, removed: 0 });
    assert.deepEqual(diffLines('', ''), [{ type: 'same', text: '' }]);
  });

  test('null and undefined are read as empty text', () => {
    assert.deepEqual(lineStat(null, undefined), { added: 0, removed: 0 });
    assert.equal(merge3(null, null, null).text, '');
  });
});
