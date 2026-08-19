// ONE-OFF. Destroys the staff audit log, then deletes every closed account.
//
// This is NOT part of fix:drift and must never become part of it. fix:drift is safe to run
// whenever a screen looks wrong; this is not safe to run at all on anything but a development
// database, and the difference is the whole reason it lives in its own file with its own name.
//
// ── Why it has to destroy the log to do its job
//
// A closed account is kept because things point at it. On this database the only thing left
// pointing at the twelve is AuditLogEntry.actorId — which is declared ON DELETE RESTRICT, is
// NOT nullable, and is INSIDE the HMAC each entry is sealed with (see auditHash in lib.mjs:
// `${prevHash}|${id}|${actorId}|…`). So the actor can be neither removed nor detached. This is
// already written down in lib/user-erase.mjs, in the KEEP list, with the same reasoning.
//
// That leaves two ways to unblock a delete, and they are not equivalent:
//
//   RE-SEAL   delete the 23 entries belonging to those accounts, then recompute prevHash/hash
//             for every survivor so `/admin/security/audit/verify` passes again.
//             REJECTED. It produces a chain that verifies while no longer being the chain that
//             was written — a forged continuity, which is the exact thing the feature exists
//             to make impossible. A log you can quietly rewrite is not an audit log.
//
//   RESET     delete the log. The chain restarts from GENESIS on the next staff action.
//             Verification then passes because there is nothing to verify, and "this database
//             has no staff history yet" is TRUE rather than manufactured.
//
// This script does RESET, and only RESET.
//
// ── When this is defensible, and when it is not
//
// Defensible here because the log spans five days, every entry is this machine's own testing
// (server.elevate, server.backup_gc, user.erased), and the accounts it protects are throwaway
// accounts from testing the closure flow. There is no history being destroyed because none was
// ever created.
//
// NOT defensible on production, ever. There the log is the record that a compromised staff
// account could not silently rewrite history, and running this would be indistinguishable from
// an attacker covering their tracks — which is why it refuses unless you say so twice.
//
//   node src/reset-audit-and-purge-closed.mjs --dry
//   node src/reset-audit-and-purge-closed.mjs --yes-destroy-the-audit-log

import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const DRY = process.argv.includes('--dry');
const GO = process.argv.includes('--yes-destroy-the-audit-log');

const run = async () => {
  const closed = await p.user.findMany({ where: { closedAt: { not: null } }, select: { id: true, closedAt: true } });
  const ids = closed.map((u) => u.id);
  const auditTotal = await p.auditLogEntry.count();
  const auditTheirs = ids.length
    ? await p.auditLogEntry.count({ where: { actorId: { in: ids } } })
    : 0;
  const notifs = ids.length
    ? await p.notification.count({ where: { userId: { in: ids } } })
    : 0;
  const span = await p.auditLogEntry.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } });

  console.log(`closed accounts        : ${ids.length}`);
  console.log(`audit entries (total)  : ${auditTotal}`);
  console.log(`  …of which are theirs : ${auditTheirs}`);
  console.log(`  …span                : ${span._min.createdAt?.toISOString().slice(0, 10) || '—'} → ${span._max.createdAt?.toISOString().slice(0, 10) || '—'}`);
  console.log(`their notifications    : ${notifs}`);

  if (!GO) {
    console.log('\nNothing was changed.');
    console.log('This deletes the ENTIRE audit log — not only the entries belonging to those');
    console.log('accounts — because a partial delete would have to be re-sealed to verify, and');
    console.log('a re-sealed chain is a forged one. Re-run with:');
    console.log('  node src/reset-audit-and-purge-closed.mjs --yes-destroy-the-audit-log');
    return;
  }
  if (DRY) { console.log('\n--dry given: nothing was changed.'); return; }

  // The log and the notifications go together in one transaction: a state where the log is
  // gone and the accounts are still blocked is the worst of both.
  await p.$transaction([
    p.auditLogEntry.deleteMany({}),
    p.notification.deleteMany({ where: { userId: { in: ids } } }),
  ]);

  // One at a time, so a single account still held by something unforeseen names itself
  // instead of failing the batch silently.
  let gone = 0;
  const stuck = [];
  for (const id of ids) {
    try { await p.user.delete({ where: { id } }); gone++; }
    catch (e) { stuck.push(`${id} — ${String(e.message).split('\n').slice(-2).join(' ').trim()}`); }
  }

  console.log(`\naudit log      : cleared (${auditTotal} entries)`);
  console.log(`accounts deleted: ${gone}`);
  if (stuck.length) {
    console.log('still blocked   :');
    for (const s of stuck) console.log(`  · ${s}`);
  }
  console.log(`remaining closed: ${await p.user.count({ where: { closedAt: { not: null } } })}`);
  console.log('\nThe audit chain restarts from GENESIS on the next staff action.');
};

run()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => p.$disconnect());
