// Who sees the tally, and who may answer.
//
// The tests that matter are the ones about NOT showing numbers. A poll that leaks its running
// total before people vote steers the vote, and a `staff` poll that answers to the public has
// published something the owner marked private. Neither throws; both just quietly happen.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { maySeeResults, canVote, viewPoll, viewMyAnswers } from '../src/lib/poll-view.mjs';

const poll = (over = {}) => ({
    id: 'p1', question: 'Which loader?', description: '', status: 'open', audience: 'all',
    multiple: false, maxChoices: 0, results: 'after_vote', pinned: false, questions: [], ...over,
});

describe('maySeeResults', () => {
    test('after_vote hides the tally until you have voted', () => {
        assert.equal(maySeeResults(poll(), { hasVoted: false }), false);
        assert.equal(maySeeResults(poll(), { hasVoted: true }), true);
    });

    test('staff-only hides it from everybody else, even after they vote', () => {
        // The one that would silently publish a number the owner marked private.
        assert.equal(maySeeResults(poll({ results: 'staff' }), { hasVoted: true }), false);
        assert.equal(maySeeResults(poll({ results: 'staff' }), { isStaff: true }), true);
    });

    test('always shows it to anyone', () => {
        assert.equal(maySeeResults(poll({ results: 'always' }), {}), true);
    });

    test('a closed poll shows its result to someone who never voted', () => {
        // Withholding the result of a poll nobody can answer any more protects nothing and
        // reads as broken.
        assert.equal(maySeeResults(poll({ status: 'closed' }), { hasVoted: false }), true);
    });

    test('a closed staff-only poll still stays staff-only', () => {
        assert.equal(maySeeResults(poll({ status: 'closed', results: 'staff' }), {}), false);
    });

    test('an unknown rule falls back to after_vote, not to open', () => {
        // A typo in the column must not publish the numbers.
        assert.equal(maySeeResults(poll({ results: 'wat' }), { hasVoted: false }), false);
    });
});

describe('canVote', () => {
    const T = (s) => new Date(s);

    test('only an open poll accepts answers', () => {
        for (const status of ['draft', 'closed']) {
            assert.equal(canVote(poll({ status }), {}), false, status);
        }
        assert.equal(canVote(poll(), {}), true);
    });

    test('a schedule is respected at both ends', () => {
        const p = poll({ opensAt: T('2026-01-02'), closesAt: T('2026-01-04') });
        assert.equal(canVote(p, {}, T('2026-01-01')), false, 'before opensAt');
        assert.equal(canVote(p, {}, T('2026-01-03')), true, 'inside');
        assert.equal(canVote(p, {}, T('2026-01-05')), false, 'after closesAt');
    });

    test('closesAt is exclusive — the closing instant is closed', () => {
        const p = poll({ closesAt: T('2026-01-04T00:00:00Z') });
        assert.equal(canVote(p, {}, T('2026-01-04T00:00:00Z')), false);
    });

    test('audience "users" turns away anonymous voters', () => {
        assert.equal(canVote(poll({ audience: 'users' }), {}), false);
        assert.equal(canVote(poll({ audience: 'users' }), { userId: 'u1' }), true);
        assert.equal(canVote(poll({ audience: 'all' }), {}), true);
    });

    test('having voted ends it, whatever else is true', () => {
        assert.equal(canVote(poll({ audience: 'all' }), { hasVoted: true }), false);
    });
});

