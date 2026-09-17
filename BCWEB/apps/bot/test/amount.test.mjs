// The fifth thing the owner reported: "one of the bet-amount choices is buggy", and the ask
// that came with it — find the same class of bug everywhere else the bot reads an amount.
//
// The buggy choice is **Custom amount…**, the only one that is a free-text box. Every such box
// in the bot did the same thing:
//
//     Number(String(raw).replace(/[^0-9]/g, ''))
//
// That is not a parser. It deletes the characters that carry the meaning and keeps the digits
// that happened to be next to them, so it can only ever return a number — never "I could not
// read that". The tests below are the four ways it returned the WRONG number; each of them is
// red against that one-liner and green against amount.mjs.
//
// Three sites had it: the casino's custom-amount modal (commands.mjs), and the live table's
// join modal and join-by-code modal (casino-live.mjs, where it was written out twice).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAmount, resolveAmount, parseWholeInRange, parseChoice } from '../src/amount.mjs';
import { PICKS } from '../src/features/casino-live.mjs';
import { BASE, LANGS } from '../src/i18n.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.mjs') ? [p] : []; });
/** The old behaviour, kept here so the assertions can name what they are the opposite of. */
const oldStrip = (s) => Number(String(s ?? '').replace(/[^0-9]/g, ''));
const amount = (s, balance = null) => parseAmount(s, { balance });

describe('the custom-amount box: what the digit strip used to return', () => {
  test('a decimal point multiplied the bet by ten instead of rounding it', () => {
    assert.equal(oldStrip('2.5'), 25, 'this is the bug');
    assert.deepEqual(amount('2.5'), { ok: true, kind: 'abs', value: 2, pct: null });
    assert.equal(amount('10.5').value, 10);
    assert.equal(amount('0.9').value, 0);
  });

  test('a French decimal comma did the same thing, in the language most readers use', () => {
    assert.equal(oldStrip('1,5'), 15, 'this is the bug');
    assert.equal(amount('1,5').value, 1);
    assert.equal(amount('1,50').value, 1);
  });

  test('a minus sign was simply deleted, so a negative became a positive bet', () => {
    assert.equal(oldStrip('-50'), 50, 'this is the bug');
    assert.equal(amount('-50').ok, false);
    assert.equal(amount('-50').reason, 'nan');
  });

  test('a percentage was read as that many flat points', () => {
    assert.equal(oldStrip('50%'), 50, 'this is the bug');
    const r = amount('50%', 4000);
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'pct');
    assert.equal(r.value, 2000);
    // 100 % is all-in, which the card already knows how to cap.
    assert.equal(amount('100%', 4000).kind, 'all');
    assert.equal(amount('0%', 4000).ok, false);
    assert.equal(amount('150%', 4000).ok, false);
  });

  test('words were not read, they were mined for digits', () => {
    assert.equal(oldStrip('bet 20 max'), 20, 'this is the bug');
    assert.equal(oldStrip('20k'), 20, 'and this one');
    assert.equal(amount('bet 20 max').ok, false);
    assert.equal(amount('20k').ok, false);
    // …and an unreadable box now SAYS so instead of silently keeping the previous bet.
    assert.equal(amount('').reason, 'empty');
    assert.equal(amount('   ').reason, 'empty');
  });
});

describe('the custom-amount box: what it does read', () => {
  test('group separators, in every shape a client pastes them', () => {
    for (const s of ['1000', '1 000', '1 000', '1 000', '1,000', '1.000', "1'000", '1_000']) {
      assert.equal(amount(s).value, 1000, s);
    }
    assert.equal(amount('1,234,567').value, 1234567);
    assert.equal(amount('1.234.567').value, 1234567);
  });

  test('both separators together: the LAST one is the decimal point', () => {
    assert.equal(amount('1.234,56').value, 1234);
    assert.equal(amount('1,234.56').value, 1234);
  });

  test('the balance the bot itself prints can be pasted straight back in', () => {
    // `n()` is `toLocaleString('en-US')`, so a balance reads "1,000" on the card. Pasting that
    // into the box has to mean one thousand, which is why a lone separator with exactly three
    // digits after it is a GROUP separator.
    const shown = Number(12345).toLocaleString('en-US');
    assert.equal(shown, '12,345');
    assert.equal(amount(shown).value, 12345);
  });

  test('“all” — in each of the four languages the placeholder offers', () => {
    for (const w of ['all', 'ALL', 'all in', 'all-in', 'max', 'tapis', 'alles', 'todo']) {
      assert.equal(amount(w).kind, 'all', w);
    }
  });

  test('resolveAmount applies the balance and the cap, and never rounds up', () => {
    assert.equal(resolveAmount('all', { balance: 5000, max: 100 }), 100, 'the cap wins over the balance');
    assert.equal(resolveAmount('all', { balance: 40, max: Infinity }), 40);
    assert.equal(resolveAmount('33%', { balance: 100 }), 33);
    assert.equal(resolveAmount('33%', { balance: 10 }), 3, 'floored, never up');
    assert.equal(resolveAmount('2.9', { balance: 10 }), 2);
    assert.equal(resolveAmount('nonsense', { balance: 10 }), null);
  });
});

