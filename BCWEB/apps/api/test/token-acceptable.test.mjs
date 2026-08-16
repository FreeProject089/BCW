// Two things a valid signature does not tell you, both found on a real cookie.
//
// A SUPERADMIN token turned up in a browser carrying no `sid`. A token without one cannot be
// revoked by anything — not "sign out this device", not closing the account, not a password
// change; it works until it expires. And the guards read `cur.role || claims.role`, so a uid
// whose account no longer exists kept the role baked into its token at sign-in: a deleted
// admin was a permanent admin.
//
// Both are now refused. These tests are over the pure predicate, so they run without a
// database — the guards themselves add the account lock and the session lookup around it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tokenAcceptable } from '../src/lib/lib.mjs';

const LIVE = { role: 'USER', perms: [], exists: true };
const GONE = { role: null, perms: [], exists: false };
const UNKNOWN = { role: null, perms: [], exists: null };   // the lookup itself failed

describe('tokenAcceptable', () => {
    test('a normal token is accepted', () => {
        assert.equal(tokenAcceptable({ uid: 'u', sid: 's', role: 'USER' }, LIVE).ok, true);
    });

    test('THE ONE: no sid is refused, whatever the role says', () => {
        // The grace for tokens predating the sessions panel expired by construction: they live
        // seven days and the feature is far older. What is left is unrevocable tokens.
        const r = tokenAcceptable({ uid: 'u', role: 'SUPERADMIN' }, LIVE);
        assert.equal(r.ok, false);
        assert.equal(r.error, 'session_revoked', 'the client should treat it as a dead session, not a login failure');
    });

    test('THE OTHER ONE: a token for an account that no longer exists is refused', () => {
        const r = tokenAcceptable({ uid: 'ghost', sid: 's', role: 'SUPERADMIN' }, GONE);
        assert.equal(r.ok, false);
        assert.equal(r.error, 'session_revoked');
    });

    test('a failed lookup is NOT treated as a deleted account', () => {
        // `exists: null` means the database could not be asked. Signing every visitor out
        // during a blip would turn a hiccup into an outage, and sessionRevoked already makes
        // the same call for the same reason.
        assert.equal(tokenAcceptable({ uid: 'u', sid: 's', role: 'ADMIN' }, UNKNOWN).ok, true);
    });

    test('no claims at all is unauthenticated, not revoked', () => {
        // Different answer on purpose: "you were never signed in" and "your session ended" are
        // different things to show somebody.
        assert.equal(tokenAcceptable(null, LIVE).error, 'unauthenticated');
        assert.equal(tokenAcceptable({}, LIVE).error, 'unauthenticated');
        assert.equal(tokenAcceptable({ sid: 's' }, LIVE).error, 'unauthenticated', 'a sid with no uid identifies nobody');
    });

    test('an empty-string sid does not count as one', () => {
        assert.equal(tokenAcceptable({ uid: 'u', sid: '', role: 'USER' }, LIVE).ok, false);
    });

    test('a missing `cur` is not a crash', () => {
        // The guards always pass one, but a predicate that throws inside a try/catch would
        // become a blanket 401 with no explanation.
        assert.equal(tokenAcceptable({ uid: 'u', sid: 's' }, undefined).ok, true);
    });
});
