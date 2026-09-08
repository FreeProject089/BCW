// Every mail this platform can send, as something you can look at.
//
// There was no way to SEE a mail without causing one. Checking that the newsletter still looked
// right meant sending yourself a newsletter; checking the closure warning meant scheduling an
// account for closure. So nobody checked, and a broken mail was found by the person who
// received it — which for a password reset or a data export is the worst possible reviewer.
//
// Every sample below is built with the SAME `mailShell` the real sender uses, from the same
// wording, so what the preview shows is what goes out. Nothing here sends anything: these
// functions return HTML and that is all they do.
//
// The values are obviously fake on purpose — `you@example.com`, `Jane`, a link to `#` — because
// a preview containing a real-looking token invites somebody to click it, and a screenshot of
// this page should never be a leak.

import { mailShell, withMailId } from './mail.mjs';

const SITE = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
const link = (path) => `${SITE}${path}`;

/**
 * The catalogue. Each entry knows its own group so the screen can lay them out the way a
 * reader thinks about them — "things that happen to my account", "things about money" — rather
 * than in the order the code happened to define them.
 *
 * `editable: true` means this mail's SENDER passes its id, so an admin's wording actually
 * reaches the message. Anything without it is preview-only, and the screen says so.
 *
 * The flag is not decoration and it is not a promise: mail-templates.test.mjs greps the
 * senders and fails if a sample claims to be editable without a sender carrying its id, or
 * if a sender carries an id no sample declares. An editor that offers to change a mail it
 * cannot change is the exact failure this whole feature exists to avoid — you would edit the
 * text, the preview would show your version, and the real mail would go out unchanged.
 */
