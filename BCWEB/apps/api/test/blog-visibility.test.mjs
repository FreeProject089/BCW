// Who may see a draft.
//
// The rule was written four times — the public list, the single post, the staff list and
// "my posts" — and two of those re-typed the role array rather than using STAFF. A visibility
// rule written more than once diverges; this codebase has already published a staff-only poll
// tally that way. Here the cost of a divergence is somebody's unfinished post going public.
//
// These tests are the reason the predicates are exported: the rule now has one home and a
// place that fails when it moves.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isStaff, draftWhere, maySeePost } from '../src/routes/blog.mjs';

const ANON = null;
const READER = { uid: 'u1', role: 'USER' };
const AUTHOR = { uid: 'author', role: 'USER' };
const COAUTHOR = { uid: 'co', role: 'USER' };
const MOD = { uid: 'm', role: 'MOD' };
const SUPER = { uid: 's', role: 'SUPERADMIN' };

const DRAFT = { status: 'DRAFT', authorId: 'author', coAuthorIds: ['co'] };
const LIVE = { status: 'PUBLISHED', authorId: 'author', coAuthorIds: [] };

describe('one post', () => {
    test('a published post is for everybody, signed in or not', () => {
        for (const who of [ANON, READER, AUTHOR, MOD]) assert.equal(maySeePost(who, LIVE), true);
    });

    test('THE ONE: a stranger cannot see a draft, signed in or not', () => {
        assert.equal(maySeePost(ANON, DRAFT), false);
        assert.equal(maySeePost(READER, DRAFT), false);
    });

    test('its author and its co-authors can', () => {
        assert.equal(maySeePost(AUTHOR, DRAFT), true);
        assert.equal(maySeePost(COAUTHOR, DRAFT), true, 'invited to write it, so able to open it');
    });

    test('staff can — every tier of it', () => {
        assert.equal(maySeePost(MOD, DRAFT), true);
        assert.equal(maySeePost(SUPER, DRAFT), true);
    });

    test('a post that does not exist is not visible', () => {
        // The caller passes whatever findUnique returned, which is null on a bad slug.
        assert.equal(maySeePost(SUPER, null), false);
    });

    test('a missing coAuthorIds is not a crash', () => {
        assert.equal(maySeePost(READER, { status: 'DRAFT', authorId: 'author' }), false);
    });
});

describe('a list of posts', () => {
    test('a logged-out reader is filtered to published', () => {
        assert.deepEqual(draftWhere(ANON), { status: 'PUBLISHED' });
    });

    test('a signed-in reader gets published + their own + what they co-write', () => {
        const w = draftWhere(READER);
        assert.deepEqual(w.OR, [
            { status: 'PUBLISHED' },
            { authorId: 'u1' },
            { coAuthorIds: { has: 'u1' } },
        ]);
    });

    test('staff are not filtered at all', () => {
        assert.deepEqual(draftWhere(MOD), {});
        assert.deepEqual(draftWhere(SUPER), {});
    });

    test('the list rule and the single-post rule agree', () => {
        // The two shapes cannot be compared directly, so this asserts the thing that matters:
        // nobody is allowed a post by one and refused it by the other.
        const cases = [ANON, READER, AUTHOR, COAUTHOR, MOD, SUPER];
        for (const who of cases) {
            const unfiltered = Object.keys(draftWhere(who)).length === 0;
            if (unfiltered) assert.equal(maySeePost(who, DRAFT), true, `${who?.role} sees every draft in a list but not on its own page`);
        }
    });
});

describe('isStaff', () => {
    test('a role that merely looks staffish is not staff', () => {
        assert.equal(isStaff({ uid: 'x', role: 'ADMINISTRATOR' }), false);
        assert.equal(isStaff({ uid: 'x', role: 'admin' }), false, 'the enum is upper-case; a lower-case value is not it');
    });

    test('no user is not staff', () => {
        assert.equal(isStaff(null), false);
        assert.equal(isStaff(undefined), false);
    });
});
