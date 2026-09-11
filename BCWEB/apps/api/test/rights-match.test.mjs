// Rights notices and the protected-works registry: the rules, without a database.
//
// A notice is a legal instrument: the four DSA elements and the two statements are what turn
// a message into actual knowledge. So the normaliser is tested for what it REFUSES as much as
// for what it keeps — a notice accepted without them would tell the sender they had achieved
// something they had not.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotice, normalizeTargets, normalizeWork, matchWorks, strikeStatus, noticeCode } from '../src/lib/rights-match.mjs';

const GOOD = {
  kind: 'copyright',
  targets: [{ type: 'repo', id: 'cmrepo1', label: 'Some pack', files: ['mods/x.zip', 'mods/y.zip'] }],
  explanation: 'These two archives are my mod "Foo" repackaged without permission, byte for byte.',
  work: { title: 'Foo', urls: ['https://example.com/foo'], basis: 'owner' },
  name: 'A. Author', email: 'a@example.com', goodFaith: true, accurate: true, signature: 'A. Author',
};

describe('normalizeNotice', () => {
  test('a complete notice is kept, trimmed and bounded', () => {
    const n = normalizeNotice({ ...GOOD, name: '  A. Author  ', email: 'A@Example.com' });
    assert.equal(n.error, undefined);
    assert.equal(n.name, 'A. Author');
    assert.equal(n.email, 'a@example.com');
    assert.deepEqual(n.targets[0].files, ['mods/x.zip', 'mods/y.zip']);
    assert.equal(n.work.title, 'Foo');
    assert.equal(n.onBehalfOf, 'owner');
  });
  test('each missing element is named, in the order the form asks for it', () => {
    assert.equal(normalizeNotice({ ...GOOD, targets: [] }).error, 'no_target');
    assert.equal(normalizeNotice({ ...GOOD, explanation: 'too short' }).error, 'explanation_short');
    assert.equal(normalizeNotice({ ...GOOD, name: '' }).error, 'name_required');
    assert.equal(normalizeNotice({ ...GOOD, email: 'nope' }).error, 'email_invalid');
    assert.equal(normalizeNotice({ ...GOOD, goodFaith: false }).error, 'good_faith_required');
    assert.equal(normalizeNotice({ ...GOOD, accurate: 'yes' }).error, 'accuracy_required', 'a string is not a tick');
    assert.equal(normalizeNotice({ ...GOOD, signature: '' }).error, 'signature_required');
  });
  test('a copyright claim must name a work; a privacy report need not', () => {
    assert.equal(normalizeNotice({ ...GOOD, work: {} }).error, 'work_required');
    assert.equal(normalizeNotice({ ...GOOD, kind: 'privacy', work: {} }).error, undefined);
  });
  test('an unknown kind falls to copyright, hashes are normalised, junk URLs dropped', () => {
    const n = normalizeNotice({ ...GOOD, kind: 'wat', work: { title: 'Foo', urls: 'https://a.test/x javascript:alert(1) ftp://b', hashes: 'SHA256:' + 'A'.repeat(64) + ', nothash' } });
    assert.equal(n.kind, 'copyright');
    assert.deepEqual(n.work.urls, ['https://a.test/x']);
    assert.deepEqual(n.work.hashes, ['a'.repeat(64)]);
  });
});

describe('normalizeTargets', () => {
  test('a target without an id is dropped unless it is a bare URL', () => {
    const t = normalizeTargets([{ type: 'repo' }, { type: 'url', url: 'https://x.test/a' }, { url: 'https://y.test' }, { type: 'item', id: 'i1' }]);
    assert.deepEqual(t.map((x) => x.type), ['url', 'url', 'item']);
  });
  test('capped, and every string bounded', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ type: 'item', id: `i${i}` }));
    assert.equal(normalizeTargets(many).length, 20);
    assert.equal(normalizeTargets([{ type: 'repo', id: 'r', note: 'x'.repeat(5000) }])[0].note.length, 1000);
  });
});

describe('normalizeWork', () => {
  test('a title is required and a pattern that does not compile is refused by name', () => {
    assert.equal(normalizeWork({}).error, 'title_required');
    const w = normalizeWork({ title: 'Foo', patterns: 'foo.*\n[unclosed' });
    assert.equal(w.error, 'pattern_invalid');
    assert.equal(w.pattern, '[unclosed');
  });
  test('lists come as arrays or as text, and are de-duplicated', () => {
    const w = normalizeWork({ title: 'Foo', hashes: ['A'.repeat(64), 'a'.repeat(64)], urls: 'https://a.test https://a.test' });
    assert.deepEqual(w.hashes, ['a'.repeat(64)]);
    assert.deepEqual(w.urls, ['https://a.test']);
    assert.equal(w.active, true);
  });
});

describe('matchWorks', () => {
  const works = [
    { id: 'w1', title: 'Foo', active: true, hashes: ['f'.repeat(64)], patterns: ['^foo[-_ ]?pack'], urls: ['https://foo.example/dl'] },
    { id: 'w2', title: 'Off', active: false, hashes: ['f'.repeat(64)], patterns: ['.*'], urls: [] },
  ];
  test('a hash is the work itself and wins over everything', () => {
    const m = matchWorks({ sha256: 'F'.repeat(64), name: 'nothing.zip' }, works);
    assert.equal(m.length, 1);
    assert.equal(m[0].via, 'hash');
    assert.equal(m[0].work.id, 'w1');
  });
  test('a name pattern is a guess, and says which pattern hit what', () => {
    const m = matchWorks({ name: 'Foo-Pack v2.zip' }, works);
    assert.equal(m[0].via, 'pattern');
    assert.match(m[0].detail, /foo-pack v2\.zip/i);
  });
  test('a listing pointing at the source URL, or under it', () => {
    assert.equal(matchWorks({ urls: ['https://foo.example/dl/v2'] }, works)[0].via, 'url');
    assert.equal(matchWorks({ urls: ['https://foo.example/dlx'] }, works).length, 0, 'a prefix that is not a path boundary is not a match');
  });
  test('an inactive work never fires, whatever it would have matched', () => {
    assert.ok(matchWorks({ sha256: 'f'.repeat(64), name: 'anything' }, works).every((m) => m.work.id !== 'w2'));
  });
  test('nothing matches nothing', () => {
    assert.deepEqual(matchWorks({ name: 'bar.zip' }, works), []);
    assert.deepEqual(matchWorks({}, works), []);
  });
});

describe('strikeStatus', () => {
  const day = 86_400_000; const now = 1_760_000_000_000;
  test('counts only what is inside the window, and says when the line is crossed', () => {
    const list = [{ decisionAt: new Date(now - 10 * day) }, { decisionAt: new Date(now - 100 * day) }, { decisionAt: new Date(now - 400 * day) }];
    const s = strikeStatus(list, { threshold: 3, windowDays: 365, now });
    assert.equal(s.strikes, 2);
    assert.equal(s.over, false);
    assert.equal(strikeStatus(list, { threshold: 2, windowDays: 365, now }).over, true);
  });
  test('a threshold of zero is junk and falls back to the default, not "everybody is over"', () => {
    assert.equal(strikeStatus([], { threshold: 0, now }).threshold, 3);
    assert.equal(strikeStatus([], { threshold: 0, now }).over, false);
  });
});

describe('noticeCode', () => {
  test('NTC-XXXX-XXXX from an unambiguous alphabet', () => {
    const c = noticeCode(Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]));
    assert.match(c, /^NTC-[ABCDEFGHJKLMNPQRSTVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTVWXYZ23456789]{4}$/);
  });
});
