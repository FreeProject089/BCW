// The staff-only note on a sanction.
//
// One test here is the point of the whole feature: `internalNote` must never reach the person
// the sanction is about. Both serializers are allowlists today, so it is safe by
// construction — and "safe by construction" lasts exactly until somebody replaces an
// allowlist with a spread to save six lines. That change would leak staff notes to their
// subjects with a 200 and no error, so it gets a test rather than a comment.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { serSanctionForUser } from '../src/lib/sanctions.mjs';

/** A row as Prisma would hand it back, with every field populated. */
const ROW = {
  id: 'snc_1',
  code: 'SNC-1234-5678',
  kind: 'suspension',
  scope: 'account',
  status: 'active',
  reason: 'Repeated spam in the catalogue.',
  internalNote: 'Third account from 203.0.113.7 — see SNC-4821. Do not quote.',
  request: 'Remove the listings.',
  requiresAction: true,
  targetType: null,
  targetName: null,
  issuedAt: new Date('2026-08-01T00:00:00Z'),
  expiresAt: new Date('2026-09-01T00:00:00Z'),
  liftedAt: null,
  liftReason: null,
  contestedAt: null,
  contestBody: null,
  contestOutcome: null,
  contestAnswer: null,
  contestAnsweredAt: null,
  userId: 'u_1',
  issuedById: 'u_mod',
  meta: { cancelledSubs: [], keptSubs: [] },
  edits: [{ at: 'x', byId: 'u_mod', field: 'reason', from: 'a', to: 'b' }],
};

describe('serSanctionForUser', () => {
  test('NEVER carries the internal note', () => {
    const out = serSanctionForUser(ROW);
    assert.equal('internalNote' in out, false, 'the key must not exist at all');
    assert.equal(JSON.stringify(out).includes('203.0.113.7'), false, 'and its contents must not appear anywhere');
  });

  test('still carries the reason, which IS the person\'s to read', () => {
    // The distinction the field exists for: `reason` is quoted in the e-mail and comes back
    // in any contest, so it must be something you would defend to the reader. The note is
    // what could not go there.
    assert.equal(serSanctionForUser(ROW).reason, 'Repeated spam in the catalogue.');
  });

  test('leaks no staff-only field at all', () => {
    // The wider rule, so the next staff-only field added to the model is caught here too
    // rather than after it has been sent.
    const out = serSanctionForUser(ROW);
    for (const k of ['internalNote', 'issuedById', 'userId', 'edits', 'id']) {
      assert.equal(k in out, false, `${k} must not reach the subject`);
    }
  });

  test('an absent note does not become the string "undefined"', () => {
    const { internalNote, ...without } = ROW;
    assert.doesNotThrow(() => serSanctionForUser(without));
    assert.equal('internalNote' in serSanctionForUser(without), false);
  });
});
