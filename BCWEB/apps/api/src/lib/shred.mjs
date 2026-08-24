// Per-user encryption for backups, so a deletion request reaches the backups too.
//
// THE PROBLEM. Row backups are git-committed JSON, and git is append-only by design: an old
// commit still holds what the row said. So a user who asks to be deleted is deleted from the
// live tables and stays in every snapshot taken before that — which is the thing the request
// was actually about.
//
// Deleting from git history is not a fix. Rewriting history invalidates every hash, breaks
// every restore that referenced one, and has to be repeated on every clone and every mirror
// of the repository. It is the operation that looks like erasure and reliably is not.
//
// CRYPTO-SHREDDING instead. Every user gets a random key. A backup of a row that belongs to
// somebody is encrypted with THAT person's key, so:
//
//   - deleting one key makes exactly one person's snapshots unreadable, and leaves
//     everybody else's restorable — which is what makes this usable at all;
//   - the backups themselves never move, so no hash changes and no restore breaks;
//   - it works on copies. A backup already synced to another disk is ciphertext there too,
//     and the key it needs no longer exists anywhere.
//
// WHAT IT IS NOT. This protects backups against being READ after a deletion. It is not
// at-rest encryption of the live database, and it is not protection from somebody who has
// the key table — an operator with the database can still read everything that has not been
// shredded. That is the honest boundary, and it is the one GDPR erasure actually asks about.
import crypto from 'node:crypto';

const ALG = 'aes-256-gcm';
export const SHRED_VERSION = 1;

/**
 * The key for one user, minted on first use.
 *
 * Created lazily rather than at signup: a key that exists for an account that never had a
 * backup taken is a secret stored for nothing, and backfilling every existing user at
 * migration time would do exactly that for the whole table.
 */
export async function keyForUser(p, userId) {
    const row = await p.userDataKey.findUnique({ where: { userId } });
    if (row?.key) return Buffer.from(row.key);
    const key = crypto.randomBytes(32);
    try {
        await p.userDataKey.create({ data: { userId, key } });
        return key;
    } catch {
        // Two backups of the same user at once both miss and both create. The loser reads
        // the winner's key rather than overwriting it — overwriting would orphan whatever
        // the winner had already encrypted, seconds after writing it.
        const again = await p.userDataKey.findUnique({ where: { userId } });
        if (again?.key) return Buffer.from(again.key);
        throw new Error('could not obtain a data key');
    }
}

/** Whether this user still has a key — i.e. whether their old backups can still be read. */
export async function hasKey(p, userId) {
    return !!(await p.userDataKey.findUnique({ where: { userId }, select: { userId: true } }));
}

/**
 * Destroy one user's key. THE erasure step.
 *
 * Called when an account is really gone from production, not when it is suspended or
 * closed-but-recoverable: this cannot be undone, and a "closure" a user can cancel must not
 * take their own backups with it.
 */
export async function shredUser(p, userId) {
    const r = await p.userDataKey.deleteMany({ where: { userId } });
    return r.count > 0;
}

/**
 * Encrypt one payload for one user.
 *
 * The envelope carries the user id in CLEARTEXT on purpose. Something has to know whose key
 * to fetch, and the alternative — trying every key until one authenticates — is both slow
 * and a worse leak, since it tells an attacker which keys exist. The id is already visible
 * in the backup's own path.
 */
export function seal(key, plaintext, userId) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv(ALG, key, iv);
    const data = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final()]);
    return JSON.stringify({
        shred: SHRED_VERSION,
        userId,
        iv: iv.toString('base64'),
        tag: c.getAuthTag().toString('base64'),
        data: data.toString('base64'),
    });
}

/** Read an envelope back. Throws if the key is wrong, missing, or the bytes were edited. */
export function open(key, envelope) {
    const e = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
    if (e?.shred !== SHRED_VERSION) throw new Error('not a shredded envelope');
    const d = crypto.createDecipheriv(ALG, key, Buffer.from(e.iv, 'base64'));
    d.setAuthTag(Buffer.from(e.tag, 'base64'));
    // GCM: `final()` is what verifies the tag, so a tampered payload throws here rather
    // than returning plausible-looking garbage.
    return Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString('utf8');
}

/** Is this text an envelope? Backups written before this existed are plain JSON. */
export function isSealed(text) {
    if (typeof text !== 'string' || text.length < 20 || text[0] !== '{') return false;
    try { return JSON.parse(text)?.shred === SHRED_VERSION; } catch { return false; }
}

/** The user id an envelope is for, without needing the key. */
export function ownerOf(text) {
    try { const e = JSON.parse(text); return e?.shred === SHRED_VERSION ? (e.userId ?? null) : null; }
    catch { return null; }
}

/**
 * Encrypt if the row belongs to somebody; otherwise pass it through.
 *
 * A row with no owner — a project config, an admin setting, a catalog entry — has no
 * personal data to erase and no key to erase it with. Encrypting it anyway would mean the
 * whole backup archive depends on a key table that can never be pruned.
 */
export async function sealForOwner(p, userId, plaintext) {
    if (!userId) return plaintext;
    const key = await keyForUser(p, userId);
    return seal(key, plaintext, userId);
}

/**
 * Read a backup back, whatever it is.
 *
 * Returns `{ ok, text, reason }` rather than throwing, because "this person was erased" is a
 * normal answer here and the caller has to be able to SAY it. A restore screen that shows a
 * stack trace where it should say "deleted at the owner's request" is a screen that gets
 * reported as broken.
 */
export async function openBackup(p, text) {
    if (!isSealed(text)) return { ok: true, text };
    const userId = ownerOf(text);
    const row = userId ? await p.userDataKey.findUnique({ where: { userId } }) : null;
    if (!row?.key) return { ok: false, reason: 'shredded', userId };
    try { return { ok: true, text: open(Buffer.from(row.key), text), userId }; }
    catch { return { ok: false, reason: 'unreadable', userId }; }
}
