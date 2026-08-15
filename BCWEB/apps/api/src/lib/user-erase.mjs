// Erasing one person, and the things that must survive it.
//
// The same derivation as user-export.mjs — the places to look come from the client metadata,
// not from a list here — because the failure is identical in shape and worse in consequence:
// a hand-written list that misses the fortieth model leaves personal data behind while
// reporting success, and the person was told it was gone.
//
// Three actions, and the whole design is in choosing between them:
//
//   DELETE   the row goes. Their content, their comments, their favourites, their sessions.
//   DETACH   the row stays and stops pointing at them. Used where the row is somebody
//            else's or the platform's, and only the link is personal — a moderator's audit
//            entry, a sanction they issued against another account.
//   KEEP     the row stays, link and all, because it may not lawfully go: a decision made
//            about them, a payment we are required to be able to account for.
//
// KEEP is the list that has to be defended, so it is written out with a reason each, and
// nothing else is allowed to reach it. An unknown model defaults to DELETE only when the
// relation makes the row theirs; otherwise it DETACHES. Erasure that guesses "keep" for
// something it does not recognise is erasure that quietly does not happen.

/**
 * What survives, and why. Each entry is a legal or evidential reason, not a convenience.
 *
 * Written as model names because that is the unit somebody argues about when a request is
 * contested — "you kept my payments" is answered by a line here, not by reading code.
 */
export const KEEP = {
  Payment: 'Accounting records must remain reconstructable for the statutory retention period.',
  Subscription: 'Tied to payments; removing it would leave charges that reconcile to nothing.',
  Sanction: 'A decision made about a person, and the record they can contest. Erasing it would erase their appeal too.',
  SanctionAttachment: 'Evidence a sanction rests on. A decision with its evidence removed cannot be reviewed.',
  // Verified against lib.mjs: auditHash() hashes `${prevHash}|${id}|${actorId}|…`, so the
  // actor id is INSIDE the HMAC. This row can be neither deleted nor detached — nulling
  // actorId breaks verification for every entry after it, exactly as deleting would.
  // That means a link to the person survives erasure, which is a deliberate trade: an
  // audit chain that cannot be verified protects nobody, including them.
  AuditLogEntry: 'Entries are HMAC-chained and the actor id is inside the hash, so it can be neither removed nor nulled without invalidating every later entry.',
  FreeTierClaim: 'Exists to stop one account claiming the free tier repeatedly. Deleting it defeats its only purpose.',
};

/** Relations that make a row THEIRS. Same list as the export, and deliberately the same
 *  reasoning: a relation nobody has classified should not be assumed to be their property. */
const OWNED_FK = new Set(['userId', 'ownerId', 'authorId', 'senderId', 'subscriberId']);

/**
 * One decision per (model, foreign key).
 *
 * `nullable` matters: DETACH writes null, so a required foreign key cannot be detached. Where
 * it cannot, the row must be deleted or kept — silently skipping it would leave the link.
 */
export function buildErasePlan(dmmf) {
  const plan = [];
  for (const model of dmmf.datamodel.models) {
    if (model.name === 'User') continue;
    for (const f of model.fields) {
      if (f.kind !== 'object' || f.type !== 'User') continue;
      const fk = (f.relationFromFields || [])[0];
      if (!fk) continue;
      const scalar = model.fields.find((x) => x.name === fk);
      const nullable = !scalar?.isRequired;
      const owned = OWNED_FK.has(fk);

      let action;
      let reason;
      if (KEEP[model.name]) { action = 'keep'; reason = KEEP[model.name]; }
      else if (owned) { action = 'delete'; reason = 'The row is theirs.'; }
      else if (nullable) { action = 'detach'; reason = 'The row is somebody else’s; only the link to them is personal.'; }
      else {
        // Somebody else's row with a REQUIRED link to this person. It cannot be detached and
        // must not be silently left, so it is surfaced rather than decided here.
        action = 'blocked';
        reason = 'Not theirs, and the link cannot be nulled. Needs a decision before this account can be erased.';
      }
      plan.push({ model: model.name, fk, action, reason, nullable });
    }
  }
  return plan.sort((a, b) => a.model.localeCompare(b.model) || a.fk.localeCompare(b.fk));
}

/**
 * What erasing would do — or, with `commit: true`, what it did.
 *
 * DRY BY DEFAULT. This function deletes personal data irreversibly, and a default that acts
 * is a default that eventually acts by accident. The preview and the execution run the same
 * plan, so what is shown is what happens.
 *
 * Anything `blocked` stops the whole thing. A partial erasure is the worst outcome available:
 * the person is told their data is gone, some of it is, and nobody knows which.
 */
export async function eraseUser(client, userId, plan, { commit = false } = {}) {
  const blocked = plan.filter((e) => e.action === 'blocked');
  if (blocked.length) {
    return { ok: false, committed: false, blocked, reason: 'blocked_relations' };
  }

  const steps = [];
  for (const entry of plan) {
    const delegate = client[entry.model.charAt(0).toLowerCase() + entry.model.slice(1)];
    if (!delegate?.count) { steps.push({ ...entry, rows: null, note: 'no_delegate' }); continue; }
    const rows = await delegate.count({ where: { [entry.fk]: userId } });
    if (!rows) continue;
    if (!commit || entry.action === 'keep') { steps.push({ ...entry, rows }); continue; }
    if (entry.action === 'delete') await delegate.deleteMany({ where: { [entry.fk]: userId } });
    else if (entry.action === 'detach') await delegate.updateMany({ where: { [entry.fk]: userId }, data: { [entry.fk]: null } });
    steps.push({ ...entry, rows, done: true });
  }

  return {
    ok: true,
    committed: !!commit,
    steps,
    totals: {
      deleted: steps.filter((s) => s.action === 'delete').reduce((n, s) => n + (s.rows || 0), 0),
      detached: steps.filter((s) => s.action === 'detach').reduce((n, s) => n + (s.rows || 0), 0),
      kept: steps.filter((s) => s.action === 'keep').reduce((n, s) => n + (s.rows || 0), 0),
    },
    // Repeated in the result so the record of what was done carries its own justification,
    // rather than pointing at a source file that will have changed by the time anybody asks.
    keptBecause: Object.fromEntries(
      steps.filter((s) => s.action === 'keep').map((s) => [s.model, s.reason]),
    ),
  };
}
