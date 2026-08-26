// Reading a plugin's manifest in the inspector.
//
// The unknown-format hint has told moderators to "paste the plugin.json from inside" since
// it was written, and doing that returned "not a recognised BMM format". The advice was
// right; the reader was missing. This is that reader, and these tests pin the two things it
// exists to say.
//
// A plugin is the one thing in BMM that is CODE running inside somebody's app, so the order
// of the summary is the order of the decisions: what it may reach, whether it runs anything,
// what it changes, what it ships.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { detectFormat, inspectAny } = await import('../src/lib/bmm-formats.mjs');

const val = (rep, label) => rep.summary.find((r) => r.label === label)?.value;
const tone = (rep, label) => rep.summary.find((r) => r.label === label)?.tone;

const plug = (extra = {}) => ({
  id: 'dcs-helper',
  name: 'DCS Helper',
  version: '1.2',
  author: 'somebody',
  apply_mode: 'modlist',
  ...extra,
});

describe('a plugin manifest', () => {
  test('is recognised by a field only a plugin has', () => {
    assert.equal(detectFormat(plug()), 'bmmplug');
    assert.equal(detectFormat({ id: 'x', name: 'X', permissions: [] }), 'bmmplug');
  });

  test('a THEME is not mistaken for a plugin', () => {
    // Both carry id + name + author + description. Reading a theme as a plugin would report
    // permissions and scripts for a document that has neither — which is worse than
    // refusing it, because it looks like an answer.
    const theme = { id: 'bmm-default', name: 'Default', author: 'BMM', description: '', vars: { '--x': '#fff' } };
    assert.notEqual(detectFormat(theme), 'bmmplug');
  });

  test('permissions are the first thing said, and flagged', () => {
    const rep = inspectAny(plug({ permissions: ['mods.write', 'repo.write'] }));
    assert.equal(rep.ok, true);
    assert.equal(rep.title, 'DCS Helper');
    assert.equal(val(rep, 'Permissions'), 'mods.write, repo.write');
    assert.equal(tone(rep, 'Permissions'), 'warn');
  });

  test('a plugin that asks for nothing says so, unflagged', () => {
    // "none" rather than an absent row: a moderator scanning for the permissions line must
    // find it every time, or its absence reads as an oversight rather than as an answer.
    const rep = inspectAny(plug());
    assert.equal(val(rep, 'Permissions'), 'none');
    assert.equal(tone(rep, 'Permissions'), undefined);
  });

  test('either signal that it runs scripts is reported', () => {
    const named = inspectAny(plug({ scripts: ['setup.ps1'], has_scripts: true }));
    assert.equal(val(named, 'Runs scripts'), 'setup.ps1');
    assert.equal(tone(named, 'Runs scripts'), 'warn');

    // The checkbox ticked with an empty list still runs something. Saying nothing here
    // because there is no list would hide exactly the sloppier case.
    const unnamed = inspectAny(plug({ has_scripts: true }));
    assert.match(String(val(unnamed, 'Runs scripts')), /not listed/);
    assert.equal(tone(unnamed, 'Runs scripts'), 'warn');

    const neither = inspectAny(plug());
    assert.equal(val(neither, 'Runs scripts'), undefined);
  });

  test('a strict mod list says what strict means', () => {
    const rep = inspectAny(plug({
      modlist: { strict: true, required_mods: [{ name: 'A' }, { name: 'B' }] },
    }));
    assert.equal(String(val(rep, 'Requires mods')), '2');
    assert.match(String(val(rep, 'Strict list')), /turns everything else off/);
    assert.equal(tone(rep, 'Strict list'), 'warn');
  });

  test('shipped files are summarised, and shipped SCRIPTS are named', () => {
    const rep = inspectAny(plug({
      assets: [
        { path: 'README.md', kind: 'doc', size: 2048 },
        { path: 'tools/fix.ps1', kind: 'script', size: 900 },
        { path: 'codes.csv', kind: 'data', size: 400 },
      ],
    }));
    assert.match(String(val(rep, 'Ships files')), /1 doc/);
    assert.match(String(val(rep, 'Ships files')), /1 script/);
    assert.equal(tone(rep, 'Ships files'), 'warn');
    // Named, not counted: a moderator can go and ask about "tools/fix.ps1".
    assert.equal(val(rep, 'Shipped scripts'), 'tools/fix.ps1');

    assert.deepEqual(rep.detail.map((d) => d.name), ['README.md', 'tools/fix.ps1', 'codes.csv']);
    assert.match(rep.detail[0].note, /2 KB/);
  });

  test('shipping only documents is not flagged', () => {
    // A plugin with a README is the ordinary, good case. Flagging it would make the warn
    // tone meaningless on the row where it matters.
    const rep = inspectAny(plug({ assets: [{ path: 'README.md', kind: 'doc', size: 100 }] }));
    assert.equal(val(rep, 'Ships files'), '1 doc');
    assert.equal(tone(rep, 'Ships files'), undefined);
    assert.equal(val(rep, 'Shipped scripts'), undefined);
  });

  test('a plugin that ships nothing gets no files row', () => {
    const rep = inspectAny(plug());
    assert.equal(val(rep, 'Ships files'), undefined);
    assert.deepEqual(rep.detail, []);
  });
});
