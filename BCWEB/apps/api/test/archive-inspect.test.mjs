// Looking inside a submitted archive.
//
// Everything here is about what a REVIEWER is told. The failure that matters is not a crash:
// it is an archive that looks harmless in the panel and is not, or a path that was quietly
// tidied up before anybody saw it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { listArchive, readEntry, escapesArchive, looksTextual, TEXT_MAX, LIST_MAX } from '../src/lib/archive-inspect.mjs';

const entry = (name, body) => ({ name, data: Buffer.from(body) });

describe('escapesArchive', () => {
    test('THE ONE: a path that climbs out is reported, not normalised', () => {
        // Quietly fixing `../../etc/passwd` hides the single most interesting thing a reviewer
        // could be told about the file they are approving.
        assert.equal(escapesArchive('../../etc/passwd'), 'climbs out with ..');
        assert.equal(escapesArchive('plugin/../../x'), 'climbs out with ..');
    });

    test('an absolute path and a drive letter, on both slash styles', () => {
        assert.equal(escapesArchive('/etc/passwd'), 'absolute path');
        assert.equal(escapesArchive('C:\\Windows\\System32\\evil.dll'), 'drive letter');
        assert.equal(escapesArchive('..\\..\\x'), 'climbs out with ..');
    });

    test('an ordinary nested path is fine', () => {
        assert.equal(escapesArchive('plugin/assets/icon.png'), null);
        assert.equal(escapesArchive('a..b/file.json'), null, '".." inside a name is not a segment');
    });
});

describe('looksTextual', () => {
    test('a known extension is enough', () => {
        assert.equal(looksTextual('plugin.json', Buffer.from('{}')), true);
    });

    test('a NUL byte means binary, whatever it is called', () => {
        // An .exe renamed to .txt is exactly the case worth catching.
        assert.equal(looksTextual('readme.txt', Buffer.from([0x4d, 0x5a, 0x00, 0x01])), false);
    });

    test('a file with no extension is judged by its bytes', () => {
        assert.equal(looksTextual('LICENSE', Buffer.from('MIT')), true);
        assert.equal(looksTextual('blob', Buffer.from([1, 2, 0, 3])), false);
    });
});

describe('listArchive', () => {
    const entries = [
        entry('plugin.json', '{"name":"x"}'),
        entry('assets/icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])),
        entry('../escape.txt', 'hi'),
    ];

    test('every entry is listed with its size and whether it can be read', () => {
        const r = listArchive(entries);
        assert.equal(r.total, 3);
        assert.equal(r.entries[0].text, true);
        assert.equal(r.entries[1].text, false);
        assert.equal(r.bytes, entries.reduce((n, e) => n + e.data.length, 0));
    });

    test('a dangerous path is raised to the top, not left in the list to be spotted', () => {
        const r = listArchive(entries);
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /escape\.txt — climbs out/);
    });

    test('an enormous archive is cut, and says so', () => {
        // 40 000 files is itself a signal; the count survives even though the list does not.
        const many = Array.from({ length: LIST_MAX + 50 }, (_, i) => entry(`f${i}.txt`, 'x'));
        const r = listArchive(many);
        assert.equal(r.total, LIST_MAX + 50);
        assert.equal(r.listed, LIST_MAX);
        assert.equal(r.truncated, true);
    });

    test('rubbish in is an empty listing, not a crash', () => {
        assert.equal(listArchive(null).total, 0);
        assert.equal(listArchive([null]).entries.length, 1, 'a broken entry is still an entry the reviewer should see');
    });
});

describe('readEntry', () => {
    const entries = [entry('a.json', '{"x":1}'), entry('big.txt', 'y'.repeat(TEXT_MAX + 100)), entry('bin', Buffer.from([0, 1, 2]))];

    test('a text entry comes back as text', () => {
        assert.equal(readEntry(entries, 'a.json').text, '{"x":1}');
    });

    test('a long entry is cut and says so, with the real size', () => {
        const r = readEntry(entries, 'big.txt');
        assert.equal(r.truncated, true);
        assert.equal(r.text.length, TEXT_MAX);
        assert.equal(r.size, TEXT_MAX + 100, 'the size is the file\'s, not the slice\'s');
    });

    test('a binary entry is named as binary rather than rendered as mojibake', () => {
        const r = readEntry(entries, 'bin');
        assert.equal(r.binary, true);
        assert.equal(r.text, undefined);
    });

    test('an entry that is not there is null, not an empty file', () => {
        assert.equal(readEntry(entries, 'nope'), null);
    });
});
