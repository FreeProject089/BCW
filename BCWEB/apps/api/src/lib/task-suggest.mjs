// Tasks the site proposes from its own state.
//
// Four places already know that something needs a human: the status page (a service is down),
// the "Needs attention" queues (routes/misc.mjs PENDING_QUEUES), the server alerts and the
// error groups. Each is its own screen. This turns what they know into DRAFT tasks an admin
// accepts or dismisses — never into tasks directly, because a board that fills itself is a
// board nobody trusts.
//
// Two properties are the whole design, and both are pure functions below so they are tested
// without a database:
//
// 1. ONE PROPOSAL PER INCIDENT. Every candidate carries a `dedupKey` naming the incident, not
//    the sighting: `status:<outageId>`, `pending:<queue>`, `alert:<alertId>`, `error:<groupId>`.
//    The monitor already collapses a flapping condition into one alert row and the error log
//    groups by message, so keying on THEIR ids inherits their deduplication instead of
//    inventing a second one. planSuggestions() turns a scan into create / refresh / reopen /
//    expire, and a condition that stays true for a day refreshes one row.
//
// 2. NOTHING SECRET CROSSES OVER (CWE-532). A suggestion, once accepted, is read by a whole
//    team, and the team may hold none of the capabilities its source is behind. Private share
//    links carry their key in the query string (`/r/<id>?k=…`) or in the path (`/threads/t/…`),
//    and error messages quote request URLs. So:
//      · no queue item is ever copied — a pending queue becomes "work is waiting in X", with no
//        count in the task text either (the /admin/pending route treats even counts as data)
//      · an alert or error message goes through scrub(): every URL, every path, every
//        key=value, every token-shaped run, every e-mail and IP is replaced by a placeholder
//      · `href` is an admin path from a fixed list, never something read from a log
//    And `sourceCap` records which capability reads the source, so a suggestion is only ever
//    SHOWN to somebody who could read the log it came from.

import { hasCap } from './lib.mjs';

/** Sources, and the capability each is read with. Null = public (the status page). */
export const SUGGEST_SOURCES = ['status', 'pending', 'alert', 'error'];
/** A dismissed proposal stays quiet this long, then may come back if the condition is still true. */
export const SNOOZE_MS = 7 * 24 * 3600e3;
/** An open proposal whose condition was not seen for this long is withdrawn. */
export const STALE_MS = 60 * 60e3;
const TITLE_MAX = 160;
const BODY_MAX = 2000;
/** The only places a suggestion may link to. Anything else is dropped, not "fixed". */
const HREF_OK = /^\/(admin\?s=[a-z0-9_-]+(&[a-z]=[a-z0-9_-]+)?|status)$/;

/**
 * Remove everything from a log line that could be a credential or a request URL.
 *
 * Over-redacts on purpose: a task that reads "Cannot GET [path]" loses nothing a human needs
 * to start (the Errors page has the rest, behind its own capability); a task that reads
 * "Cannot GET /r/cm1…?k=9f3…" has handed a private repo's key to the whole team.
 */
