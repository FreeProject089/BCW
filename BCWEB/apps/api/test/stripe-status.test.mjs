// Stripe's status is Stripe's published status, fetched politely, and its failure never
// becomes ours.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseStripeStatus, stripeUp, createStripeStatusCache, STRIPE_STATUS_URL } from '../src/lib/stripe-status.mjs';

const doc = (indicator, description = 'x') => ({ page: { id: 'd5zv7xbys5v3', name: 'Stripe', updated_at: '2026-09-22T09:08:08.602Z' }, status: { indicator, description } });

describe('parsing', () => {
    test('the Statuspage indicators map to our states', () => {
        assert.equal(parseStripeStatus(doc('none', 'All Systems Operational')).state, 'operational');
        assert.equal(parseStripeStatus(doc('minor')).state, 'degraded');
        assert.equal(parseStripeStatus(doc('major')).state, 'major');
        assert.equal(parseStripeStatus(doc('critical')).state, 'critical');
        assert.equal(parseStripeStatus(doc('maintenance')).state, 'maintenance');
    });
    test('an unknown indicator is unknown, never green; a foreign shape is null', () => {
        assert.equal(parseStripeStatus(doc('purple')).state, 'unknown');
        // status.stripe.com/current's frozen shape — the endpoint NOT to use.
        assert.equal(parseStripeStatus({ statuses: { api: 'up' }, largestatus: 'up', message: 'All services are online.' }), null);
        assert.equal(parseStripeStatus(null), null);
    });
    test('only a major or critical incident is "down"; unknown is "cannot tell"', () => {
        assert.equal(stripeUp(parseStripeStatus(doc('none'))), true);
        assert.equal(stripeUp(parseStripeStatus(doc('minor'))), true);
        assert.equal(stripeUp(parseStripeStatus(doc('maintenance'))), true);
        assert.equal(stripeUp(parseStripeStatus(doc('major'))), false);
        assert.equal(stripeUp(parseStripeStatus(doc('critical'))), false);
        assert.equal(stripeUp(parseStripeStatus(doc('purple'))), null);
        assert.equal(stripeUp(null), null);
    });
});

describe('polling', () => {
    const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
    test('the right endpoint, once per TTL however many callers ask', async () => {
        let now = 0, calls = 0, url = null;
        const c = createStripeStatusCache({ now: () => now, fetchImpl: async (u) => { calls++; url = u; return ok(doc('none'))(); } });
        await Promise.all([c.get(), c.get(), c.get()]);
        assert.equal(calls, 1, 'concurrent callers share one request');
        assert.equal(url, STRIPE_STATUS_URL);
        now = 4 * 60_000; await c.get();
        assert.equal(calls, 1, 'inside the TTL');
        now = 6 * 60_000; await c.get();
        assert.equal(calls, 2);
    });
    test('a failure keeps the last good answer, marks it stale, and backs off', async () => {
        let now = 0, calls = 0, fail = false;
        const c = createStripeStatusCache({ now: () => now, fetchImpl: async () => { calls++; if (fail) throw new Error('ENOTFOUND'); return ok(doc('major', 'Elevated errors'))(); } });
        assert.equal((await c.get()).state, 'major');
        fail = true; now = 6 * 60_000;
        const s = await c.get();
        assert.equal(s.state, 'major');
        assert.equal(s.stale, true);
        const n = calls;
        now += 5 * 60_000; await c.get();
        assert.equal(calls, n, 'no retry during the back-off');
    });
    test('never known and failing → null, no throw', async () => {
        const c = createStripeStatusCache({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
        assert.equal(await c.get(), null);
        const c2 = createStripeStatusCache({ fetchImpl: async () => { throw new Error('boom'); } });
        assert.equal(await c2.get(), null);
    });
});
