// The PendingCheckout ledger, and the one invariant the return page depends on: reading a
// checkout's status can never deliver it.
//
// No database. The Prisma client is a small in-memory fake that RECORDS every call, so a test
// can assert not only what a function returned but that it wrote nothing — which is the whole
// point of purchaseStatusForSession, and not something a return value can show.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordPendingCheckout, syncPendingFromEvent, purchaseStatusForSession } from '../src/lib/pending-checkout.mjs';

const WRITES = /^(create|update|updateMany|upsert|delete|deleteMany|createMany|\$executeRaw|\$executeRawUnsafe)$/;

/** An in-memory Prisma stand-in for the two models the ledger touches. */
function fakeDb({ ledger = [], purchases = [] } = {}) {
  const calls = [];
  const rec = (model, op, args) => { calls.push({ model, op, args }); };
  const matchStatus = (row, where) => {
    if (!where?.status) return true;
    if (typeof where.status === 'string') return row.status === where.status;
    if (where.status.in) return where.status.in.includes(row.status);
    return true;
  };
  const p = {
    calls,
    writes: () => calls.filter((c) => WRITES.test(c.op)),
    pendingCheckout: {
      create: async ({ data }) => {
        rec('pendingCheckout', 'create', data);
        if (ledger.some((r) => r.sessionId === data.sessionId)) { const e = new Error('unique'); e.code = 'P2002'; throw e; }
        const row = { id: `pc_${ledger.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        ledger.push(row); return row;
      },
      findUnique: async ({ where }) => { rec('pendingCheckout', 'findUnique', where); return ledger.find((r) => r.sessionId === where.sessionId) || null; },
      updateMany: async ({ where, data }) => {
        rec('pendingCheckout', 'updateMany', { where, data });
        let n = 0;
        for (const r of ledger) if (r.sessionId === where.sessionId && matchStatus(r, where)) { Object.assign(r, data); n++; }
        return { count: n };
      },
    },
    projectProductPurchase: {
      findUnique: async ({ where }) => { rec('projectProductPurchase', 'findUnique', where); return purchases.find((r) => r.checkoutSessionId === where.checkoutSessionId) || null; },
      create: async ({ data }) => { rec('projectProductPurchase', 'create', data); throw new Error('a status read must never reach here'); },
    },
  };
  return p;
}

describe('recordPendingCheckout', () => {
  test('writes one pending row per session and swallows the duplicate', async () => {
    const p = fakeDb();
    const a = await recordPendingCheckout(p, { kind: 'marketplace', sessionId: 'cs_1', userId: 'u1', payload: { type: 'marketplace' } });
    assert.equal(a.status, 'pending');
    assert.equal(a.kind, 'marketplace');
    // A resent create is a no-op, not a second stuck row and not a thrown checkout.
    const b = await recordPendingCheckout(p, { kind: 'marketplace', sessionId: 'cs_1', userId: 'u1' });
    assert.equal(b, null);
  });

  test('a real database error still surfaces to the caller', async () => {
    const p = fakeDb();
    p.pendingCheckout.create = async () => { throw new Error('connection reset'); };
    await assert.rejects(() => recordPendingCheckout(p, { kind: 'cart', sessionId: 'cs_2' }), /connection reset/);
  });

  test('no session id, nothing recorded', async () => {
    const p = fakeDb();
    assert.equal(await recordPendingCheckout(p, { kind: 'cart', sessionId: '' }), null);
    assert.equal(p.writes().length, 0);
  });
});

describe('syncPendingFromEvent', () => {
  const ledgerWith = (status) => [{ id: 'pc_1', sessionId: 'cs_1', kind: 'marketplace', status }];

  test('a settled completion marks the row delivered', async () => {
    const ledger = ledgerWith('pending');
    await syncPendingFromEvent(fakeDb({ ledger }), { type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid' } } });
    assert.equal(ledger[0].status, 'delivered');
  });

  test('a completion whose money has not cleared is "paid", not delivered', async () => {
    const ledger = ledgerWith('pending');
    await syncPendingFromEvent(fakeDb({ ledger }), { type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'unpaid' } } });
    assert.equal(ledger[0].status, 'paid');
    // …and the later clearance finishes it.
    await syncPendingFromEvent(fakeDb({ ledger }), { type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_1', payment_status: 'paid' } } });
    assert.equal(ledger[0].status, 'delivered');
  });

  test('expiry and async failure mark it failed', async () => {
    for (const type of ['checkout.session.expired', 'checkout.session.async_payment_failed']) {
      const ledger = ledgerWith('pending');
      await syncPendingFromEvent(fakeDb({ ledger }), { type, data: { object: { id: 'cs_1' } } });
      assert.equal(ledger[0].status, 'failed', type);
    }
  });

  test('a delivered row is never walked back by a late event', async () => {
    const ledger = ledgerWith('delivered');
    await syncPendingFromEvent(fakeDb({ ledger }), { type: 'checkout.session.expired', data: { object: { id: 'cs_1' } } });
    assert.equal(ledger[0].status, 'delivered');
    await syncPendingFromEvent(fakeDb({ ledger }), { type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'unpaid' } } });
    assert.equal(ledger[0].status, 'delivered');
  });

  test('an event with no session object is ignored', async () => {
    const p = fakeDb();
    await syncPendingFromEvent(p, { type: 'checkout.session.completed', data: {} });
    assert.equal(p.writes().length, 0);
  });
});

describe('purchaseStatusForSession — the return page can only READ', () => {
  test('in flight: pending, and not one write', async () => {
    const p = fakeDb({ ledger: [{ sessionId: 'cs_1', userId: 'u1', kind: 'marketplace', status: 'pending' }] });
    const r = await purchaseStatusForSession(p, { sessionId: 'cs_1', userId: 'u1' });
    assert.deepEqual(r, { status: 'pending' });
    assert.equal(p.writes().length, 0, JSON.stringify(p.writes()));
  });

  test('polling a hundred times still grants nothing', async () => {
    const p = fakeDb({ ledger: [{ sessionId: 'cs_1', userId: 'u1', kind: 'marketplace', status: 'paid' }] });
    for (let i = 0; i < 100; i++) assert.equal((await purchaseStatusForSession(p, { sessionId: 'cs_1', userId: 'u1' })).status, 'paid');
    assert.equal(p.writes().length, 0);
  });

  test('delivered once the webhook wrote the purchase row', async () => {
    const p = fakeDb({
      ledger: [{ sessionId: 'cs_1', userId: 'u1', kind: 'marketplace', status: 'delivered' }],
      purchases: [{ id: 'pur_1', checkoutSessionId: 'cs_1', buyerId: 'u1', status: 'paid', delivery: { key: 'K-1' }, product: { name: 'Pro', redeemUrl: null, redeemNote: null } }],
    });
    const r = await purchaseStatusForSession(p, { sessionId: 'cs_1', userId: 'u1' });
    assert.equal(r.status, 'delivered');
    assert.equal(r.purchase.id, 'pur_1');
    assert.deepEqual(r.purchase.delivery, { key: 'K-1' });
    assert.equal(r.purchase.name, 'Pro');
    assert.equal(p.writes().length, 0);
  });

  test('somebody else\'s session id is not found, even with the purchase row present', async () => {
    const p = fakeDb({
      ledger: [{ sessionId: 'cs_1', userId: 'u1', kind: 'marketplace', status: 'delivered' }],
      purchases: [{ id: 'pur_1', checkoutSessionId: 'cs_1', buyerId: 'u1', status: 'paid', delivery: { key: 'K-1' }, product: { name: 'Pro' } }],
    });
    assert.equal(await purchaseStatusForSession(p, { sessionId: 'cs_1', userId: 'u2' }), null);
    // No ledger row (pre-ledger session): the purchase row's buyer is the only owner.
    const q = fakeDb({ purchases: [{ id: 'pur_1', checkoutSessionId: 'cs_9', buyerId: 'u1', status: 'paid', delivery: {}, product: { name: 'Pro' } }] });
    assert.equal(await purchaseStatusForSession(q, { sessionId: 'cs_9', userId: 'u2' }), null);
    assert.equal((await purchaseStatusForSession(q, { sessionId: 'cs_9', userId: 'u1' })).status, 'delivered');
  });

  test('an expired checkout reads failed; an unknown one is not found', async () => {
    const p = fakeDb({ ledger: [{ sessionId: 'cs_1', userId: 'u1', kind: 'marketplace', status: 'failed' }] });
    assert.equal((await purchaseStatusForSession(p, { sessionId: 'cs_1', userId: 'u1' })).status, 'failed');
    assert.equal(await purchaseStatusForSession(p, { sessionId: 'cs_nope', userId: 'u1' }), null);
    assert.equal(await purchaseStatusForSession(p, { sessionId: '', userId: 'u1' }), null);
  });
});

describe('the marketplace route file keeps delivery out of the return path', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = fs.readFileSync(path.join(ROOT, 'src/routes/marketplace.mjs'), 'utf8');

  test('the status route is read-only in source', () => {
    const start = src.indexOf("'/marketplace/checkout/:sessionId/status'");
    assert.ok(start > 0, 'status route exists');
    const end = src.indexOf('\n  app.', start + 1);
    const body = src.slice(start, end);
    assert.ok(!/\.(create|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|fulfilProduct\(/.test(body), body);
  });

  test('the checkout return URL carries only the session id, and the route records the ledger row', () => {
    assert.match(src, /market=ok&session_id=\{CHECKOUT_SESSION_ID\}/);
    assert.match(src, /recordPendingCheckout\(p, \{ kind: 'marketplace'/);
  });

  test('every Checkout-session creation site in the API records a ledger row', () => {
    // Counted per FILE, so a new checkout added without its ledger row fails here rather
    // than silently becoming the one purchase kind the reconciler cannot see.
    const dir = path.join(ROOT, 'src/routes');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.mjs')) continue;
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      // `await x.checkout.sessions.create(` — the call, not a comment that names it.
      const creates = (s.match(/await \w+\.checkout\.sessions\.create\(/g) || []).length;
      if (!creates) continue;
      const records = (s.match(/recordPendingCheckout\(p,/g) || []).length;
      assert.equal(records, creates, `${f}: ${creates} checkout.sessions.create vs ${records} recordPendingCheckout`);
    }
  });
});
