// Is this BMM document still the one its author wrote?
//
// BMM signs the files it produces — mod lists, automations, backup manifests — with the same
// ed25519 identity it has always used for `repo.json`. The block travels inside the document:
//
//   "bmm_signature": { "format": "mm", "author_id": "<hex public key>",
//                      "signature": "<hex>", "signed_at": "…" }
//
// A moderator deciding whether to publish somebody's automation has exactly one question
// this can answer, and it is worth answering precisely:
//
//   · VALID     — these bytes have not changed since that key signed them.
//   · TAMPERED  — they have. Either the file was edited after signing, or the block was
//                 lifted from another file. This is the interesting one.
//   · UNSIGNED  — nothing was claimed. Not a failure: every file written before BMM signed
//                 anything is unsigned, and third-party tools write these formats too.
//   · MALFORMED — there is a block, but it is not one (missing fields, wrong format name).
//
// What it does NOT say is that the author is trustworthy. `author_id` is a public key, not
// an identity: it says two files came from the same BMM installation. The reviewer decides
// what that is worth, which is why the id is shown next to the verdict rather than being
// turned into a name.
//
// The rules below have to match BMM's `commands/doc_sign.rs` byte for byte, or every
// document reads as tampered. There are exactly three, and each is a decision:
//   1. the payload is the document with the signature block REMOVED;
//   2. serialised with object keys SORTED (serde_json's default, so the JSON in the file
//      having a different key order — a formatter ran over it, a tool rewrote it — does not
//      change the answer);
//   3. prefixed with the format name and a 0x1E separator, so a signature over a mod list
//      cannot vouch for an automation.

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export const FIELD = 'bmm_signature';

/** JSON with object keys sorted at every level. Matches serde_json's map ordering, which is
 *  what BMM signs. Arrays keep their order — they are content, not a map. */
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    // JSON.stringify handles strings, numbers, booleans and null the same way serde does for
    // the values these documents carry.
    return JSON.stringify(value === undefined ? null : value);
}

/** The exact bytes BMM signed. */
export function signedPayload(doc, format) {
    const bare = { ...doc };
    delete bare[FIELD];
    return Buffer.concat([
        Buffer.from(format, 'utf8'),
        Buffer.from([0x1e]),
        Buffer.from(canonical(bare), 'utf8'),
    ]);
}

/** A raw 32-byte ed25519 public key, as a KeyObject. Node wants DER, so the key is wrapped
 *  in the 12-byte SubjectPublicKeyInfo prefix that says "this is ed25519". */
function publicKeyFrom(hex) {
    const raw = Buffer.from(hex, 'hex');
    if (raw.length !== 32) return null;
    const der = Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        raw,
    ]);
    try {
        return createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch {
        return null;
    }
}

/**
 * The verdict on a document.
 *
 * `expectedFormat` is what the reader believes it is opening — pass the format the inspector
 * detected, so a renamed file is caught rather than trusted.
 */
export function verifyDocument(doc, expectedFormat) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { state: 'unsigned' };
    const block = doc[FIELD];
    if (!block) return { state: 'unsigned' };
    if (typeof block !== 'object') return { state: 'malformed', reason: 'the signature block is not an object' };

    const authorId = typeof block.author_id === 'string' ? block.author_id : null;
    const signature = typeof block.signature === 'string' ? block.signature : null;
    if (!authorId || !signature) {
        return { state: 'malformed', reason: 'the signature block has no author_id/signature' };
    }
    const format = typeof block.format === 'string' ? block.format : expectedFormat;
    if (expectedFormat && format !== expectedFormat) {
        return { state: 'malformed', reason: `signed as "${format}", opened as "${expectedFormat}"` };
    }

    const key = publicKeyFrom(authorId);
    if (!key) return { state: 'malformed', reason: 'author_id is not an ed25519 public key' };

    let sig;
    try {
        sig = Buffer.from(signature, 'hex');
    } catch {
        return { state: 'malformed', reason: 'the signature is not hex' };
    }
    if (sig.length !== 64) return { state: 'malformed', reason: 'the signature is the wrong length' };

    let ok = false;
    try {
        ok = cryptoVerify(null, signedPayload(doc, format), key, sig);
    } catch {
        ok = false;
    }
    return ok
        ? { state: 'valid', authorId, format, signedAt: block.signed_at || null }
        : { state: 'tampered', authorId };
}
