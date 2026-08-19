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

import { mailShell } from './mail.mjs';

const SITE = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
const link = (path) => `${SITE}${path}`;

/**
 * The catalogue. Each entry knows its own group so the screen can lay them out the way a
 * reader thinks about them — "things that happen to my account", "things about money" — rather
 * than in the order the code happened to define them.
 */
export const MAIL_SAMPLES = [
    {
        id: 'verify', group: 'account', label: 'Confirm your email',
        note: 'Sent on sign-up, and again from the account screen if it was never confirmed.',
        build: () => mailShell('Confirm your email',
            'Welcome to BetterCommunity. Confirm this address and your account is ready.',
            { url: link('/auth/verify?token=EXAMPLE'), label: 'Confirm my email' }),
    },
    {
        id: 'reset', group: 'account', label: 'Reset your password',
        note: 'Only ever sent to an address that asked. The link expires.',
        build: () => mailShell('Reset your password',
            'Somebody asked to reset the password for this account. If that was not you, nothing has changed and you can ignore this.',
            { url: link('/auth/reset?token=EXAMPLE'), label: 'Choose a new password' }),
    },
    {
        id: 'password-changed', group: 'account', label: 'Your password was changed',
        note: 'The one mail nobody asks for and everybody needs — it is how a stolen account is noticed.',
        build: () => mailShell('Your password was changed',
            'The password on your account was changed just now. If that was you, there is nothing to do. If it was not, reset it immediately and check your signed-in devices.',
            { url: link('/auth/forgot'), label: 'Reset it now' }),
    },
    {
        id: 'twofa-reset', group: 'account', label: 'Two-factor authentication reset',
        build: () => mailShell('Two-factor authentication reset',
            'Two-factor authentication was turned off for your account. If you did not do this, your account may be compromised.',
            { url: link('/settings'), label: 'Open my settings' }),
    },
    {
        id: 'closure', group: 'account', label: 'Your account is scheduled to close',
        note: 'Carries the date and the way back. The link works while the closure is pending, signed in or not.',
        build: () => mailShell('Your account is scheduled to close',
            'Your account will close on <b>1 September 2026</b>. Nothing has been deleted yet. If you change your mind, one click stops it.',
            { url: link('/account/closure/cancel?token=EXAMPLE'), label: 'Keep my account' }),
    },
    {
        id: 'reactivated', group: 'account', label: 'Account reactivated',
        build: () => mailShell('Account reactivated',
            'Your account is active again and everything you had is back where it was.',
            { url: link('/'), label: 'Open BetterCommunity' }),
    },
    {
        id: 'data-export', group: 'account', label: 'Your data',
        note: 'A GDPR export. The archive rides as an attachment, which is why this mail must never look improvised.',
        build: () => mailShell('Your data',
            'Everything BetterCommunity holds about your account is attached as a single file. It contains personal data — keep it somewhere you would keep a bank statement.'),
    },
    {
        id: 'newsletter', group: 'content', label: 'Newsletter',
        note: 'Also what a blog post announcement looks like. Every one carries its own unsubscribe link.',
        build: () => mailShell('What shipped this month',
            '<p style="margin:0 0 14px">A short paragraph of news, written in the composer.</p>'
            + '<ul style="margin:0 0 14px;padding-left:20px"><li>Something that shipped</li><li>Something else</li></ul>',
            { url: link('/blog/example'), label: 'Read the post' },
            { preheader: 'The short line a mail client shows beside the subject.' }),
    },
    {
        id: 'status', group: 'ops', label: 'Confirm your status alerts',
        note: 'Double opt-in: nothing is sent to an address until it confirms.',
        build: () => mailShell('Confirm your status alerts',
            'Confirm this address and you will be told when a service goes down, and when it comes back. Nothing else.',
            { url: link('/status/confirm/EXAMPLE'), label: 'Confirm' }),
    },
    {
        id: 'status-down', group: 'ops', label: 'A service is down',
        note: 'What a subscriber actually receives. The "it is back" mail is the same shell with the other wording.',
        build: () => mailShell('Object storage is down',
            'We noticed at <b>14:32 UTC</b>. Uploads and downloads will fail until it is back. You will get one more mail when it is.',
            { url: link('/status'), label: 'See the status page' }),
    },
    {
        id: 'sanction', group: 'moderation', label: 'A moderation decision',
        note: 'Quotes the reason and the reference. The reference is what an appeal is filed against.',
        build: () => mailShell('Your content was taken down',
            '<p style="margin:0 0 14px">Reference <b>BC-1234-5678</b>.</p>'
            + '<p style="margin:0 0 14px">Reason given: <i>the example reason a moderator typed</i>.</p>'
            + '<p style="margin:0 0 14px">If you think this is wrong, you can contest it — a person reads every contest.</p>',
            { url: link('/sanction/BC-1234-5678'), label: 'Read it or contest it' }),
    },
    {
        id: 'report-archived', group: 'moderation', label: 'Your report was archived',
        build: () => mailShell('Your report was archived',
            'Thank you — a moderator looked at what you reported and has closed it.'),
    },
    {
        id: 'hosting-expiry', group: 'billing', label: 'Your hosting term is ending',
        note: 'One warning per term, and it says exactly what stops working and when.',
        build: () => mailShell('Your hosting ends in 7 days',
            'Your storage pool <b>"my-pool"</b> is paid until <b>1 September 2026</b>. After that its repos are suspended for 72 hours, then hidden. Renewing at any point puts everything back.',
            { url: link('/hosting'), label: 'Renew it' }),
    },
    {
        id: 'legal-changed', group: 'account', label: 'A policy changed',
        note: 'Sent when a legal document is published with "notify everyone" ticked. The '
            + 'link goes to the new version; the archived previous one stays readable.',
        build: () => mailShell('The Terms of Service have changed',
            'We published a new version of the Terms of Service on 1 January 2026.\n\n'
            + 'What changed: we added a section on reporting illegal content.\n\n'
            + 'The previous version stays available, so you can read exactly what you agreed to before.',
            { url: link('/legal/terms'), label: 'Read the new version' }),
    },
    {
        id: 'legal-reaccept', group: 'account', label: 'A policy needs your agreement',
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
    const html = s.build();
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
