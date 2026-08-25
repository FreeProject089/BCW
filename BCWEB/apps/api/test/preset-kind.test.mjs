// `PRESET` means two different things, and this pins which is which.
//
// For **BSM** it is an audio preset: one JSON document whose metadata IS the item, which is
// why presetSchema demands `assetPaths` and why a preset can be shared by pasting it.
//
// For **BMM** it is a scheduled-task catalogue: the entry POINTS at a `.bmmpa`, exactly as
// every other BMM catalogue kind points at its file.
//
// The bug this guards against was live: the FEED already emitted the BMM shape
// (`presets: [{ download_url }]`, which is what BMM's reader parses), while all four write
// paths ran the BSM schema over every PRESET regardless of project. So a BMM automation could
// not be submitted at all, and the two halves of one enum value described different things.
// Neither half was wrong on its own, which is why nothing failed loudly.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkPresetMeta } from '../src/routes/catalog.mjs';

const BSM_PRESET = { name: 'Warm Cabin', version: '1.2.0', assetPaths: ['ambience/rain_light'] };
const BMM_AUTOMATION = { download_url: 'https://example.com/nightly.bmmpa', tasks: 1 };

describe('checkPresetMeta', () => {
  test('a BSM preset is accepted for bsm', () => {
    assert.equal(checkPresetMeta('bsm', BSM_PRESET), null);
  });

  test('a BMM automation is accepted for bmm', () => {
    assert.equal(checkPresetMeta('bmm', BMM_AUTOMATION), null);
  });

  test('the BSM rule rejects a BMM automation — which is what every path used to apply', () => {
    // The bug, kept as a test: an automation has no assetPaths and never will, because the
    // .bmmpa IS the item. Running this rule over a BMM submission refused all of them.
    assert.equal(checkPresetMeta('bsm', BMM_AUTOMATION), 'invalid_preset');
  });

  test('a BSM preset submitted as a BMM one is refused — it points at nothing to download', () => {
    assert.equal(checkPresetMeta('bmm', BSM_PRESET), 'invalid_preset_no_download_url');
  });

  test('the three spellings of the download field are all accepted', () => {
    // BMM's own reader takes download_url or downloadUrl, and the modpack feed uses url.
    // Accepting fewer here than the reader does would refuse a feed that works.
    for (const key of ['download_url', 'downloadUrl', 'url']) {
      assert.equal(checkPresetMeta('bmm', { [key]: 'https://e.com/x.bmmpa' }), null, key);
    }
  });

  test('an unknown or missing project falls through to the stricter BSM rule', () => {
    // projectId is nullable on the row. Guessing "probably BMM" for an orphan would loosen
    // the check on exactly the items nobody is watching.
    assert.equal(checkPresetMeta(null, BMM_AUTOMATION), 'invalid_preset');
    assert.equal(checkPresetMeta(undefined, BMM_AUTOMATION), 'invalid_preset');
    assert.equal(checkPresetMeta('community', BMM_AUTOMATION), 'invalid_preset');
    assert.equal(checkPresetMeta(null, BSM_PRESET), null);
  });

  test('empty metadata is refused for either project', () => {
    assert.ok(checkPresetMeta('bmm', {}));
    assert.ok(checkPresetMeta('bsm', {}));
    assert.ok(checkPresetMeta('bmm', null));
    assert.ok(checkPresetMeta('bsm', null));
  });
});
