// Poll statistics.
//
// The test that matters most is voterCount on a multiple-choice poll. One person ticking
// three boxes writes three PollVote rows, so counting rows reports three voters — an
// overstatement that looks entirely plausible and makes every share below it wrong too.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { voterCount, optionTally, timeline, leadStrength, pollStats } from '../src/lib/poll-stats.mjs';

const OPTIONS = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }];
const v = (optionId, who, day = '01', extra = {}) => ({
  optionId,
  userId: who?.startsWith('u') ? who : null,
  voterKey: who?.startsWith('k') ? who : null,
  wasLoggedIn: !!who?.startsWith('u'),
  createdAt: `2026-08-${day}T10:00:00Z`,
  ...extra,
});

describe('voterCount', () => {
  test('one person ticking three boxes is ONE voter', () => {
    const votes = [v('a', 'u1'), v('b', 'u1'), v('c', 'u1')];
    assert.equal(voterCount(votes), 1);
    assert.equal(votes.length, 3, 'and three rows, which is why counting rows is wrong');
  });

  test('signed-in and anonymous voters are both counted, and not merged', () => {
    assert.equal(voterCount([v('a', 'u1'), v('a', 'k1'), v('b', 'k2')]), 3);
  });

  test('an anonymised vote from a closed account still counts', () => {
    // userId cleared on closure, voterKey never set. Dropping it would change a published
    // result after the fact; merging it with the other unattributed ones would under-count.
    const votes = [v('a', 'u1'), { ...v('b'), userId: null, voterKey: null }, { ...v('c'), userId: null, voterKey: null }];
    assert.equal(voterCount(votes), 3);
  });
});

describe('optionTally', () => {
  test('sorted by votes, with the label attached', () => {
    const t = optionTally(OPTIONS, [v('b', 'u1'), v('b', 'u2'), v('a', 'u3')]);
    assert.deepEqual(t.map((x) => [x.label, x.votes]), [['Beta', 2], ['Alpha', 1], ['Gamma', 0]]);
  });

  test('shares are of VOTERS, so on a multi-choice poll they exceed 100%', () => {
    // Deliberate. "62% of people picked this" is the true statement; normalising to sum to
    // 100 would answer a question nobody asked.
    const t = optionTally(OPTIONS, [v('a', 'u1'), v('b', 'u1'), v('a', 'u2')]);
    const total = t.reduce((n, x) => n + x.shareOfVoters, 0);
    assert.ok(total > 100, `expected >100, got ${total}`);
    assert.equal(t.find((x) => x.label === 'Alpha').shareOfVoters, 100);
  });

  test('an option nobody chose is present with zero, not missing', () => {
    // A missing row reads as "no such option" instead of "nobody wanted it".
    assert.equal(optionTally(OPTIONS, [v('a', 'u1')]).find((x) => x.label === 'Gamma').votes, 0);
  });

  test('a vote for an option that no longer exists does not invent one', () => {
    assert.equal(optionTally(OPTIONS, [v('deleted', 'u1')]).length, 3);
  });
});

describe('timeline', () => {
  test('one entry per day, oldest first', () => {
    const t = timeline([v('a', 'u1', '03'), v('a', 'u2', '01'), v('b', 'u3', '01')]);
    assert.deepEqual(t, [{ day: '2026-08-01', votes: 2 }, { day: '2026-08-03', votes: 1 }]);
  });
});

describe('leadStrength', () => {
  const tally = (x, y) => [{ label: 'A', votes: x }, { label: 'B', votes: y }];

  test('a small poll is not a result, however lopsided', () => {
    // 3–1 is not an answer, and showing it beside a four-thousand-vote poll as though both
    // are is how a poll gets quoted.
    assert.deepEqual(leadStrength(tally(3, 1), 4), { decided: false, reason: 'too_few_voters', voters: 4, margin: 2 });
  });

  test('a big poll with a thin margin is not a result either', () => {
    assert.equal(leadStrength(tally(102, 100), 202).decided, false);
    assert.equal(leadStrength(tally(102, 100), 202).reason, 'too_close');
  });

  test('a clear lead on enough voters is', () => {
    const r = leadStrength(tally(160, 40), 200);
    assert.equal(r.decided, true);
    assert.equal(r.winner, 'A');
  });

  test('a single option is never a verdict', () => {
    assert.equal(leadStrength([{ label: 'A', votes: 9 }], 9).decided, false);
  });
});

describe('pollStats', () => {
  const poll = { id: 'p1', question: 'Which?', status: 'open', multiple: true };

  test('picksPerVoter is the gap between people and ticks', () => {
    const s = pollStats(poll, OPTIONS, [v('a', 'u1'), v('b', 'u1'), v('a', 'u2')], new Date('2026-08-02T10:00:00Z'));
    assert.equal(s.counts.voters, 2);
    assert.equal(s.counts.votes, 3);
    assert.equal(s.counts.picksPerVoter, 1.5);
  });

  test('quietDays says a poll is finished whatever its status claims', () => {
    const s = pollStats(poll, OPTIONS, [v('a', 'u1', '01')], new Date('2026-08-20T10:00:00Z'));
    assert.equal(s.quietDays, 19);
    assert.equal(s.status, 'open', 'still open, and dead for nineteen days');
  });

  test('a poll with no votes does not divide by zero or claim a winner', () => {
    const s = pollStats(poll, OPTIONS, [], new Date());
    assert.equal(s.counts.voters, 0);
    assert.equal(s.counts.picksPerVoter, 0);
    assert.equal(s.quietDays, null);
    assert.equal(s.lead.decided, false);
    assert.equal(s.tally.every((x) => x.shareOfVoters === 0), true);
  });
});
