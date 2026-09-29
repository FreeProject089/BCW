// One phishing brand list, two runtimes.
//
// The API's DEFAULT_BRANDS (lib/moderation/links.mjs) is the list. The Discord bot cannot
// import it (its image is built from apps/bot alone), so it reads a generated copy,
// apps/bot/src/features/brands.generated.mjs, written by apps/bot/scripts/sync-brands.mjs.
// Before that the two were hand-kept and had drifted: the bot knew roblox and dis.gd, the API
// knew the site's own brand, google and apple. This fails while the copy is stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_BRANDS } from '../src/lib/moderation/links.mjs';
import { renderBrands, OUT } from '../../bot/scripts/sync-brands.mjs';

test('the bot\'s brand list is the API\'s DEFAULT_BRANDS (run node apps/bot/scripts/sync-brands.mjs)', () => {
  const have = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(have, renderBrands(DEFAULT_BRANDS));
});

test('every brand of the list reaches the bot with every one of its domains', async () => {
  const { BRANDS } = await import('../../bot/src/features/brands.generated.mjs');
  for (const b of DEFAULT_BRANDS) {
    for (const d of b.domains) assert.ok(BRANDS[b.brand]?.includes(d), `${b.brand}: ${d}`);
  }
});
