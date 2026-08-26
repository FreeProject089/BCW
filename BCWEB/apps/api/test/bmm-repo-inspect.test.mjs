// Reading a Server-Repo manifest in the inspector.
//
// `repo.json` is the file a moderator opening a hosted repo is most likely to be holding,
// and until now it fell through every branch and came back as "not a recognised BMM
// format" — which says the file is junk about the most ordinary document in the system.
//
// It matters more now than it did, because a repo stopped being only mods. It can carry a
// plugin (code that runs inside BMM) and an automation (code that runs commands on the
// machine). BMM ticks neither by default and installs both disabled; this reader is the
// only place a moderator ever SEES that a repo contains any, so "1 plugin" appearing in the
// summary, flagged, is the whole point of the format existing here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { detectFormat, inspectAny } = await import('../src/lib/bmm-formats.mjs');

const val = (rep, label) => rep.summary.find((r) => r.label === label)?.value;
const tone = (rep, label) => rep.summary.find((r) => r.label === label)?.tone;

const repo = (extra = {}) => ({
  name: 'Squadron repo',
  author: 'somebody',
  version: '1.2',
  game_name: 'DCS',
  created_at: '2026-08-26T00:00:00Z',
  profiles: [{ id: 'p1', name: 'Main', game_name: 'DCS', mods: [] }],
  ...extra,
});

describe('a Server-Repo manifest', () => {
  test('is recognised by its shape', () => {
    assert.equal(detectFormat(repo()), 'repo');
  });

  test('a mod LIST is not mistaken for a repo', () => {
    // Both carry `name` and a version-ish field. The separator is `profiles`, and getting
    // this wrong would route a list to a reader that reports none of what a list is for.
    assert.equal(detectFormat({ format_version: '1.0', name: 'A list', mods: [] }), 'mm');
  });

  test('the mods are counted across every profile, and their hosts named', () => {
    const rep = inspectAny(repo({
      profiles: [
        { id: 'a', name: 'A', mods: [
          { id: '1', name: 'One', download_links: [{ url: 'https://cdn.example.com/a.zip' }] },
          { id: '2', name: 'Two', download_links: [{ url: 'https://cdn.example.com/b.zip' }] },
        ] },
        { id: 'b', name: 'B', mods: [
          { id: '3', name: 'Three', download_links: [{ url: 'https://github.com/x/y.zip' }] },
        ] },
      ],
    }));
    assert.equal(rep.ok, true);
    assert.equal(rep.title, 'Squadron repo');
    assert.equal(String(val(rep, 'Profiles')), '2');
    assert.equal(String(val(rep, 'Mods')), '3');
    assert.equal(val(rep, 'Download hosts'), 'cdn.example.com (2), github.com (1)');
  });

  test('a manifest whose files live on another host says so, and is flagged', () => {
    // Normal, and important: the manifest was approved here and the bytes come from
    // somewhere nobody in this queue has looked at.
    const rep = inspectAny(repo({ files_base_url: 'https://elsewhere.test/files' }));
    assert.equal(val(rep, 'Files served from'), 'https://elsewhere.test/files');
    assert.equal(tone(rep, 'Files served from'), 'warn');
  });

  test('a repo with no extras does not get an extras row', () => {
    // Absent rather than "none": a row that is always there is a row people stop reading,
    // and this is the row that has to be noticed the day it says "1 plugin".
    const rep = inspectAny(repo());
    assert.equal(val(rep, 'Also carries'), undefined);
    assert.equal(val(rep, 'Code in this repo'), undefined);
    assert.deepEqual(rep.detail, []);
  });

  test('extras are summarised, and CODE is flagged and named', () => {
    const rep = inspectAny(repo({
      extras: [
        { kind: 'theme', id: 't', name: 'Night' },
        { kind: 'plugin', id: 'dcs-helper', name: 'DCS Helper', author: 'someone',
          file: { relative_path: 'p.bmmplug', size: 10, sha256_hash: 'abc' } },
        { kind: 'catalog', id: 'c', name: 'Their catalogue', url: 'https://cat.example/catalog.json' },
      ],
    }));
    assert.match(String(val(rep, 'Also carries')), /1 theme/);
    assert.match(String(val(rep, 'Also carries')), /1 plugin/);
    assert.equal(tone(rep, 'Also carries'), 'warn', 'a repo carrying code is not the same object as a repo of mods');
    // Named, not counted: "1 plugin" is a number, "DCS Helper" is something to go and look at.
    assert.equal(val(rep, 'Code in this repo'), 'DCS Helper');

    const names = rep.detail.map((d) => d.name);
    assert.deepEqual(names, ['Night', 'DCS Helper', 'Their catalogue']);
    assert.match(rep.detail[2].note, /cat\.example/);
  });

  test('extras with nothing vouching for them say so', () => {
    // An empty hash is a manifest that never carried one. It installs — and it is the
    // difference between "checked and correct" and "nothing to check against", which only
    // one of the two is reassuring about.
    const rep = inspectAny(repo({
      extras: [{ kind: 'plugin', id: 'p', name: 'Unsigned thing',
        file: { relative_path: 'p.bmmplug', size: 10, sha256_hash: '' } }],
    }));
    assert.match(rep.detail[0].note, /NO HASH/);
  });

  test('a locked mod list carried by a repo is flagged in its line', () => {
    const rep = inspectAny(repo({
      extras: [{ kind: 'modlist', id: 'm', name: 'Secret Ops', locked: true,
        file: { relative_path: 'm.mm', size: 10, sha256_hash: 'abc' } }],
    }));
    assert.match(rep.detail[0].note, /locked/);
  });

  test('a kind this build does not know keeps its own name', () => {
    // A repo published by a newer BMM must not read as a repo with something missing from
    // it. The kind is shown as written rather than dropped or guessed at.
    const rep = inspectAny(repo({ extras: [{ kind: 'hologram', id: 'h', name: 'From the future' }] }));
    assert.match(String(val(rep, 'Also carries')), /hologram/);
    assert.match(rep.detail[0].note, /hologram/);
    assert.equal(tone(rep, 'Also carries'), undefined, 'unknown is not the same as dangerous');
  });
});
