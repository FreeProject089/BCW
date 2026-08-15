// Everything held about one person, for a subject access request.
//
// The list of places to look is DERIVED from the Prisma client's own metadata, never written
// out here. Thirty-nine models reference User today; a hand-written list would be wrong the
// first time somebody adds the fortieth, and wrong SILENTLY — an export that quietly omits a
// table looks exactly like a complete one, and the person receiving it cannot tell.
//
// Two decisions this file makes, both of which are judgements rather than mechanics:
//
// 1. SUBJECT rows versus ACTOR rows. A model can reference a person in two ways. Sanction has
//    `userId` (the person it is about) and `issuedById` (the moderator who wrote it). The
//    first is their data. The second is a record about SOMEBODY ELSE that they touched —
//    exporting it whole would hand a moderator's export the personal data of everyone they
//    have ever sanctioned. Actor rows are therefore reduced to a reference: this happened,
//    on this date, and you were the one who did it.
//
// 2. Credentials are never exported. A password hash and a TOTP secret are data about the
//    person in the literal sense and are not what a subject access request is for; putting
//    them in a file that travels by e-mail creates a risk that did not exist before.

/** Fields that never leave, whatever model they sit on. Matched by NAME because the same
 *  name means the same thing across this schema, and a per-model list would go stale. */
const NEVER_EXPORT = [
  /passwordhash/i, /^password$/i,
  /twofactorsecret/i, /totpsecret/i, /recoverycodes/i,
  /sharekey/i, /^secret$/i, /apitoken/i, /accesstoken/i, /refreshtoken/i,
  /webhooksecret/i, /^token$/i,
];

export function isRedactedField(name) {
  return NEVER_EXPORT.some((re) => re.test(String(name)));
}

/**
 * Which relation makes a row THEIRS rather than one they merely touched.
 *
 * `userId` and `ownerId` mean "this row is about/belongs to this person". Everything else —
 * issuedById, addedById, actorId, liftedById, answeredById — means they acted on a row that
 * is about something or somebody else.
 *
 * A closed list of SUBJECT names rather than a list of actor names: a new relation should
 * default to the cautious side. Getting it wrong as "actor" under-reports one person's own
 * data, which they can ask about; getting it wrong as "subject" leaks a third party's.
 */
const SUBJECT_FK = new Set(['userId', 'ownerId', 'authorId', 'senderId', 'subscriberId']);

export function relationRole(fkName) {
  return SUBJECT_FK.has(fkName) ? 'subject' : 'actor';
}

/**
 * Where to look, derived from the live client metadata.
 *
 * Returns one entry per (model, foreign key) pair, so a model referencing User twice is
 * visited twice with the right role each time.
 */
export function buildExportPlan(dmmf) {
  const plan = [];
  for (const model of dmmf.datamodel.models) {
    if (model.name === 'User') continue; // the account itself is handled separately
    for (const f of model.fields) {
      if (f.kind !== 'object' || f.type !== 'User') continue;
      const fk = (f.relationFromFields || [])[0];
      // A relation with no scalar FK on this side is the other end of somebody else's
      // relation — following it would double-count rows already collected from their owner.
      if (!fk) continue;
      plan.push({ model: model.name, fk, role: relationRole(fk), via: f.name });
    }
  }
  return plan.sort((a, b) => a.model.localeCompare(b.model) || a.fk.localeCompare(b.fk));
}

/** Strip credentials, and anything a caller names, from one row. */
export function redactRow(row, extra = []) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (isRedactedField(k) || extra.includes(k)) { out[k] = '[redacted]'; continue; }
    out[k] = typeof v === 'bigint' ? String(v) : v;
  }
  return out;
}

/** An actor row, reduced to the fact that they did it. */
export function referenceRow(row) {
  const at = row.createdAt || row.issuedAt || row.addedAt || row.at || null;
  return { id: row.id ?? null, at, model_note: 'You acted on this record; it is about someone or something else.' };
}

/**
 * Collect it.
 *
 * `client` is the Prisma client; `plan` comes from buildExportPlan. Every model is queried
 * independently and a failure on one is RECORDED rather than thrown — a single unreadable
 * table must not turn a legal deliverable into a 500, and an export that silently skipped it
 * would be worse than one that says which table it could not read.
 */
export async function collectUserData(client, userId, plan) {
  const data = {};
  const errors = [];
  for (const entry of plan) {
    const delegate = client[entry.model.charAt(0).toLowerCase() + entry.model.slice(1)];
    if (!delegate?.findMany) { errors.push({ ...entry, error: 'no_delegate' }); continue; }
    try {
      const rows = await delegate.findMany({ where: { [entry.fk]: userId }, take: 5000 });
      if (!rows.length) continue;
      const key = `${entry.model}.${entry.fk}`;
      data[key] = entry.role === 'subject' ? rows.map((r) => redactRow(r)) : rows.map(referenceRow);
    } catch (e) {
      errors.push({ ...entry, error: String(e?.message || e).slice(0, 200) });
    }
  }
  return { data, errors };
}

/** The whole document, ready to hand over. */
export async function exportUser(client, userId, dmmf, now) {
  const account = await client.user.findUnique({ where: { id: userId } });
  if (!account) return null;
  const plan = buildExportPlan(dmmf);
  const { data, errors } = await collectUserData(client, userId, plan);
  return {
    generatedAt: now,
    subject: { id: account.id, email: account.email, displayName: account.displayName },
    account: redactRow(account),
    // Named in the document itself: somebody reading it should be able to see what was
    // looked at, not just what was found. A place with no rows is absent from `data` and
    // present here, which is the difference between "nothing" and "not checked".
    lookedIn: plan.map((e) => `${e.model}.${e.fk} (${e.role})`),
    data,
    // Empty on a healthy run. Present always, so its absence is never mistaken for a
    // guarantee that nothing failed.
    couldNotRead: errors,
    notes: [
      'Rows where you acted on somebody else’s record are reduced to a reference: exporting them whole would disclose another person’s data.',
      'Credentials (password hash, two-factor secret, tokens) are redacted. They are not what an access request is for, and mailing them would create a risk that did not exist.',
    ],
  };
}
