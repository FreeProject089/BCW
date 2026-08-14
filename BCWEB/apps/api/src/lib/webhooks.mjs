// Outgoing webhooks: telling a developer's server that something happened, so it stops asking.
//
// Every integration built against this API so far has to poll — ask /v1/catalogs every minute
// in case an item was published. That is wasted on both sides and always up to a minute late.
// This inverts it.
//
// Two things here are load-bearing and easy to get wrong:
//
//   • The URL is attacker-chosen. It is fetched through safeFetch, which refuses private
//     addresses and re-checks after every redirect — without it a webhook is a hole straight
//     into whatever the container can reach.
//   • Delivery is queued and retried on a timer, never inline with the action that caused it.
//     Publishing an item must not wait on somebody's slow server, and must not fail because
//     their TLS certificate expired.
import crypto from 'node:crypto';
import { safeFetch } from './net.mjs';

/** What can be subscribed to. Names are `noun.verb`, past tense: they describe something that
 *  already happened, which is the only thing a webhook can honestly report. */
export const WEBHOOK_EVENTS = Object.freeze({
  'catalog.item.published': 'An item you own was published to a catalog.',
  'catalog.item.updated': 'A published item you own changed.',
  'catalog.item.removed': 'An item you own was unpublished or removed.',
  'repo.updated': 'Files changed in one of your repos.',
  'repo.status.changed': 'One of your repos went online, offline or was suspended.',
  'pool.storage.warning': 'A storage pool of yours is close to full.',
  'subscription.expiring': 'A subscription of yours is about to end.',
  'sanction.issued': 'A moderation decision was recorded against you or your content.',
  'transfer.offered': 'Somebody offered you ownership of a repo or catalog.',
});

const MAX_ATTEMPTS = 6;
// 1 min, 5, 25, 2h, 10h — capped. Long enough for somebody to notice and fix a receiver over
// a working day; short enough that the first retry catches an ordinary blip.
const BACKOFF_MS = [60e3, 300e3, 1500e3, 7200e3, 36000e3, 36000e3];

export const newWebhookSecret = () => `whsec_${crypto.randomBytes(24).toString('base64url')}`;

/** The signature a receiver checks.
 *
 *  Timestamp INSIDE the signed string, not just beside it: signing the body alone lets anyone
 *  who once saw a delivery replay it for ever. The receiver compares timestamps and rejects
 *  anything old.
 */
export function signWebhook(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Queue an event for every endpoint that asked for it.
 *
 *  Never throws and never awaits the HTTP call: the caller is in the middle of publishing an
 *  item, and a webhook is not allowed to be the reason that fails.
 */
export async function emitWebhook(p, userId, event, data) {
  try {
    if (!WEBHOOK_EVENTS[event]) return 0;
    const endpoints = await p.webhookEndpoint.findMany({
      where: { userId, enabled: true, events: { has: event } },
      select: { id: true },
    });
    if (!endpoints.length) return 0;
    const payload = { event, at: new Date().toISOString(), data };
    await p.webhookDelivery.createMany({
      data: endpoints.map((e) => ({ endpointId: e.id, event, payload, nextAt: new Date() })),
    });
    return endpoints.length;
  } catch { return 0; }
}

/** Send one delivery. Returns the updated row. */
export async function attemptDelivery(p, delivery, endpoint, log) {
  const body = JSON.stringify(delivery.payload);
  const ts = Math.floor(Date.now() / 1000);
  const attempts = delivery.attempts + 1;
  try {
    const res = await safeFetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BetterCommunity-Webhooks/1',
        'X-BCW-Event': delivery.event,
        'X-BCW-Delivery': delivery.id,
        'X-BCW-Timestamp': String(ts),
        'X-BCW-Signature': `v1=${signWebhook(endpoint.secret, ts, body)}`,
      },
      body,
      // A receiver that needs longer than ten seconds to say "got it" is doing the work
      // inline, which is their bug and must not become our queue's.
      signal: AbortSignal.timeout(10_000),
    });
    const ok = res.status >= 200 && res.status < 300;
    await p.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { lastAt: new Date(), lastStatus: res.status, failures: ok ? 0 : { increment: 1 } },
    });
    return p.webhookDelivery.update({
      where: { id: delivery.id },
      data: ok
        ? { status: 'ok', httpStatus: res.status, attempts, deliveredAt: new Date(), nextAt: null, error: null }
        : {
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          httpStatus: res.status, attempts, error: `HTTP ${res.status}`,
          nextAt: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]),
        },
    });
  } catch (e) {
    // A refused URL (private address, bad scheme) is not a transient failure and must not be
    // retried for two days — it will be refused identically every time.
    const msg = String(e?.message || e).slice(0, 300);
    const permanent = msg.startsWith('ssrf_');
    await p.webhookEndpoint.update({ where: { id: endpoint.id }, data: { lastAt: new Date(), failures: { increment: 1 } } }).catch(() => {});
    log?.warn?.({ endpoint: endpoint.id, e: msg }, 'webhook delivery failed');
    return p.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: permanent || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts, error: msg,
        nextAt: permanent || attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]),
      },
    });
  }
}

/** Drain what is due. Called from the sweeper. */
export async function runWebhookQueue(p, log) {
  const due = await p.webhookDelivery.findMany({
    where: { status: 'pending', nextAt: { lte: new Date() } },
    orderBy: { nextAt: 'asc' }, take: 25,
    include: { endpoint: true },
  }).catch(() => []);
  let sent = 0;
  for (const d of due) {
    if (!d.endpoint?.enabled) {
      await p.webhookDelivery.update({ where: { id: d.id }, data: { status: 'failed', error: 'endpoint disabled', nextAt: null } }).catch(() => {});
      continue;
    }
    await attemptDelivery(p, d, d.endpoint, log);
    sent++;
  }

  // An address that has failed twenty times in a row is not coming back on its own. Disabling
  // it stops us hammering somebody else's server — and the owner is told, because an endpoint
  // that silently stopped is worse than one that visibly did.
  const dead = await p.webhookEndpoint.findMany({ where: { enabled: true, failures: { gte: 20 } }, select: { id: true, userId: true, url: true } }).catch(() => []);
  for (const e of dead) {
    await p.webhookEndpoint.update({ where: { id: e.id }, data: { enabled: false, disabledReason: 'Twenty deliveries in a row failed.' } }).catch(() => {});
    const { notify } = await import('./lib.mjs');
    await notify(p, e.userId, 'webhook_disabled', `Your webhook to ${e.url} was switched off after twenty failed deliveries in a row. Fix the receiver and turn it back on.`).catch(() => {});
  }

  // Deliveries are a log, not an archive: thirty days is long enough to answer "you never
  // called me" and short enough that the table cannot become the biggest thing in the
  // database.
  await p.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 864e5) } } }).catch(() => {});
  return sent;
}
