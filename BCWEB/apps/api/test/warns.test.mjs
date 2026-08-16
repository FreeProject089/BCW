// What a count of warnings is worth.
//
// The failure modes here are not crashes — they are a moderation log nobody can defend. A
// member banned because one warning fired three rules at once, or re-banned every time a
// fourth warning is added, is a decision that cannot be explained to the person it happened to.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { actionFor, normalizeThresholds, warnMessage, DEFAULT_THRESHOLDS } from '../src/lib/warns.mjs';

const LADDER = [
    { count: 3, action: 'timeout', minutes: 60 },
    { count: 5, action: 'kick' },
    { count: 7, action: 'ban' },
];

describe('actionFor', () => {
    test('most warnings trigger nothing, and that is the normal case', () => {
        for (const n of [1, 2, 4, 6, 8, 20]) assert.equal(actionFor(n, LADDER), null, `warning ${n}`);
    });

    test('the warning that crosses a line triggers that line', () => {
        assert.deepEqual(actionFor(3, LADDER), { kind: 'timeout', minutes: 60, at: 3 });
        assert.deepEqual(actionFor(5, LADDER), { kind: 'kick', minutes: null, at: 5 });
        assert.deepEqual(actionFor(7, LADDER), { kind: 'ban', minutes: null, at: 7 });
    });

    test('THE ONE: reaching five does not also fire the three-warning rule', () => {
        // With `>=`, one warning would issue a timeout AND a kick AND a ban, and whichever
        // Discord executed last would be the outcome.
        const a = actionFor(5, LADDER);
        assert.equal(a.kind, 'kick');
        assert.notEqual(a.kind, 'timeout');
    });

    test('THE OTHER ONE: a count past a threshold does not fire it again', () => {
        // Otherwise every warning after the third re-times-out the member, for ever.
        assert.equal(actionFor(4, LADDER), null);
        assert.equal(actionFor(6, LADDER), null);
    });

    test('a threshold that only warns does nothing', () => {
        assert.equal(actionFor(2, [{ count: 2, action: 'warn' }]), null,
            'the rule exists so it can be written down and disabled without deleting it');
    });

    test('a timeout with no duration still has one', () => {
        // A timeout of null minutes is not a timeout; Discord would refuse it.
        assert.equal(actionFor(3, [{ count: 3, action: 'timeout' }]).minutes, 60);
    });

    test('no configured ladder uses the built-in one', () => {
        assert.deepEqual(actionFor(3, []), actionFor(3, DEFAULT_THRESHOLDS));
    });

    test('nonsense counts trigger nothing rather than throwing', () => {
        for (const n of [0, -1, NaN, null, undefined, 'three']) assert.equal(actionFor(n, LADDER), null);
    });
});

describe('normalizeThresholds', () => {
    test('an unknown action is dropped, not carried', () => {
        // Carried, it would sit in the admin screen looking like a rule and do nothing.
        assert.deepEqual(normalizeThresholds([{ count: 3, action: 'explode' }]), []);
    });

    test('a count below one is dropped', () => {
        // It would fire on every warning ever issued.
        assert.deepEqual(normalizeThresholds([{ count: 0, action: 'ban' }]), []);
    });

    test('the ladder comes back most severe first', () => {
        const r = normalizeThresholds([{ count: 5, action: 'kick' }, { count: 3, action: 'timeout' }]);
        assert.deepEqual(r.map((t) => t.count), [5, 3]);
    });

    test('strings from a form are read as numbers', () => {
        const r = normalizeThresholds([{ count: '3', action: 'TIMEOUT', minutes: '30' }]);
        assert.deepEqual(r, [{ count: 3, action: 'timeout', minutes: 30 }]);
    });

    test('rubbish in is an empty ladder, not a crash', () => {
        for (const bad of [null, undefined, 'nope', 42, [{}], [null]]) {
            assert.deepEqual(normalizeThresholds(bad), []);
        }
    });
});

describe('warnMessage', () => {
    test('the first warning does not quote a total at somebody', () => {
        assert.equal(warnMessage(1, 'spam', null), 'You have been warned. Reason: spam');
    });

    test('a later one says where they stand', () => {
        assert.match(warnMessage(4, 'spam', null), /4 warnings/);
    });

    test('when it triggers something, it says what and why', () => {
        const m = warnMessage(3, 'spam', { kind: 'timeout', minutes: 60, at: 3 });
        assert.match(m, /warning 3/);
        assert.match(m, /timed out for 60 minute/);
    });

    test('no reason is not the word "undefined"', () => {
        assert.ok(!warnMessage(1, '', null).includes('undefined'));
        assert.ok(!warnMessage(1, null, null).includes('null'));
    });
});
