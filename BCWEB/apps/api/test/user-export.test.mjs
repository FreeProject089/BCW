// A subject access request, assembled from the schema's own metadata.
//
// The two tests that carry the weight are the leak ones. An export is a file that leaves the
// building, so the failure that matters is not "a table was missed" — it is "somebody else's
// data went with it", and "the account's password hash went with it".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRedactedField, relationRole, buildExportPlan, redactRow, referenceRow, collectUserData, exportUser,
} from '../src/lib/user-export.mjs';

/** A miniature dmmf with the shapes that matter: a subject-owned model, an actor-only model,
 *  and one that is BOTH (which is Sanction in the real schema). */
const DMMF = {
  datamodel: {
    models: [
      { name: 'User', fields: [] },
      {
        name: 'Sanction',
        fields: [
          { kind: 'object', type: 'User', name: 'user', relationFromFields: ['userId'] },
          { kind: 'object', type: 'User', name: 'issuedBy', relationFromFields: ['issuedById'] },
        ],
      },
      { name: 'ServerRepo', fields: [{ kind: 'object', type: 'User', name: 'owner', relationFromFields: ['ownerId'] }] },
      { name: 'AuditLogEntry', fields: [{ kind: 'object', type: 'User', name: 'actor', relationFromFields: ['actorId'] }] },
      // The far side of somebody else's relation: no scalar FK here, so following it would
      // re-collect rows already gathered from their owner.
      { name: 'Backref', fields: [{ kind: 'object', type: 'User', name: 'users', relationFromFields: [] }] },
      { name: 'Unrelated', fields: [{ kind: 'scalar', type: 'String', name: 'name' }] },
    ],
  },
};

describe('buildExportPlan', () => {
  test('a model referencing User twice is visited twice, with the right role each time', () => {
    // Sanction is the case: userId is the person it is ABOUT, issuedById is the moderator
    // who wrote it. Collapsing them would either lose their own sanctions or export
    // everyone they ever sanctioned.
    const plan = buildExportPlan(DMMF).filter((e) => e.model === 'Sanction');
    assert.deepEqual(plan.map((e) => [e.fk, e.role]), [['issuedById', 'actor'], ['userId', 'subject']]);
  });

  test('ownerId is theirs; actorId is not', () => {
    const by = Object.fromEntries(buildExportPlan(DMMF).map((e) => [`${e.model}.${e.fk}`, e.role]));
    assert.equal(by['ServerRepo.ownerId'], 'subject');
    assert.equal(by['AuditLogEntry.actorId'], 'actor');
  });

  test('User itself and unrelated models are not in the plan', () => {
    const names = buildExportPlan(DMMF).map((e) => e.model);
    assert.equal(names.includes('User'), false);
    assert.equal(names.includes('Unrelated'), false);
  });

  test('a relation with no scalar FK is skipped', () => {
    // The other end of somebody else's relation. Following it double-counts.
    assert.equal(buildExportPlan(DMMF).some((e) => e.model === 'Backref'), false);
  });
});

describe('relationRole', () => {
  test('an unknown relation defaults to ACTOR, the cautious side', () => {
    // Wrong as "actor" under-reports one person's own data, which they can ask about again.
    // Wrong as "subject" discloses a third party's, which cannot be taken back.
    assert.equal(relationRole('somethingNewById'), 'actor');
    assert.equal(relationRole('userId'), 'subject');
  });
});

