// The Terms promise at least 72 hours before hosted content is deleted after a lapse or a
// failed payment; an admin setting below that must not shorten the window (Sept 24 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostingGrace } from '../src/lib/lib.mjs';

const fake = (rows) => ({ adminSetting: { findMany: async () => rows } });

test('defaults: 72 h after a term ends, a week after a failed card', async () => {
  const g = await hostingGrace(fake([]));
  assert.equal(g.lapseHours, 72);
  assert.equal(g.unpaidHours, 168);
});

test('an admin value below 72 h is raised to 72 h', async () => {
  const g = await hostingGrace(fake([{ key: 'hosting.graceLapseHours', value: 1 }, { key: 'hosting.graceUnpaidHours', value: 24 }]));
  assert.equal(g.lapseHours, 72);
  assert.equal(g.unpaidHours, 72);
});

test('a longer admin value is kept', async () => {
  const g = await hostingGrace(fake([{ key: 'hosting.graceUnpaidHours', value: 240 }]));
  assert.equal(g.unpaidHours, 240);
});
