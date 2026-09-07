// Who may turn the studio on for a project.
//
// The rule is "admins only". The UI hides the switch from everyone else, and that is worth
// nothing on its own: a per-project grantee is ALLOWED to edit their page's config, the config
// is free-form JSON, so without a server-side guard they can grant themselves the feature by
// putting `studioEnabled: true` in a body they craft. A permission enforced only by not
// drawing a control is not a permission.
//
// Pure, so every shape can be pinned — including the ones that are easy to get wrong: turning
// it OFF, a first save with no stored config, and a caller who simply omits the key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardStudioFlag } from '../src/lib/lib.mjs';

test('an admin may turn it on and off', () => {
  assert.equal(guardStudioFlag({ studioEnabled: true }, {}, true).studioEnabled, true);
  assert.equal(guardStudioFlag({ studioEnabled: false }, { studioEnabled: true }, true).studioEnabled, false);
});

test('a grantee cannot turn it on', () => {
  const out = guardStudioFlag({ tagline: 'mine', studioEnabled: true }, { tagline: 'old' }, false);
  assert.equal(out.studioEnabled, undefined, 'the flag they sent is discarded');
  assert.equal(out.tagline, 'mine', 'and the rest of their edit is kept');
});

test('a grantee cannot turn it OFF either', () => {
  // The other direction matters just as much: the switch belongs to the admin, so a grantee
  // must not be able to take away a studio page the admin enabled.
  const out = guardStudioFlag({ studioEnabled: false }, { studioEnabled: true }, false);
  assert.equal(out.studioEnabled, true, 'the stored value wins');
});

test('a grantee saving a page that already has it keeps it', () => {
  // The common case, and the one a naive "delete the key" guard breaks: they edit some text,
  // their editor sends the whole config back including the flag it read, and the page must
  // not silently lose its studio tab.
  const out = guardStudioFlag({ tagline: 'edited', studioEnabled: true }, { studioEnabled: true }, false);
  assert.equal(out.studioEnabled, true);
});

test('a grantee who omits the key does not accidentally enable it', () => {
  assert.equal(guardStudioFlag({ tagline: 'x' }, {}, false).studioEnabled, undefined);
  assert.equal(guardStudioFlag({ tagline: 'x' }, { studioEnabled: true }, false).studioEnabled, true);
});

test('a first save with nothing stored yet is handled', () => {
  assert.equal(guardStudioFlag({ studioEnabled: true }, null, false).studioEnabled, undefined);
  assert.equal(guardStudioFlag({ studioEnabled: true }, undefined, true).studioEnabled, true);
});

test('nothing else in the config is touched, and the input is not mutated', () => {
  const incoming = { a: 1, nested: { b: 2 }, studioEnabled: true };
  const out = guardStudioFlag(incoming, { studioEnabled: false }, false);
  assert.equal(out.a, 1);
  assert.deepEqual(out.nested, { b: 2 });
  assert.equal(incoming.studioEnabled, true, 'the caller\'s object is left alone');
});

test('junk in place of a config does not throw', () => {
  for (const bad of [null, undefined, 'nope', 42]) {
    assert.doesNotThrow(() => guardStudioFlag(bad, bad, false));
    assert.equal(typeof guardStudioFlag(bad, bad, true), 'object');
  }
});