describe('redaction', () => {
  test('credentials never leave', () => {
    for (const f of ['passwordHash', 'twoFactorSecret', 'recoveryCodes', 'apiToken', 'shareKey', 'webhookSecret']) {
      assert.equal(isRedactedField(f), true, f);
    }
  });

  test('ordinary personal data is NOT redacted — that is the point of the export', () => {
    for (const f of ['email', 'displayName', 'createdAt', 'ip', 'internalNote']) {
      assert.equal(isRedactedField(f), false, f);
    }
  });

  test('a redacted row keeps its shape and loses its secrets', () => {
    const out = redactRow({ id: 'u1', email: 'a@b.c', passwordHash: '$argon2…', bytes: 10n });
    assert.equal(out.email, 'a@b.c');
    assert.equal(out.passwordHash, '[redacted]');
    // BigInt survives JSON.stringify only as a string; an export that throws at serialise
    // time is an export nobody receives.
    assert.equal(out.bytes, '10');
    assert.doesNotThrow(() => JSON.stringify(out));
  });

  test('an actor row keeps no content at all', () => {
    const ref = referenceRow({ id: 's1', createdAt: 'X', reason: 'SOMEBODY ELSE PERSONAL DATA', userId: 'other' });
    assert.equal(JSON.stringify(ref).includes('SOMEBODY ELSE'), false);
    assert.equal(JSON.stringify(ref).includes('other'), false);
    assert.equal(ref.id, 's1');
  });
});

describe('collectUserData', () => {
  const client = {
    sanction: {
      findMany: async ({ where }) => (where.userId === 'me'
        ? [{ id: 's1', reason: 'mine', internalNote: 'staff note about me' }]
        : [{ id: 's2', reason: 'about someone else', userId: 'them' }]),
    },
    serverRepo: { findMany: async () => [{ id: 'r1', name: 'My repo', shareKey: 'SECRET' }] },
    auditLogEntry: { findMany: async () => [{ id: 'a1', createdAt: 'X', detail: 'about someone else' }] },
    backref: { findMany: async () => [] },
  };
  const plan = buildExportPlan(DMMF);

  test('subject rows come whole, actor rows come as references', async () => {
    const { data } = await collectUserData(client, 'me', plan);
    assert.equal(data['Sanction.userId'][0].reason, 'mine');
    assert.equal(data['Sanction.issuedById'][0].reason, undefined, 'an issued sanction must not carry its reason');
    assert.equal(data['AuditLogEntry.actorId'][0].detail, undefined);
  });

  test('the staff note about THEM is included — it is their data', () => {
    // Deliberate, and the opposite of the rule for the user-facing sanction view. A note
    // about a person is personal data about that person; a subject access request is exactly
    // where it is owed, even though the sanction e-mail never quotes it.
    assert.equal(isRedactedField('internalNote'), false);
  });

  test('a secret inside a subject row is still redacted', async () => {
    const { data } = await collectUserData(client, 'me', plan);
    assert.equal(data['ServerRepo.ownerId'][0].shareKey, '[redacted]');
    assert.equal(data['ServerRepo.ownerId'][0].name, 'My repo');
  });

  test('one unreadable table is RECORDED, not thrown', async () => {
    // A single failing table must not turn a legal deliverable into a 500 — and must not be
    // silently dropped either, which would look exactly like a complete export.
    const broken = { ...client, serverRepo: { findMany: async () => { throw new Error('boom'); } } };
    const { data, errors } = await collectUserData(broken, 'me', plan);
    assert.ok(data['Sanction.userId'], 'the rest still collected');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].model, 'ServerRepo');
  });

  test('a model with no rows is absent rather than empty', async () => {
    const { data } = await collectUserData(client, 'me', plan);
    assert.equal('Backref.' in data, false);
  });
});

describe('exportUser', () => {
  const client = {
    user: { findUnique: async ({ where }) => (where.id === 'me' ? { id: 'me', email: 'a@b.c', displayName: 'Me', passwordHash: '$argon2' } : null) },
    sanction: { findMany: async () => [] },
    serverRepo: { findMany: async () => [] },
    auditLogEntry: { findMany: async () => [] },
    backref: { findMany: async () => [] },
  };

  test('an unknown subject is null, not an empty export', async () => {
    // An empty document handed to somebody would read as "we hold nothing about you".
    assert.equal(await exportUser(client, 'ghost', DMMF, 'now'), null);
  });

  test('the document says where it looked, not only what it found', async () => {
    const doc = await exportUser(client, 'me', DMMF, 'now');
    assert.ok(doc.lookedIn.some((x) => x.startsWith('ServerRepo.ownerId')));
    assert.equal(doc.account.passwordHash, '[redacted]');
    assert.deepEqual(doc.couldNotRead, [], 'present even when empty');
  });
});
