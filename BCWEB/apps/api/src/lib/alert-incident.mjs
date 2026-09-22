// One alert per INCIDENT, not one per sighting.
//
// Why the Discord alerts channel was a wall of messages (measured against monitor.mjs, Sept 2026):
//
//   1. maybeAlert() debounced on kind + MESSAGE, and the messages carry the live number —
//      "CPU usage at 91% (>90%)", then "at 93%", then "at 92%". Every tick (10 min) wrote a new
//      ServerAlertLog row because the text differed, and the debounce never matched anything.
//      Same for "12 new server error(s) in the last 10 minutes", capacity figures, vitals shares.
//   2. Even with identical text, the debounce was 30 min on a 10-min tick: a condition that
//      stayed true for a day was re-raised 48 times.
//   3. The bot posted every unannounced row as a NEW message, never edited one, and said
//      nothing at all when the condition cleared — so the channel only ever grew, and the
//      last message about a fixed problem still read as an emergency.
//   4. Every row also sent an in-app notification to every SUPERADMIN.
//
// The rule now: a condition (`key`) has at most ONE open row. While it stays true the row is
// UPDATED (latest text, severity only ever raised), not duplicated; when it clears
// resolveClearedAlerts() stamps resolvedAt; if it comes back within REOPEN_WINDOW_MS the same
// row is re-opened (a flapping disk is one incident, not twelve). Keyless alerts are EVENTS
// ("a new kind of error appeared") and keep the old exact-message debounce.
//
// The Discord side edits one message per incident from these rows — see the bot's
// features/alerts-plan.mjs, and alertFingerprint() below, which is what "changed" means.

export const EVENT_DEBOUNCE_MS = 30 * 60_000;
export const REOPEN_WINDOW_MS = 30 * 60_000;
const RANK = { info: 0, warning: 1, critical: 2 };
const worse = (a, b) => ((RANK[b] ?? 1) > (RANK[a] ?? 1) ? b : a);

/**
 * What to do with one alert the monitor raised. Pure.
 *
 * @param alert  { kind, message, key, severity }
 * @param found  { open, lastResolved, lastSame } — the open row for this key, the most recent
 *               resolved row for this key, the most recent row with this kind+message (events)
 * @returns { op: 'create' } | { op: 'update'|'reopen', id, data, escalated } | { op: 'skip' }
 *          `fired` is true when people should be TOLD (a new incident, or one that got worse).
 */
export function planAlert(alert, found = {}, now = Date.now()) {
    const { key, message } = alert;
    const severity = alert.severity || 'warning';
    if (key) {
        const { open, lastResolved } = found;
        if (open) {
            const sev = worse(open.severity || 'warning', severity);
            const escalated = sev !== (open.severity || 'warning');
            if (open.message === message && !escalated) return { op: 'skip', fired: false };
            return { op: 'update', id: open.id, data: { message, severity: sev }, escalated, fired: escalated };
        }
        if (lastResolved?.resolvedAt && now - new Date(lastResolved.resolvedAt).getTime() < REOPEN_WINDOW_MS) {
            // A flap. Same incident, same Discord message; not a new page for anybody.
            return { op: 'reopen', id: lastResolved.id, data: { message, severity: worse(lastResolved.severity || 'warning', severity), resolvedAt: null }, escalated: false, fired: false };
        }
        return { op: 'create', fired: true };
    }
    const { lastSame } = found;
    if (lastSame && now - new Date(lastSame.createdAt).getTime() < EVENT_DEBOUNCE_MS) return { op: 'skip', fired: false };
    return { op: 'create', fired: true };
}

/**
 * What a posted alert looked like, as one short string: the bot edits its message when this
 * changes. Only what a reader SEES — the text, how bad, whether it is over.
 */
export function alertFingerprint(a) {
    const s = JSON.stringify([a.message || '', a.severity || '', a.resolvedAt ? new Date(a.resolvedAt).toISOString() : '']);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

/**
 * The posted alerts whose row has changed since the bot last drew it. `posts` is the
 * `bot.alertPosts` map { [alertId]: { channelId, messageId, fp } }, `rows` the current rows.
 * A row that no longer exists (the log was cleared) is not an update — nothing to edit to.
 */
export function pendingAlertUpdates(rows, posts) {
    const out = [];
    for (const r of rows || []) {
        const p = posts?.[r.id];
        if (!p || !p.messageId) continue;
        if (p.fp !== alertFingerprint(r)) out.push({ ...r, post: { channelId: p.channelId, messageId: p.messageId, resolvedNotice: !!p.resolvedNotice } });
    }
    return out;
}

/**
 * Keep the post map bounded: drop what is resolved and settled for a week, then the oldest.
 * A resolved incident is kept a while so a re-open within the window still edits ITS message.
 */
export function prunePosts(posts, rowsById, now = Date.now(), { keepDays = 7, max = 300 } = {}) {
    const entries = Object.entries(posts || {}).filter(([id, p]) => {
        const row = rowsById?.[id];
        if (!row) return now - (p.at || 0) < keepDays * 864e5; // row gone: keep briefly, then forget
        if (!row.resolvedAt) return true;
        return now - new Date(row.resolvedAt).getTime() < keepDays * 864e5;
    });
    entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    return Object.fromEntries(entries.slice(0, max));
}
