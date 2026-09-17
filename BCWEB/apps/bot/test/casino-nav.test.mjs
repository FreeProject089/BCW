// The two casino bugs the owner reported with screenshots, pinned so they cannot come back:
//
//   1. a RAW EMOJI TOKEN printed as text inside a button / menu label
//      (`<:bc_rename_…:1546305741365710878> Montant libre…`,
//       `Visibilité : <:bc_vis_server_…:1549822136829485066> Ce serveur`).
//      Discord draws `<:name:id>` only in MESSAGE text; in a label it prints the source.
//
//   2. Previous / Next walking a ring that contained screens which are not pages: `race` and
//      `pot` are live tables, so the list's Previous (the LAST entry of CASINO_GAMES) and the
//      first game's Previous both opened a table instead of going back.
//
// Plus the season command's card, which has to render in every language.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import * as ui from '../src/ui.mjs';
import { makeT, BASE, LANGS } from '../src/i18n.mjs';
import { CASINO_GAMES, PAGE_GAMES } from '../src/commands.mjs';
import { seasonStatusCard, seasonEveryLabel } from '../src/features/season.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.mjs') ? [p] : []; });
const TOKEN = /<a?:\w{2,32}:\d{15,22}>/;
const ICON = '<:bc_rename_1a2b3c4d:1546305741365710878>';

describe('an emoji token never survives in a label', () => {
  test('a button moves it out of the label and into the emoji slot', () => {
    ui.setAutoIcons({}); ui.setIcons({});
    const b = ui.btn('x', `${ICON} Montant libre…`).toJSON();
    assert.equal(b.label, 'Montant libre…');
    assert.equal(b.emoji.id, '1546305741365710878');
    // Mid-label too, and the double blank it leaves behind is closed up.
    const v = ui.btn('x', 'Visibilité : <:bc_vis_server_aab5b567:1549822136829485066> Ce serveur').toJSON();
    assert.equal(v.label, 'Visibilité : Ce serveur');
    assert.equal(v.emoji.id, '1549822136829485066');
  });

  test('an icon the caller named explicitly still wins over one found in the label', () => {
    ui.setAutoIcons({ casino: '<:bc_casino_deadbeef:111111111111111111>' });
    const b = ui.btn('x', `${ICON} Play`, ButtonStyle.Primary, { emoji: 'casino' }).toJSON();
    assert.equal(b.label, 'Play');
    assert.equal(b.emoji.id, '111111111111111111');
    ui.setAutoIcons({});
  });

  test('a select option strips its label and its description the same way', () => {
    const o = ui.option('custom', `${ICON} Custom amount…`, { description: `${ICON} Any amount`, selected: true }).toJSON();
    assert.equal(o.label, 'Custom amount…');
    assert.equal(o.description, 'Any amount');
    assert.equal(o.emoji.id, '1546305741365710878');
    assert.equal(o.default, true);
  });

  test('a label that is nothing but an icon keeps the icon, not a blank label', () => {
    const b = ui.btn('x', ICON).toJSON();
    assert.equal(b.label, undefined);
    assert.equal(b.emoji.id, '1546305741365710878');
  });

  test('every bet option the casino offers renders clean, cap or no cap', () => {
    ui.setAutoIcons({ rename: ICON });
    const t = makeT('fr');
    const bets = [
      ui.option(50, '50 points', {}),
      ui.option('all', t('cas.allIn', { n: '5,000', cur: 'points' }), {}),
      ui.option('all', t('cas.allInCap', { n: '100', cur: 'points' }), {}),
      ui.option('custom', t('cas.custom'), { description: t('cas.customDesc', { a: 5, b: 100 }) }),
    ].map((o) => o.toJSON());
    for (const o of bets) {
      assert.ok(!TOKEN.test(o.label), `token in a bet label: ${o.label}`);
      assert.ok(!TOKEN.test(o.description || ''), `token in a bet description: ${o.description}`);
    }
    assert.equal(bets[3].emoji.id, '1546305741365710878', 'the custom-amount icon rides in the emoji slot');
    ui.setAutoIcons({});
  });

  test('the casino builds no option by hand: every one of them goes through ui.option', () => {
    // The bug was one hand-built StringSelectMenuOptionBuilder per casino file, each putting a
    // dictionary string straight into setLabel. Neither file may grow another.
    const bad = [];
    for (const f of files(SRC).filter((p) => /commands\.mjs$|casino-.*\.mjs$/.test(p))) {
      if (/StringSelectMenuOptionBuilder/.test(readFileSync(f, 'utf8'))) bad.push(f.slice(SRC.length + 1));
    }
    assert.deepEqual(bad, []);
  });

  test('no dictionary string reaches a label with an icon token still in it', () => {
    // Belt and braces: whatever i18n resolves, the built component is what Discord sees.
    ui.setAutoIcons({ rename: ICON, vis_server: '<:bc_vis_server_aab5b567:1549822136829485066>', push: ICON, red: ICON, black: ICON, green: ICON });
    const bad = [];
    for (const lang of LANGS) {
      const t = makeT(lang);
      for (const key of ['cas.custom', 'live.pick.red', 'live.pick.black', 'live.pick.green', 'live.res.push']) {
        const j = ui.btn('x', t(key, { u: 'someone' })).toJSON();
        if (TOKEN.test(j.label || '')) bad.push(`${lang}:${key} -> ${j.label}`);
      }
      const vis = ui.btn('x', t('live.vis.btn', { v: t('live.vis.server') })).toJSON();
      if (TOKEN.test(vis.label || '')) bad.push(`${lang}:live.vis.btn -> ${vis.label}`);
    }
    assert.deepEqual(bad, []);
    ui.setAutoIcons({});
  });
});

