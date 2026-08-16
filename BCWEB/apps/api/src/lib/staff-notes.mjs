// Staff notes about an account, and the record of why one was acted on.
//
// One module because four different buttons — suspend, ban, close, erase — all have to record
// the same thing the same way. Written twice they diverge, and the one that diverges is always
// the one you read six months later, next to an account that no longer exists.
//
// A note deliberately carries no foreign key to its subject: the note explaining why somebody
// was removed is the note you need AFTER they are gone. It keeps their name and address as they
// were, so a closed account still reads as a person rather than as a cuid.

import { sendMail, mailShell, escapeHtml, emailEnabled } from './mail.mjs';

export const NOTE_KINDS = ['note', 'closure', 'ban', 'suspension', 'erasure'];

/** What an action is called in the note list and in the e-mail's subject. */
const ACTION_TITLE = {
    closure: 'Your account has been closed',
    ban: 'Your account has been banned',
    suspension: 'Your account has been suspended',
    erasure: 'Your account and its data have been removed',
};

/**
 * Write a note.
 *
 * @param p            prisma
 * @param subject      { id, displayName?, email? } — the account it is about
 * @param author       { uid, displayName?, email? } — whoever is writing, or null for the system
 * @param body         the text
 * @param kind         one of NOTE_KINDS
 * @param notified     was the person told, and where
 */
export async function addStaffNote(p, { subject, author, body, kind = 'note', notified = false, notifiedTo = null, pinned = false }) {
    const text = String(body ?? '').trim();
    if (!text) return null;
    // `req.user` is the session payload — a uid and a role, nothing else. Assuming it carried a
    // name wrote every note with a blank author, which is worse than no author field at all: it
    // looks like the note was left by nobody. Resolved here rather than at each call site so a
    // fifth button cannot get it wrong.
    let who = author;
    if (author?.uid && !author.displayName && !author.email) {
        who = await p.user.findUnique({ where: { id: author.uid }, select: { displayName: true, email: true } })
            .then((u) => ({ uid: author.uid, ...(u || {}) }))
            .catch(() => author);
    }
    author = who;
    return p.staffNote.create({
        data: {
            subjectId: subject.id,
            // Recorded at write time, because by read time it may be `closed+<id>@account.invalid`.
            subjectLabel: [subject.displayName, subject.email].filter(Boolean).join(' · ').slice(0, 200),
            kind: NOTE_KINDS.includes(kind) ? kind : 'note',
            body: text.slice(0, 4000),
            notified: !!notified,
            notifiedTo: notifiedTo || null,
            authorId: author?.uid || null,
            authorLabel: [author?.displayName, author?.email].filter(Boolean).join(' · ').slice(0, 200),
            pinned: !!pinned,
        },
    });
}

/**
 * Tell somebody why, in a mail that is only the decision.
 *
 * No marketing shell, no "we value you", and the reason quoted as the staff wrote it — a person
 * reading this is going to ask "what did I do", and anything between them and the answer reads
 * as evasion. Returns false when mail is off or there is nowhere to send it, so the caller can
 * record honestly whether the person was actually told.
 */
export async function notifyAccountAction({ to, kind, reason, appealTo = null }) {
    if (!emailEnabled() || !to || /@account\.invalid$/i.test(to)) return false;
    const title = ACTION_TITLE[kind] || 'A decision about your account';
    const body = [
        `<p>${escapeHtml(title)}.</p>`,
        '<p><b>Reason given:</b></p>',
        `<blockquote style="margin:0;padding:10px 14px;border-left:3px solid #d1d5db;color:#374151">${escapeHtml(reason)}</blockquote>`,
        kind === 'erasure'
            ? '<p>Your account and the data attached to it have been removed. Some records we are required to keep — payments and moderation decisions — remain, without your name on them.</p>'
            : '<p>If you think this is wrong, you can reply to this message.</p>',
        appealTo ? `<p>Write to <a href="mailto:${escapeHtml(appealTo)}">${escapeHtml(appealTo)}</a>.</p>` : '',
    ].join('\n');
    try {
        await sendMail({
            to,
            subject: title,
            html: mailShell(title, body),
            text: `${title}\n\nReason given:\n${reason}\n`,
        });
        return true;
    } catch {
        // A mail that did not go out must not stop the action, and must not be recorded as
        // though it did — the caller writes `notified` from what this returns.
        return false;
    }
}

/** Every note about an account, newest first, pinned ones on top. */
export async function notesFor(p, subjectId, take = 100) {
    return p.staffNote.findMany({
        where: { subjectId },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take,
    });
}
