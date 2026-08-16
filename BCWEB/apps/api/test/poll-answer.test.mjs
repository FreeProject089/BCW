// The vote endpoint is where a poll takes untrusted input, so these are the rules that must
// hold even when the client is lying, old, or somebody else's script.
//
// The tests that matter most are the two silent-acceptance ones: a choice id borrowed from
// ANOTHER question is a real row, and Number('') is 0. Both would record an answer nobody gave,
// under a question nobody answered, with nothing in any log to say so.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswer, maxAnswers, COLUMN_FOR_KIND, scaleStyle, validateRanking, validateGrid, gridRows } from '../src/lib/poll-answer.mjs';

const q = (over = {}) => ({ kind: 'choice', required: false, config: {}, ...over });

describe('validateAnswer — blank', () => {
    test('a required question refuses a blank answer', () => {
        for (const blank of [undefined, null, '', '   ']) {
            assert.equal(validateAnswer(q({ required: true }), blank).ok, false, String(blank));
        }
    });

    test('an optional question accepts blank and stores NOTHING', () => {
        // null, not '' — "skipped" and "answered with nothing" are different facts, and the
        // completion funnel counts them differently.
        assert.deepEqual(validateAnswer(q(), ''), { ok: true, value: null, column: 'choiceId' });
    });

    test('zero is an answer, not a blank', () => {
        const r = validateAnswer(q({ kind: 'number', required: true }), 0);
        assert.equal(r.ok, true);
        assert.equal(r.value, 0);
    });
});

describe('validateAnswer — choice', () => {
    test('a choice from another question is refused', () => {
        // THE ONE. That id is a real row, so a check asking only "does this exist" accepts it
        // and files the answer under a question nobody answered.
        const r = validateAnswer(q(), 'choice_from_q2', ['a', 'b']);
        assert.deepEqual(r, { ok: false, error: 'unknown_choice' });
    });

    test('a choice of this question is accepted', () => {
        assert.deepEqual(validateAnswer(q(), 'b', ['a', 'b']), { ok: true, value: 'b', column: 'choiceId' });
    });
});

describe('validateAnswer — numbers', () => {
    test('things that Number() turns into 0 are refused', () => {
        // Number('') and Number([]) are both 0 and would sail through a bare isNaN check.
        for (const bad of ['abc', [], {}, 'NaN', Infinity]) {
            assert.equal(validateAnswer(q({ kind: 'number', required: true }), bad).ok, false, String(bad));
        }
    });

    test('min and max are enforced', () => {
        const scale = q({ kind: 'scale', config: { min: 1, max: 5 } });
        assert.equal(validateAnswer(scale, 0).error, 'below_min');
        assert.equal(validateAnswer(scale, 6).error, 'above_max');
        assert.equal(validateAnswer(scale, 3).ok, true);
    });

    test('a scale takes whole steps; a number does not have to', () => {
        assert.equal(validateAnswer(q({ kind: 'scale', config: { min: 1, max: 5 } }), 2.5).error, 'not_an_integer');
        assert.equal(validateAnswer(q({ kind: 'number' }), 2.5).ok, true);
    });

    test('a number lands in the number column, not text', () => {
        assert.equal(validateAnswer(q({ kind: 'number' }), 7).column, 'number');
    });
});

describe('validateAnswer — text and date', () => {
    test('over-long text is refused, never truncated', () => {
        // Truncating stores something the person did not write and shows it back as theirs.
        const r = validateAnswer(q({ kind: 'text', config: { maxLength: 5 } }), 'far too long');
        assert.deepEqual(r, { ok: false, error: 'too_long' });
    });

    test('text within the default cap is kept verbatim', () => {
        assert.deepEqual(validateAnswer(q({ kind: 'text' }), ' hi '), { ok: true, value: ' hi ', column: 'text' });
    });

    test('an unparseable date is refused', () => {
        assert.equal(validateAnswer(q({ kind: 'date' }), 'not a date').error, 'not_a_date');
    });

    test('a valid date becomes a Date in the date column', () => {
        const r = validateAnswer(q({ kind: 'date' }), '2026-08-16');
        assert.equal(r.ok, true);
        assert.ok(r.value instanceof Date);
        assert.equal(r.column, 'date');
    });
});