describe('the roulette number box had the same strip', () => {
  test('a decimal or a sign used to become a number that is not on the wheel', () => {
    assert.equal(oldStrip('3.7'), 37, 'this is the bug: 37 is not on a European wheel');
    assert.equal(oldStrip('-1'), 1);
    assert.equal(parseWholeInRange('3.7', 0, 36), null);
    assert.equal(parseWholeInRange('-1', 0, 36), null);
    assert.equal(parseWholeInRange('37', 0, 36), null);
    assert.equal(parseWholeInRange('0', 0, 36), 0, 'zero is a real pocket');
    assert.equal(parseWholeInRange('36', 0, 36), 36);
    assert.equal(parseWholeInRange(' 17 ', 0, 36), 17);
  });
});

describe('a CHOICE is checked against the list that was offered', () => {
  test('a pick that no control offers is refused, not coerced', () => {
    assert.equal(parseChoice('0', PICKS.race), 0, 'car 1 is index 0, which is falsy — it must survive');
    assert.equal(parseChoice('5', PICKS.race), 5);
    assert.equal(parseChoice('6', PICKS.race), null, 'there is no seventh car');
    assert.equal(parseChoice('abc', PICKS.race), null, 'used to be NaN, a seat that loses every round');
    assert.equal(parseChoice('50', PICKS.wheel), 50);
    assert.equal(parseChoice('7', PICKS.wheel), null, 'the wheel has no 7×');
    assert.equal(parseChoice('heads', PICKS.coinflip), 'heads');
    assert.equal(parseChoice('edge', PICKS.coinflip), null);
    assert.equal(parseChoice('green', PICKS.roulette), 'green');
    assert.equal(parseChoice(null, PICKS.roulette), null);
  });

  test('PICKS is the same list the controls draw — one ordering, not two', () => {
    assert.deepEqual(PICKS.race, [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(PICKS.wheel, [2, 3, 5, 10, 20, 50]);
    const src = readFileSync(join(SRC, 'features', 'casino-live.mjs'), 'utf8');
    assert.ok(src.includes('PICKS.wheel.map'), 'the wheel menu must be built FROM PICKS');
    assert.ok(!/addOptions\(\[2, 3, 5, 10, 20, 50\]/.test(src), 'no second copy of the multiplier list');
  });
});

describe('no box in the bot mines a string for digits any more', () => {
  test('the digit strip is gone from every amount the bot reads', () => {
    const bad = [];
    for (const f of files(SRC)) {
      const s = readFileSync(f, 'utf8');
      s.split('\n').forEach((line, k) => {
        // The one in amount.mjs' own comment block is the description of the bug.
        if (/replace\(\/\[\^0-9\]\/g/.test(line) && !/^\s*(\/\/|\*)/.test(line)) bad.push(`${f.slice(SRC.length + 1)}:${k + 1}`);
      });
    }
    assert.deepEqual(bad, []);
  });
});

describe('a missing dictionary key is shown to the player as its own name', () => {
  test('every t(\'…\') key in the bot exists in English', () => {
    // `makeT` ends in `?? key`, so a key nobody wrote prints the key. `cas.notyours` did
    // exactly that: `t('cas.notyours', 'That is not your game — …')` passed a SENTENCE where
    // `t` takes VARIABLES, the sentence was ignored, and the player read "cas.notyours".
    const missing = new Set();
    for (const f of files(SRC)) {
      if (/i18n\.mjs$/.test(f)) continue;
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\bt\(\s*'([a-z][\w]*(?:\.[\w]+)+)'/gi)) if (!BASE.en[m[1]]) missing.add(`${m[1]} (${f.slice(SRC.length + 1)})`);
    }
    assert.deepEqual([...missing], []);
  });

  test('t() is never handed a fallback sentence where it expects variables', () => {
    const bad = [];
    for (const f of files(SRC)) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\bt\(\s*'[\w.]+'\s*,\s*['"`]/g)) bad.push(`${f.slice(SRC.length + 1)}: ${m[0]}`);
    }
    assert.deepEqual(bad, []);
  });

  test('the new amount strings exist in all four languages, with their placeholder intact', () => {
    const keys = ['cas.notyours', 'cas.badAmount', 'cas.badNumber', 'cas.modal.betTitle', 'cas.modal.bet', 'cas.modal.betPh', 'cas.modal.numTitle', 'cas.modal.num'];
    for (const lang of LANGS) for (const k of keys) assert.ok(BASE[lang][k], `${lang}:${k}`);
    for (const lang of LANGS) {
      assert.match(BASE[lang]['cas.badAmount'], /\{v\}/, lang);
      assert.match(BASE[lang]['cas.badNumber'], /\{v\}/, lang);
      // The placeholder has to offer a word this parser actually accepts in that language.
      const word = BASE[lang]['cas.modal.betPh'].split('·').pop().trim();
      assert.equal(parseAmount(word).kind, 'all', `${lang}: the box offers “${word}”`);
    }
  });
});
