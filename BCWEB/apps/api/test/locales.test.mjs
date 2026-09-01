// B9 — runtime-locale helpers. Pure functions, no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidLocaleCode, publicLocaleList, sanitizeStrings, RESERVED_CODES,
} from '../src/lib/locales.mjs';

test('the picker lists the compiled base first, then enabled runtime locales in order', () => {
  const list = publicLocaleList([
    { code: 'zh-Hans', nativeName: '简体中文', rtl: false, enabled: true, order: 2 },
    { code: 'he', nativeName: 'עברית', rtl: true, enabled: true, order: 1 },
    { code: 'ru', nativeName: 'Русский', rtl: false, enabled: false, order: 0 }, // disabled → hidden
  ]);
  assert.deepEqual(list.map((l) => l.code), ['en', 'fr', 'he', 'zh-Hans']);
  assert.equal(list.find((l) => l.code === 'he').rtl, true);
});

test('en/fr can never be re-added as runtime rows', () => {
  assert.ok(RESERVED_CODES.has('en'));
  assert.ok(RESERVED_CODES.has('fr'));
  // even if a row with code 'en' somehow existed, it is filtered out of the public list
  const list = publicLocaleList([{ code: 'en', nativeName: 'X', enabled: true, order: 0 }]);
  assert.equal(list.filter((l) => l.code === 'en').length, 1); // only the base one
});

test('locale codes are validated (BCP-47-ish)', () => {
  assert.ok(isValidLocaleCode('ru'));
  assert.ok(isValidLocaleCode('zh-Hans'));
  assert.ok(isValidLocaleCode('pt-BR'));
  assert.ok(!isValidLocaleCode('x'));            // too short
  assert.ok(!isValidLocaleCode('en_US'));        // underscore, not a hyphen
  assert.ok(!isValidLocaleCode('../etc'));       // junk
  assert.ok(!isValidLocaleCode(''));
});

test('strings map keeps only string→string entries', () => {
  const s = sanitizeStrings({ 'nav.home': 'Дом', bad: 42, nested: { a: 1 }, ok: 'yes' });
  assert.deepEqual(s, { 'nav.home': 'Дом', ok: 'yes' });
  assert.deepEqual(sanitizeStrings(null), {});
  assert.deepEqual(sanitizeStrings([1, 2]), {});
});