describe('the Previous / Next walk', () => {
  test('the live tables are not pages, so they are not in the walk', () => {
    assert.deepEqual(CASINO_GAMES.filter((g) => g.live).map((g) => g.id), ['race', 'pot']);
    assert.deepEqual(PAGE_GAMES.map((g) => g.id), ['coinflip', 'dice', 'slots', 'roulette', 'wheel', 'plinko']);
    for (const g of PAGE_GAMES) assert.ok(!g.live, g.id);
  });

  test('the ring is [LIST, …pages]: both ends are the list, and it is symmetric', () => {
    // The walk as the two cards build it: the list steps to the first/last PAGE game, a game
    // steps to its neighbour or back to the list.
    const ring = ['list', ...PAGE_GAMES.map((g) => g.id)];
    const next = (x) => ring[(ring.indexOf(x) + 1) % ring.length];
    const prev = (x) => ring[(ring.indexOf(x) + ring.length - 1) % ring.length];
    assert.equal(next('list'), 'coinflip');
    assert.equal(prev('coinflip'), 'list', 'this is the bug: it used to be `pot`, a live table');
    assert.equal(prev('list'), 'plinko', 'and this one: it used to be `pot` too');
    assert.equal(next('plinko'), 'list');
    for (const x of ring) { assert.equal(prev(next(x)), x); assert.equal(next(prev(x)), x); }
  });
});

describe('/season', () => {
  test('the card names the season, the countdown and the schedule, in every language', () => {
    for (const lang of LANGS) {
      const c = seasonStatusCard(makeT(lang), {
        seasonNo: 5, next: '2026-09-15T04:00:00Z', since: '2026-09-01T04:00:00Z', lastResetAt: '2026-09-01T04:00:00Z',
        season: { every: 'custom_weeks', days: 2, resetXp: false },
      });
      const body = c.body.join('\n');
      assert.match(c.title, /5/, lang);
      assert.match(body, /<t:1789444800:R>/, lang);
      assert.ok(body.includes(seasonEveryLabel(makeT(lang), { every: 'custom_weeks', days: 2 })), lang);
      assert.ok(!/\{\w+\}/.test(body), `unfilled placeholder in ${lang}: ${body}`);
    }
  });

  test('no schedule says so instead of showing a countdown to nothing', () => {
    const c = seasonStatusCard(makeT('en'), { seasonNo: 2, next: null, season: { every: 'never' } });
    assert.ok(!/<t:\d+:R>/.test(c.body[0]));
    assert.equal(c.body[0], makeT('en')('season.now.none'));
  });

  test('a season length reads as the unit the admin picked', () => {
    const t = makeT('en');
    assert.equal(seasonEveryLabel(t, { every: 'custom', days: 45 }), 'every 45 day(s)');
    assert.equal(seasonEveryLabel(t, { every: 'custom_weeks', days: 2 }), 'every 2 week(s)');
    assert.equal(seasonEveryLabel(t, { every: 'custom_months', days: 3 }), 'every 3 month(s)');
    assert.equal(seasonEveryLabel(t, { every: 'quarterly' }), 'every quarter');
    assert.equal(seasonEveryLabel(t, { every: 'nonsense' }), 'no automatic reset');
    assert.equal(seasonEveryLabel(t, {}), 'no automatic reset');
  });

  test('every season key exists in every language', () => {
    const keys = Object.keys(BASE.en).filter((k) => k.startsWith('season.'));
    assert.ok(keys.length >= 20, String(keys.length));
    for (const lang of LANGS) for (const k of keys) assert.ok(BASE[lang][k], `${lang}:${k}`);
  });
});

describe('button columns', () => {
  const b = (i) => ui.btn(`b${i}`, `B${i}`);
  test('rowsOf lays buttons out in the asked number of columns, a select keeps its own row', () => {
    const shape = (rs) => rs.map((r) => r.components.length);
    assert.deepEqual(shape(ui.rowsOf(2, [b(1), b(2), b(3), b(4), b(5), b(6)])), [2, 2, 2]);
    assert.deepEqual(shape(ui.rowsOf(5, [b(1), b(2), b(3), b(4), b(5), b(6)])), [5, 1]);
    // Out-of-range asks fall back to Discord's own limit rather than throwing.
    assert.deepEqual(shape(ui.rowsOf(99, [b(1), b(2), b(3), b(4), b(5), b(6)])), [5, 1]);
    assert.deepEqual(shape(ui.rowsOf(0, [b(1), b(2), b(3), b(4), b(5), b(6)])), [5, 1]);
  });

  test('the games list shape — a dropdown then two columns of six buttons — fits the cap', () => {
    const menu = new StringSelectMenuBuilder().setCustomId('m').setPlaceholder('Open a game…')
      .addOptions(Array.from({ length: 8 }, (_, i) => ui.option(`g${i}`, `Game ${i}`)));
    const msg = ui.card({
      title: 'Casino', body: ['a', 'b'], thumb: 'https://cdn.discordapp.com/a.png', footer: 'f',
      buttonColumns: 2,
      buttons: [menu, ...Array.from({ length: 6 }, (_, i) => b(i))],
    });
    // container 1 + thumb section 3 + footer 2 + separator 1 + menu row 2 + three rows of 3.
    assert.equal(ui.countComponents(msg), 18);
    assert.ok(ui.countComponents(msg) <= ui.MAX_COMPONENTS);
    const rowLens = msg.components[0].toJSON().components.filter((c) => c.type === 1).map((r) => r.components.length);
    assert.deepEqual(rowLens, [1, 2, 2, 2], 'the dropdown, then two columns — not three');
  });
});
