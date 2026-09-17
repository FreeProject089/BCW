// The weak-password rule, exercised rather than read.
//
// It was broken and looked fine. `/^(.)\1+$/` is "the same character, repeated"; the `\1`
// had become a raw 0x01 byte, so the pattern read "any character followed by one or more
// 0x01" and matched nothing a person can type. `aaaaaaaa` was accepted as a strong password,
// and Node prints that pattern as /^(.)+$/ because the byte is invisible, so neither reading
// the line nor logging the regex would have shown it.
//
// This is the third time this repo has been bitten by a control byte inside a pattern (a
// generated `\b` twice became 0x08, a regex that is valid and matches nothing, green for
// ever). source-bytes.test.mjs now refuses the byte; this refuses the silence, by asserting
// what the rule is FOR rather than what it is written as.
//
// `isWeakPassword` is not exported, so the function is read out of the source and evaluated
// on its own. That keeps the test on the real text: a copy here would be the thing that
// stays right while the original rots.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/routes/auth.mjs', import.meta.url)), 'utf8');

const cut = (from, to) => {
  const a = src.indexOf(from);
  assert.notEqual(a, -1, `${from} is gone from auth.mjs, so this test is checking nothing`);
  const b = src.indexOf(to, a);
  assert.notEqual(b, -1, `${to} is gone from auth.mjs`);
  return src.slice(a, b + to.length);
};

const list = cut('const WEAK_PASSWORDS', ']);');
const fn = cut('function isWeakPassword', '\n}');
// eslint-disable-next-line no-new-func
const isWeakPassword = new Function(`${list}\n${fn}\nreturn isWeakPassword;`)();

describe('isWeakPassword', () => {
  test('a single character repeated is weak, at any length', () => {
    for (const pw of ['aaaaaaaa', 'AAAAAAAAAAAA', '11111111', '........', 'zz']) {
      assert.equal(isWeakPassword(pw), true, `${pw} should be weak`);
    }
  });

  test('the leetspeak folding does not let a weak one through', () => {
    // The rule lowercases and folds 4→a, 0→o, 1/!/|→l, 3→e, $/5→s, 7→t before it looks, so
    // a "clever" spelling of a listed password is still that password.
    for (const pw of ['P@ssw0rd', 'p4ssw0rd', 'PASSWORD']) {
      assert.equal(isWeakPassword(pw), true, `${pw} folds to something on the list`);
    }
  });

  test('a straight run of the alphabet or the digits is weak', () => {
    for (const pw of ['abcdefgh', 'ijklmnop', '01234567', '1234567890', '87654321', '890123']) {
      assert.equal(isWeakPassword(pw), true, `${pw} should be weak`);
    }
  });

  test('EVERY entry on the list is refused when it is typed', () => {
    // The property rather than a handful of examples, because this is precisely what went
    // wrong: the fold ran before the lookup, so an entry that is not its own fold could never
    // be matched by somebody typing it. Twelve of the thirty-eight were in that state,
    // including 12345678, 123456789, 1234567890, admin123 and root1234. A list a third of
    // which is decoration is worse than a shorter list, because it reads as covered.
    const entries = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((v) => v.length > 3);
    assert.ok(entries.length > 20, `read ${entries.length} entries, the list shape moved`);
    assert.deepEqual(entries.filter((e) => !isWeakPassword(e)), [], 'on the weak list and accepted');
  });

  test('an ordinary password is not refused', () => {
    // The cost of a false positive here is somebody unable to choose a good password, so the
    // rule has to stay narrow. `abababab` in particular is NOT one character repeated, and
    // `1379` is four digits that are not a run.
    //
    // `a1b2c3d4` is deliberately absent from this list: it IS on the weak list, and it was
    // one of the twelve the fold made unreachable, so it refuses now and that is the fix.
    for (const pw of ['abababab', 'correct-horse-battery', 'Tr0ub4dour&3', 'ceci-est-un-mot-de-passe', '1379']) {
      assert.equal(isWeakPassword(pw), false, `${pw} should be allowed`);
    }
  });

  test('the repeated-character rule is a real backreference', () => {
    // The regression itself, named: a pattern that cannot match, spelled so it looks like one
    // that can. If this line ever reads `/^(.)+$/` again, the rule above it is decoration.
    assert.match(src, /if \(\/\^\(\.\)\\1\+\$\/\.test\(raw\)\) return true;/);
  });
});
