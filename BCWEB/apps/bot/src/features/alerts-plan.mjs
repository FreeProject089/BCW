// The pure half of the server-perf alerts poster (features/alerts.mjs): how fresh alerts are
// grouped into messages, and what each message says. No discord.js, so it is tested as data.
//
// Why this exists — the spam, as it was (see also the API's lib/alert-incident.mjs):
//   · the API wrote a new alert row every monitor tick while a condition stayed true, because
//     its text carried the live number ("CPU at 93%");
//   · this poster sent every row as a NEW message and never edited or closed one.
// Now: one API row per incident, and here one Discord message per incident, EDITED as the row
// changes, closed with a short "resolved" reply, and linked to the admin page for it. Events
// (keyless rows: "a new kind of error appeared") of one kind that arrive together share one
// message instead of one each.

export const MAX_NEW_MESSAGES_PER_POLL = 5;
export const MAX_EVENTS_PER_MESSAGE = 10;

const COLOR = { critical: 0xef4444, warning: 0xf59e0b, info: 0x3b82f6, resolved: 0x16a34a };
const PERF_KINDS = new Set(['cpu', 'mem', 'disk', 'web_vitals', 'storage']);
export const isPerf = (kind) => PERF_KINDS.has(kind);

const ts = (d) => Math.floor(new Date(d).getTime() / 1000);

/** "45 s", "12 min", "3 h 5 min", "2 d 4 h" — the length of an incident, in the units people use. */
export function durationLabel(ms) {
  const s = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

/**
 * Fresh rows → messages to send. A keyed row (a condition) is its own message, because it will
 * be edited on its own. Keyless rows (events) of one kind share a message, up to
 * MAX_EVENTS_PER_MESSAGE each. Oldest first; the caller sends at most
 * MAX_NEW_MESSAGES_PER_POLL and leaves the rest for the next poll.
 */
export function groupFresh(fresh) {
  const groups = [];
  const byKind = new Map();
  for (const a of [...(fresh || [])].sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt))) {
    if (a.key) { groups.push({ incident: true, kind: a.kind, alerts: [a] }); continue; }
    let g = byKind.get(a.kind);
    if (!g || g.alerts.length >= MAX_EVENTS_PER_MESSAGE) { g = { incident: false, kind: a.kind, alerts: [] }; byKind.set(a.kind, g); groups.push(g); }
    g.alerts.push(a);
  }
  return groups;
}

const kindLabel = (t, kind) => { const k = `al.kind.${kind}`; const v = t(k); return v === k ? kind : v; };

/** What one incident's message says right now. `t` is the bot's translator. */
export function incidentSpec(t, a) {
  const resolved = !!a.resolvedAt;
  const sev = a.severity || 'warning';
  return {
    title: `${t(`al.sev.${sev}`)} · ${kindLabel(t, a.kind)}`,
    color: resolved ? COLOR.resolved : (COLOR[sev] || COLOR.warning),
    body: [
      resolved ? `~~${a.message}~~` : a.message,
      resolved
        ? t('al.resolved', { dur: durationLabel(new Date(a.resolvedAt) - new Date(a.createdAt)) })
        : t('al.ongoing', { since: `<t:${ts(a.createdAt)}:R>` }),
    ],
    footer: `<t:${ts(a.createdAt)}:f>${resolved ? ` → <t:${ts(a.resolvedAt)}:f>` : ''}`,
    url: a.url || null,
    icon: resolved ? 'done' : 'warn',
    resolved,
  };
}

/** One message for a burst of events of one kind. */
export function eventsSpec(t, group) {
  const first = group.alerts[0];
  const sev = group.alerts.some((a) => a.severity === 'critical') ? 'critical' : group.alerts.some((a) => a.severity === 'warning') ? 'warning' : 'info';
  return {
    title: `${kindLabel(t, group.kind)} · ${t('al.events', { n: group.alerts.length, since: `<t:${ts(first.createdAt)}:t>` })}`,
    color: COLOR[sev],
    body: group.alerts.map((a) => `- <t:${ts(a.createdAt)}:t> ${String(a.message).slice(0, 180)}`),
    footer: null,
    // The events have no page each worth opening; the list they sit in is the useful link.
    url: first.url ? first.url.replace(/&alert=[^&]*$/, '') : null,
    icon: 'warn',
    resolved: false,
  };
}

/** The short reply posted once when an incident clears. */
export function resolvedNotice(t, a) {
  return t('al.resolvedNotice', {
    title: `${kindLabel(t, a.kind)} — ${String(a.message).slice(0, 160)}`,
    dur: durationLabel(new Date(a.resolvedAt) - new Date(a.createdAt)),
  });
}