export const MAIL_SAMPLES = [
    {
        id: 'verify', editable: true, group: 'account', label: 'Confirm your email',
        note: 'Sent on sign-up, and again from the account screen if it was never confirmed.',
        build: (o) => mailShell('Confirm your email',
            'Welcome to BetterCommunity. Confirm this address and your account is ready.',
            { url: link('/auth/verify?token=EXAMPLE'), label: 'Confirm my email' }, o),
    },
    {
        id: 'reset', editable: true, group: 'account', label: 'Reset your password',
        note: 'Only ever sent to an address that asked. The link expires.',
        build: (o) => mailShell('Reset your password',
            'Somebody asked to reset the password for this account. If that was not you, nothing has changed and you can ignore this.',
            { url: link('/auth/reset?token=EXAMPLE'), label: 'Choose a new password' }, o),
    },
    {
        id: 'password-changed', editable: true, group: 'account', label: 'Your password was changed',
        note: 'The one mail nobody asks for and everybody needs — it is how a stolen account is noticed.',
        build: (o) => mailShell('Your password was changed',
            'The password on your account was changed just now. If that was you, there is nothing to do. If it was not, reset it immediately and check your signed-in devices.',
            { url: link('/auth/forgot'), label: 'Reset it now' }, o),
    },
    {
        id: 'twofa-reset', editable: true, group: 'account', label: 'Two-factor authentication reset',
        build: (o) => mailShell('Two-factor authentication reset',
            'Two-factor authentication was turned off for your account. If you did not do this, your account may be compromised.',
            { url: link('/settings'), label: 'Open my settings' }, o),
    },
    {
        id: 'closure', editable: true, group: 'account', label: 'Your account is scheduled to close',
        note: 'Carries the date and the way back. The link works while the closure is pending, signed in or not.',
        build: () => mailShell('Your account is scheduled to close',
            'Your account will close on <b>1 September 2026</b>. Nothing has been deleted yet. If you change your mind, one click stops it.',
            { url: link('/account/closure/cancel?token=EXAMPLE'), label: 'Keep my account' }),
    },
    {
        id: 'reactivated', editable: true, group: 'account', label: 'Account reactivated',
        build: (o) => mailShell('Account reactivated',
            'Your account is active again and everything you had is back where it was.',
            { url: link('/'), label: 'Open BetterCommunity' }, o),
    },
    {
        id: 'data-export', editable: true, group: 'account', label: 'Your data',
        note: 'A GDPR export. The archive rides as an attachment, which is why this mail must never look improvised.',
        build: (o) => mailShell('Your data',
            'Everything BetterCommunity holds about your account is attached as a single file. It contains personal data — keep it somewhere you would keep a bank statement.', undefined, o),
    },
    {
        id: 'newsletter', editable: true, group: 'content', label: 'Newsletter',
        note: 'Also what a blog post announcement looks like. Every one carries its own unsubscribe link.',
        build: () => mailShell('What shipped this month',
            '<p style="margin:0 0 14px">A short paragraph of news, written in the composer.</p>'
            + '<ul style="margin:0 0 14px;padding-left:20px"><li>Something that shipped</li><li>Something else</li></ul>',
            { url: link('/blog/example'), label: 'Read the post' },
            { preheader: 'The short line a mail client shows beside the subject.' }),
    },
    {
        id: 'status', editable: true, group: 'ops', label: 'Confirm your status alerts',
        note: 'Double opt-in: nothing is sent to an address until it confirms.',
        build: () => mailShell('Confirm your status alerts',
            'Confirm this address and you will be told when a service goes down, and when it comes back. Nothing else.',
            { url: link('/status/confirm/EXAMPLE'), label: 'Confirm' }),
    },
    {
        id: 'status-down', editable: true, group: 'ops', label: 'A service is down',
        note: 'What a subscriber actually receives. The "it is back" mail is the same shell with the other wording.',
        build: () => mailShell('Object storage is down',
            'We noticed at <b>14:32 UTC</b>. Uploads and downloads will fail until it is back. You will get one more mail when it is.',
            { url: link('/status'), label: 'See the status page' }),
    },
    {
        id: 'sanction', editable: true, group: 'moderation', label: 'A moderation decision',
        note: 'Quotes the reason and the reference. The reference is what an appeal is filed against.',
        build: () => mailShell('Your content was taken down',
            '<p style="margin:0 0 14px">Reference <b>BC-1234-5678</b>.</p>'
            + '<p style="margin:0 0 14px">Reason given: <i>the example reason a moderator typed</i>.</p>'
            + '<p style="margin:0 0 14px">If you think this is wrong, you can contest it — a person reads every contest.</p>',
            { url: link('/sanction/BC-1234-5678'), label: 'Read it or contest it' }),
    },
    {
        id: 'report-archived', editable: true, group: 'moderation', label: 'Your report was archived',
        build: () => mailShell('Your report was archived',
            'Thank you — a moderator looked at what you reported and has closed it.'),
    },
    {
        // NOT SENT BY E-MAIL. sweepExpiryWarnings raises an in-app notification and stops
        // there — so this page, titled "every mail we send", has been showing a message
        // nobody has ever received in their inbox. Left here rather than deleted because the
        // warning is real and the wording is what an e-mail would say; flagged so the screen
        // says which it is. Whether hosting expiry SHOULD also go out by mail is a product
        // decision about writing to paying customers, and not one to make in passing.
        id: 'hosting-expiry', notifyOnly: true, group: 'billing', label: 'Your hosting term is ending',
        note: 'Raised in the notification centre, not sent as an e-mail — a renewal reminder nobody gets in their inbox.',
        build: () => mailShell('Your hosting ends in 7 days',
            'Your storage pool <b>"my-pool"</b> is paid until <b>1 September 2026</b>. After that its repos are suspended for 72 hours, then hidden. Renewing at any point puts everything back.',
            { url: link('/hosting'), label: 'Renew it' }),
    },
    {
        id: 'hosting-waitlist', editable: true, group: 'billing', label: 'There is room for you now',
        note: 'Sent once, to somebody who asked to be told when the disk had space for the size they wanted. It reserves nothing, and says so — the sweeper that sends it does not hold a slot either.',
        build: (o) => mailShell('There is room for your 25 GB on BetterCommunity',
            '<p>The space you asked about is free again: 25 GB.</p>'
            + '<p>Nothing is reserved for you — whoever checks out first gets it, so it is worth going now.</p>',
            { url: link('/hosting'), label: 'Go to hosting' }, o),
    },
    {
        id: 'legal-changed', editable: true, group: 'account', label: 'A policy changed',
        note: 'Sent when a legal document is published with "notify everyone" ticked. The '
            + 'link goes to the new version; the archived previous one stays readable.',
        build: () => mailShell('The Terms of Service have changed',
            'We published a new version of the Terms of Service on 1 January 2026.\n\n'
            + 'What changed: we added a section on reporting illegal content.\n\n'
            + 'The previous version stays available, so you can read exactly what you agreed to before.',
            { url: link('/legal/terms'), label: 'Read the new version' }),
    },
    {
        id: 'legal-reaccept', editable: true, group: 'account', label: 'A policy needs your agreement',
        note: 'Only for a change marked as requiring acceptance. The site also asks on the '
            + 'next visit — the mail exists so somebody who does not visit still hears about it.',
        build: () => mailShell('Please review the updated Privacy Policy',
            'We published a new version of the Privacy Policy on 1 January 2026, and this one '
            + 'needs your agreement before you continue using your account.\n\n'
            + 'What changed: we now name every processor that receives data.\n\n'
            + 'Nothing happens to your account in the meantime, and you can read the version you '
            + 'previously accepted at any time.',
            { url: link('/legal/privacy'), label: 'Review and accept' }),
    },

    // ── Added after an audit that counted the senders. The gallery had 20 entries and the code
    // had 25 places that send; these eight are the difference. Every one of them is a mail a
    // real person receives and that nobody here had ever looked at, which is exactly the state
    // this file was created to end — the count is the point, not the intention.
    {
        id: 'newsletter-confirm', editable: true, group: 'content', label: 'Confirm your newsletter subscription',
        note: 'Double opt-in. Distinct from the status-page confirmation, which is a different list with a different link.',
        build: () => mailShell('Confirm your subscription',
            "You asked to receive BetterCommunity blog updates. Confirm below — if this wasn't you, ignore this email and you'll receive nothing.",
            { url: link('/api/newsletter/confirm?token=EXAMPLE'), label: 'Confirm' }),
    },
    {
        id: 'transfer-offer', editable: true, group: 'content', label: 'Somebody wants to transfer something to you',
        note: 'Ownership handover of a repo or a catalog. The offer expires; accepting is what moves it.',
        build: () => mailShell('Jane wants to transfer "Better Textures" to you',
            '<p><b>Jane</b> would like to hand <b>Better Textures</b> over to you. If you accept, it moves to your dashboard and leaves theirs.</p>'
            + '<p>If you were not expecting this, ignore it — nothing happens unless you accept.</p>',
            { url: link('/dashboard?transfer=EXAMPLE'), label: 'Review the transfer' }),
    },
    {
        id: 'transfer-accepted', editable: true, group: 'content', label: 'A transfer you offered was accepted',
        note: 'Goes to the person who GAVE it away, so the disappearance from their dashboard is explained rather than discovered.',
        build: () => mailShell('"Better Textures" has been transferred',
            '<p><b>Jane</b> accepted the transfer of <b>Better Textures</b>. It now belongs to them and no longer appears in your dashboard.</p>'),
    },
    {
        id: 'transfer-declined', editable: true, group: 'content', label: 'A transfer you offered was declined',
        note: 'The other half of transfer-accepted. Carries the reason when one was given \u2014 a bare "no" is what makes people ask twice.',
        build: () => mailShell('Your transfer of "Better Textures" was declined',
            '<p><b>Jane</b> declined the transfer of <b>Better Textures</b>. Nothing moved \u2014 it is still yours, and still in your dashboard.</p>'
            + '<p style="padding:10px 14px;border-left:3px solid #f97316;color:#6f685d">I do not have the storage for it right now, sorry.</p>'
            + '<p>You can offer it to somebody else whenever you like.</p>',
            { url: link('/dashboard#transfers'), label: 'Open your dashboard' }),
    },
    {
        id: 'report-new', editable: true, group: 'moderation', label: 'New report opened (to staff)',
        note: 'The only mail in this group addressed to the team rather than to a member.',
        build: () => mailShell('New report opened',
            '<p>A user opened a report on catalog item "Better Textures".</p>',
            { url: link('/admin?tab=reports'), label: 'Open the report' }),
    },
    {
        id: 'report-added', editable: true, group: 'moderation', label: 'You were added to a conversation',
        build: () => mailShell('You were added to a conversation',
            '<p>A moderator added you to a report conversation.</p>',
            { url: link('/dashboard?section=reports'), label: 'Open the conversation' }),
    },
    {
        id: 'report-reply', editable: true, group: 'moderation', label: 'Reply to your report',
        build: () => mailShell('Reply to your report',
            '<p>A staff member replied to your report.</p>',
            { url: link('/dashboard?section=reports'), label: 'Read the reply' }),
    },
    {
        id: 'report-acted', editable: true, group: 'moderation', label: 'Your report was acted on',
        note: 'The one that closes the loop. A report with no outcome is why people stop reporting.',
        build: () => mailShell('Your report was acted on',
            '<p>The content you reported has been removed.</p>',
            { url: link('/dashboard?section=reports'), label: 'See the report' }),
    },
    {
        id: 'staff-note', editable: true, group: 'moderation', label: 'An action was taken on your account',
        note: 'Carries the reason given and the way to appeal. The erasure wording is a variant of this same mail.',
        build: (o) => mailShell('An action was taken on your account',
            '<p>Reason given:</p><blockquote>Repeated uploads of content that is not yours.</blockquote>'
            + '<p>If you think this is wrong, you can reply to this message.</p>'
            + '<p>Write to <a href="mailto:appeals@example.com">appeals@example.com</a>.</p>', undefined, o),
    },
    {
        id: 'gift-hosting', editable: true, group: 'billing', label: 'Somebody bought you hosting',
        note: 'The gift code. Sent to the recipient — who may not have an account yet, which is why it is a code and not a provisioned pool.',
        build: () => mailShell('Somebody bought you hosting',
            '<p>Somebody bought you <b>Standard</b> hosting for <b>6 months</b>.</p>'
            + '<p>Redeem it with this code:</p>'
            + '<p style="font-size:20px;font-family:monospace;letter-spacing:2px"><b>K7QP2-M4XRD</b></p>'
            + '<p>You do not need a card. If you do not have an account yet, create one with this address and the code will be waiting.</p>'
            + '<p>It expires in a year.</p>',
            { url: link('/hosting#redeem'), label: 'Redeem it' }),
    },
];

