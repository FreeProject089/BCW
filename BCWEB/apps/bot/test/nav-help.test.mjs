// The two shared mechanisms every card now leans on:
//   · nav.mjs — a screen knows what it was opened from, and draws one Back button to it;
//   · help.mjs — one explanation per feature, read by the Learn more buttons AND by /help.
//
// What is pinned here is what silently breaks them: an origin token that outgrows Discord's
// 100-character custom_id limit, a Learn more button naming a feature nobody wrote, a help
// page missing in one language, and a help card over the 40-component cap.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ui from '../src/ui.mjs';
import * as nav from '../src/nav.mjs';
import { makeT, BASE, LANGS } from '../src/i18n.mjs';
import { FEATURES, HELP_KEYS, helpCard, helpIndexCard, learnButton } from '../src/help.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.mjs') ? [p] : []; });
const source = () => files(SRC).map((f) => [f.slice(SRC.length + 1), readFileSync(f, 'utf8')]);

describe('help content', () => {
  test('every feature has a title and a body, in every language', () => {
    const missing = [];
    for (const lang of LANGS) {
      for (const f of FEATURES) for (const k of [`help.${f.key}.t`, `help.${f.key}.b`]) if (!BASE[lang][k]) missing.push(`${lang}:${k}`);
    }
    assert.deepEqual(missing, []);
  });

  test('every Learn more button in the bot names a feature that exists', () => {
    const bad = [];
    for (const [name, text] of source()) {
      for (const m of text.matchAll(/learnButton\(\s*\w+\s*,\s*'([a-z_]+)'/g)) if (!HELP_KEYS.includes(m[1])) bad.push(`${name}: ${m[1]}`);
    }
    assert.deepEqual(bad, []);
  });

  test('a help page and the index stay inside the component cap', () => {
    const t = makeT('en');
    for (const f of FEATURES) assert.ok(ui.countComponents(ui.card(helpCard(t, f.key, { from: 'cas' }))) <= ui.MAX_COMPONENTS, f.key);
    assert.ok(ui.countComponents(ui.card(helpIndexCard(t))) <= ui.MAX_COMPONENTS);
  });

  test('an unknown topic answers instead of throwing', () => {
    const card = helpCard(makeT('en'), 'no-such-feature');
    assert.equal(card.body, makeT('en')('help.unknown'));
  });

  test('the Learn more button carries the feature in its id and fits a custom id', () => {
    const b = learnButton(makeT('en'), 'casino').toJSON();
    assert.equal(b.custom_id, 'help:more:casino');
    assert.ok(b.custom_id.length <= 100);
  });
});

describe('navigation origins', () => {
  test('a token keeps its arguments and drops only the empty tail', () => {
    assert.equal(nav.origin('shop', 2), 'shop~2');
    // `num` is empty for every game but roulette, and it sits in the MIDDLE: dropping it
    // would slide `risk` into the target slot when the token is unpacked by position.
    assert.equal(nav.origin('casg', 'plinko', 500, 'red', '', 2, 'high'), 'casg~plinko~500~red~~2~high');
    assert.equal(nav.origin('hist', ''), 'hist');
  });

  test('the worst case the bot builds still fits Discord`s 100-character custom id', () => {
    // The longest origin is a casino game page, and the longest id carrying one is an eco
    // cross-link with that origin appended.
    const token = nav.origin('casg', 'roulette', 999999999, 'number', 36, 50, 'medium');
    assert.ok(token.length <= nav.TOKEN_MAX, token);
    assert.ok(nav.withOrigin('eco:leaderboard', token).length <= 100);
    assert.ok(`nav:${token}`.length <= 100);
  });

  test('a token is stripped of anything that would break the id it travels in', () => {
    assert.equal(nav.origin('shop', 'a:b c'), 'shop~abc');
  });

  test('Back is drawn only for a screen nav can actually re-open', () => {
    const t = makeT('en');
    assert.equal(nav.backButton(t, ''), null);
    assert.equal(nav.backButton(t, 'nothing-registered'), null);
    nav.register('testscreen', () => {});
    assert.equal(nav.backButton(t, 'testscreen~7').toJSON().custom_id, 'nav:testscreen~7');
    assert.equal(nav.backButtons(t, 'testscreen~7').length, 1);
  });

  test('an unknown origin answers the click instead of leaving it hanging', async () => {
    let said = null;
    const fake = { reply: (m) => { said = m; return Promise.resolve(); } };
    await nav.openOrigin(fake, 'gone~1', makeT('en'));
    assert.ok(said, 'the click was answered');
  });
});

describe('custom ids', () => {
  test('no literal custom id in the bot is already over the limit', () => {
    const bad = [];
    for (const [name, text] of source()) {
      for (const m of text.matchAll(/setCustomId\('([^']+)'\)/g)) if (m[1].length > 100) bad.push(`${name}: ${m[1]}`);
    }
    assert.deepEqual(bad, []);
  });
});