describe('kinds', () => {
    test('an unknown kind is refused rather than defaulted', () => {
        // Defaulting to choice would file a free-text answer as a choice id that matches
        // nothing, and the question would read as unanswered.
        assert.deepEqual(validateAnswer(q({ kind: 'wat' }), 'x'), { ok: false, error: 'unknown_kind' });
    });

    test('every kind maps to exactly one column, and ranking is the stated exception', () => {
        const cols = Object.values(COLUMN_FOR_KIND);
        assert.equal(cols.length, 7, 'choice, text, scale, number, date, ranking, grid');
        assert.equal(new Set(cols).size, 4, 'scale/number/ranking share number; choice/grid share choiceId');
        // A grid's VALUE is which column was picked — an fk, like a plain choice. What makes it
        // a grid is `slot` saying which row, and slot is not a value column.
        assert.equal(COLUMN_FOR_KIND.grid, 'choiceId');
        // Ranking writes choiceId AND number — the one row shape that carries both, documented
        // on PollAnswer in schema.prisma. Asserted here so the exception stays deliberate: if
        // somebody later "tidies" it into a single column, this line is what argues back.
        assert.equal(COLUMN_FOR_KIND.ranking, 'number');
    });
});

describe('maxAnswers', () => {
    test('only a choice question can take more than one', () => {
        for (const kind of ['text', 'scale', 'date', 'number']) {
            assert.equal(maxAnswers(q({ kind, config: { multiple: true, maxChoices: 3 } })), 1, kind);
        }
    });

    test('a single-choice question takes one even with a cap set', () => {
        assert.equal(maxAnswers(q({ config: { multiple: false, maxChoices: 3 } })), 1);
    });

    test('multiple with no cap is unlimited — 0 means no cap, as Poll.maxChoices always did', () => {
        assert.equal(maxAnswers(q({ config: { multiple: true, maxChoices: 0 } })), Infinity);
        assert.equal(maxAnswers(q({ config: { multiple: true } })), Infinity);
    });

    test('multiple with a cap returns the cap', () => {
        assert.equal(maxAnswers(q({ config: { multiple: true, maxChoices: 2 } })), 2);
    });
});

describe('scaleStyle — presentation, not a kind', () => {
    test('a declared style is used', () => {
        assert.equal(scaleStyle({ config: { style: 'stars' } }), 'stars');
        assert.equal(scaleStyle({ config: { style: 'buttons' } }), 'buttons');
    });

    test('anything unknown falls back to the plain number input', () => {
        // A renderer switching on this must always have a branch to take. An unknown style
        // that returned itself would draw nothing and the question would look broken rather
        // than plain.
        for (const bad of ['emoji', '', null, undefined, 42, {}]) {
            assert.equal(scaleStyle({ config: { style: bad } }), 'number', String(bad));
        }
    });

    test('a question with no config at all is safe', () => {
        assert.equal(scaleStyle({}), 'number');
        assert.equal(scaleStyle(null), 'number');
    });

    test('style does NOT change where the answer is stored', () => {
        // The whole reason this is config and not a kind: a starred scale and a numeric one
        // are the same answer in the same column, so the aggregate stays one aggregate.
        assert.equal(COLUMN_FOR_KIND.scale, 'number');
        assert.equal(validateAnswer({ kind: 'scale', config: { style: 'stars', min: 1, max: 5 } }, 4).column, 'number');
    });
});

describe('validateRanking', () => {
    const ids = ['a', 'b', 'c'];

    test('a full ordering becomes rows numbered from 1', () => {
        // From 1, not 0. A zero-based rank reads as "0th place" on every screen that shows it,
        // and somebody eventually adds 1 in one place and forgets in another.
        const r = validateRanking(['c', 'a', 'b'], ids);
        assert.deepEqual(r.rows, [
            { choiceId: 'c', number: 1 }, { choiceId: 'a', number: 2 }, { choiceId: 'b', number: 3 },
        ]);
    });

    test('a duplicate is refused', () => {
        // It would give one item two ranks and silently shift everything below it.
        assert.deepEqual(validateRanking(['a', 'a', 'b'], ids), { ok: false, error: 'duplicate_choice', choiceId: 'a' });
    });

    test('an id from another question is refused', () => {
        assert.equal(validateRanking(['a', 'b', 'zz'], ids).error, 'unknown_choice');
    });

    test('a partial ranking is refused, and says by how much', () => {
        // Averaging ranks across submissions that ranked different subsets compares numbers
        // that do not mean the same thing.
        const r = validateRanking(['a', 'b'], ids);
        assert.equal(r.error, 'incomplete_ranking');
        assert.equal(r.expected, 3);
        assert.equal(r.got, 2);
    });

    test('empty is allowed when optional, refused when required', () => {
        assert.deepEqual(validateRanking([], ids), { ok: true, rows: [] });
        assert.equal(validateRanking([], ids, { required: true }).error, 'required');
        assert.equal(validateRanking(null, ids, { required: true }).error, 'required');
    });

    test('validateAnswer refuses a ranking instead of parsing it as a date', () => {
        // THE ONE. `ranking` resolves a column, so it passed the unknown-kind check and fell
        // through every branch to the date parser at the bottom — a whole answer type mangled
        // by the default case, silently.
        assert.deepEqual(validateAnswer({ kind: 'ranking' }, 'a'), { ok: false, error: 'use_validate_ranking' });
    });
});

