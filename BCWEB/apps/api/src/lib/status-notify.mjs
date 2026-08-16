// Telling the people who asked to be told.
//
// The status page collects subscribers; without this it collected them and never wrote. A
// subscribe box that sends nothing is worse than no subscribe box: somebody relies on it.
//
// Sent at the two moments that matter and no others — when a service goes down, and when it
// comes back. Not on every probe, not on a threshold wobble. A status alert that fires often
// stops being read, and then the one that mattered is not read either.

import { sendMail, mailShell, escapeHtml, emailEnabled } from './mail.mjs';
import { DEP_LABELS } from './monitor.mjs';

const SITE = (process.env.SITE_URL || 'http://localhost').replace(/\/+$/, '');

/**
 * Who should hear about this service.
 *
 * Separate and exported because it is the part that can be WRONG — and it cannot be tested
 * through notifyStatusChange, which returns 0 the moment mail is switched off and so reports
 * "correctly skipped" and "broken query" identically. That ambiguity cost a debugging round.
 *
 * An empty `deps` means "everything", which is the common case and must keep working when a
 * new service is added rather than silently excluding it.
 */
export async function subscribersFor(p, dep) {
    return p.statusSubscriber.findMany({
        where: { kind: 'email', confirmed: true, OR: [{ deps: { isEmpty: true } }, { deps: { has: dep } }] },
    }).catch(() => []);
}

/**
 * @param p      prisma
 * @param dep    which service
 * @param kind   'down' | 'up'
 * @param since  when it broke (for a recovery, so the message can say how long)
 */
export async function notifyStatusChange(p, dep, kind, since = null) {
    if (!emailEnabled()) return 0;
    const label = DEP_LABELS[dep] || dep;

    const subs = await subscribersFor(p, dep);
    if (!subs.length) return 0;

    const minutes = since ? Math.round((Date.now() - new Date(since).getTime()) / 60000) : null;
    const subject = kind === 'down' ? `${label} is down` : `${label} is back`;
    const line = kind === 'down'
        ? `<p><b>${escapeHtml(label)}</b> stopped responding. We are on it.</p>`
        : `<p><b>${escapeHtml(label)}</b> is working again${minutes != null ? ` — it was down for about ${minutes} minute(s)` : ''}.</p>`;

    let sent = 0;
    for (const s of subs) {
        // Per subscriber, because the unsubscribe link is per subscriber. One failure must not
        // stop the rest: a bounced address is not a reason to leave everybody else uninformed.
        const stop = `${SITE}/api/status/unsubscribe/${s.token}`;
        try {
            await sendMail({
                to: s.target,
                subject,
                html: mailShell(subject, `${line}
          <p><a href="${escapeHtml(`${SITE}/status`)}">See the status page</a></p>
          <p style="font-size:12px;color:#6b7280">You asked to be told about this.
             <a href="${escapeHtml(stop)}">Stop these messages</a>.</p>`),
                text: `${subject}\n\n${SITE}/status\n\nStop these messages: ${stop}\n`,
            });
            sent += 1;
        } catch { /* one bad address must not silence the rest */ }
    }
    // Recorded so a look at the table answers "did anything actually go out", which is the
    // question after every incident.
    await p.statusSubscriber.updateMany({ where: { id: { in: subs.map((s) => s.id) } }, data: { lastSentAt: new Date() } }).catch(() => {});
    return sent;
}
