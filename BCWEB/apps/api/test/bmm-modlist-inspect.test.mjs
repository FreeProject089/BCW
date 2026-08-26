// Reading a shared mod list in the inspector.
//
// A `.mm` is the file people pass around most, and the two questions a moderator is holding
// when they open one are where its mods are DOWNLOADED from and where they will UPDATE
// from. Those are different questions with different answers, and the second is the one with
// teeth: installing a shared list wires every mod to whatever it names, so a list can hand
// somebody an update source they never chose and never see.
//
// The field names are the whole test. The reader used to look for `m.links` and `m.url`,
// neither of which has ever existed in a .mm — the entry carries `download_links` — so
// "Download hosts" said "—" and every entry note was empty, for every list ever inspected.
// Nothing failed. A moderator was simply told the list pointed nowhere, which is the most
// reassuring possible way to be wrong.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { detectFormat, inspectAny } = await import('../src/lib/bmm-formats.mjs');

const val = (rep, label) => rep.summary.find((r) => r.label === label)?.value;
const tone = (rep, label) => rep.summary.find((r) => r.label === label)?.tone;

const list = (mods, extra = {}) => ({
  format_version: '1.0',
  name: 'Shared list',
  game_name: 'DCS',
  author: 'somebody',
  created_at: '2026-08-26T00:00:00Z',
  mods,
  ...extra,
});

describe('a mod list', () => {
  test('is recognised by its shape', () => {
    assert.equal(detectFormat(list([])), 'mm');
  });

  test('download hosts come from download_links — the field the format actually uses', () => {
    const rep = inspectAny(list([
      { name: 'A', download_links: [{ url: 'https://cdn.example.com/a.zip', link_type: 'direct', label: '' }] },
      { name: 'B', download_links: [{ url: 'https://cdn.example.com/b.zip', link_type: 'direct', label: '' }] },
      { name: 'C', download_links: [{ url: 'https://github.com/x/y/releases/z.zip', link_type: 'github', label: '' }] },
    ]));
    assert.equal(val(rep, 'Download hosts'), 'cdn.example.com (2), github.com (1)');
    assert.match(rep.detail[0].note, /cdn\.example\.com\/a\.zip/);
  });

  test('update hosts are reported SEPARATELY, and flagged', () => {
    // Not folded in with the download hosts: one is where the bytes came from once, the
    // other is what will fetch new bytes later, unattended.
    const rep = inspectAny(list([
      {
        name: 'A',
        download_links: [{ url: 'https://cdn.example.com/a.zip' }],
        source_repo: 'https://repo.example.org/repo.json',
      },
      { name: 'B', update_url: 'https://elsewhere.test/latest.zip' },
      { name: 'C', update_sources: [{ url: 'https://repo.example.org/repo.json' }] },
    ]));
    assert.equal(val(rep, 'Download hosts'), 'cdn.example.com (1)');
    assert.equal(val(rep, 'Update hosts'), 'repo.example.org (2), elsewhere.test (1)');
    assert.equal(tone(rep, 'Update hosts'), 'warn', 'an update source somebody did not choose is a warning');
    assert.match(rep.detail[0].note, /updates: https:\/\/repo\.example\.org/);
  });

  test('a list that updates from nowhere gets no update row at all', () => {
    // Absent rather than "—": a row that is always there teaches a reader to skip it, and
    // this is the row that must be noticed when it appears.
    const rep = inspectAny(list([{ name: 'A', download_links: [{ url: 'https://cdn.example.com/a.zip' }] }]));
    assert.equal(val(rep, 'Update hosts'), undefined);
  });

  test('what the list carries besides mods is counted', () => {
    const rep = inspectAny(list(
      [{ name: 'A', install_notes: 'Drop it in Saved Games.' }, { name: 'B', install_notes: '' }],
      { tag_defs: [{ id: 't-1', name: 'Liveries', color: '#f97316', icon: 'lucide:tag' }], modpacks: [{ id: 'p' }] },
    ));
    assert.equal(String(val(rep, 'Tag definitions')), '1');
    assert.equal(String(val(rep, 'Modpacks carried')), '1');
    assert.equal(String(val(rep, 'Entries with install notes')), '1');
  });

  test('a LOCKED list is recognised, not reported as junk', () => {
    // Its contents are encrypted, so it has no `mods` and no `format_version`. Without the
    // locked branch it fell through every reader and came back as "not a recognised BMM
    // format" — which tells a moderator the file is damaged when it is an ordinary list they
    // simply cannot read, and sends them looking for a problem that is not there.
    const locked = {
      bmm_locked: true, name: 'Secret Ops', author: 'me', game_name: 'DCS',
      created_at: '2026-08-26T00:00:00Z', mods_count: 12, sealed: { bmm_enc: 1 },
    };
    assert.equal(detectFormat(locked), 'mm-locked');

    const rep = inspectAny(locked);
    assert.equal(rep.ok, true);
    assert.equal(rep.title, 'Secret Ops');
    // The fact that governs every other line, and it is flagged: nothing below it could be
    // checked against the actual contents.
    assert.equal(tone(rep, 'Encrypted'), 'warn');
    assert.equal(val(rep, 'Author'), 'me');
    // "claimed", because a count in a header is what the author wrote, not what is inside.
    assert.match(String(val(rep, 'Mods')), /claimed/);
    assert.deepEqual(rep.detail, [], 'there is nothing to list');
  });

  test('the path hint is still flagged — it carries a person\'s name more often than not', () => {
    const rep = inspectAny(list([], { game_path_hint: 'C:/Users/somebody/DCS' }));
    assert.equal(tone(rep, 'Path hint'), 'warn');
  });
});
