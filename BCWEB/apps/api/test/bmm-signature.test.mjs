// Verifying BMM's document signatures — against a document BMM actually signed.
//
// The two implementations of the canonical form live in different languages and different
// repositories. Nothing would notice them drifting apart until every file a moderator opened
// read as "tampered", which is the worst possible way to find out: the tool would be crying
// wolf about real submissions.
//
// So the fixture is not hand-written. It is printed by BMM's own Rust test
// (`cargo test print_a_signed_sample -- --nocapture`) and checked in beside this file. It
// deliberately carries the values the two languages disagree about if nobody is careful:
// a whole float (`2.0`, which serde prints as "2.0" and JavaScript as "2"), a fraction, keys
// out of alphabetical order, a nested object, an escaped quote, a tab and a newline.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyDocument, verifyArchive, signedPayload, FIELD, ARCHIVE_ENTRY } from '../src/lib/bmm-signature.mjs';

const sample = JSON.parse(readFileSync(
    fileURLToPath(new URL('./fixtures-bmm-signed-sample.json', import.meta.url)), 'utf8'));

const clone = () => JSON.parse(JSON.stringify(sample));

describe('a document BMM signed', () => {
    test('THE ONE: it verifies here', () => {
        // If this fails, the canonical form drifted. Compare lib/bmm-signature.mjs against
        // BMM's commands/doc_sign.rs — payload() and canonical() are the two halves.
        assert.deepEqual(verifyDocument(sample, 'mm').state, 'valid');
    });

    test('and it names the key that signed it', () => {
        const v = verifyDocument(sample, 'mm');
        assert.match(v.authorId, /^[0-9a-f]{64}$/);
        assert.equal(v.format, 'mm');
        assert.ok(v.signedAt);
    });

    test('a whole float does not break it', () => {
        // serde prints 2.0, JavaScript prints 2, and the canonical form says "2" on both
        // sides. This is the single most likely way the two drift apart.
        assert.equal(sample.whole, 2);
        assert.ok(signedPayload(sample, 'mm').includes(Buffer.from('"whole":2')));
        assert.ok(!signedPayload(sample, 'mm').includes(Buffer.from('"whole":2.0')));
    });

    test('reformatting it changes nothing', () => {
        // A file that went through a formatter — reindented, keys reordered — is the same
        // document, and a reviewer who pretty-printed one before reading it must not be told
        // it was tampered with.
        const reordered = {};
        for (const k of Object.keys(sample).reverse()) reordered[k] = sample[k];
        assert.equal(verifyDocument(reordered, 'mm').state, 'valid');
    });
});

describe('what it refuses', () => {
    test('one changed character is tampered', () => {
        const doc = clone();
        doc.name = 'Cross-language sampl3';
        assert.equal(verifyDocument(doc, 'mm').state, 'tampered');
    });

    test('a changed number is tampered', () => {
        const doc = clone();
        doc.count = 4;
        assert.equal(verifyDocument(doc, 'mm').state, 'tampered');
    });

    test('a block lifted onto another document is tampered', () => {
        const doc = { name: 'Something else', mods: [], [FIELD]: sample[FIELD] };
        assert.equal(verifyDocument(doc, 'mm').state, 'tampered');
    });

    test('a mod list opened as an automation does not verify', () => {
        const v = verifyDocument(sample, 'bmmpa');
        assert.equal(v.state, 'malformed');
        assert.match(v.reason, /signed as "mm"/);
    });

    test('no block is unsigned, not a failure', () => {
        const doc = clone();
        delete doc[FIELD];
        assert.equal(verifyDocument(doc, 'mm').state, 'unsigned');
    });

    test('a half-written block says what is wrong', () => {
        const doc = clone();
        doc[FIELD] = { format: 'mm' };
        assert.equal(verifyDocument(doc, 'mm').state, 'malformed');
    });

    test('a signature of the right shape but the wrong key is tampered, not an error', () => {
        const doc = clone();
        doc[FIELD] = { ...doc[FIELD], signature: 'ab'.repeat(64) };
        assert.equal(verifyDocument(doc, 'mm').state, 'tampered');
    });

    test('nonsense in author_id is malformed, and does not throw', () => {
        const doc = clone();
        doc[FIELD] = { ...doc[FIELD], author_id: 'not a key' };
        assert.equal(verifyDocument(doc, 'mm').state, 'malformed');
    });

    test('an array or a null is unsigned rather than a crash', () => {
        assert.equal(verifyDocument([], 'mm').state, 'unsigned');
        assert.equal(verifyDocument(null, 'mm').state, 'unsigned');
    });
});

describe('an archive BMM signed', () => {
    // A .bmmplug is a ZIP, so the signature is an ENTRY: an ordinary signed document whose
    // content is every other entry and its SHA-256. The fixture is printed by BMM's own test
    // — the exact bytes it produced — and the three entries here are the ones that break a
    // careless implementation: a JSON manifest, a script, and a binary icon.
    const manifest = JSON.parse(readFileSync(
        fileURLToPath(new URL('./fixtures-bmm-signed-archive.json', import.meta.url)), 'utf8'));

    const files = () => [
        { name: 'plugin.json', data: Buffer.from('{"id":"demo","name":"Demo"}') },
        { name: 'scripts/run.js', data: Buffer.from('export const go = () => 1;\n') },
        { name: 'icon.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]) },
        { name: ARCHIVE_ENTRY, data: Buffer.from(JSON.stringify(manifest)) },
    ];

    test('THE ONE: it verifies here', () => {
        assert.equal(verifyArchive(files(), 'bmmplug').state, 'valid');
    });

    test('a swapped script is caught even though the manifest is untouched', () => {
        // The failure that signing only plugin.json would miss entirely.
        const f = files();
        f[1].data = Buffer.from('export const go = () => evil();\n');
        const v = verifyArchive(f, 'bmmplug');
        assert.equal(v.state, 'tampered');
        assert.match(v.detail, /scripts\/run\.js was changed/);
    });

    test('an added file is caught', () => {
        const f = files();
        f.splice(1, 0, { name: 'extra.js', data: Buffer.from('anything') });
        assert.match(verifyArchive(f, 'bmmplug').detail, /extra\.js was added/);
    });

    test('a removed file is caught', () => {
        const f = files().filter((e) => e.name !== 'icon.png');
        assert.match(verifyArchive(f, 'bmmplug').detail, /icon\.png was removed/);
    });

    test('rewriting the list to match a swap breaks the signature over the list', () => {
        const f = files();
        const doc = JSON.parse(JSON.stringify(manifest));
        doc.entries[0].sha256 = '0'.repeat(64);
        f[3].data = Buffer.from(JSON.stringify(doc));
        assert.equal(verifyArchive(f, 'bmmplug').state, 'tampered');
    });

    test('a plugin signature does not vouch for a theme', () => {
        assert.equal(verifyArchive(files(), 'bmmtheme').state, 'malformed');
    });

    test('an archive with no signature entry is unsigned', () => {
        assert.equal(verifyArchive(files().slice(0, 3), 'bmmplug').state, 'unsigned');
    });
});
