// In-process pub/sub for conversation threads (commissions, reports).
//
// A message posted by one side should appear on the other without a refresh. The transport is
// Server-Sent Events, matching the live analytics feed already in this codebase: one-way,
// plain HTTP, carries the session cookie, and reconnects on its own — none of which is true
// of a WebSocket without extra work at the proxy.
//
// SCOPE: the local emitter reaches this process; Redis pub/sub carries an event to the other
// API replicas. That second half is not optional decoration — running two API containers is a
// documented, supported step (guides/run/ADDONS_EN.md §3), and without it a message posted on
// container A never reaches a reader parked on container B, who silently sees nothing new
// until they reload. With REDIS_URL unset this degrades to in-process only, which is exactly
// right for a single container.
//
// The bus deliberately carries NO authorisation of its own. Every subscriber is authorised by
// the route that opens the stream, using the same predicate as the route that reads the
// thread, so the stream can never show what a GET would refuse.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { getRedis, getRedisSubscriber } from './redis.mjs';

const bus = new EventEmitter();
// One listener per open stream, and a busy thread can legitimately have many readers (a
// reporter, several staff, invited participants). The default cap of 10 would print a
// misleading "memory leak detected" warning long before anything is actually wrong.
bus.setMaxListeners(0);

const topic = (kind, id) => `${kind}:${id}`;

// One Redis channel for every thread, rather than a channel per thread.
//
// A channel per thread would mean subscribing and unsubscribing as readers come and go —
// bookkeeping that has to stay exactly in step with the SSE connections or it leaks
// subscriptions. Thread traffic is a handful of messages a minute across the whole site, so
// the cost of every replica seeing every event is negligible next to that risk. It also
// matches how the live analytics feed already does it.
const CHANNEL = 'bcw:threads';
// Identifies THIS process, so a replica ignores the echo of its own publish — it already
// emitted locally, and re-emitting would deliver every message twice.
const INSTANCE_ID = createHash('sha1').update(`${process.pid}-${Math.random()}`).digest('hex').slice(0, 12);

/** Publish an event to everyone watching one thread, on every replica. Call it AFTER the
 *  write commits — a client told about a message the database then fails to store has been
 *  lied to. */
export function publishToThread(kind, id, event) {
  bus.emit(topic(kind, id), event);
  const r = getRedis();
  if (!r) return;   // no Redis configured → single container, local delivery is complete
  try { r.publish(CHANNEL, JSON.stringify({ from: INSTANCE_ID, kind, id, event })); }
  catch { /* Redis down → this replica's own readers still got it */ }
}

// Subscribe once per process and re-emit other replicas' events onto the local bus.
let subInit = false;
function initSubscriber() {
  if (subInit) return;
  subInit = true;
  const sub = getRedisSubscriber();
  if (!sub) return;
  // The connection disables the offline queue, so subscribing before it is ready is
  // rejected outright. Subscribe on every 'ready' — the initial connect AND every
  // reconnect, which is what stops a Redis restart from silently ending live delivery.
  // Re-subscribing to the same channel is idempotent.
  const doSub = () => sub.subscribe(CHANNEL).catch(() => {});
  if (sub.status === 'ready') doSub();
  sub.on('ready', doSub);
  sub.on('message', (ch, msg) => {
    if (ch !== CHANNEL) return;
    try {
      const { from, kind, id, event } = JSON.parse(msg);
      if (from !== INSTANCE_ID) bus.emit(topic(kind, id), event);
    } catch { /* ignore malformed */ }
  });
}

/** Subscribe to one thread. Returns an unsubscribe function; callers must invoke it on
 *  socket close, or every dropped connection leaves a listener behind. */
export function subscribeToThread(kind, id, handler) {
  // Lazily, on the first reader: a process that never opens a stream (a worker, a one-shot
  // script) has no reason to hold a Redis subscription open.
  initSubscriber();
  const t = topic(kind, id);
  bus.on(t, handler);
  return () => bus.removeListener(t, handler);
}

/** Attach an SSE stream for one thread to a Fastify reply.
 *
 *  Shares the analytics feed's headers for the same reasons: `X-Accel-Buffering: no` stops a
 *  reverse proxy holding the stream in a buffer (which looks exactly like "chat is broken"),
 *  and the heartbeat keeps idle connections from being reaped by an intermediary. `retry`
 *  tells EventSource how long to wait before reconnecting after a drop.
 *
 *  The caller MUST have already authorised this reader for this thread. */
export function streamThread(req, reply, kind, id) {
  reply.hijack(); // take ownership of the socket before writing the SSE head
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  raw.write('retry: 5000\n\n');
  const off = subscribeToThread(kind, id, (ev) => {
    try { raw.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* client gone; cleanup runs on close */ }
  });
  const hb = setInterval(() => { try { raw.write(': ping\n\n'); } catch { /* client gone */ } }, 25000);
  const cleanup = () => { clearInterval(hb); off(); };
  req.raw.on('close', cleanup);
  req.raw.on('error', cleanup);
}
