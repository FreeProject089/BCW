// followups (agent-bcw-followups): arming auto-renew before a prepaid term ends must not bill
// the days already paid for. The checkout waits for the paid-up date (Stripe Checkout's
// `subscription_data.trial_end`), which Stripe accepts only 48 h or more ahead. The webhook
// half is in hosting-webhook-replay.test.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoRenewTrialEnd, checkoutRenewedEnd, addMonths, STRIPE_MIN_TRIAL_MS } from '../src/lib/loyalty.mjs';

const now = new Date('2026-09-29T12:00:00Z');

describe('autoRenewTrialEnd', () => {
  test('two months left: the first charge waits for the paid-up date', () => {
    const end = addMonths(now, 2);
    assert.equal(autoRenewTrialEnd({ currentPeriodEnd: end }, now), Math.floor(end.getTime() / 1000));
  });
  test('no term, a lapsed term, or under 48 h left: bill today (Stripe refuses a closer trial_end)', () => {
    assert.equal(autoRenewTrialEnd(null, now), null);
    assert.equal(autoRenewTrialEnd({ currentPeriodEnd: null }, now), null);
    assert.equal(autoRenewTrialEnd({ currentPeriodEnd: new Date(now.getTime() - 864e5) }, now), null);
    assert.equal(autoRenewTrialEnd({ currentPeriodEnd: new Date(now.getTime() + STRIPE_MIN_TRIAL_MS - 1) }, now), null);
    assert.ok(autoRenewTrialEnd({ currentPeriodEnd: new Date(now.getTime() + STRIPE_MIN_TRIAL_MS + 3600e3) }, now) > 0);
  });
});

describe('checkoutRenewedEnd', () => {
  test('a subscription waiting for the paid-up date leaves it where it is', () => {
    const end = addMonths(now, 2);
    assert.equal(checkoutRenewedEnd({ currentPeriodEnd: end }, 6, true, Math.floor(end.getTime() / 1000), now).getTime(), Math.floor(end.getTime() / 1000) * 1000);
  });
  test('without a trial, the existing rules: by hand from the paid-up date, a subscription from today', () => {
    const end = addMonths(now, 2);
    assert.equal(checkoutRenewedEnd({ currentPeriodEnd: end }, 6, false, 0, now).toISOString(), addMonths(end, 6).toISOString());
    assert.equal(checkoutRenewedEnd({ currentPeriodEnd: end }, 6, true, 0, now).toISOString(), addMonths(now, 6).toISOString());
  });
});

describe('both renew checkouts pass the trial to Stripe', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/routes/repos.mjs'), 'utf8');
  for (const route of ["'/me/repos/:id/renew'", "'/me/hosting/groups/:id/renew'"]) {
    test(route, () => {
      const i = src.indexOf(`app.post(${route}`);
      assert.ok(i >= 0, `${route} not found`);
      const j = src.indexOf('app.post(', i + 10);
      const body = src.slice(i, j > 0 ? j : undefined);
      assert.match(body, /autoRenewTrialEnd\(prevSub\)/);
      assert.match(body, /subscription_data: \{ metadata: smd, \.\.\.\(trialEnd \? \{ trial_end: trialEnd \} : \{\}\) \}/);
    });
  }
});
