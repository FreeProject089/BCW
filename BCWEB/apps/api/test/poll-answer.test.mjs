// The vote endpoint is where a poll takes untrusted input, so these are the rules that must
// hold even when the client is lying, old, or somebody else's script.
//
// The tests that matter most are the two silent-acceptance ones: a choice id borrowed from
// ANOTHER question is a real row, and Number('') is 0. Both would record an answer nobody gave,
// under a question nobody answered, with nothing in any log to say so.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswer, maxAnswers, COLUMN_FOR_KIND, scaleStyle } from '../src/lib/poll-answer.mjs';

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

    test('every kind maps to exactly one column', () => {
        const cols = Object.values(COLUMN_FOR_KIND);
        assert.equal(cols.length, 5);
        assert.equal(new Set(cols).size, 4, 'scale and number share the number column, the rest are distinct');
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
