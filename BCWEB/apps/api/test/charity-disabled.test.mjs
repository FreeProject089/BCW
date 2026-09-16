// Community Charity switched off: every public route answers 404 `charity_disabled`.
//
// The page and the landing widget already rendered nothing on `enabled:false`; what this pins
// down is the CONTRACT for everything else — the public API, a bot, a client that never read
// the route file: a feature that is switched off is not there, and "not there" is a 404, the
// same status from every door. Switched on, `/charity/current` answers 200 with the pot.
//
// Real HTTP through the real route plugin (needs DATABASE_URL, like the journey tests). The
// config row is saved before and restored after, so a run leaves the dev database exactly as
// it found it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run route tests';
process.env.JWT_SECRET ||= 'charity-test-secret';

let p, app, saved, KEY;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  KEY = (await import('../src/lib/charity.mjs')).CHARITY_CONFIG_KEY;
  saved = await p.adminSetting.findUnique({ where: { key: KEY } });
  const Fastify = (await import('fastify')).default;
  const cookie = (await import('@fastify/cookie')).default;
  app = Fastify();
  await app.register(cookie);
  await app.register((await import('../src/routes/charity.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  // Put the row back exactly as it was — or remove it if there was none.
  if (saved) await p.adminSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: saved.value }, update: { value: saved.value } });
  else await p.adminSetting.deleteMany({ where: { key: KEY } });
  await app?.close();
});

const setEnabled = async (enabled) => {
  const base = saved?.value && typeof saved.value === 'object' ? saved.value : {};
  await p.adminSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: { ...base, enabled } }, update: { value: { ...base, enabled } } });
};

describe('charity switched off', { skip }, () => {
  test('GET /charity/current is 404 charity_disabled', async () => {
    await setEnabled(false);
    const r = await app.inject({ method: 'GET', url: '/charity/current' });
    assert.equal(r.statusCode, 404);
    const body = r.json();
    assert.equal(body.error, 'charity_disabled');
    assert.equal(body.enabled, false);
  });

  test('POST /charity/contribute is 404 charity_disabled, before Stripe is even consulted', async () => {
    await setEnabled(false);
    const r = await app.inject({ method: 'POST', url: '/charity/contribute', payload: { amountCents: 1000 } });
    assert.equal(r.statusCode, 404);
    assert.equal(r.json().error, 'charity_disabled');
  });

  test('a malformed gift is still rejected as such — validation runs first, then the switch', async () => {
    await setEnabled(false);
    const r = await app.inject({ method: 'POST', url: '/charity/contribute', payload: { amountCents: 5 } });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'too_small');
  });
});

describe('charity switched on', { skip }, () => {
  test('GET /charity/current is 200 with the pot', async () => {
    await setEnabled(true);
    const r = await app.inject({ method: 'GET', url: '/charity/current' });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.enabled, true);
    assert.match(body.month, /^\d{4}-\d{2}$/);
    assert.ok(Array.isArray(body.presets));
    assert.equal(typeof body.totalCents, 'number');
  });
});