describe('validateGrid', () => {
    const cols = ['bad', 'ok', 'good'];
    const g = (over = {}) => ({ kind: 'grid', required: false, config: { rows: ['Speed', 'Docs'] }, ...over });
    const pick = (row, choiceId) => ({ row, choiceId });

    test('a full grid becomes rows carrying column AND row', () => {
        const r = validateGrid([pick(0, 'good'), pick(1, 'ok')], g(), cols);
        assert.deepEqual(r.rows, [
            { choiceId: 'good', slot: 0 }, { choiceId: 'ok', slot: 1 },
        ]);
    });

    test('the row goes in slot, NOT in number', () => {
        // THE ONE that cost a migration. The unique key is (question, voter, choice, slot); a
        // row index parked in `number` is invisible to it, so "Speed: good, Docs: good" — the
        // normal case — reads as one voter picking `good` twice, and createMany's
        // skipDuplicates drops the second silently.
        const r = validateGrid([pick(0, 'good'), pick(1, 'good')], g(), cols);
        assert.equal(r.ok, true);
        assert.deepEqual(r.rows.map((x) => x.slot), [0, 1]);
        assert.ok(r.rows.every((x) => x.number === undefined), 'number stays free for the kinds that use it');
    });

    test('the row index is zero-based, unlike a rank', () => {
        // Deliberately different from validateRanking, which starts at 1. A rank is shown to
        // people ("1st"); a row index is an offset into config.rows and is never displayed.
        assert.equal(validateGrid([pick(0, 'ok')], g({ config: { rows: ['Speed'] } }), cols).rows[0].slot, 0);
    });

    test('the same row twice is refused', () => {
        // One of the two would silently win, decided by insertion order at write time.
        const r = validateGrid([pick(0, 'ok'), pick(0, 'good')], g(), cols);
        assert.deepEqual(r, { ok: false, error: 'duplicate_row', row: 0 });
    });

    test('a row past the end is refused', () => {
        assert.equal(validateGrid([pick(2, 'ok')], g(), cols).error, 'unknown_row');
        assert.equal(validateGrid([pick(-1, 'ok')], g(), cols).error, 'unknown_row');
    });

    test('a row that is not a whole number is refused before the range check', () => {
        // THE ONE for grids. NaN < rows.length is false, so a bare range check lets NaN — and
        // therefore undefined, '', {} — through as a row index and writes number: NaN.
        for (const bad of [1.5, 'x', undefined, null, {}, []]) {
            const r = validateGrid([{ row: bad, choiceId: 'ok' }], g(), cols);
            assert.equal(r.error, 'bad_row', String(bad));
        }
    });

    test('a column from another question is refused, and says which row', () => {
        const r = validateGrid([pick(0, 'ok'), pick(1, 'col_from_q2')], g(), cols);
        assert.deepEqual(r, { ok: false, error: 'unknown_choice', choiceId: 'col_from_q2', row: 1 });
    });

    test('a required grid wants every row; an optional one does not', () => {
        assert.equal(validateGrid([pick(0, 'ok')], g({ required: true }), cols).error, 'incomplete_grid');
        assert.equal(validateGrid([pick(0, 'ok')], g(), cols).ok, true);
    });

    test('requireAllRows overrides required, in both directions', () => {
        const half = [pick(0, 'ok')];
        assert.equal(validateGrid(half, g({ required: true, config: { rows: ['Speed', 'Docs'], requireAllRows: false } }), cols).ok, true);
        assert.equal(validateGrid(half, g({ config: { rows: ['Speed', 'Docs'], requireAllRows: true } }), cols).error, 'incomplete_grid');
    });

    test('empty is allowed when optional, refused when required', () => {
        assert.deepEqual(validateGrid([], g(), cols), { ok: true, rows: [] });
        assert.equal(validateGrid([], g({ required: true }), cols).error, 'required');
        assert.equal(validateGrid(null, g({ required: true }), cols).error, 'required');
    });

    test('answering a grid that has no rows is refused, not stored', () => {
        // The rows would be unreadable: `number` would point into a list that is not there.
        assert.equal(validateGrid([pick(0, 'ok')], g({ config: {} }), cols).error, 'no_rows');
    });

    test('gridRows drops blanks and anything that is not a list', () => {
        assert.deepEqual(gridRows({ config: { rows: ['a', '', '  ', 'b'] } }), ['a', 'b']);
        for (const bad of [undefined, null, 'a,b', 42, {}]) {
            assert.deepEqual(gridRows({ config: { rows: bad } }), [], String(bad));
        }
    });

    test('validateAnswer refuses a grid instead of parsing it as a date', () => {
        assert.deepEqual(validateAnswer({ kind: 'grid' }, 'a'), { ok: false, error: 'use_validate_grid' });
    });
});
