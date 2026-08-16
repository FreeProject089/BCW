// Telling Discord that something is waiting.
//
// Three queues need a human — a data request with a legal clock on it, a submission awaiting
// review, an open report — and the only place that said so was a badge in an admin dashboard
// nobody has open at 9pm. The announcement queue the bot already drains is the obvious way to
// say it out loud, and it already carries commissions and incidents.
//
// The whole design here is about NOT becoming noise, because a channel people mute is worse
// than no channel:
//
//   · a DIGEST, not one message per item. Five submissions arriving together are one line.
//   · only when the work GREW. Re-announcing "3 waiting" every ten minutes teaches everybody
//     to ignore it; a number that has not moved is not news.
//   · a floor between messages, so a burst does not produce a burst.
//   · nothing at all when every queue is empty. Silence is the good state and should look
//     like it.
//
// The watermark lives in AdminSetting rather than in memory: the sweeper runs in whichever
// replica wins the lock, and an in-process counter would let each replica announce the same
// work once.

const KEY = 'attention.lastAnnounced';

/** No more than one attention digest in this window, however fast the queues move. */
export const QUIET_MS = 60 * 60 * 1000;

/**
 * Should we say something, and what?
 *
 * Pure, so the decision is testable without a database or a clock: the caller supplies the
 * counts, what was last announced, and now.
 */
export function attentionDigest(counts, last, now = Date.now()) {
    const total = Object.values(counts).reduce((a, n) => a + (Number(n) || 0), 0);
    if (!total) return null;                                    // nothing waiting → nothing to say

    const prev = last?.counts || {};
    // GREW, per queue. A queue that shrank while another grew still counts as news, which is
    // why this is per-key rather than on the total: three reports closed and three submissions
    // arriving is a total that never moved and a channel that should have heard about it.
    const grew = Object.keys(counts).some((k) => (Number(counts[k]) || 0) > (Number(prev[k]) || 0));
    if (!grew) return null;

    if (last?.at && now - new Date(last.at).getTime() < QUIET_MS) return null;

    const parts = Object.entries(counts)
        .filter(([, n]) => Number(n) > 0)
        // The plural is part of the label, not an `s` glued to the end of the phrase: appending
        // one to "submission awaiting review" produces "submission awaiting reviews".
        .map(([k, n]) => `${n} ${words(k, Number(n))}`);
    return {
        total,
        title: total === 1 ? 'One thing is waiting' : `${total} things are waiting`,
        body: parts.join(' · '),
        // Urgent means a clock is running: a data request has a legal deadline, a contested
        // sanction is somebody locked out while they wait, and a server alert is the site
        // itself. Marking everything urgent is the same as marking nothing.
        urgent: ['dataRequests', 'contests', 'alerts'].some((k) => (Number(counts[k]) || 0) > 0),
    };
}

// Every queue the badge counts, in the words a person would use. Read off the definitions
// rather than guessed: my first version named three keys, and the list has seven — a digest
// that says "4 contests" because it did not recognise the key is a digest nobody trusts twice.
const LABEL = {
    dataRequests: ['data request', 'data requests'],
    submissions: ['submission awaiting review', 'submissions awaiting review'],
    reports: ['open report', 'open reports'],
    contact: ['unread message', 'unread messages'],
    myo: ['commission waiting', 'commissions waiting'],
    contests: ['contested sanction', 'contested sanctions'],
    alerts: ['server alert', 'server alerts'],
};

/** A queue nobody has labelled still reads as English, not as an identifier. */
const words = (key, n) => LABEL[key]?.[n > 1 ? 1 : 0]
    || `${String(key).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} item${n > 1 ? 's' : ''}`;

/**
 * Read the queues, decide, and enqueue an announcement the bot will post.
 *
 * `queues` is passed in rather than imported: the definitions live beside the admin endpoint
 * that renders them, and a second copy here would drift from the badge staff actually trust.
 */
export async function sweepAttention(p, queues, log) {
    const counts = {};
    for (const q of queues) {
        // One unreadable queue must not silence the others, and must not read as zero either —
        // it is simply left out of the digest.
        try { counts[q.key] = await q.count(p); } catch { /* skip this queue this round */ }
    }
    const row = await p.adminSetting.findUnique({ where: { key: KEY } }).catch(() => null);
    const digest = attentionDigest(counts, row?.value || null);
    if (!digest) return 0;

    const site = (process.env.SITE_URL || '').replace(/\/+$/, '');
    await p.botAnnouncement.create({
        data: {
            kind: 'custom', urgent: digest.urgent,
            title: digest.title, body: digest.body,
            url: site ? `${site}/admin` : null,
        },
    });
    const value = { at: new Date().toISOString(), counts };
    await p.adminSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
    log?.info?.(`[attention] announced ${digest.total} waiting item(s)`);
    return digest.total;
}
