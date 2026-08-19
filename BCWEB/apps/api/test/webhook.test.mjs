// End-to-end Stripe webhook tests (audit P1) — POST a genuinely-signed event through the
// real handler and assert the DB lifecycle. Covers the two DB-only lifecycle branches
// that don't call the Stripe API: customer.subscription.deleted (lapse → suspend) and
// checkout.session.completed{pool_renew} (renew → restore). Exercises signature
// verification + routing + recomputePoolBytes together. Needs a throwaway Postgres
// (DATABASE_URL); skips cleanly without one, like the other integration tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { track, cleanupFixtures } from './helpers/fixtures.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run webhook tests';

// Dummy Stripe creds — enough to construct the client + verify our own test signature.
// No real API call is made in the branches under test.
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_test_secret_for_ci';

const GiB = 1024n ** 3n;
let p, app, stripe;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  const Fastify = (await import('fastify')).default;
  const stripeWebhook = (await import('../src/routes/stripe-webhook.mjs')).default;
  app = Fastify();
  await app.register(stripeWebhook);
  await app.ready();
  const Stripe = (await import('stripe')).default;
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
});
after(async () => { if (RUN) { await cleanupFixtures(p); await app?.close(); await p?.$disconnect?.(); } });

// POST a signed event and return the Fastify response.
async function post(event) {
  const payload = JSON.stringify(event);
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return app.inject({ method: 'POST', url: '/hosting/webhook', payload,
    headers: { 'content-type': 'application/json', 'stripe-signature': sig } });
}

async function scaffold({ poolBytes = 0n } = {}) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = track('user', await p.user.create({ data: { email: `wh-${uid}@test.local`, displayName: 'W' } }));
  // track(), like the user above. Everything else this file creates hangs off that user and
  // goes with it on cascade — a plan does not, so an untracked one survives every run. Four
  // had piled up in the developer's database and showed up as phantom hosting offers in the
  // admin screen, created by nobody.
  const plan = track('hostingPlan', await p.hostingPlan.create({ data: { name: 'W', storageGB: 5, uploadLimitKbps: 1000, priceMonthlyCents: 500 } }));
  const group = await p.hostingGroup.create({ data: { ownerId: user.id, name: 'pool', poolBytes } });
  return { uid, user, plan, group };
}

test('rejects an unsigned / bad-signature webhook with 400', { skip }, async () => {
  const res = await app.inject({ method: 'POST', url: '/hosting/webhook',
    payload: JSON.stringify({ type: 'ping' }), headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' } });
  assert.equal(res.statusCode, 400);
});

test('customer.subscription.deleted: a single-sub pool lapses → sub canceled, content suspended', { skip }, async () => {
  const { uid, user, plan, group } = await scaffold({ poolBytes: 5n * GiB });
  const stripeSubId = `sub_del_${uid}`;
  await p.subscription.create({ data: { user: { connect: { id: user.id } }, plan: { connect: { id: plan.id } }, hostingGroup: { connect: { id: group.id } }, poolContribBytes: 5n * GiB, status: 'active', stripeSubId } });
  const repo = await p.serverRepo.create({ data: { owner: { connect: { id: user.id } }, group: { connect: { id: group.id } }, name: 'r', hosted: true, status: 'ONLINE' } });
  const cat = await p.communityCatalog.create({ data: { owner: { connect: { id: user.id } }, group: { connect: { id: group.id } }, name: 'c', slug: `wh-${uid}`, status: 'ACTIVE', listed: true } });

  const res = await post({ id: `evt_${uid}`, type: 'customer.subscription.deleted', data: { object: { id: stripeSubId } } });
  assert.equal(res.statusCode, 200);

  const s = await p.subscription.findUnique({ where: { stripeSubId } });
  const g = await p.hostingGroup.findUnique({ where: { id: group.id } });
  const r = await p.serverRepo.findUnique({ where: { id: repo.id } });
  const c = await p.communityCatalog.findUnique({ where: { id: cat.id } });
  assert.equal(s.status, 'canceled');
  assert.equal(g.poolBytes, 0n);
  assert.equal(r.status, 'SUSPENDED');
  assert.equal(c.status, 'HIDDEN');
});

test('checkout.session.completed{pool_renew}: restores a suspended pool and reactivates the sub', { skip }, async () => {
  const { uid, user, plan, group } = await scaffold({ poolBytes: 0n }); // lapsed pool
  const sub0 = await p.subscription.create({ data: { user: { connect: { id: user.id } }, plan: { connect: { id: plan.id } }, hostingGroup: { connect: { id: group.id } }, poolContribBytes: 5n * GiB, status: 'canceled' } });
  const repo = await p.serverRepo.create({ data: { owner: { connect: { id: user.id } }, group: { connect: { id: group.id } }, name: 'r', hosted: true, status: 'SUSPENDED', deleteAt: new Date() } });
  const cat = await p.communityCatalog.create({ data: { owner: { connect: { id: user.id } }, group: { connect: { id: group.id } }, name: 'c', slug: `wh-${uid}`, status: 'HIDDEN', listed: false } });

  const res = await post({ id: `evt_${uid}`, type: 'checkout.session.completed', data: { object: {
    id: `cs_${uid}`, subscription: `sub_renew_${uid}`, amount_total: 500, currency: 'usd',
    metadata: { type: 'pool_renew', groupId: group.id, userId: user.id, months: '1' },
  } } });
  assert.equal(res.statusCode, 200);

  const r = await p.serverRepo.findUnique({ where: { id: repo.id } });
  const c = await p.communityCatalog.findUnique({ where: { id: cat.id } });
  const s = await p.subscription.findUnique({ where: { id: sub0.id } });
  assert.equal(r.status, 'ONLINE');
  assert.equal(r.deleteAt, null);
  assert.equal(c.status, 'ACTIVE');
  assert.equal(s.status, 'active');
  assert.ok(s.currentPeriodEnd instanceof Date, 'renewal set a new period end');
});
