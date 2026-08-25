// Reading a BMM catalogue in the inspector.
//
// The question a reviewer is holding when they open a catalogue is not "what does this
// list" — the entry names are right there — it is **where does each entry come from**. A
// catalogue is a set of addresses somebody else will follow, and the three kinds carry
// different risk: packed with the archive and reviewable here, fetched from a host that can
// change its mind after review, or a shape BMM refuses outright.
//
// The detection order is the other half. `modpacks` is one of the catalogue arrays AND the
// thing that makes a document a .cbmp, so a reader that ran first would take every modpack
// catalogue away from the reader that knows more about it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { detectFormat, inspectAny } = await import('../src/lib/bmm-formats.mjs');

const val = (rep, label) => rep.summary.find((r) => r.label === label)?.value;
const tone = (rep, label) => rep.summary.find((r) => r.label === label)?.tone;

describe('detectFormat', () => {
  test('a catalogue is recognised by its shape, not by a claim', () => {
    assert.equal(detectFormat({ version: '1.0', presets: [{ id: 'a' }] }), 'bmmcat');
    assert.equal(detectFormat({ plugins: [{ id: 'a' }] }), 'bmmcat');
    assert.equal(detectFormat({ themes: [{ id: 'a' }] }), 'bmmcat');
  });

  test('an empty or scalar array is not a catalogue', () => {
    // `{ presets: [] }` is a document that has not said anything yet, and `{ presets: 3 }`
    // is not a catalogue at all. Reporting either as one puts a confident empty summary in
    // front of a reviewer.
    assert.equal(detectFormat({ version: '1.0', presets: [] }), null);
    assert.equal(detectFormat({ presets: 3 }), null);
    assert.equal(detectFormat({ version: '1.0' }), null);
  });

  test('a .cbmp still wins over the generic reader', () => {
    // `modpacks` is in both lists. The specific reader knows about packs/*.bmp paths; this
    // one does not, and taking the document from it would be a quiet downgrade.
    const cbmp = { name: 'packs', modpacks: [{ name: 'p', file: 'packs/p.bmp' }] };
    assert.equal(detectFormat(cbmp), 'cbmp');
  });

  test('a .bmmpa is still a .bmmpa', () => {
    assert.equal(detectFormat({ magic: 'BMMPA', tasks: [{ name: 't', steps: [] }] }), 'bmmpa');
  });
});

describe('inspectAny on a catalogue', () => {
  const doc = {
    version: '1.0',
    name: 'My automations',
    presets: [
      { id: 'a', name: 'Nightly', download_url: 'nightly.bmmpa' },
      { id: 'b', name: 'Big', download_url: 'https://cdn.example.com/big.bmmpa' },
      { id: 'c', name: 'Nasty', download_url: '../../../etc/passwd' },
      { id: 'd', name: 'Nothing' },
    ],
  };

  test('counts the three kinds of address apart', () => {
    const r = inspectAny(doc);
    assert.equal(r.format, 'bmmcat');
    assert.equal(val(r, 'Packed with the catalogue'), '1');
    assert.equal(val(r, 'Fetched from elsewhere'), '1');
    assert.equal(val(r, 'Entries with no address'), '1');
  });

  test('names the addresses BMM will refuse, rather than counting them', () => {
    // A count is a number somebody has to go and diff. The path IS the finding.
    const r = inspectAny(doc);
    const refused = val(r, 'Addresses BMM will refuse');
    assert.ok(refused.includes('../../../etc/passwd'), refused);
    assert.equal(tone(r, 'Addresses BMM will refuse'), 'warn');
  });

  test('the hosts are listed, because reviewing a remote catalogue means reviewing them', () => {
    const r = inspectAny(doc);
    assert.equal(val(r, 'Hosts'), 'cdn.example.com');
    assert.equal(tone(r, 'Hosts'), 'warn');
  });

  test('packedNames is what the archive is expected to hold', () => {
    // Reported, not judged: this reader is handed ONE document and has never seen the
    // archive around it. The caller does the cross-check.
    assert.deepEqual(inspectAny(doc).packedNames, ['nightly.bmmpa']);
  });

  test('a fully self-contained catalogue raises nothing', () => {
    const r = inspectAny({ name: 'all packed', presets: [{ id: 'a', download_url: 'a.bmmpa' }] });
    assert.equal(val(r, 'Fetched from elsewhere'), '0');
    assert.equal(tone(r, 'Fetched from elsewhere'), undefined);
    assert.equal(val(r, 'Addresses BMM will refuse'), undefined);
  });

  test('a plugin catalogue reads the same way', () => {
    const r = inspectAny({ name: 'plugs', plugins: [
      { id: 'p', name: 'P', download_url: 'p.bmmplug' },
      { id: 'q', name: 'Q', download_url: 'https://x.test/q.bmmplug' },
    ] });
    assert.equal(val(r, 'Lists'), 'plugins');
    assert.equal(val(r, 'Packed with the catalogue'), '1');
    assert.deepEqual(r.packedNames, ['p.bmmplug']);
  });
});
