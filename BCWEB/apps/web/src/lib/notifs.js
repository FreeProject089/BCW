// Every write to a notification, in one place, so the bell hears about it.
//
// There are three surfaces that mark notifications read or delete them — the navbar bell, the
// dashboard panel and the notification centre — and each kept its own copy of the list. The
// bell reloads on a 60-second poll, so marking everything read on the notifications PAGE left
// the badge sitting there with its old number for up to a minute. It reads as "I have to
// refresh to make it go away", and refreshing is what people did.
//
// The fix could have been an event dispatched at each of the eight call sites. That is the
// shape that goes wrong later: the ninth call site is written by someone who does not know
// the rule, nothing breaks visibly, and the badge is stale again for one action only. So the
// API calls live here instead and broadcasting is not something a caller can forget.
//
// Optimistic updates stay with the callers. Each list is rendered differently and each one
// already had that code; what they could not do is tell the others.

import { api } from './api.js';

const EVENT = 'bcw:notifs-changed';

/**
 * Tell every mounted list what just happened.
 *
 * The detail carries WHAT changed rather than "something changed", so a listener can update
 * its own state without a round trip — the badge drops on the click rather than one request
 * later. Listeners still reload afterwards to reconcile; this is what makes the wait invisible,
 * not what makes it correct.
 */
function broadcast(detail) {
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail })); } catch { /* no window: SSR, tests */ }
}

/**
 * Subscribe. Returns the unsubscribe, so a caller can hand it straight back from useEffect.
 */
export function onNotifsChanged(fn) {
  const h = (e) => fn(e.detail || {});
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/**
 * Broadcast AFTER the write lands, never before.
 *
 * A listener reacting to the event reloads from the API, and a reload that overtakes the POST
 * reads the old value — the badge would drop and come straight back. The optimistic half is
 * carried in the event detail, so nothing waits for the network to LOOK right; only the
 * reconciling reload does.
 */
async function write(fn, detail) {
  const r = await fn();
  broadcast(detail);
  return r;
}

export const listNotifs = () => api.get('/me/notifications');

export const markNotifRead = (id) =>
  write(() => api.post(`/me/notifications/${id}/read`), { read: [id] });

export const markAllNotifsRead = () =>
  write(() => api.post('/me/notifications/read-all'), { readAll: true });

export const deleteNotif = (id) =>
  write(() => api.del(`/me/notifications/${id}`), { deleted: [id] });

export const deleteAllNotifs = () =>
  write(() => api.del('/me/notifications'), { deletedAll: true });

/**
 * A report thread was SEEN — opened, or marked seen from a list — and the server read the
 * notifications that point at it as part of the same write (lib/feedback-thread.mjs). The ids
 * come back in the response, so the lists hear about it the same way as a direct mark-read,
 * and the reports badge (lib/reports-unseen.js) listens to the same event. `reportsSeen` is
 * set even when no notification matched, because the badge still has to drop.
 */
export const notifsReadElsewhere = (ids) => broadcast({ read: Array.isArray(ids) ? ids : [], reportsSeen: true });

/** POST one of the report "seen" routes and tell every list what it read. */
export const markReportsSeen = (path) => api.post(path).then((r) => { notifsReadElsewhere(r?.notifIds); return r; });

/**
 * Apply an event's detail to a list, without asking the server.
 *
 * Shared so the three lists cannot disagree about what "read-all" means to a list that also
 * holds items the sender could not see — the bell filters by a local "cleared before" stamp,
 * and the page does not.
 */
export function applyNotifChange(items, detail) {
  if (!Array.isArray(items) || !detail) return items;
  const now = new Date().toISOString();
  if (detail.deletedAll) return [];
  if (detail.readAll) return items.map((n) => ({ ...n, readAt: n.readAt || now }));
  if (detail.deleted?.length) return items.filter((n) => !detail.deleted.includes(n.id));
  if (detail.read?.length) {
    return items.map((n) => (detail.read.includes(n.id) ? { ...n, readAt: n.readAt || now } : n));
  }
  return items;
}
