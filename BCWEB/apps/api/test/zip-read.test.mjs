// The browser-side ZIP reader, tested against archives a real zip tool wrote.
//
// It lives in apps/web because that is where it runs, and it is tested here because this is
// where the test runner is. Nothing in it is browser-only: File is a Blob, and Node has
// Blob, DecompressionStream and TextDecoder.
//
// What is actually being asserted: that listing an archive READS ONLY ITS INDEX. That is the
// whole reason the module exists — the inspector could not open a `.DATABMM` because the old
// path base64'd the entire file into a JSON body. A test that only checked "the names come
// back" would pass just as happily against an implementation that loads a gigabyte.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { listZip, readZipEntry, escapesArchive } from '../../web/src/lib/zip-read.js';

/** A Blob that counts what was read from it, and from where. */
function countingFile(buf) {
    const blob = new Blob([buf]);
    const reads = [];
    return {
        size: blob.size,
        reads,
        slice(start, end) {
            reads.push([start, end]);
            return blob.slice(start, end);
        },
    };
}

function zipOf(files) {
    const z = new AdmZip();
    for (const [name, body] of files) z.addFile(name, Buffer.from(body));
    return z.toBuffer();
}

describe('listing', () => {
    test('names, sizes and the entry count', async () => {
        const buf = zipOf([['a.json', '{"x":1}'], ['deep/b.txt', 'hello'], ['c.bin', Buffer.from([1, 0, 2])]]);
        const out = await listZip(countingFile(buf));
        assert.equal(out.total, 3);
        assert.deepEqual(out.entries.map((e) => e.name).sort(), ['a.json', 'c.bin', 'deep/b.txt']);
        assert.equal(out.entries.find((e) => e.name === 'deep/b.txt').size, 5);
    });

    test('THE ONE: listing reads the index, not the archive', async () => {
        // 4 MB of entries. If listing ever loads the file, this read total jumps by ~4 MB and
        // the .DATABMM case is quietly broken again.
        const big = Buffer.alloc(1024 * 1024, 0x41);
        const buf = zipOf([['one.bin', big], ['two.bin', big], ['three.bin', big], ['four.bin', big]]);
        const file = countingFile(buf);
        await listZip(file);
        const read = file.reads.reduce((n, [s, e]) => n + (Math.min(e, file.size) - Math.max(0, s)), 0);
        assert.ok(read < 200 * 1024, `listing read ${read} bytes of a ${buf.length}-byte archive`);
    });

    test('directory entries are not listed as files', async () => {
        const z = new AdmZip();
        z.addFile('folder/', Buffer.alloc(0));
        z.addFile('folder/x.txt', Buffer.from('x'));
        const out = await listZip(countingFile(z.toBuffer()));
        assert.deepEqual(out.entries.map((e) => e.name), ['folder/x.txt']);
    });

    test('an escaping path is reported, not normalised', async () => {
        // Written by hand: the zip library normalises `..` away when ADDING an entry, which
        // is precisely why the reader cannot assume an archive was written by one. Same
        // length, so only the bytes of the name change and every offset still lines up.
        const placeholder = 'xx/xx/etc/passwd';
        const buf = zipOf([[placeholder, 'root:x']]);
        const hostile = Buffer.from(
            buf.toString('latin1').split(placeholder).join('../../etc/passwd'), 'latin1');
        const out = await listZip(countingFile(hostile));
        assert.equal(out.entries[0].name, '../../etc/passwd');
        assert.equal(out.entries[0].unsafe, 'climbs out with ..');
        assert.equal(out.warnings.length, 1);
    });

    test('a file that is not a zip says so', async () => {
        await assert.rejects(() => listZip(countingFile(Buffer.from('not a zip at all'))), /not a zip/);
    });
});

describe('opening one entry', () => {
    test('deflated text comes back decoded', async () => {
        // Long enough that the zip tool actually deflates it rather than storing it.
        const body = 'the quick brown fox '.repeat(500);
        const buf = zipOf([['big.txt', body], ['other.txt', 'x']]);
        const file = countingFile(buf);
        const list = await listZip(file);
        const row = list.entries.find((e) => e.name === 'big.txt');
        const got = await readZipEntry(file, row);
        assert.equal(got.binary, false);
        assert.equal(got.text, body);
    });

    test('opening one entry does not read the others', async () => {
        const big = Buffer.alloc(2 * 1024 * 1024, 0x42);
        const buf = zipOf([['small.txt', 'hi'], ['huge.bin', big]]);
        const file = countingFile(buf);
        const list = await listZip(file);
        file.reads.length = 0;
        await readZipEntry(file, list.entries.find((e) => e.name === 'small.txt'));
        const read = file.reads.reduce((n, [s, e]) => n + (Math.min(e, file.size) - Math.max(0, s)), 0);
        assert.ok(read < 4096, `opening a 2-byte entry read ${read} bytes`);
    });

    test('the BYTES decide what is binary, overruling the name', async () => {
        // An executable renamed to .txt is exactly the entry worth catching; the listing's
        // extension guess would have called it text.
        const buf = zipOf([['innocent.txt', Buffer.from([0x4d, 0x5a, 0x00, 0x00, 0x01])]]);
        const file = countingFile(buf);
        const list = await listZip(file);
        assert.equal(list.entries[0].text, true, 'the listing guessed text from .txt');
        assert.equal((await readZipEntry(file, list.entries[0])).binary, true, 'the bytes did not overrule it');
    });

    test('a stored (uncompressed) entry reads too', async () => {
        const z = new AdmZip();
        z.addFile('stored.txt', Buffer.from('plain'), '', 0);
        const file = countingFile(z.toBuffer());
        const list = await listZip(file);
        const got = await readZipEntry(file, list.entries[0]);
        assert.equal(got.text, 'plain');
    });

    test('a huge entry is refused by size instead of hanging the tab', async () => {
        const list = { size: 500 * 1024 * 1024, compressedSize: 1, method: 8, localOffset: 0 };
        const got = await readZipEntry(countingFile(Buffer.alloc(4)), list);
        assert.equal(got.tooBig, true);
    });
});

describe('escapesArchive', () => {
    test('the three shapes, and nothing else', () => {
        assert.equal(escapesArchive('a/b/c.txt'), null);
        assert.equal(escapesArchive('/etc/passwd'), 'absolute path');
        assert.equal(escapesArchive('C:\\Windows\\x'), 'drive letter');
        assert.equal(escapesArchive('a/../../b'), 'climbs out with ..');
        // A name that merely CONTAINS two dots is not an escape.
        assert.equal(escapesArchive('a/..b/c'), null);
    });
});
