// The dev catalogue fixtures (`npm run seed:demo`). They outlived the admin demo mode (retired
// Sept 23), and these are the two checks of demo-mode.test.mjs that were about THEM rather than
// about the retired feature: one body of fixtures, and the production shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCatalogItems } from '../src/lib/demo-fixtures.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('seed:demo imports the generator and has no word lists of its own', () => {
  const seed = fs.readFileSync(path.join(SRC, 'seed-demo.mjs'), 'utf8');
  assert.match(seed, /import\s*\{[^}]*generateCatalogItems[^}]*\}\s*from\s*'\.\/lib\/demo-fixtures\.mjs'/);
  assert.equal(/const\s+(ADJ|NOUN|TAGS|CATS)\s*=/.test(seed), false);
});

test('deterministic, and only plugins carry meta.validation (the production shape)', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const a = generateCatalogItems({ seed: 7, n: 60, at });
  assert.deepEqual(a, generateCatalogItems({ seed: 7, n: 60, at }));
  for (const it of a) assert.equal('validation' in it.meta, it.kind === 'PLUGIN', `${it.slug}`);
});

test('the retired demo mode left no module behind', () => {
  for (const f of ['lib/demo.mjs', 'routes/demo.mjs', 'lib/demo-tour.mjs', 'routes/demo-tour.mjs']) {
    assert.equal(fs.existsSync(path.join(SRC, f)), false, f);
  }
  const server = fs.readFileSync(path.join(SRC, 'server.mjs'), 'utf8');
  assert.equal(/routes\/demo(-tour)?\.mjs/.test(server), false);
});
