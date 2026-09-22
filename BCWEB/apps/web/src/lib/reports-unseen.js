// How many report threads are waiting to be SEEN — the number on the topbar's dashboard entry
// (your own threads with an unseen staff reply) and on its admin entry (threads with a reporter
// message no moderator has seen).
//
// Not a second unread system. The state is the Report row's own `userUnread` / `staffUnread`
// flags, which the thread views already set and clear; GET /me/reports/unseen only counts
// them. What this module adds is ONE poll shared by every consumer — the topbar and the
// dashboard sidebar both show it, and two fetches of the same two integers every minute would
// be waste — and a refresh on the notification bus, so marking a thread seen anywhere drops
// the badge on the click instead of a minute later.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { onNotifsChanged } from './notifs.js';

let state = { mine: 0, staff: 0 };
const subs = new Set();
let timer = null;
let inflight = null;

function publish(next) {
  if (next.mine === state.mine && next.staff === state.staff) return;
  state = next;
  subs.forEach((fn) => fn(state));
}

function refresh() {
  if (inflight) return inflight;
  inflight = api.get('/me/reports/unseen')
    .then((r) => publish({ mine: Number(r?.mine) || 0, staff: Number(r?.staff) || 0 }))
    .catch(() => { /* a badge is not worth an error: keep the last number */ })
    .finally(() => { inflight = null; });
  return inflight;
}

let offBus = null;
function start() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, 60_000);
  // Any notification write may be a report being seen (see notifsReadElsewhere). A count is
  // two integers; re-asking is cheaper than working out which events could have changed it.
  offBus = onNotifsChanged(() => { void refresh(); });
}
function stop() {
  clearInterval(timer); timer = null;
  offBus?.(); offBus = null;
  state = { mine: 0, staff: 0 };
}

/**
 * `{ mine, staff }`. Pass `enabled = false` while signed out: the route needs a session, and
 * the last subscriber leaving stops the poll and forgets the numbers, so signing out never
 * leaves a badge behind.
 */
export function useReportsUnseen(enabled = true) {
  const [v, setV] = useState(state);
  useEffect(() => {
    if (!enabled) return undefined;
    subs.add(setV);
    start();
    setV(state);
    return () => { subs.delete(setV); if (!subs.size) stop(); };
  }, [enabled]);
  return enabled ? v : { mine: 0, staff: 0 };
}

/** Ask now — after an action this screen took that the server may have changed the count for. */
export const refreshReportsUnseen = () => refresh();
