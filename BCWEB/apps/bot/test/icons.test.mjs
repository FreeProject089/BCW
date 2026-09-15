// The bot's house rules for glyphs and component counts:
//   · no unicode emoji anywhere in the bot's source — every glyph is an icon-set key;
//   · a card never exceeds Discord's 40-component cap, whatever it is asked to show;
//   · a button asked for an unmapped icon is a plain button, never a stray emoji;
//   · the application-emoji sync uploads only what is missing and touches nothing foreign.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ButtonStyle } from 'discord.js';
import * as ui from '../src/ui.mjs';
import { makeT, BASE, LANGS } from '../src/i18n.mjs';
import { plan, parseName, emojiName } from '../src/features/icons.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.mjs') ? [p] : []; });
// Pictographs and the symbol blocks Discord renders as emoji. Arrows (→ ←) and the box-drawing
// / bar glyphs (▰ ▱ ▁…█) are typography, not emoji, and stay allowed.
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25B6}\u{25C0}\u{2705}\u{274C}\u{231A}\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}\u{25AB}\u{25FB}-\u{25FE}\u{2139}]/u;

describe('no unicode emoji in the bot', () => {
  test('every source file is clean', () => {
    const bad = [];
    for (const f of files(SRC)) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => { if (EMOJI.test(l)) bad.push(`${f.slice(SRC.length + 1)}:${i + 1}`); });
    }
    assert.deepEqual(bad, []);
  });

  test('a string resolves {ic:key} to the mapped emoji, or to nothing (blank included)', () => {
    ui.setAutoIcons({ start: '<:bc_start_0123abcd:123456789012345678>' });
    const t = makeT('en');
    assert.equal(t('live.race.go'), '<:bc_start_0123abcd:123456789012345678> Lights out!');
    ui.setAutoIcons({});
    ui.setIcons({});
    // Nothing mapped for `warn` → the text starts with the first word, no leading blank.
    assert.equal(makeT('en')('cas.onlyHave', { n: 5, cur: 'pts' }), 'You only have **5** pts.');
  });

  test('every language has the keys English has', () => {
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      const missing = Object.keys(BASE.en).filter((k) => !(k in BASE[lang]));
      assert.deepEqual(missing, [], lang);
    }
  });

  test('the crash game is gone from the dictionary', () => {
    assert.deepEqual(Object.keys(BASE.en).filter((k) => /crash/i.test(k)), []);
  });
});

describe('icons on buttons', () => {
  test('an unmapped key or a unicode emoji leaves the button plain', () => {
    ui.setAutoIcons({}); ui.setIcons({});
    assert.equal(ui.btn('x', 'Go', ButtonStyle.Primary, { emoji: 'casino' }).toJSON().emoji, undefined);
    assert.equal(ui.btn('x', 'Go', ButtonStyle.Primary, { emoji: '\u{1F3B0}' }).toJSON().emoji, undefined);
    assert.equal(ui.ic('casino'), '');
    assert.equal(ui.icx('casino'), '');
  });
  test('a mapped key or a custom token rides on the button; the admin mapping wins', () => {
    ui.setAutoIcons({ casino: '<:bc_casino_deadbeef:111111111111111111>' });
    assert.equal(ui.btn('x', 'Go', ButtonStyle.Primary, { emoji: 'casino' }).toJSON().emoji.id, '111111111111111111');
    ui.setIcons({ casino: '<a:mine:222222222222222222>', bogus: '\u{1F3B0}' });
    assert.equal(ui.btn('x', 'Go', ButtonStyle.Primary, { emoji: 'casino' }).toJSON().emoji.id, '222222222222222222');
    assert.equal(ui.ic('bogus'), '');
    assert.equal(ui.btn('x', 'Go', ButtonStyle.Primary, { emoji: '<:lit:333333333333333333>' }).toJSON().emoji.id, '333333333333333333');
    assert.equal(ui.icx('casino'), '<a:mine:222222222222222222> ');
    ui.setIcons({}); ui.setAutoIcons({});
  });
});

describe('the 40-component cap', () => {
  const b = (i) => ui.btn(`b${i}`, `B${i}`, ButtonStyle.Secondary);
  test('a card asked for twelve button sections, a thumb, a footer and five rows stays under 40', () => {
    const msg = ui.card({
      title: 'T', body: 'x', thumb: 'https://cdn.discordapp.com/a.png', footer: 'f',
      sections: Array.from({ length: 12 }, (_, i) => ({ text: `row ${i}`, button: b(100 + i) })),
      buttons: Array.from({ length: 25 }, (_, i) => b(i)),
    });
    assert.ok(ui.countComponents(msg) <= ui.MAX_COMPONENTS, String(ui.countComponents(msg)));
    // The rows were kept whole (the buttons are the point); the overflowing sections folded into text.
    const json = msg.components[0].toJSON();
    const rowsKept = json.components.filter((c) => c.type === 1).length;
    assert.equal(rowsKept, 5);
    const text = JSON.stringify(json);
    for (let i = 0; i < 12; i++) assert.ok(text.includes(`row ${i}`), `row ${i} still shown`);
  });
  test('the old games list shape (9 sections + 6 buttons) fits', () => {
    const msg = ui.card({ title: 'Casino', body: ['a', 'b'], thumb: 'https://cdn.discordapp.com/a.png', footer: 'f',
      sections: Array.from({ length: 9 }, (_, i) => ({ text: `g${i}`, button: b(50 + i) })), buttons: Array.from({ length: 6 }, (_, i) => b(i)) });
    assert.ok(ui.countComponents(msg) <= 40, String(ui.countComponents(msg)));
  });
  test('a plain card counts what Discord counts', () => {
    const msg = ui.card({ title: 'T', body: 'x', buttons: [b(1), b(2)] });
    // container + text + separator + row + 2 buttons
    assert.equal(ui.countComponents(msg), 6);
  });
});

describe('application-emoji sync planning', () => {
  test('names round-trip', () => {
    assert.deepEqual(parseName(emojiName('car_red', 'a1b2c3d4')), { key: 'car_red', version: 'a1b2c3d4' });
    assert.equal(parseName('someone_elses'), null);
    assert.equal(parseName('bc_casino'), null);
  });
  test('uploads only the missing or changed keys, deletes only our stale ones', () => {
    const keys = [{ key: 'casino', version: '11111111' }, { key: 'race', version: '22222222' }, { key: 'pot', version: '33333333' }];
    const existing = [
      { id: '1', name: 'bc_casino_11111111' },   // current
      { id: '2', name: 'bc_race_00000000' },     // stale version
      { id: '3', name: 'bc_old_44444444' },      // a key the site no longer draws
      { id: '4', name: 'partyparrot' },          // not ours
    ];
    const p = plan(keys, existing);
    assert.deepEqual([...p.have.keys()], ['casino']);
    assert.deepEqual(p.upload.map((k) => k.key), ['race', 'pot']);
    assert.deepEqual(p.stale.map((e) => e.id), ['2', '3']);
  });
});
