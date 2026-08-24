// Re-apply every erasure a restored dump undid.
//
// RUN THIS AFTER ANY RESTORE, before the stack serves traffic again.
//
// A dump is a frozen copy. Restoring one from before an erasure brings that person back —
// their row, their address, their content — and it brings back a database with no record
// that the erasure happened, because that record was written after the dump was taken. The
// restore therefore undoes the erasure AND the evidence of it, silently.
//
// The erasure log lives outside the database for exactly this reason (lib/erasure-log.mjs).
// This reads it and re-applies anything the restored dump brought back.
//
//   node src/replay-erasures.mjs           # report only
//   node src/replay-erasures.mjs --write   # apply
//
// Idempotent: an account already erased is reported as such and skipped, so running it twice
// — or running it when nothing was restored — does nothing.
import { db } from './lib/lib.mjs';
import { readErasures } from './lib/erasure-log.mjs';
import { anonymiseAccount } from './routes/closure.mjs';
import { shredUser } from './lib/shred.mjs';

const WRITE = process.argv.includes('--write');

const p = await db();
const log = await readErasures();

if (!log.length) {
    console.log('No erasure log found — nothing to replay.');
    console.log('(Expected at SERVER_BACKUP_ROOT/erasures.jsonl. An empty log on a server that');
    console.log(' has never had an erasure request is correct; on one that has, it means the log');
    console.log(' was lost and the replay cannot be done from here.)');
    process.exit(0);
}

console.log(`${log.length} erasure(s) recorded.`);

let back = 0, keyBack = 0, done = 0;
for (const e of log) {
    const u = await p.user.findUnique({
        where: { id: e.userId },
        select: { id: true, email: true, closedAt: true },
    });

    // The row is gone: the restore predates this account entirely, or the erasure survived.
    // Either way there is nothing to re-erase.
    if (!u) {
        // The KEY can still be back even when the row is not — different tables, and a
        // partial restore is a real thing. Checked separately rather than assumed.
        const key = await p.userDataKey.findUnique({ where: { userId: e.userId }, select: { userId: true } });
        if (key) {
            keyBack += 1;
            console.log(`  ${e.userId}  key restored without its account — shredding`);
            if (WRITE) await shredUser(p, e.userId);
        }
        continue;
    }

    // Already anonymised: the address is gone and this is the state the erasure left. The
    // key is still checked, because a restore can bring one back on its own.
    const erasedLooking = /^closed\+/.test(u.email || '');
    const key = await p.userDataKey.findUnique({ where: { userId: u.id }, select: { userId: true } });
    if (erasedLooking && !key) {
        done += 1;
        continue;
    }

    back += 1;
    console.log(`  ${u.id}  ${erasedLooking ? 'anonymised but its key is back' : 'ACCOUNT IS BACK'} (erased ${e.at})`);
    if (WRITE) {
        if (!erasedLooking) await anonymiseAccount(p, u).catch((x) => console.error('    anonymise failed:', x.message));
        await shredUser(p, u.id).catch(() => {});
    }
}

console.log('');
console.log(`already erased : ${done}`);
console.log(`brought back   : ${back}`);
console.log(`orphan keys    : ${keyBack}`);
if (!WRITE && (back || keyBack)) {
    console.log('');
    console.log('Nothing was changed. Re-run with --write to re-apply these erasures.');
} else if (WRITE && (back || keyBack)) {
    console.log('');
    console.log('Re-applied. Verify with a spot check before opening the site.');
}
process.exit(0);
