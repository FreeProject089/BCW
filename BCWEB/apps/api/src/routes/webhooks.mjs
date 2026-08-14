// The developer's side of webhooks: register an address, see what we sent it, replay a
// delivery that failed while their server was down.
import { z } from 'zod';
import { db, requireRole, requireCap } from '../lib/lib.mjs';
import { WEBHOOK_EVENTS, newWebhookSecret, attemptDelivery, emitWebhook } from '../lib/webhooks.mjs';

// The secret is shown once, at creation, like an API key — it is stored in clear because we
// have to sign with it, but it is never sent again. A receiver that lost it rotates.
const view = (e) => ({
  id: e.id, url: e.url, label: e.label, events: e.events, enabled: e.enabled,
  failures: e.failures, disabledReason: e.disabledReason,
  lastAt: e.lastAt, lastStatus: e.lastStatus, createdAt: e.createdAt,
  secretHint: `${e.secret.slice(0, 11)}…`,
});

export default async function webhookRoutes(app) {
  app.get('/v1/webhook-events', async () => ({ events: WEBHOOK_EVENTS }));

  app.get('/me/webhooks', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.webhookEndpoint.findMany({ where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' } });
    return { webhooks: rows.map(view), events: WEBHOOK_EVENTS };
  });

  app.post('/me/webhooks', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({
      url: z.string().url().max(500),
      label: z.string().trim().max(60).optional(),
      events: z.array(z.string()).min(1).max(30),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });

    const events = [...new Set(b.data.events.filter((e) => WEBHOOK_EVENTS[e]))];
    if (!events.length) return reply.code(400).send({ error: 'no_events', allowed: Object.keys(WEBHOOK_EVENTS) });
    // https only, except on localhost for development — the payload describes your content
    // and carries a signature; sending it in clear undoes the point of signing it.
    const u = new URL(b.data.url);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !local) return reply.code(400).send({ error: 'https_required' });

    const p = await db();
    const count = await p.webhookEndpoint.count({ where: { userId: req.user.uid } });
    if (count >= 10) return reply.code(409).send({ error: 'too_many', max: 10 });

    const secret = newWebhookSecret();
    const row = await p.webhookEndpoint.create({
      data: { userId: req.user.uid, url: b.data.url, label: b.data.label || '', events, secret },
    });
    // The only time the secret is ever sent.
    return reply.code(201).send({ webhook: view(row), secret });
  });

  app.patch('/me/webhooks/:id', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      enabled: z.boolean().optional(),
      label: z.string().trim().max(60).optional(),
      events: z.array(z.string()).max(30).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.webhookEndpoint.findFirst({ where: { id: req.params.id, userId: req.user.uid } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const data = {};
    if (b.data.label !== undefined) data.label = b.data.label;
    if (b.data.events) data.events = [...new Set(b.data.events.filter((e) => WEBHOOK_EVENTS[e]))];
    // Re-enabling clears the failure count: otherwise an address fixed after twenty failures
    // is one bad delivery away from being switched off again.
    if (b.data.enabled !== undefined) Object.assign(data, { enabled: b.data.enabled, failures: b.data.enabled ? 0 : row.failures, disabledReason: b.data.enabled ? null : row.disabledReason });
    const out = await p.webhookEndpoint.update({ where: { id: row.id }, data });
    return { webhook: view(out) };
  });

  app.delete('/me/webhooks/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const r = await p.webhookEndpoint.deleteMany({ where: { id: req.params.id, userId: req.user.uid } });
    if (!r.count) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // Rotate. The old secret stops verifying the moment this returns, which is the point.
  app.post('/me/webhooks/:id/rotate', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const row = await p.webhookEndpoint.findFirst({ where: { id: req.params.id, userId: req.user.uid } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const secret = newWebhookSecret();
    await p.webhookEndpoint.update({ where: { id: row.id }, data: { secret } });
    return { secret };
  });

  app.get('/me/webhooks/:id/deliveries', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const row = await p.webhookEndpoint.findFirst({ where: { id: req.params.id, userId: req.user.uid }, select: { id: true } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const rows = await p.webhookDelivery.findMany({
      where: { endpointId: row.id }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, event: true, status: true, httpStatus: true, error: true, attempts: true, createdAt: true, deliveredAt: true, nextAt: true, payload: true },
    });
    return { deliveries: rows };
  });

  // Send a real event with fabricated data, so the receiver can be built before the first
  // real one happens. Marked `test: true` in the payload — a receiver that treats it as real
  // would be a receiver that acts on any POST it is sent.
  app.post('/me/webhooks/:id/test', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const endpoint = await p.webhookEndpoint.findFirst({ where: { id: req.params.id, userId: req.user.uid } });
    if (!endpoint) return reply.code(404).send({ error: 'not_found' });
    const event = WEBHOOK_EVENTS[req.body?.event] ? req.body.event : (endpoint.events[0] || 'repo.updated');
    const delivery = await p.webhookDelivery.create({
      data: { endpointId: endpoint.id, event, payload: { event, at: new Date().toISOString(), test: true, data: { message: 'This is a test delivery from BetterCommunity.' } }, nextAt: new Date() },
    });
    const out = await attemptDelivery(p, delivery, endpoint, req.log);
    return { delivery: { id: out.id, status: out.status, httpStatus: out.httpStatus, error: out.error } };
  });

  // Replay one. The payload is unchanged — this is the same event again, not a new one, which
  // is what makes it useful after fixing a receiver that was down.
  app.post('/me/webhooks/:id/deliveries/:did/replay', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const endpoint = await p.webhookEndpoint.findFirst({ where: { id: req.params.id, userId: req.user.uid } });
    if (!endpoint) return reply.code(404).send({ error: 'not_found' });
    const old = await p.webhookDelivery.findFirst({ where: { id: req.params.did, endpointId: endpoint.id } });
    if (!old) return reply.code(404).send({ error: 'not_found' });
    const fresh = await p.webhookDelivery.create({ data: { endpointId: endpoint.id, event: old.event, payload: old.payload, nextAt: new Date() } });
    const out = await attemptDelivery(p, fresh, endpoint, req.log);
    return { delivery: { id: out.id, status: out.status, httpStatus: out.httpStatus, error: out.error } };
  });

  // Staff view: who is subscribed to what, and which addresses are failing. An endpoint
  // hammering a dead host is our outbound traffic, so it is our problem too.
  app.get('/admin/webhooks', { preHandler: requireCap('manage_api') }, async () => {
    const p = await db();
    const rows = await p.webhookEndpoint.findMany({
      orderBy: [{ failures: 'desc' }, { createdAt: 'desc' }], take: 200,
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
    const [pending, failed] = await Promise.all([
      p.webhookDelivery.count({ where: { status: 'pending' } }),
      p.webhookDelivery.count({ where: { status: 'failed', createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } }),
    ]);
    return {
      endpoints: rows.map((e) => ({ ...view(e), user: e.user })),
      queue: { pending, failedLast7d: failed },
    };
  });
}

export { emitWebhook };
