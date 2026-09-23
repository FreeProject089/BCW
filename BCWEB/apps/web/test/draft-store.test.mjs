// Kept drafts: the storage half (src/ui/draft-store.js).
//
// Three things are worth a test here and the rest is React: that a key scopes a draft to one
// form and one row, that an old draft is not offered back, and that "drafts off" writes
// NOTHING — the failure mode being a switch that gates the restore while the writes carry on,
// which looks off and is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftKey, draftKeys, readDraft, writeDraft, clearDraft, clearAllDrafts, draftAge, draftDiffers, DRAFT_MAX_AGE_MS,
} from '../src/ui/draft-store.js';

/** A sessionStorage stand-in that counts what was done to it. `fail` makes every call throw,
 *  which is the private-window / storage-disabled case. */
function mockStore({ fail = false } = {}) {
  const map = new Map();
  return {
    sets: 0, removes: 0,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i]; },
    getItem(k) { if (fail) throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { this.sets += 1; if (fail) throw new Error('denied'); map.set(k, String(v)); },
    removeItem(k) { this.removes += 1; if (fail) throw new Error('denied'); map.delete(k); },
  };
}

test('a key scopes a draft to one form and one row', () => {
  assert.notEqual(draftKey('contact', null), draftKey('report', null));
  assert.notEqual(draftKey('blog', 7), draftKey('blog', 8));
  assert.equal(draftKey('blog', null), draftKey('blog', ''), 'no id and an empty id are the same "new" draft');
  assert.ok(draftKey('blog', 7).startsWith('bcw.draft.'));
  assert.equal(draftKey('a/b', '../../etc'), 'bcw.draft.a-b...-..-etc', 'a key is sanitised, not interpolated raw');
});

test('a draft written comes back with its value, its age and its meta', () => {
  const s = mockStore();
  const k = draftKey('contact', null);
  assert.equal(writeDraft(s, k, { subject: 'hi', body: 'there' }, { meta: { step: 2 }, now: 1000 }), true);
  const got = readDraft(s, k, { now: 2000 });
  assert.deepEqual(got.value, { subject: 'hi', body: 'there' });
  assert.equal(got.savedAt, 1000);
  assert.deepEqual(got.meta, { step: 2 });
});

test('a draft older than the window is neither offered nor kept', () => {
  const s = mockStore();
  const k = draftKey('blog', 3);
  writeDraft(s, k, { title: 'old' }, { now: 0 });
  assert.ok(readDraft(s, k, { now: DRAFT_MAX_AGE_MS - 1 }), 'inside the window it is offered');
  assert.equal(readDraft(s, k, { now: DRAFT_MAX_AGE_MS + 1 }), null, 'past it, nothing');
  assert.equal(s.length, 0, 'and the expired entry is pruned, not left behind');
});

test('a clock that moved backwards does not throw the work away', () => {
  const s = mockStore();
  const k = draftKey('report', null);
  writeDraft(s, k, { text: 'x' }, { now: 10_000 });
  assert.ok(readDraft(s, k, { now: 1000 }), 'a negative age reads as fresh');
});

test('drafts off writes NOTHING, not "writes and ignores"', () => {
  const s = mockStore();
  const k = draftKey('contact', null);
  assert.equal(writeDraft(s, k, { body: 'secret' }, { enabled: false }), false);
  assert.equal(s.sets, 0, 'no setter was called at all');
  assert.equal(s.length, 0);
  // And an entry written while drafts were on is not handed back once they are off.
  writeDraft(s, k, { body: 'secret' });
  assert.equal(readDraft(s, k, { enabled: false }), null);
});

test('storage that refuses everything is a form with no draft, not a crash', () => {
  const s = mockStore({ fail: true });
  const k = draftKey('contact', null);
  assert.equal(writeDraft(s, k, { a: 1 }), false);
  assert.equal(readDraft(s, k), null);
  assert.doesNotThrow(() => clearDraft(s, k));
  assert.doesNotThrow(() => clearAllDrafts(s));
});

test('rubbish in the key reads as no draft', () => {
  const s = mockStore();
  const k = draftKey('blog', 1);
  s.setItem(k, 'not json');
  assert.equal(readDraft(s, k), null);
  s.setItem(k, JSON.stringify({ savedAt: Date.now() }));
  assert.equal(readDraft(s, k), null, 'an entry with no value is not a draft');
  s.setItem(k, JSON.stringify({ value: { a: 1 } }));
  assert.equal(readDraft(s, k), null, 'an entry with no timestamp has no age, so it is not offered');
});

test('turning drafts off clears the ones already kept, and touches nothing else', () => {
  const s = mockStore();
  writeDraft(s, draftKey('contact', null), { a: 1 });
  writeDraft(s, draftKey('blog', 4), { b: 2 });
  s.setItem('bcw_theme', 'dark');
  assert.deepEqual(draftKeys(s).sort(), ['bcw.draft.blog.4', 'bcw.draft.contact.new']);
  assert.equal(clearAllDrafts(s), 2);
  assert.equal(s.getItem('bcw_theme'), 'dark', 'a neighbouring preference is not swept up');
  assert.equal(s.length, 1);
});

test('an age is bucketed, and a value equal to the form is not a draft', () => {
  const h = 3600_000;
  assert.deepEqual(draftAge(1000, 1000), { unit: 'now', n: 0 });
  assert.deepEqual(draftAge(0, 5 * 60_000), { unit: 'min', n: 5 });
  assert.deepEqual(draftAge(0, 3 * h), { unit: 'hour', n: 3 });
  assert.deepEqual(draftAge(0, 50 * h), { unit: 'day', n: 2 });
  assert.equal(draftDiffers({ a: 1 }, { a: 1 }), false);
  assert.equal(draftDiffers({ a: 1 }, { a: 2 }), true);
});