export function scrub(text, max = TITLE_MAX) {
  let s = String(text ?? '');
  // Control characters first: they hide things from the reader and from every rule below.
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  s = s.replace(/\b[a-z][a-z0-9+.-]{1,20}:\/\/\S+/gi, '[url]');
  s = s.replace(/\bwww\.\S+/gi, '[url]');
  s = s.replace(/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g, '[token]');
  s = s.replace(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g, '[email]');
  s = s.replace(/\b(bearer|basic|token)\s+\S+/gi, '$1 [redacted]');
  // A secret-named field written `name: value` or JSON `"name":"value"` (pentest R9): a short
  // password or key is neither a key=value below nor token-shaped, and headers, JSON and
  // Prisma's argument dumps all use the colon form.
  s = s.replace(/(["']?)\b([\w-]*(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|auth(?:orization)?|cookie|session|credential)s?)\1\s*:\s*("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi, '$1$2$1: [redacted]');
  // IPv6 (pentest R9): no group of one is long enough to look like a token, and the IPv4 rule
  // below never sees it. A run of 2-8 hex groups with `::` in it, or all 8; a zone (`%eth0`) goes
  // with it. `12:30:45` and `16:9` have neither shape and stay.
  s = s.replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:%[\w.]+)?(?![\w:])/gi, (m) => (m.includes('::') || (m.match(/:/g) || []).length === 7 ? '[ip]' : m));
  // A path: a slash at the start of a word. `1/2` and `and/or` survive; `/r/x?k=y` does not.
  s = s.replace(/(^|[\s("'`=:,[{<])\/[^\s)"'`<>\]}]*/g, '$1[path]');
  s = s.replace(/\?[^\s?]+/g, '?[redacted]');
  s = s.replace(/\b([A-Za-z_][\w.-]{0,40})=("[^"]*"|'[^']*'|[^\s&,;]+)/g, '$1=[redacted]');
  s = s.replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '[ip]');
  // Token-shaped: a long run mixing letters and digits (an id, a key, a hash). A long run of
  // letters alone is a word or a class name and stays: "PrismaClientKnownRequestError".
  s = s.replace(/[A-Za-z0-9_+/-]{16,}={0,2}/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? '[token]' : m));
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** An admin path from the fixed list, or null. */
export const safeHref = (href) => (typeof href === 'string' && HREF_OK.test(href) ? href : null);

/** What each "Needs attention" queue is called in a proposal. Fixed strings, nothing read. */
const QUEUE_TITLES = {
  legalNotices: 'Legal notices are waiting to be read',
  dataRequests: 'Data export or erasure requests are waiting',
  submissions: 'Catalogue submissions are waiting for review',
  feedback: 'New feedback is waiting to be triaged',
  rights: 'Rights notices are waiting for a decision',
  reports: 'Open reports are waiting for a moderator',
  contact: 'Contact messages are waiting for an answer',
  myo: 'Commission requests are waiting for staff',
  contests: 'Contested sanctions are waiting for a decision',
};
/** Queues with a legal clock on them: higher priority. */
const CLOCKED = ['legalNotices', 'dataRequests', 'rights'];
/** Handled per ROW below (alert:, error:), so not also as a whole queue. */
const PER_ROW = ['alerts', 'errors'];

const PENDING_BODY = 'Proposed from the "Needs attention" queue. Open the queue to see the items: '
  + 'they are not copied into this task, because the task can be read by people the queue is not open to.';

/**
 * Everything the site currently knows needs a human, as candidate proposals. Pure.
 *
 * @param outages  [{ id, dep, label?, startedAt }]      open ServiceOutage rows
 * @param queues   [{ key, cap, to, n }]                  PENDING_QUEUES with their counts
 * @param alerts   [{ id, title, sub }]                   the alerts queue's recent rows
 * @param errors   [{ id, title, sub }]                   the errors queue's recent rows
 */
export function candidatesFrom({ outages = [], queues = [], alerts = [], errors = [] } = {}) {
  const out = [];
  for (const o of outages) {
    const label = scrub(o.label || o.dep || 'a service', 60);
    out.push({
      dedupKey: `status:${o.id}`, source: 'status', sourceCap: null,
      title: scrub(`Service down: ${label}`),
      body: `The status page shows ${label} as down since ${new Date(o.startedAt).toISOString()}. Find the cause, and close this task when the service is back.`,
      priority: 'urgent', count: 1, href: '/status',
    });
  }
  for (const q of queues) {
    if (PER_ROW.includes(q.key) || !(Number(q.n) > 0)) continue;
    out.push({
      dedupKey: `pending:${q.key}`, source: 'pending', sourceCap: q.cap || null,
      title: QUEUE_TITLES[q.key] || 'Work is waiting in a staff queue',
      body: PENDING_BODY,
      priority: CLOCKED.includes(q.key) ? 'high' : 'normal', count: Number(q.n), href: safeHref(q.to),
    });
  }
  for (const a of alerts) {
    out.push({
      dedupKey: `alert:${a.id}`, source: 'alert', sourceCap: 'manage_server',
      title: scrub(`Server alert: ${a.title || a.sub || 'unnamed'}`),
      body: `Proposed from a server alert (${scrub(a.sub || 'alert', 40)}). The alert itself, with its figures, is on the Performance tab.`,
      priority: 'high', count: 1, href: '/admin?s=serverperf',
    });
  }
  for (const e of errors) {
    const n = Number(String(e.sub || '').match(/×\s*(\d+)/)?.[1] || 1);
    out.push({
      dedupKey: `error:${e.id}`, source: 'error', sourceCap: 'manage_analytics',
      title: scrub(`Server error: ${e.title || 'unnamed'}`),
      body: 'Proposed from an error group of the last 24 hours. The message above has had every URL, path and token-shaped string removed; the full group, with its stack, is on the Errors page.',
      priority: n >= 10 ? 'high' : 'normal', count: n, href: '/admin?s=errors',
    });
  }
  // Belt and braces: every text field goes through scrub once more, at its own length. A
  // candidate built by a future source that forgot to is still clean.
  return out.map((c) => ({ ...c, title: scrub(c.title, TITLE_MAX), body: scrub(c.body, BODY_MAX), href: safeHref(c.href) }));
}

/**
 * A scan, turned into writes. Pure.
 *
 * @param candidates    from candidatesFrom()
 * @param existing      the TaskSuggestion rows with those dedupKeys, plus every OPEN row
 * @param taskStates    { [taskId]: state } for the accepted rows' tasks (missing = deleted)
 * @param scanned       the sources that were actually read this time — a source whose query
 *                      failed must not have its proposals withdrawn as "cleared"
 * @returns [{ op: 'create'|'refresh'|'reopen'|'touch'|'expire', ... }]
 */
export function planSuggestions(candidates = [], existing = [], taskStates = {}, scanned = SUGGEST_SOURCES, now = Date.now()) {
  const byKey = new Map(existing.map((r) => [r.dedupKey, r]));
  const seen = new Set();
  const ops = [];
  for (const c of candidates) {
    if (seen.has(c.dedupKey)) continue;
    seen.add(c.dedupKey);
    const row = byKey.get(c.dedupKey);
    const fresh = { title: c.title, body: c.body, priority: c.priority, count: c.count, href: c.href, sourceCap: c.sourceCap, lastSeenAt: new Date(now) };
    if (!row) { ops.push({ op: 'create', data: { ...c, lastSeenAt: new Date(now) } }); continue; }
    if (row.state === 'open') { ops.push({ op: 'refresh', id: row.id, data: fresh }); continue; }
    const taskGone = row.state === 'accepted' && (!row.taskId || !(row.taskId in taskStates) || ['done', 'cancelled'].includes(taskStates[row.taskId]));
    const snoozeOver = row.state === 'dismissed' && (!row.decidedAt || now - new Date(row.decidedAt).getTime() > SNOOZE_MS);
    // The work it became is finished (or the snooze ran out) and the condition is STILL true:
    // that is the incident again, and saying so once is the point of the feature.
    if (taskGone || snoozeOver) ops.push({ op: 'reopen', id: row.id, data: { ...fresh, state: 'open', taskId: null, decidedById: null, decidedAt: null } });
    else ops.push({ op: 'touch', id: row.id, data: { count: c.count, lastSeenAt: new Date(now) } });
  }
  // An undecided proposal for a condition that has cleared is withdrawn. Only open rows (a
  // decision is history) and only for sources we actually read.
  for (const r of existing) {
    if (r.state !== 'open' || seen.has(r.dedupKey) || !scanned.includes(r.source)) continue;
    if (now - new Date(r.lastSeenAt).getTime() < STALE_MS) continue;
    ops.push({ op: 'expire', id: r.id });
  }
  return ops;
}

/** May this viewer see (and so act on) this proposal? Only if they could read its source. */
export const canSeeSuggestion = (user, s) => !!user && !!s && (!s.sourceCap || hasCap(user, s.sourceCap));

/** A proposal, as the board reads it. An allowlist. */
export const serSuggestion = (s) => ({
  id: s.id, source: s.source, title: s.title, body: s.body, priority: s.priority, href: safeHref(s.href),
  count: s.count, state: s.state, taskId: s.taskId || null, firstSeenAt: s.firstSeenAt, lastSeenAt: s.lastSeenAt,
});
