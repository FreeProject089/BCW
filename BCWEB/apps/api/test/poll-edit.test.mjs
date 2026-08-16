// Editing a poll's questions must not quietly destroy the answers.
//
// PollAnswer cascades from PollQuestion. Every test here is about the same thing: an edit that
// looks like housekeeping — remove a question, change its type — takes real responses with it,
// returns 200, and leaves nothing to restore from.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planQuestionUpdate } from '../src/lib/poll-edit.mjs';

const existing = [{ id: 'q1', kind: 'choice' }, { id: 'q2', kind: 'text' }];

describe('planQuestionUpdate', () => {
    test('an edit that loses nothing goes through', () => {
        const r = planQuestionUpdate(existing, [{ id: 'q1', kind: 'choice' }, { id: 'q2', kind: 'text' }], {});
        assert.equal(r.ok, true);
        assert.deepEqual(r.removedIds, []);
    });

    test('removing a question that has answers is refused by default', () => {
        const r = planQuestionUpdate(existing, [{ id: 'q1', kind: 'choice' }], { q2: 12 });
        assert.equal(r.ok, false);
        assert.equal(r.error, 'would_lose_answers');
        assert.equal(r.answersLost, 12);
    });

    test('the refusal NAMES the questions, it does not just count', () => {
        // "This deletes 12 answers" is a number to click past. Knowing WHICH question is a
        // decision.
        const r = planQuestionUpdate(existing, [{ id: 'q1', kind: 'choice' }], { q2: 12 });
        assert.deepEqual(r.questions, [{ id: 'q2', kind: 'text', answers: 12 }]);
    });

    test('removing a question with NO answers needs no confirmation', () => {
        const r = planQuestionUpdate(existing, [{ id: 'q1', kind: 'choice' }], { q2: 0 });
        assert.equal(r.ok, true);
        assert.deepEqual(r.removedIds, ['q2']);
    });

    test('force proceeds, and still reports what it cost', () => {
        const r = planQuestionUpdate(existing, [{ id: 'q1', kind: 'choice' }], { q2: 12 }, { force: true });
        assert.equal(r.ok, true);
        assert.equal(r.answersLost, 12);
    });

    test('changing a question KIND counts as destroying its answers', () => {
        // The value lives in a column chosen by kind. A text answer under a question that is
        // now a scale is not a wrong answer — it is a value in a column nothing will read
        // again. Keeping the id makes it look harmless, which is why it is tested.
        const r = planQuestionUpdate(existing, [{ id: 'q1', kind: 'choice' }, { id: 'q2', kind: 'scale' }], { q2: 5 });
        assert.equal(r.ok, false);
        assert.equal(r.answersLost, 5);
        assert.deepEqual(r.questions.map((q) => q.id), ['q2']);
    });

    test('an id the poll does not own is refused, never treated as new', () => {
        // Accepting it would move another poll's question, or let a caller choose an id.
        const r = planQuestionUpdate(existing, [{ id: 'someone_elses', kind: 'text' }], {});
        assert.equal(r.ok, false);
        assert.equal(r.error, 'unknown_question');
        assert.deepEqual(r.ids, ['someone_elses']);
    });

    test('a foreign id is refused even with force', () => {
        // force means "yes, delete my answers", not "yes, touch another poll".
        const r = planQuestionUpdate(existing, [{ id: 'nope', kind: 'text' }], {}, { force: true });
        assert.equal(r.error, 'unknown_question');
    });

    test('a question with no id is new and costs nothing', () => {
        const r = planQuestionUpdate(existing, [...existing, { kind: 'scale' }], { q1: 9, q2: 9 });
        assert.equal(r.ok, true);
        assert.equal(r.answersLost, 0);
    });

    test('order comes from the array, not from a sort the caller supplies', () => {
        // Two questions claiming sort 3 is a state the UI can produce and the reader cannot
        // resolve, so the submitted order is the truth.
        const r = planQuestionUpdate(existing, [
            { id: 'q2', kind: 'text', sort: 99 }, { id: 'q1', kind: 'choice', sort: 99 },
        ], {});
        assert.deepEqual(r.ordered.map((q) => [q.id, q.sort]), [['q2', 0], ['q1', 1]]);
    });

    test('emptying every question is refused while answers exist', () => {
        const r = planQuestionUpdate(existing, [], { q1: 3, q2: 4 });
        assert.equal(r.ok, false);
        assert.equal(r.answersLost, 7);
    });
});
