// Per-question statistics on the multi-question shape.
//
// The tests that matter count PEOPLE. A multi-choice question produces several rows for one
// person, so anything counting rows reports a turnout that is simply larger than the number of
// humans involved — and it is the turnout figure that gets quoted.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { numericSummary, completion, questionStats, rankingSummary, gridSummary } from '../src/lib/poll-stats.mjs';

const ans = (over) => ({ questionId: 'q1', userId: null, voterKey: null, ...over });

describe('numericSummary', () => {
    test('reports the median beside the mean', () => {
        // One long answer drags a mean and leaves the median where the answers are. A mean
        // alone is what gets quoted, which is why both ship.
        const s = numericSummary([1, 1, 2, 100].map((n) => ans({ number: n })));
        assert.equal(s.mean, 26);
        assert.equal(s.median, 1.5);
    });

    test('min, max and the distribution come back', () => {
        const s = numericSummary([3, 5, 3].map((n) => ans({ number: n })));
        assert.equal(s.min, 3);
        assert.equal(s.max, 5);
        assert.deepEqual(s.distribution, { 3: 2, 5: 1 });
    });

    test('no numeric answers is count 0, not NaN', () => {
        // A NaN mean renders as "NaN" on the admin screen and reads as a broken page.
        assert.deepEqual(numericSummary([]), { count: 0 });
        assert.deepEqual(numericSummary([ans({ text: 'hi' })]), { count: 0 });
    });

    test('zero is a value, not a missing answer', () => {
        assert.equal(numericSummary([ans({ number: 0 })]).count, 1);
    });
});

describe('completion', () => {
    const qs = [{ id: 'q1', required: true }, { id: 'q2', required: true }, { id: 'q3', required: false }];

    test('counts people, not rows', () => {
        // One person answering a multi-choice question writes several rows.
        const answers = [
            ans({ questionId: 'q1', userId: 'u1' }), ans({ questionId: 'q1', userId: 'u1' }),
            ans({ questionId: 'q2', userId: 'u1' }),
        ];
        assert.deepEqual(completion(qs, answers), { started: 1, completed: 1, rate: 1 });
    });

    test('someone who skipped a required question started but did not complete', () => {
        const answers = [ans({ questionId: 'q1', userId: 'u1' })];
        const c = completion(qs, answers);
        assert.equal(c.started, 1);
        assert.equal(c.completed, 0);
    });

    test('an optional question is not needed to complete', () => {
        const answers = [ans({ questionId: 'q1', userId: 'u1' }), ans({ questionId: 'q2', userId: 'u1' })];
        assert.equal(completion(qs, answers).completed, 1);
    });

    test('an anonymised answer counts as started, never as completed', () => {
        // It cannot be joined to its siblings, so claiming it finished would overstate the
        // rate. Undercounting is the honest direction here.
        const answers = [ans({ questionId: 'q1' }), ans({ questionId: 'q2' })];
        const c = completion(qs, answers);
        assert.equal(c.completed, 0);
        assert.ok(c.started > 0);
    });

    test('no required questions means everyone who started finished', () => {
        const c = completion([{ id: 'q1', required: false }], [ans({ userId: 'u1' })]);
        assert.deepEqual(c, { started: 1, completed: 1, rate: 1 });
    });

    test('no answers is a rate of 0, not a division by zero', () => {
        assert.deepEqual(completion(qs, []), { started: 0, completed: 0, rate: 0 });
    });
});

