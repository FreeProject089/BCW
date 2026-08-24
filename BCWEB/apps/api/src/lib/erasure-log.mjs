// The list of people who asked to be forgotten, kept OUTSIDE the database.
//
// WHY OUTSIDE. Restoring a dump taken before an erasure brings that person back — and it
// brings back a database that has no record the erasure ever happened, because the record
// was written after the dump was taken. So a log stored only in the database cannot survive
// the one event it exists for.
//
// It lives beside the backups instead: an append-only JSONL that a restore does not touch,
// and that `replay-erasures.mjs` reads to re-apply everything the restored dump undid.
//
// IT HOLDS NO PERSONAL DATA. A suppression list full of the addresses of people who asked to
// be deleted is the worst possible file to keep, and keeping it forever is exactly what this
// file does. So it stores the user id and a SHA-256 of the address — enough to find the row
// again after a restore, not enough to read a name out of the file.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const ERASURE_LOG = path.resolve(
    process.env.SERVER_BACKUP_ROOT || '/app-backups',
    'erasures.jsonl',
);

export const emailHash = (email) =>
    crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');

/**
 * Record one erasure. Appends; never rewrites.
 *
 * Failure is reported to the caller rather than thrown: an erasure that succeeded must not
 * be reported as failed because a disk was full, but a log entry that silently did not land
 * is the thing that makes a later restore quietly wrong — so the caller is told and can say
 * so in the audit line.
 */
export async function recordErasure(entry) {
    const line = JSON.stringify({
        v: 1,
        userId: entry.userId,
        emailHash: entry.emailHash || null,
        outcome: entry.outcome || 'deleted',
        shredded: !!entry.shredded,
        at: new Date().toISOString(),
        by: entry.by || null,
    });
    try {
        await fs.mkdir(path.dirname(ERASURE_LOG), { recursive: true });
        await fs.appendFile(ERASURE_LOG, line + '\n', 'utf8');
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e?.message || e) };
    }
}

/** Every recorded erasure, oldest first. A malformed line is skipped, not fatal — one bad
 *  append must not make the whole list unreadable on the day it is needed. */
export async function readErasures() {
    let text;
    try { text = await fs.readFile(ERASURE_LOG, 'utf8'); }
    catch { return []; }
    const out = [];
    for (const line of text.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try { const e = JSON.parse(s); if (e?.userId) out.push(e); } catch { /* skip */ }
    }
    return out;
}