export const MAIL_GROUPS = [
    { id: 'account', label: 'Account' },
    { id: 'content', label: 'Content' },
    { id: 'ops', label: 'Status & operations' },
    { id: 'moderation', label: 'Moderation' },
    { id: 'billing', label: 'Billing' },
];

/** One sample's HTML, or null. `scheme` is the shell's own light/dark switch — an author
 *  checking a mail needs to see the version their reader's client will pick. */
export function renderSample(id, scheme = 'auto') {
    const s = MAIL_SAMPLES.find((x) => x.id === id);
    if (!s) return null;
    // Its own id, so an editable sample is built through the same override the sender applies.
    // Without this the screen would show the built-in wording while the mailbox got the
    // admin's — a preview disagreeing with the thing it previews, which is what this gallery
    // already was before the wording became editable.
    const html = withMailId(s.id, () => s.build({ mailId: s.id }));
    // The shell writes its dark rules from `opts.scheme`, and the samples do not pass one —
    // so the switch is applied here, on the produced HTML, by swapping the media query for the
    // unconditional block. Same declarations either way: what you preview is what is sent.
    if (scheme === 'dark') {
        return html.replace(/@media \(prefers-color-scheme: dark\)\{([\s\S]*?)\n\s*\}/, '$1');
    }
    if (scheme === 'light') {
        return html.replace(/@media \(prefers-color-scheme: dark\)\{[\s\S]*?\n\s*\}/, '');
    }
    return html;
}
