// What people actually paste into "Build it from a repository".
//
// The field was validated with zod's `.url()` and then matched against a strict regex, so a
// bare `github.com/owner/repo` and a copied `…/repo?tab=readme-ov-file` both failed — the first
// as `invalid_request`, which the screen rendered as "Could not read that." That message is the
// only one that tells you nothing about what to change.
//
// The normaliser lives in the route; this is its rule, kept honest here. Both are the same two
// lines, deliberately: a test that re-implemented them would agree with itself for ever.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const GH_REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+))?\/?$/i;

/** The same normalisation the route applies before matching. */
function normalize(raw) {
    let u = String(raw).trim();
    u = u.split('#')[0].split('?')[0];
    if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
    return u.replace(/\/+$/, '');
}

const accepts = (raw) => GH_REPO_RE.test(normalize(raw));

describe('a pasted repository address', () => {
    test('the plain form works', () => {
        assert.ok(accepts('https://github.com/sindresorhus/got'));
    });

    test('THE ONE: no scheme — what people type from memory', () => {
        assert.ok(accepts('github.com/sindresorhus/got'));
        assert.ok(accepts('www.github.com/sindresorhus/got'));
    });

    test('THE OTHER ONE: what the browser copies', () => {
        // GitHub's own copy button and address bar add this.
        assert.ok(accepts('https://github.com/sindresorhus/got?tab=readme-ov-file'));
        assert.ok(accepts('https://github.com/sindresorhus/got#readme'));
    });

    test('a trailing slash, a .git suffix, stray whitespace', () => {
        assert.ok(accepts('https://github.com/sindresorhus/got/'));
        assert.ok(accepts('https://github.com/sindresorhus/got.git'));
        assert.ok(accepts('  https://github.com/sindresorhus/got  '));
    });

    test('a branch link still names its branch', () => {
        const m = normalize('https://github.com/owner/repo/tree/dev').match(GH_REPO_RE);
        assert.equal(m?.[3], 'dev', 'the ref is what makes a branch link worth accepting');
    });

    test('what must still be refused', () => {
        // Refusal is not a failure here — it is the message that names the problem.
        assert.ok(!accepts('https://github.com/sindresorhus'), 'a user, not a repository');
        assert.ok(!accepts('https://gitlab.com/owner/repo'), 'another host');
        assert.ok(!accepts('not a url at all'), 'a space is not part of any repository name');
        assert.ok(!accepts('https://github.com/owner/repo/issues/12'), 'a page inside the repo, not the repo');
    });
});
