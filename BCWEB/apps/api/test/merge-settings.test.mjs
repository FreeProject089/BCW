// A settings save REPLACES the stored JSON, so what this function forgets is deleted.
//
// That is not a hypothetical: the merge was written out twice, in two route files, and adding
// `listing` to the schema + the form + one of the copies produced a save that validated,
// returned 200, and did not write the field. Nothing errors, nothing logs, and the switch
// simply goes back to where it was on the next load.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, DEFAULT_SETTINGS, SETTINGS_SCHEMA } from '../src/routes/repos.mjs';

describe('mergeSettings', () => {
  test('keeps every key the defaults define', () => {
    // The guard against the actual bug: whatever DEFAULT_SETTINGS knows about has to survive
    // a merge, so a setting added there without being added here fails HERE rather than in
    // production as a save that does nothing.
    const out = mergeSettings({}, {});
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      assert.ok(k in out, `mergeSettings drops "${k}" — a save would delete it`);
    }
  });

  test('every key the schema accepts is a key the merge writes', () => {
    // The other half of the same rule, from the other end: zod accepting a field the merge
    // ignores is exactly the shape of a 200 that saves nothing.
    for (const k of Object.keys(SETTINGS_SCHEMA.shape)) {
      assert.ok(k in mergeSettings({}, {}), `schema accepts "${k}" but the merge never writes it`);
    }
  });

  test('a patch wins over the stored value', () => {
    assert.equal(mergeSettings({ listing: true }, { listing: false }).listing, false);
    assert.equal(mergeSettings({ requestedUploadKbps: 1024 }, { requestedUploadKbps: 2048 }).requestedUploadKbps, 2048);
  });

  test('an untouched key keeps the stored value', () => {
    const cur = { listing: false, requestedUploadKbps: 4096, bans: { ips: ['1.2.3.4'] } };
    const out = mergeSettings(cur, { access: { whitelistEnabled: true } });
    assert.equal(out.listing, false);
    assert.equal(out.requestedUploadKbps, 4096);
    assert.deepEqual(out.bans.ips, ['1.2.3.4']);
    assert.equal(out.access.whitelistEnabled, true);
  });

  test('a row saved before the setting existed reads as ON', () => {
    // Every repo predating the switch has been serving a listing, so absent must not read
    // as off — that would silently turn the index off for everyone on their next save.
    assert.equal(mergeSettings({}, {}).listing, true);
    assert.equal(mergeSettings({ requestedUploadKbps: null }, {}).listing, true);
  });

  test('explicit false survives a merge that does not mention it', () => {
    assert.equal(mergeSettings({ listing: false }, { bans: {} }).listing, false);
  });

  test('the lists fall back to the defaults rather than to undefined', () => {
    const out = mergeSettings({}, {});
    assert.deepEqual(out.access.ips, []);
    assert.deepEqual(out.bans.keys, []);
    assert.equal(out.access.whitelistEnabled, false);
  });
});
