// The diff behind the history timeline.
//
// The dangerous direction here is not "the diff is wrong", it is "the diff is too good": this
// runs over settings blobs that hold a sync-password hash, a dashboard-password hash, a share
// key and an access list of IP addresses, and its output is shown to every collaborator on the
// repo. Most of what follows is about what must NOT come out.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diffFields, summarise, summaryFor, CHANGE_ACTIONS } from '../src/lib/changelog.mjs';

describe('diffFields', () => {
  test('reports what changed, and nothing that did not', () => {
    const d = diffFields({ listing: true, name: 'a' }, { listing: false, name: 'a' });
    assert.deepEqual(d, [{ field: 'listing', from: 'true', to: 'false' }]);
  });

  test('a key added, and a key removed', () => {
    assert.deepEqual(diffFields({}, { listing: true }), [{ field: 'listing', from: null, to: 'true' }]);
    assert.deepEqual(diffFields({ listing: true }, {}), [{ field: 'listing', from: 'true', to: null }]);
  });

  test('one level of nesting is walked, which is where settings live', () => {
    const d = diffFields({ access: { whitelistEnabled: false } }, { access: { whitelistEnabled: true } });
    assert.deepEqual(d, [{ field: 'access.whitelistEnabled', from: 'false', to: 'true' }]);
  });

  test('a list becomes its LENGTH, never its contents', () => {
    // The ban list is IP addresses. "3 items → 4 items" is the fact somebody needs; the
    // addresses are not, and a timeline is readable by collaborators.
    const d = diffFields({ bans: { ips: ['1.1.1.1'] } }, { bans: { ips: ['1.1.1.1', '2.2.2.2'] } });
    assert.deepEqual(d, [{ field: 'bans.ips', from: '[1]', to: '[2]' }]);
    assert.equal(JSON.stringify(d).includes('2.2.2.2'), false);
  });

  test('a secret is never in the output, at any depth or spelling', () => {
    const before = { syncPasswordHash: 'a', dashPassword: 'b', access: { token: 'c' }, shareKey: 'd' };
    const after = { syncPasswordHash: 'z', dashPassword: 'y', access: { token: 'x' }, shareKey: 'w' };
    const d = diffFields(before, after);
    const json = JSON.stringify(d);
    for (const leak of ['a', 'b', 'c', 'd', 'z', 'y', 'x', 'w']) {
      assert.equal(d.some((r) => r.from === leak || r.to === leak), false, `leaked ${leak}`);
    }
    assert.equal(/password|token|sharekey/i.test(json), false);
  });

  test('a deeply nested object is summarised, not expanded', () => {
    // The recursion stops after one level ON PURPOSE. An unbounded walk eventually reaches
    // something nobody meant to publish, and no denylist keeps up with a growing blob.
    const d = diffFields(
      { a: { b: { secretish: 'one', more: 1 } } },
      { a: { b: { secretish: 'two', more: 2 } } },
    );
    assert.deepEqual(d, [{ field: 'a.b', from: '{2}', to: '{2}' }].filter((r) => r.from !== r.to));
    assert.equal(JSON.stringify(d).includes('one'), false);
  });

  test('`fields` restricts the comparison to the caller\'s business', () => {
    const before = { name: 'a', ownerId: 'u1', updatedAt: 1 };
    const after = { name: 'b', ownerId: 'u2', updatedAt: 2 };
    assert.deepEqual(diffFields(before, after, { fields: ['name'] }), [{ field: 'name', from: 'a', to: 'b' }]);
  });

  test('the order is stable', () => {
    const a = { x: 1, y: 1, z: 1 };
    const b = { x: 2, y: 2, z: 2 };
    assert.deepEqual(diffFields(a, b).map((r) => r.field), ['x', 'y', 'z']);
    assert.deepEqual(diffFields(a, b).map((r) => r.field), diffFields(a, b).map((r) => r.field));
  });

  test('two empty states produce nothing, not a row saying so', () => {
    assert.deepEqual(diffFields({}, {}), []);
    assert.deepEqual(diffFields(null, null), []);
  });
});

describe('summarise', () => {
  test('long text is cut, with a mark that it was', () => {
    const s = summarise('x'.repeat(400));
    assert.equal(s.length, 120);
    assert.ok(s.endsWith('…'));
  });

  test('booleans and numbers survive as themselves', () => {
    assert.equal(summarise(false), 'false');
    assert.equal(summarise(0), '0');
  });

  test('absent and null are the same nothing', () => {
    assert.equal(summarise(undefined), null);
    assert.equal(summarise(null), null);
  });

  test('a list is a count in brackets, in no language', () => {
    // "0 items" is English prose in a string that is stored as written and rendered as-is
    // into a French page. The brackets say list-of-N without saying it in a language.
    assert.equal(summarise([]), '[0]');
    assert.equal(summarise(['a', 'b']), '[2]');
    assert.equal(summarise({ a: 1 }), '{1}');
  });
});

describe('CHANGE_ACTIONS', () => {
  test('is closed, so a typo cannot invent a category nothing renders', () => {
    assert.equal(CHANGE_ACTIONS.includes('settings'), true);
    assert.equal(CHANGE_ACTIONS.includes('sttings'), false);
  });
});

describe('summaryFor', () => {
  test('names the single field', () => {
    assert.equal(summaryFor('settings', [{ field: 'listing' }]), 'listing');
  });

  test('never returns prose, because nothing here is translated', () => {
    // The summary is stored as written and rendered as-is in a French page. A helpful
    // "2 fields" would be an English sentence built on the server travelling straight past
    // i18n — and it would only repeat the rows shown directly underneath it.
    assert.equal(summaryFor('settings', [{ field: 'a' }, { field: 'b' }]), '');
    assert.equal(summaryFor('publish', []), '');
    assert.equal(summaryFor('publish', null), '');
  });
});
