// Turning a list of outages into the thing a status page shows.
//
// Pure, and separate from the route, because this is where it goes wrong: an outage that is
// still open has no end, one can span midnight, one can start before the window and run into
// it, and each of those quietly produces a wrong percentage if it is not handled. The fetching
// is trivial; this is not.

/** A day, as the status page keys them: midnight UTC. */
export const dayKey = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Downtime per day for one service.
 *
 * @param outages [{ startedAt, endedAt }] — endedAt null means STILL DOWN
 * @param days    how many days back, ending today
 * @param now     clamp for an open outage; passed in so this stays testable
 * @returns [{ day, downMs, uptimePct }] oldest first, one entry per day with no gaps
 */
export function dailyUptime(outages, days, now = new Date()) {
    const today = dayKey(now);
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const day = new Date(today.getTime() - i * 864e5);
        const dayEnd = new Date(day.getTime() + 864e5);
        // Today is only as long as it has been so far. Measuring a partial day against 24h
        // would show every current day as worse than it is, every day, for ever.
        const windowEnd = dayEnd > now ? now : dayEnd;
        const windowMs = Math.max(0, windowEnd - day);

        let downMs = 0;
        for (const o of outages) {
            const from = new Date(o.startedAt);
            // An open outage runs to "now", not to the end of time.
            const to = o.endedAt ? new Date(o.endedAt) : now;
            // Clip to this day — an outage spanning midnight belongs partly to each side, and
            // counting it whole against both is how a status page reports 40 hours of downtime
            // in a 24-hour day.
            const start = from > day ? from : day;
            const end = to < windowEnd ? to : windowEnd;
            if (end > start) downMs += end - start;
        }
        // Overlapping outages on the same service would double-count; clamped rather than
        // trusted, because two probes disagreeing is a real thing that happens.
        downMs = Math.min(downMs, windowMs);
        out.push({
            day,
            downMs,
            // A day with no window yet (a future day, or the very first millisecond of today)
            // is not 0% uptime — it is unknown, and 100 is the honest default for "nothing has
            // gone wrong yet" while null would break every chart that averages these.
            uptimePct: windowMs > 0 ? 100 * (1 - downMs / windowMs) : 100,
        });
    }
    return out;
}

/** One number for the whole window, weighted by how long each day actually was. */
export function overallUptime(daily) {
    const totalMs = daily.length * 864e5;
    const downMs = daily.reduce((a, d) => a + d.downMs, 0);
    return totalMs > 0 ? Math.max(0, 100 * (1 - downMs / totalMs)) : 100;
}

/**
 * What to call the current state of a service.
 *
 * `null` from a probe means "not applicable" — an integration with no key configured — and is
 * deliberately NOT "down". Showing Stripe as broken on a public page because nobody set a key
 * would be a false alarm with an audience.
 */
export function serviceState(probeResult, openOutage) {
    if (probeResult === null || probeResult === undefined) return 'not_configured';
    if (openOutage) return 'down';
    return probeResult ? 'operational' : 'down';
}

/** Overall banner: the worst thing that is true, ignoring what is not configured. */
export function overallState(states) {
    const real = states.filter((s) => s !== 'not_configured');
    if (!real.length) return 'unknown';
    if (real.every((s) => s === 'operational')) return 'operational';
    if (real.every((s) => s === 'down')) return 'major';
    return 'partial';
}