describe('questionStats', () => {
    test('a choice question tallies and judges its lead', () => {
        const answers = Array.from({ length: 30 }, (_, i) =>
            ans({ questionId: 'q1', userId: `u${i}`, choiceId: i < 25 ? 'c1' : 'c2' }));
        const s = questionStats({ id: 'q1', kind: 'choice', label: 'Which?' }, answers,
            [{ id: 'c1', label: 'Forge' }, { id: 'c2', label: 'Fabric' }]);
        assert.equal(s.voters, 30);
        assert.equal(s.lead.decided, true);
        assert.equal(s.lead.winner, 'Forge');
    });

    test('a small choice question refuses to call a winner', () => {
        // Fewer than 20 voters is a room, not a sample — the same rule the legacy stats use,
        // reached through the same function rather than a second copy of the threshold.
        const answers = [ans({ userId: 'u1', choiceId: 'c1' }), ans({ userId: 'u2', choiceId: 'c2' })];
        const s = questionStats({ id: 'q1', kind: 'choice', label: 'x' }, answers,
            [{ id: 'c1', label: 'A' }, { id: 'c2', label: 'B' }]);
        assert.equal(s.lead.decided, false);
    });

    test('text is counted, never aggregated into a top answer', () => {
        // Picking a "most common" free-text answer invents a consensus out of writing.
        const s = questionStats({ id: 'q1', kind: 'text', label: 'Why?' },
            [ans({ text: 'because' }), ans({ text: '' })]);
        assert.equal(s.answered, 1);
        assert.equal('tally' in s, false);
    });

    test('answers to OTHER questions are excluded', () => {
        const s = questionStats({ id: 'q1', kind: 'number', label: 'n' },
            [ans({ questionId: 'q1', number: 4 }), ans({ questionId: 'q2', number: 100 })]);
        assert.equal(s.numeric.count, 1);
        assert.equal(s.numeric.mean, 4);
    });

    test('a date question reports its range', () => {
        const s = questionStats({ id: 'q1', kind: 'date', label: 'when' },
            [ans({ date: '2026-03-02' }), ans({ date: '2026-01-05' })]);
        assert.equal(s.answered, 2);
        assert.equal(s.earliest.toISOString().slice(0, 10), '2026-01-05');
        assert.equal(s.latest.toISOString().slice(0, 10), '2026-03-02');
    });

    test('ranking and grid are named, not left to the date branch', () => {
        // THE ONE. Neither matches a branch above, so both fell to the date parser at the
        // bottom and reported `answered: 0` — the question shown as unanswered on the stats
        // screen while its rows sat in the table.
        const cs = [{ id: 'c1', label: 'A' }, { id: 'c2', label: 'B' }];
        const rk = questionStats({ id: 'q1', kind: 'ranking', label: 'order' },
            [ans({ choiceId: 'c1', number: 1 }), ans({ choiceId: 'c2', number: 2 })], cs);
        assert.ok(rk.ranking, 'a ranking reports ranks');
        assert.equal('earliest' in rk, false);

        const gd = questionStats({ id: 'q1', kind: 'grid', label: 'rate', config: { rows: ['Speed'] } },
            [ans({ choiceId: 'c1', slot: 0 })], cs);
        assert.ok(gd.grid, 'a grid reports rows');
        assert.equal('earliest' in gd, false);
    });
});

describe('rankingSummary', () => {
    const cs = [{ id: 'c1', label: 'Forge' }, { id: 'c2', label: 'Fabric' }];

    test('consistent second place beats erratic first place', () => {
        // The whole reason this is a mean and not a count of first places: Fabric is first for
        // one person and last for two; Forge is second for everybody. Forge is the better
        // answer and only the average says so.
        const rows = [
            ans({ userId: 'u1', choiceId: 'c2', number: 1 }), ans({ userId: 'u1', choiceId: 'c1', number: 2 }),
            ans({ userId: 'u2', choiceId: 'c1', number: 1 }), ans({ userId: 'u2', choiceId: 'c2', number: 2 }),
            ans({ userId: 'u3', choiceId: 'c1', number: 1 }), ans({ userId: 'u3', choiceId: 'c2', number: 2 }),
        ];
        const s = rankingSummary(cs, rows);
        assert.equal(s[0].label, 'Forge');
        assert.equal(Math.round(s[0].averageRank * 100) / 100, 1.33);
        assert.equal(s[0].count, 3);
    });

    test('an item nobody ranked sorts last rather than winning with no number', () => {
        const s = rankingSummary(cs, [ans({ choiceId: 'c2', number: 3 })]);
        assert.equal(s[0].label, 'Fabric');
        assert.equal(s[1].averageRank, null);
        assert.equal(s[1].count, 0);
    });

    test('a rank from another question is ignored', () => {
        assert.equal(rankingSummary(cs, [ans({ choiceId: 'stranger', number: 1 })])[0].count, 0);
    });
});

describe('gridSummary', () => {
    const cs = [{ id: 'c1', label: 'Good' }, { id: 'c2', label: 'Bad' }];

    test('each row is tallied separately, and rows come from the config', () => {
        // Rows from the config, not the answers: a row nobody filled must appear with zero.
        // Missing and unanimously-skipped look identical in the data and are different facts.
        const s = gridSummary(['Speed', 'Docs', 'Price'], cs, [
            ans({ userId: 'u1', choiceId: 'c1', slot: 0 }), ans({ userId: 'u1', choiceId: 'c2', slot: 1 }),
            ans({ userId: 'u2', choiceId: 'c1', slot: 0 }),
        ]);
        assert.equal(s.length, 3);
        assert.equal(s[0].label, 'Speed');
        assert.equal(s[0].tally.find((t) => t.label === 'Good').votes, 2);
        assert.equal(s[1].tally.find((t) => t.label === 'Bad').votes, 1);
        assert.equal(s[2].voters, 0, 'a row nobody answered is still shown');
    });

    test('one person picking the same column for two rows counts once per row', () => {
        // The case that forced PollAnswer.slot to exist. Both rows are that person's real
        // answer; neither is a duplicate of the other.
        const s = gridSummary(['Speed', 'Docs'], cs, [
            ans({ userId: 'u1', choiceId: 'c1', slot: 0 }), ans({ userId: 'u1', choiceId: 'c1', slot: 1 }),
        ]);
        assert.equal(s[0].tally.find((t) => t.label === 'Good').votes, 1);
        assert.equal(s[1].tally.find((t) => t.label === 'Good').votes, 1);
    });
});
