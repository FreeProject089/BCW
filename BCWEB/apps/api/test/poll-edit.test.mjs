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

// Until this existed the update branch wrote label/kind/config and never touched choices, so a
// typo in an option was fixable only by deleting the question — and its answers with it.
describe('planQuestionUpdate — choices', () => {
    const withChoices = [{ id: 'q1', kind: 'choice', choices: [{ id: 'c1', label: 'A' }, { id: 'c2', label: 'B' }] }];
    const plan1 = (r) => r.choicePlan.find((c) => c.questionId === 'q1');

    test('renaming an option updates it in place, keeping its answers', () => {
        const r = planQuestionUpdate(withChoices, [{ id: 'q1', kind: 'choice', choices: [{ id: 'c1', label: 'Renamed' }, { id: 'c2', label: 'B' }] }], { q1: 40 });
        assert.equal(r.ok, true);
        assert.equal(r.answersLost, 0, 'a rename destroys nothing');
        assert.deepEqual(plan1(r).update, [{ id: 'c1', label: 'Renamed', sort: 0 }, { id: 'c2', label: 'B', sort: 1 }]);
        assert.deepEqual(plan1(r).removeIds, []);
    });

    test('an option with no id is created, and its sort is its position', () => {
        const r = planQuestionUpdate(withChoices, [{ id: 'q1', kind: 'choice', choices: [{ id: 'c1', label: 'A' }, { label: 'New' }, { id: 'c2', label: 'B' }] }], {});
        assert.deepEqual(plan1(r).create, [{ label: 'New', sort: 1 }]);
        assert.deepEqual(plan1(r).update.map((c) => c.sort), [0, 2]);
    });

    test('deleting an option that holds answers is refused, and names the OPTION', () => {
        // THE ONE this half exists for. The question survives, so the old plan saw no loss and
        // the delete went through with a 200 — answers gone, nothing said.
        const r = planQuestionUpdate(withChoices, [{ id: 'q1', kind: 'choice', choices: [{ id: 'c1', label: 'A' }] }],
            { q1: 40 }, { choiceAnswerCounts: { c2: 7 } });
        assert.equal(r.ok, false);
        assert.equal(r.answersLost, 7, 'the option, not the whole question');
        assert.deepEqual(r.choices, [{ questionId: 'q1', choiceId: 'c2', label: 'B', answers: 7 }]);
        assert.deepEqual(r.questions, [], 'no question is being destroyed');
    });

    test('deleting an option nobody picked needs no confirmation', () => {
        const r = planQuestionUpdate(withChoices, [{ id: 'q1', kind: 'choice', choices: [{ id: 'c1', label: 'A' }] }],
            { q1: 40 }, { choiceAnswerCounts: { c2: 0 } });
        assert.equal(r.ok, true);
        assert.deepEqual(plan1(r).removeIds, ['c2']);
    });

    test('a choice id from another question is refused, force or not', () => {
        for (const opts of [{}, { force: true }]) {
            const r = planQuestionUpdate(withChoices, [{ id: 'q1', kind: 'choice', choices: [{ id: 'c1', label: 'A' }, { id: 'stranger', label: 'X' }] }], {}, opts);
            assert.equal(r.error, 'unknown_choice');
            assert.deepEqual(r.ids, ['stranger']);
        }
    });

    test('a removed question does not have its options counted a second time', () => {
        // Its answers are already in the question total. Counting the options again would report
        // one deletion as twice the loss, and a warning nobody believes is a warning nobody reads.
        const r = planQuestionUpdate(withChoices, [], { q1: 7 }, { choiceAnswerCounts: { c1: 4, c2: 3 } });
        assert.equal(r.answersLost, 7);
        assert.deepEqual(r.choices, []);
    });

    test('a RETYPED question does not have its options counted a second time either', () => {
        const r = planQuestionUpdate(withChoices, [{ id: 'q1', kind: 'text', choices: [] }], { q1: 7 }, { choiceAnswerCounts: { c1: 4, c2: 3 } });
        assert.equal(r.answersLost, 7);
    });

    test('a question with no choices at all plans nothing for them', () => {
        const r = planQuestionUpdate([{ id: 'q1', kind: 'text' }], [{ id: 'q1', kind: 'text' }], {});
        assert.equal(r.ok, true);
        assert.deepEqual(plan1(r), { questionId: 'q1', removeIds: [], update: [], create: [] });
    });
});
