// In-process pub/sub for conversation threads (commissions, reports).
//
// A message posted by one side should appear on the other without a refresh. The transport is
// Server-Sent Events, matching the live analytics feed already in this codebase: one-way,
// plain HTTP, carries the session cookie, and reconnects on its own — none of which is true
// of a WebSocket without extra work at the proxy.
//
// SCOPE, and the reason it matters: this is an in-PROCESS emitter. With one API container it
// reaches every connected client. Run two and a message posted on container A never reaches a
// listener parked on container B — that reader silently sees nothing new until they reload.
// Moving to several API replicas therefore means giving this a shared backend (Redis pub/sub
// is already a dependency); it is not something that degrades gracefully on its own.
//
// The bus deliberately carries NO authorisation of its own. Every subscriber is authorised by
// the route that opens the stream, using the same predicate as the route that reads the
// thread, so the stream can never show what a GET would refuse.
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
// One listener per open stream, and a busy thread can legitimately have many readers (a
// reporter, several staff, invited participants). The default cap of 10 would print a
// misleading "memory leak detected" warning long before anything is actually wrong.
bus.setMaxListeners(0);

const topic = (kind, id) => `${kind}:${id}`;

/** Publish an event to everyone watching one thread. Call it AFTER the write commits —
 *  a client that receives a message the database then fails to store has been told a lie. */
export function publishToThread(kind, id, event) {
  bus.emit(topic(kind, id), event);
}

/** Subscribe to one thread. Returns an unsubscribe function; callers must invoke it on
 *  socket close, or every dropped connection leaves a listener behind. */
export function subscribeToThread(kind, id, handler) {
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
