// Erasing a person: what goes, what stays, and what stops the whole thing.
//
// This is the one operation here that cannot be undone, so the tests are weighted towards
// refusing rather than towards succeeding. The three that matter: a dry run must not write,
// a blocked relation must stop everything before anything is written, and a model on the
// KEEP list must survive.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildErasePlan, eraseUser, KEEP } from '../src/lib/user-erase.mjs';

const model = (name, fields) => ({ name, fields });
const rel = (name, fk) => ({ kind: 'object', type: 'User', name, relationFromFields: [fk] });
const scalar = (name, isRequired) => ({ kind: 'scalar', type: 'String', name, isRequired });

const DMMF = {
  datamodel: {
    models: [
      model('User', []),
      // Theirs.
      model('BlogComment', [rel('author', 'authorId'), scalar('authorId', true)]),
      model('ServerRepo', [rel('owner', 'ownerId'), scalar('ownerId', true)]),
      // Somebody else's, link nullable → detach.
      model('SubmissionComment', [rel('reviewer', 'reviewerId'), scalar('reviewerId', false)]),
      // Kept, not detached: the actor id is inside the audit HMAC (see lib.mjs auditHash).
      model('AuditLogEntry', [rel('actor', 'actorId'), scalar('actorId', false)]),
      // On the KEEP list.
      model('Payment', [rel('user', 'userId'), scalar('userId', true)]),
      model('Sanction', [rel('user', 'userId'), scalar('userId', true), rel('issuedBy', 'issuedById'), scalar('issuedById', false)]),
      // Somebody else's, link REQUIRED → cannot be detached, must not be silently left.
      model('Awkward', [rel('reviewer', 'reviewerId'), scalar('reviewerId', true)]),
    ],
  },
};

const planOf = (dmmf = DMMF) => Object.fromEntries(buildErasePlan(dmmf).map((e) => [`${e.model}.${e.fk}`, e.action]));

describe('buildErasePlan', () => {
  test('their own rows are deleted', () => {
    const p = planOf();
    assert.equal(p['BlogComment.authorId'], 'delete');
    assert.equal(p['ServerRepo.ownerId'], 'delete');
  });

  test('somebody else’s row is detached, not deleted', () => {
    // Deleting an audit entry because a moderator asked to be erased would remove the record
    // of decisions taken about OTHER people.
    assert.equal(planOf()['SubmissionComment.reviewerId'], 'detach');
  });

  test('the KEEP list wins over everything, including ownership', () => {
    // Payment.userId is `owned` by the same rule that deletes a blog comment. Keeping it is
    // a deliberate exception with a stated reason, not an accident of classification.
    const p = planOf();
    assert.equal(p['Payment.userId'], 'keep');
    assert.equal(p['Sanction.userId'], 'keep');
    assert.equal(p['Sanction.issuedById'], 'keep');
  });

  test('the audit chain is KEPT, not detached — the actor id is inside its HMAC', () => {
    // auditHash() in lib.mjs hashes `${prevHash}|${id}|${actorId}|…`, so nulling actorId
    // invalidates every later entry exactly as deleting the row would. The consequence is
    // deliberate and worth stating: a link to the person survives erasure, because an audit
    // chain nobody can verify protects nobody, including them.
    assert.equal(planOf()['AuditLogEntry.actorId'], 'keep');
    assert.match(KEEP.AuditLogEntry, /hash/i);
  });

  test('every KEEP entry states a reason', () => {
    // "Kept" without a reason is indistinguishable from "not implemented", and this is the
    // list somebody argues with when a request is contested.
    for (const [m, why] of Object.entries(KEEP)) {
      assert.ok(why && why.length > 25, `${m} needs a real reason, got: ${why}`);
    }
  });

  test('a required link on somebody else’s row is BLOCKED, never guessed', () => {
    // It cannot be detached and it is not theirs to delete. Silently skipping would leave a
    // link to a person who was told they were erased.
    assert.equal(planOf()['Awkward.reviewerId'], 'blocked');
  });
});

describe('eraseUser', () => {
  /** A client that records every write instead of performing one. */
  const spyClient = (counts = {}) => {
    const writes = [];
    const mk = (name) => ({
      count: async () => counts[name] ?? 1,
      deleteMany: async (a) => { writes.push(['delete', name, a]); return { count: counts[name] ?? 1 }; },
      updateMany: async (a) => { writes.push(['update', name, a]); return { count: counts[name] ?? 1 }; },
    });
    return {
      writes,
      blogComment: mk('blogComment'),
      serverRepo: mk('serverRepo'),
      auditLogEntry: mk('auditLogEntry'),
      submissionComment: mk('submissionComment'),
      payment: mk('payment'),
      sanction: mk('sanction'),
      awkward: mk('awkward'),
    };
  };

  const OK_DMMF = {
    datamodel: { models: DMMF.datamodel.models.filter((m) => m.name !== 'Awkward') },
  };

  test('a dry run WRITES NOTHING', async () => {
    // The default. A function that erases people and defaults to acting is one that
    // eventually acts by accident.
    const c = spyClient();
    const r = await eraseUser(c, 'u1', buildErasePlan(OK_DMMF));
    assert.equal(r.committed, false);
    assert.deepEqual(c.writes, [], 'a preview must not touch the database');
    assert.ok(r.totals.deleted > 0, 'and must still say what it would do');
  });

  test('committing deletes the owned rows and detaches the others', async () => {
    const c = spyClient();
    await eraseUser(c, 'u1', buildErasePlan(OK_DMMF), { commit: true });
    const kinds = Object.fromEntries(c.writes.map((w) => [w[1], w[0]]));
    assert.equal(kinds.blogComment, 'delete');
    assert.equal(kinds.serverRepo, 'delete');
    assert.equal(kinds.submissionComment, 'update', 'somebody else’s row is detached, never deleted');
    assert.equal(kinds.auditLogEntry, undefined, 'the audit chain is not written to at all');
  });

  test('a KEEP model is never written to, even on commit', async () => {
    const c = spyClient();
    await eraseUser(c, 'u1', buildErasePlan(OK_DMMF), { commit: true });
    for (const w of c.writes) {
      assert.notEqual(w[1], 'payment', 'payments must survive erasure');
      assert.notEqual(w[1], 'sanction', 'sanctions must survive erasure');
    }
  });

  test('a blocked relation stops everything BEFORE anything is written', async () => {
    // A partial erasure is the worst available outcome: the person is told their data is
    // gone, some of it is, and nobody knows which.
    const c = spyClient();
    const r = await eraseUser(c, 'u1', buildErasePlan(DMMF), { commit: true });
    assert.equal(r.ok, false);
    assert.equal(r.committed, false);
    assert.equal(r.blocked[0].model, 'Awkward');
    assert.deepEqual(c.writes, [], 'nothing may be written when the plan is incomplete');
  });

  test('the result carries its own justification for what it kept', async () => {
    // So the record of the decision does not depend on a source file that will have changed
    // by the time somebody asks why.
    const r = await eraseUser(spyClient(), 'u1', buildErasePlan(OK_DMMF));
    assert.ok(r.keptBecause.Payment?.includes('Accounting'));
  });

  test('a model with no rows is not reported as work', async () => {
    const c = spyClient({ blogComment: 0 });
    const r = await eraseUser(c, 'u1', buildErasePlan(OK_DMMF));
    assert.equal(r.steps.some((s) => s.model === 'BlogComment'), false);
  });
});
