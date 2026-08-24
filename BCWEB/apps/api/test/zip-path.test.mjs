// Zip entry names, which are instructions to an extractor and not merely strings.
//
// The defect this closes was live: the upload validator maps every character outside
// [A-Za-z0-9._-] to '_', and '.' is inside that set — so a path segment of exactly '..'
// passed through whole, was stored on the row, and went into the repo download zip as the
// entry name. Extracting that archive writes outside the folder you chose. The person
// extracting is not the person who picked the name: repo archives go to collaborators and
// to anyone holding the repo password.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { zipEntryName } from '../src/lib/zip-path.mjs';

const BS = String.fromCharCode(92);

describe('traversal', () => {
  test('THE ONE: a .. segment cannot survive', () => {
    assert.equal(zipEntryName('repos/x', '../../evil.txt'), 'repos/x/evil.txt');
    assert.equal(zipEntryName('repos/x', '..'), 'repos/x');
    assert.equal(zipEntryName('..', '..', '..'), 'unnamed');
  });

  test('a backslash is a separator too, because the extractor may be on Windows', () => {
    // POSIX sees one filename here; a Windows extractor sees traversal. The stricter
    // reading is the safe one.
    assert.equal(zipEntryName('repos/x', ['..', '..', 'evil.txt'].join(BS)), 'repos/x/evil.txt');
    assert.equal(zipEntryName('repos/x', ['sub', 'file.zip'].join(BS)), 'repos/x/sub/file.zip');
  });

  test('a leading slash cannot make the entry absolute', () => {
    assert.equal(zipEntryName('repos/x', '/etc/passwd'), 'repos/x/etc/passwd');
    assert.equal(zipEntryName('/', 'a.txt'), 'a.txt');
  });

  test('doubled separators collapse rather than producing empty segments', () => {
    assert.equal(zipEntryName('repos//x', 'a///b.txt'), 'repos/x/a/b.txt');
  });

  test('a single . is dropped, so a/./b is a/b and not a/_/b', () => {
    assert.equal(zipEntryName('a/./b.txt'), 'a/b.txt');
  });

  test('a Windows drive prefix cannot re-anchor the path', () => {
    assert.equal(zipEntryName('repos/x', 'C:/Windows/system32/x.dll'), 'repos/x/C_/Windows/system32/x.dll');
  });
});

describe('what it leaves alone', () => {
  test('an ordinary path is unchanged, dots and digits included', () => {
    assert.equal(zipEntryName('repos/My_Repo', 'mods/thing-1.2.3.zip'), 'repos/My_Repo/mods/thing-1.2.3.zip');
    assert.equal(zipEntryName('a.b.c/d_e-f/g.9.txt'), 'a.b.c/d_e-f/g.9.txt');
  });

  test('spaces and unicode survive — they are legal in a filename and not a risk', () => {
    assert.equal(zipEntryName('My Repo', 'un fichier accentué.zip'), 'My Repo/un fichier accentué.zip');
  });

  test('a dotfile keeps its leading dot', () => {
    // '.gitignore' is not a '.' segment, and treating it as one would silently drop files.
    assert.equal(zipEntryName('repos/x', '.gitignore'), 'repos/x/.gitignore');
  });
});

describe('hostile names', () => {
  test('a NUL or control character becomes an underscore, not a truncation', () => {
    const withNul = `a${String.fromCharCode(0)}b.txt`;
    assert.equal(zipEntryName(withNul), 'a_b.txt');
  });

  test('the characters Windows refuses in a filename are replaced', () => {
    assert.equal(zipEntryName('a<b>c:d"e|f?g*h.txt'), 'a_b_c_d_e_f_g_h.txt');
  });

  test('a trailing dot or space is stripped — Windows drops it silently on creation', () => {
    // 'report.' and 'report' would otherwise be two entries that become one file.
    assert.equal(zipEntryName('report.'), 'report');
    assert.equal(zipEntryName('report '), 'report');
  });

  test('a very long segment is bounded', () => {
    const seg = zipEntryName('x'.repeat(400));
    assert.equal(seg.length, 120);
  });

  test('nothing usable still yields a name, never an empty entry', () => {
    assert.equal(zipEntryName(''), 'unnamed');
    assert.equal(zipEntryName(null), 'unnamed');
    assert.equal(zipEntryName(undefined, '', '   '), 'unnamed');
    assert.equal(zipEntryName('///'), 'unnamed');
  });

  test('the result never starts with a separator', () => {
    for (const input of ['/a', '//a', `${BS}a`, '/../a', './/../a']) {
      assert.ok(!zipEntryName(input).startsWith('/'), `${input} produced an absolute entry`);
    }
  });
});
