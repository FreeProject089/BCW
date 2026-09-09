// Who still gets the file.
//
// Born red against a real bug: the gate read `purchase.status !== 'paid'`, and a
// subscription purchase is created 'active'. Because nothing couples deliveryKind to
// billing, a `file` product sold monthly is an ordinary thing for a seller to build — and
// every one of its paying customers got 409 not_paid, for the whole life of the
// subscription. They had paid. The message said they had not.
//
// The interesting cases are the two that are NOT 'paid': 'active' must open, 'ended' must
// not, and the difference between them is what lets the storefront tell somebody whose
// subscription lapsed apart from somebody who never bought.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mayDownload } from '../src/routes/marketplace.mjs';

describe('mayDownload', () => {
  test("a one-off purchase opens — 'paid' is what a single sale and a free claim both write", () => {
    assert.equal(mayDownload('paid'), true);
  });

  test("a LIVE subscription opens — the bug: 'active' is not 'paid', and they are paying", () => {
    assert.equal(mayDownload('active'), true);
  });

  test("a LAPSED subscription does not — 'ended' keeps the row without keeping the file", () => {
    assert.equal(mayDownload('ended'), false);
  });

  test('a status nobody has taught it is refused, not waved through', () => {
    // The direction a default has to fail in. A status added later (a refund, a dispute, a
    // hold) must arrive closed and make somebody come back here, rather than quietly
    // handing over the file because it was not on a deny-list.
    for (const s of ['refunded', 'disputed', 'pending', 'cancelled', '']) {
      assert.equal(mayDownload(s), false, `${s || '(empty)'} should not open the file`);
    }
  });

  test('absent, null and the wrong type are refused rather than throwing', () => {
    for (const s of [undefined, null, 0, {}, ['paid']]) assert.equal(mayDownload(s), false);
  });
});
