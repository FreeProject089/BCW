// When Discord should be told that something is waiting.
//
// The whole value of this feature is in when it stays QUIET. A channel that repeats "3 things
// waiting" every ten minutes is a channel people mute, and a muted channel is worse than none —
// it looks like coverage while providing none.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { attentionDigest, QUIET_MS } from '../src/lib/attention.mjs';

const NOW = new Date('2026-08-16T12:00:00Z').getTime();
const ago = (ms) => new Date(NOW - ms).toISOString();

describe('attentionDigest', () => {
    test('nothing waiting says nothing', () => {
        assert.equal(attentionDigest({ submissions: 0, reports: 0 }, null, NOW), null);
        assert.equal(attentionDigest({}, null, NOW), null);
    });

    test('the first thing to arrive is announced', () => {
        const d = attentionDigest({ submissions: 1 }, null, NOW);
        assert.equal(d.title, 'One thing is waiting');
        assert.equal(d.body, '1 submission awaiting review');
    });

    test('THE ONE: a number that has not moved is not news', () => {
        const last = { at: ago(3 * QUIET_MS), counts: { submissions: 3 } };
        assert.equal(attentionDigest({ submissions: 3 }, last, NOW), null,
            'the work is still there; saying so again teaches everybody to ignore the channel');
    });

    test('work that shrank is not news either', () => {
        const last = { at: ago(3 * QUIET_MS), counts: { submissions: 5 } };
        assert.equal(attentionDigest({ submissions: 2 }, last, NOW), null);
    });

    test('one queue growing while another shrinks IS news', () => {
        // The total never moved. Three reports closed and three submissions arrived is exactly
        // the case a total-based check would miss.
        const last = { at: ago(3 * QUIET_MS), counts: { reports: 3, submissions: 0 } };
        const d = attentionDigest({ reports: 0, submissions: 3 }, last, NOW);
        assert.ok(d, 'per-queue, not per-total');
        assert.equal(d.body, '3 submissions awaiting review', 'the plural belongs to the noun, not the end of the phrase');
    });

    test('a burst does not produce a burst', () => {
        const last = { at: ago(5 * 60 * 1000), counts: { submissions: 1 } };
        assert.equal(attentionDigest({ submissions: 9 }, last, NOW), null, 'inside the quiet window');
        const older = { at: ago(QUIET_MS + 1000), counts: { submissions: 1 } };
        assert.ok(attentionDigest({ submissions: 9 }, older, NOW), 'past it, the growth is announced');
    });

    test('urgent means a clock is running', () => {
        // A legal deadline, somebody locked out contesting a sanction, or the site itself.
        // Marking everything urgent marks nothing.
        assert.equal(attentionDigest({ submissions: 4 }, null, NOW).urgent, false);
        assert.equal(attentionDigest({ myo: 3 }, null, NOW).urgent, false);
        for (const k of ['dataRequests', 'contests', 'alerts']) {
            assert.equal(attentionDigest({ [k]: 1 }, null, NOW).urgent, true, k);
        }
    });

    test('every queue the badge counts has words', () => {
        // The list here is the one in misc.mjs. A key with no label used to print itself, and
        // "4 contests" is not a sentence anybody acts on.
        for (const k of ['dataRequests', 'submissions', 'reports', 'contact', 'myo', 'contests', 'alerts']) {
            const d = attentionDigest({ [k]: 2 }, null, NOW);
            // Not the raw key, and not the generic "<key> items" fallback either — both mean
            // nobody wrote words for this queue.
            const generic = `2 ${k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} items`;
            assert.notEqual(d.body, `2 ${k}`, `${k} rendered as its own key`);
            assert.notEqual(d.body, generic, `${k} has no words of its own`);
        }
    });

    test('an unlabelled queue still reads as English', () => {
        const d = attentionDigest({ someNewQueue: 2 }, null, NOW);
        assert.equal(d.body, '2 some new queue items');
    });

    test('several queues read as one line', () => {
        const d = attentionDigest({ dataRequests: 1, submissions: 2, reports: 1 }, null, NOW);
        assert.equal(d.total, 4);
        assert.match(d.body, /data request/);
        assert.match(d.body, /open report/);
        assert.equal(d.title, '4 things are waiting');
    });

    test('a queue that could not be read is absent, not zero', () => {
        // sweepAttention leaves an unreadable queue out of `counts` entirely. It must not then
        // read as "it went down to zero" and suppress the next real announcement.
        const last = { at: ago(3 * QUIET_MS), counts: { submissions: 2, reports: 1 } };
        const d = attentionDigest({ submissions: 5 }, last, NOW);
        assert.ok(d, 'submissions grew; the missing queue is simply not part of this digest');
        assert.equal(d.total, 5);
    });
});