describe('viewPoll', () => {
    const withQuestions = poll({
        questions: [
            { id: 'q2', kind: 'text', label: 'Why?', sort: 1, choices: [] },
            { id: 'q1', kind: 'choice', label: 'Which?', sort: 0, choices: [
                { id: 'c2', label: 'Fabric', sort: 1 }, { id: 'c1', label: 'Forge', sort: 0 },
            ] },
        ],
    });

    test('questions and choices come back in sort order, not insertion order', () => {
        const v = viewPoll(withQuestions, { hasVoted: false });
        assert.deepEqual(v.questions.map((q) => q.id), ['q1', 'q2']);
        assert.deepEqual(v.questions[0].choices.map((c) => c.id), ['c1', 'c2']);
    });

    test('the tally is OMITTED, not zeroed, when it may not be shown', () => {
        // Zeros are a claim — "nobody has voted" — and a client renders a false result rather
        // than no result.
        const v = viewPoll(withQuestions, { hasVoted: false }, { c1: 5, c2: 3 });
        assert.equal('tally' in v, false);
        assert.equal(v.showResults, false);
    });

    test('the tally is included once it may be shown', () => {
        const v = viewPoll(withQuestions, { hasVoted: true }, { c1: 5, c2: 3 });
        assert.deepEqual(v.tally, { c1: 5, c2: 3 });
    });

    test('it is an allowlist — an unexpected column does not reach the client', () => {
        // A new field is invisible until somebody adds it on purpose, which is the direction
        // to fail in.
        const v = viewPoll(poll({ internalNote: 'staff eyes only', createdById: 'u9' }), {});
        assert.equal('internalNote' in v, false);
        assert.equal('createdById' in v, false);
    });

    test('a question does not leak anything beyond its declared shape', () => {
        const v = viewPoll(poll({ questions: [{ id: 'q1', kind: 'choice', label: 'x', secret: 'no', choices: [] }] }), {});
        assert.equal('secret' in v.questions[0], false);
    });
});

describe('viewMyAnswers — the answers you already gave', () => {
    const q = (over) => ({ id: 'q', kind: 'choice', config: {}, ...over });
    const row = (over) => ({ questionId: 'q', ...over });

    test('a single choice comes back as a bare id, a multiple one as a list', () => {
        // The renderer branches on exactly that, so a second interpretation here would drift.
        assert.equal(viewMyAnswers([q()], [row({ choiceId: 'a' })]).q, 'a');
        assert.deepEqual(
            viewMyAnswers([q({ config: { multiple: true } })], [row({ choiceId: 'a' }), row({ choiceId: 'b' })]).q,
            ['a', 'b'],
        );
    });

    test('a ranking comes back in RANK order, not row order', () => {
        // The database returns rows in whatever order it likes; the rank is in the data.
        const rows = [row({ choiceId: 'c', number: 3 }), row({ choiceId: 'a', number: 1 }), row({ choiceId: 'b', number: 2 })];
        assert.deepEqual(viewMyAnswers([q({ kind: 'ranking' })], rows).q, ['a', 'b', 'c']);
    });

    test('a grid comes back keyed by row, which is what the picker holds', () => {
        const rows = [row({ choiceId: 'good', slot: 0 }), row({ choiceId: 'bad', slot: 1 })];
        assert.deepEqual(viewMyAnswers([q({ kind: 'grid' })], rows).q, { 0: 'good', 1: 'bad' });
    });

    test('a date comes back as the yyyy-mm-dd an <input type=date> needs', () => {
        const r = viewMyAnswers([q({ kind: 'date' })], [row({ date: new Date('2026-08-16T10:00:00Z') })]);
        assert.equal(r.q, '2026-08-16');
    });

    test('a question with no answer is ABSENT, not empty', () => {
        // Absent means "you have not answered this"; an empty string is an answer somebody
        // gave. The form pre-fills from this map and the difference is visible on screen.
        assert.deepEqual(viewMyAnswers([q(), q({ id: 'q2', kind: 'text' })], [row({ choiceId: 'a' })]), { q: 'a' });
    });

    test('a note contributes nothing — it cannot be answered', () => {
        assert.deepEqual(viewMyAnswers([q({ kind: 'note' })], [row({ text: 'x' })]), {});
    });

    test('nothing at all is an empty map rather than a crash', () => {
        assert.deepEqual(viewMyAnswers(null, null), {});
        assert.deepEqual(viewMyAnswers([q()], []), {});
    });
});
