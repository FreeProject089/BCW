// Visibility decides whether a poll meant for nobody shows up on the front page, so the
// things worth proving are that it fails CLOSED and that a link never buys a place in a list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayViewPoll, mayListPoll, listWhere, shareKeyFor, newShareKey, POLL_VISIBILITIES } from '../src/lib/poll-visibility.mjs';

const poll = (over = {}) => ({ status: 'open', visibility: 'public', shareKey: '', ...over });

test('a public poll is listed and openable by anybody', () => {
    assert.equal(mayViewPoll(poll()), true);
    assert.equal(mayListPoll(poll()), true);
});

test('a draft is neither listed nor openable, whatever its visibility', () => {
    for (const visibility of POLL_VISIBILITIES) {
        const d = poll({ status: 'draft', visibility });
        assert.equal(mayViewPoll(d), false, visibility);
        assert.equal(mayListPoll(d), false, visibility);
    }
});

test('an unlisted poll opens with its key and not without', () => {
    const p = poll({ visibility: 'unlisted', shareKey: 'sekret' });
    assert.equal(mayViewPoll(p, { key: 'sekret' }), true);
    assert.equal(mayViewPoll(p, { key: 'wrong' }), false);
    assert.equal(mayViewPoll(p, { key: null }), false);
});

test('an unlisted poll with NO key set is not openable by an empty key', () => {
    // The bug this guards: `key === poll.shareKey` with both empty is true, which would make
    // every unlisted poll that never got a key readable by anyone who left ?k= off.
    const p = poll({ visibility: 'unlisted', shareKey: '' });
    assert.equal(mayViewPoll(p, { key: '' }), false);
    assert.equal(mayViewPoll(p, { key: null }), false);
});

test('a link never buys a place in a listing', () => {
    // mayListPoll takes no key on purpose — if holding one key listed the others, one shared
    // link would enumerate everything unlisted.
    const p = poll({ visibility: 'unlisted', shareKey: 'sekret' });
    assert.equal(mayListPoll(p), false);
    assert.equal(mayViewPoll(p, { key: 'sekret' }), true);
});

test('a private poll opens for nobody but staff, key or no key', () => {
    const p = poll({ visibility: 'private', shareKey: 'sekret' });
    assert.equal(mayViewPoll(p, { key: 'sekret' }), false);
    assert.equal(mayViewPoll(p), false);
    assert.equal(mayListPoll(p), false);
    assert.equal(mayViewPoll(p, { role: 'ADMIN' }), true);
});

test('staff see everything, including drafts', () => {
    for (const role of ['MOD', 'ADMIN', 'SUPERADMIN']) {
        assert.equal(mayViewPoll(poll({ status: 'draft', visibility: 'private' }), { role }), true, role);
    }
    assert.equal(mayViewPoll(poll({ status: 'draft' }), { role: 'USER' }), false);
});

test('drafts stay out of a list unless staff explicitly asks for them', () => {
    const d = poll({ status: 'draft' });
    assert.equal(mayListPoll(d, { role: 'ADMIN' }), false);
    assert.equal(mayListPoll(d, { role: 'ADMIN', includeDrafts: true }), true);
    assert.equal(mayListPoll(d, { role: 'USER', includeDrafts: true }), false);
});

test('an unknown visibility fails closed', () => {
    // A value that is not one of the three is a bug somewhere upstream. Treating it as public
    // would publish whatever that bug produced.
    const p = poll({ visibility: 'somethingelse' });
    assert.equal(mayViewPoll(p), false);
    assert.equal(mayListPoll(p), false);
});

test('the share key goes out to staff only, and only for unlisted polls', () => {
    const p = poll({ visibility: 'unlisted', shareKey: 'sekret' });
    assert.equal(shareKeyFor(p, { role: 'ADMIN' }), 'sekret');
    assert.equal(shareKeyFor(p, { role: 'USER' }), null);
    assert.equal(shareKeyFor(p), null);
    assert.equal(shareKeyFor(poll({ visibility: 'public', shareKey: 'sekret' }), { role: 'ADMIN' }), null);
});

test('generated keys are URL-safe and do not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newShareKey()));
    assert.equal(keys.size, 200);
    for (const k of keys) assert.match(k, /^[A-Za-z0-9_-]{20,}$/);
});

test('listWhere and mayListPoll agree on every combination', () => {
    // The point of this test: the SQL filter and the predicate are two statements of one rule,
    // and the failure mode when they drift is a poll appearing in a list that says it should
    // not be there. So every sample is run through both.
    const matches = (where, p) => {
        if (where.status && !where.status.in.includes(p.status)) return false;
        if (where.visibility && p.visibility !== where.visibility) return false;
        return true;
    };
    const samples = [];
    for (const status of ['draft', 'open', 'closed']) {
        for (const visibility of [...POLL_VISIBILITIES, 'somethingelse']) {
            samples.push({ status, visibility, shareKey: 'k' });
        }
    }
    for (const role of [null, 'USER', 'MOD', 'ADMIN']) {
        for (const includeDrafts of [false, true]) {
            const where = listWhere({ role, includeDrafts });
            for (const p of samples) {
                assert.equal(
                    matches(where, p), mayListPoll(p, { role, includeDrafts }),
                    `role=${role} drafts=${includeDrafts} status=${p.status} vis=${p.visibility}`,
                );
            }
        }
    }
});
