// The publication gate decides whether an unvouched account can appear in an OFFICIAL
// catalogue, so the two things worth proving are that it lets the right people through and
// that it fails CLOSED when it does not understand the question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirementFor, hasProjectLink, PROJECT_LINK } from '../src/lib/project-link.mjs';

/** A Prisma stand-in: only creatorLink.count is ever consulted. */
const db = (creatorLinks) => ({ creatorLink: { count: async () => creatorLinks } });

test('every ProjectKey is declared, so a missing one is a decision and not an oversight', () => {
    for (const key of ['community', 'bmm', 'bsm', 'installer', 'developers']) {
        assert.ok(key in PROJECT_LINK, `${key} is not declared`);
    }
});

test('bmm needs a creator link', async () => {
    assert.equal(requirementFor('bmm').link, 'creator');
    assert.equal((await hasProjectLink(db(0), 'u1', 'bmm')).ok, false);
    assert.equal((await hasProjectLink(db(1), 'u1', 'bmm')).ok, true);
});

test('a refusal carries the reason, so the owner is told what to do', async () => {
    const r = await hasProjectLink(db(0), 'u1', 'bmm');
    assert.equal(r.ok, false);
    assert.match(r.why, /creator id/i);
});

test('projects that ask for nothing let everyone through, linked or not', async () => {
    for (const key of ['community', 'bsm', 'installer', 'developers']) {
        assert.equal((await hasProjectLink(db(0), 'u1', key)).ok, true, `${key} should not gate`);
    }
});

test('an unknown project key asks for nothing rather than throwing', async () => {
    assert.equal((await hasProjectLink(db(0), 'u1', 'not-a-project')).ok, true);
});

test('an unrecognised requirement FAILS CLOSED', async () => {
    // The dangerous direction is the other one. If somebody adds `bsm: { link: "steam" }`
    // and forgets the branch that checks it, this must refuse — an unvouched listing in an
    // official catalogue is exactly what the gate exists to prevent, and "allowed by default"
    // would ship that silently.
    const saved = PROJECT_LINK.bsm;
    PROJECT_LINK.bsm = { link: 'a-link-nobody-implemented', why: 'something' };
    try {
        assert.equal((await hasProjectLink(db(99), 'u1', 'bsm')).ok, false);
    } finally {
        PROJECT_LINK.bsm = saved;
    }
});
