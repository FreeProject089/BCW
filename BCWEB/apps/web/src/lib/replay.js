// Session replay (rrweb) — off unless an admin turned it on, and never without consent.
//
// Everything else in analytics.js is a COUNT. This reproduces what a page looked like, which
// is a different kind of collection and is treated as one:
//
//   1. Consent first. `analytics = 'all'`, the same gate as pageviews. Checked before rrweb is
//      even imported, so a visitor who declined never downloads the recorder either.
//   2. The admin switch second, fetched from the server. A build that ships this code to
//      everybody still records nothing until somebody turns it on deliberately.
//   3. Sampling third, so "on" does not mean "everyone".
//   4. INPUT VALUES ARE MASKED AT THE SOURCE. `maskAllInputs` means rrweb writes asterisks
//      into the event as it creates it — the typed value never exists in the buffer, so there
//      is nothing to leak, nothing to strip later, and nothing to get wrong on the server. The
//      privacy policy says values are never collected; this is what makes that true rather
//      than a promise.
//
// The recording is sent in CHUNKS while the page is alive, not once on the way out. That is
// forced rather than chosen: sendBeacon and keepalive fetch are both capped near 64 KB and a
// few seconds of an ordinary page is already past it, so a single send at the end is refused
// by the browser with no error anywhere. See `flush` below.
import { getConsent } from './analytics.js';

// Belt and braces around rrweb's own cap: a long visit on a busy page can produce a very large
// stream, and the server refuses over 2 MB. Stopping at a limit the server accepts means the
// recording is kept; going over means it is thrown away at the end of the visit, which is the
// worst of both.
const MAX_EVENTS = 20000;
const MAX_BYTES = 1.8 * 1024 * 1024;

// A page nobody should be watching over, whatever the settings say. Sign-in and the built-in
// authenticator are where secrets are on screen, and the authenticator's whole promise is that
// its secrets never reach a server.
const NEVER_RECORD = [/^\/auth/, /^\/2fa/, /^\/settings/];

let started = false;

export async function initReplay() {
  if (started) return;
  if (getConsent() !== 'all') return;
  if (NEVER_RECORD.some((re) => re.test(location.pathname))) return;

  let cfg;
  try {
    const res = await fetch('/api/analytics/replay/config');
    if (!res.ok) return;
    cfg = await res.json();
  } catch { return; }
  if (!cfg?.enabled) return;

  // Per PAGE LOAD, not per visitor: a stable per-visitor decision would need an identifier
  // that survives the day, which is exactly what the daily-rotating hash exists to avoid.
  if (!(Math.random() * 100 < (cfg.sampleRate ?? 0))) return;

  const { record } = await import('rrweb');

  const events = [];
  let bytes = 0;
  let stop = null;
  let emitHook = null;
  const startedAt = Date.now();
  // One id for this recording, so the server can join its chunks back into a single row.
  const sid = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

  // `started` is set only once the recorder is ACTUALLY running.
  //
  // It used to be set before this call, and that hid a real failure completely: if `record`
  // throws, the exception propagates out of initReplay into App.jsx's `.catch(() => {})`, the
  // pagehide listener below is never attached, and nothing is ever sent — while a second call
  // to initReplay returns instantly at the `started` guard, so even probing it says "fine".
  // The symptom is an empty Replays screen, which looks exactly like "nobody visited".
  const options = {
    emit(ev) {
      if (events.length >= MAX_EVENTS || bytes >= MAX_BYTES) { try { stop?.(); } catch { /* ignore */ } return; }
      events.push(ev);
      // Cheap running estimate. Serialising the whole buffer on every event would be O(n²)
      // over a session, which is a page that gets slower the longer somebody stays on it —
      // the opposite of what a measurement tool should do to the thing it measures.
      bytes += JSON.stringify(ev).length;
      emitHook?.();
    },
    // The privacy guarantees, as options rather than as a later filtering step.
    maskAllInputs: true,
    maskInputOptions: { password: true, email: true, tel: true, text: true, textarea: true, number: true, date: true, url: true, search: true },
    // Anything an author marks. `.bc-no-record` blocks a whole subtree from being recorded;
    // `.bc-mask` keeps the layout and replaces the text.
    blockClass: 'bc-no-record',
    maskTextClass: 'bc-mask',
    // Recording every mouse move produces most of the bytes and almost none of the meaning.
    sampling: { mousemove: 100, scroll: 150, input: 'last' },
    // A stream with no checkpoint cannot be played from the middle; rrweb needs a periodic
    // full snapshot for the seek bar to work at all.
    checkoutEveryNms: 60 * 1000,
  };

  try {
    stop = record(options) || null;
  } catch (e) {
    // Said out loud, once. A measurement tool must never break the page, but it must not
    // pretend to be working either.
    console.warn('[replay] recorder did not start:', e);
    return;
  }
  started = true;

  // `splice` DETACHES the batch before the payload is built. A first version put `events`
  // straight into the payload and then set `events.length = 0` to stop a double send — but the
  // payload holds a reference to that same array, so what got serialised a line later was an
  // empty list. Every post carried `events: []`, the server answered 400, and the feature
  // collected nothing while looking completely wired up.
  const flush = (final = false) => {
    if (!events.length) return;
    const batch = events.splice(0);
    bytes = 0;
    const body = JSON.stringify({ sid, path: location.pathname, durationMs: Date.now() - startedAt, events: batch });

    // WHY THIS IS NOT ONE SEND AT THE END.
    //
    // sendBeacon and a keepalive fetch are both capped at about 64 KB. Five seconds of an
    // ordinary page already produces more than that — measured here at 171 KB — and over the
    // limit the browser simply REFUSES. It returns false, or resolves nothing; there is no
    // error, no console line, no failed request in the network tab. The only symptom is a
    // Replays screen that stays empty, which reads as "nobody visited".
    //
    // So the recording is flushed while the page is still alive, with an ordinary fetch that
    // has no such limit, and only the small tail goes out through a beacon on the way off.
    if (!final) {
      fetch('/api/analytics/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
      return;
    }
    try {
      const blob = new Blob([body], { type: 'application/json' });
      // Under the cap it goes as a beacon, which survives the page going away. Over it, a
      // keepalive fetch would be refused for the same reason, so a plain fetch is the honest
      // last try: it may not finish, and losing the last few seconds beats losing everything.
      if (blob.size > 60 * 1024 || !navigator.sendBeacon?.('/api/analytics/replay', blob)) {
        fetch('/api/analytics/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
      }
    } catch { /* a failed measurement must never surface to the visitor */ }
  };

  // Flush on size first, time second: a busy page hits the size bound long before the timer,
  // and a quiet one would otherwise hold everything until the visitor leaves.
  const FLUSH_BYTES = 48 * 1024;
  const timer = setInterval(() => flush(false), 20000);
  const onEmit = () => { if (bytes >= FLUSH_BYTES) flush(false); };

  // `pagehide` and not `unload`: unload is not fired at all on a backgrounded mobile tab that
  // the OS then discards, which is most of a phone session.
  addEventListener('pagehide', () => { clearInterval(timer); flush(true); });
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  emitHook = onEmit;
}
