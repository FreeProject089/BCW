// The sent-mail log: one MailLog row per mail sendMail was asked to send.
//
// WHAT IS STORED, AND WHAT IS NOT
//
//   to           the full address(es). Masked in every list; whole only on the detail route,
//                and only for a reader holding manage_users (routes/mail-log.mjs).
//   mailId       the gallery/template id the sender passed ('' when it passed none)
//   subject      REDACTED: links, long token-like runs and bare 6-8 digit codes replaced
//   status       'sent' | 'failed' | 'disabled' (mail switched off: nothing left the server)
//   error        the transport's message, redacted the same way and cut to 300 chars
//   attachments  how many, never what
//
// NEVER the body, html or text. A mail's body is where its secret lives: the verification
// link, the reset token, the gift code, the data export. Today's subjects carry none (they
// were read one by one), but a subject is free text written at the call site, so it goes
// through the same redaction anyway: the rule is "nothing secret-shaped is stored", not
// "the senders we have today are careful".
//
// Fire-and-forget, like the access-traffic recorder: never awaited by the mail, never
// throws, and a failed write never fails a send. Skipped entirely without DATABASE_URL, so a
// unit test that renders a mail opens no database connection.
//
// Retention: 90 days AND at most 20 000 rows, pruned on ~2% of writes.

import { ciEquals } from './ci-equals.mjs';
export const MAIL_LOG_KEEP_DAYS = 90;
export const MAIL_LOG_KEEP_ROWS = 20000;
export const MAIL_LOG_PRUNE_ODDS = 0.02;
export const MAIL_STATUSES = ['sent', 'failed', 'disabled'];

/** Replace anything secret-shaped in a short free-text field. Pure. */
export function redactMailText(s, max = 200) {
  return String(s ?? '')
    .replace(/\b(?:https?|ftp):\/\/\S+/gi, '[link]')
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[address]')
    // 20+ chars from a token alphabet with at least one digit: JWTs, base64url keys, hex.
    .replace(/[A-Za-z0-9_\-.]{20,}/g, (m) => (/\d/.test(m) ? '[redacted]' : m))
    .replace(/(^|[^\w-])\d{6,8}(?![\w-])/g, '$1[code]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Every recipient, as one lower-cased comma-separated string. Pure. */
export function recipientsOf(to) {
  const list = Array.isArray(to) ? to : String(to ?? '').split(',');
  return list
    .map((x) => (typeof x === 'object' && x ? x.address : x))
    .map((x) => String(x ?? '').trim().replace(/^.*<([^>]+)>\s*$/, '$1').toLowerCase())
    .filter(Boolean)
    .join(', ')
    .slice(0, 500);
}

/** "gougele222@gmail.com" -> "go•••@gm•••.com". Pure; used by the list route. */
export function maskAddress(addr) {
  return String(addr ?? '').split(',').map((one) => {
    const a = one.trim();
    const at = a.lastIndexOf('@');
    if (at < 1) return a ? `${a.slice(0, 1)}•••` : '';
    const local = a.slice(0, at); const domain = a.slice(at + 1);
    const dot = domain.lastIndexOf('.');
    const host = dot > 0 ? domain.slice(0, dot) : domain; const tld = dot > 0 ? domain.slice(dot) : '';
    return `${local.slice(0, Math.min(2, local.length - 1) || 1)}•••@${host.slice(0, 2)}•••${tld}`;
  }).join(', ');
}

/** The row to write. Pure, so "no body, nothing secret-shaped" is testable without a DB. */
export function mailLogRow({ to, subject, mailId, status, error, attachments }) {
  return {
    to: recipientsOf(to),
    mailId: String(mailId || '').slice(0, 60),
    subject: redactMailText(subject, 200),
    status: MAIL_STATUSES.includes(status) ? status : 'failed',
    error: error ? redactMailText(error?.message || error, 300) : null,
    attachments: Array.isArray(attachments) ? attachments.length : 0,
  };
}

/** Delete rows past the window, then everything past the row cap. */
export async function pruneMailLog(p, now = Date.now()) {
  await p.mailLog.deleteMany({ where: { createdAt: { lt: new Date(now - MAIL_LOG_KEEP_DAYS * 864e5) } } });
  const excess = await p.mailLog.findMany({ orderBy: { createdAt: 'desc' }, skip: MAIL_LOG_KEEP_ROWS, take: 2000, select: { id: true } });
  if (excess.length) await p.mailLog.deleteMany({ where: { id: { in: excess.map((e) => e.id) } } });
}

/**
 * Record one mail. `getDb` is a seam; production resolves lib.mjs lazily, because mail.mjs
 * is imported by lib.mjs's neighbours and a static import here would tie the mail renderer
 * (which tests load on its own) to a database client.
 */
export function recordMail(entry, { getDb, random = Math.random } = {}) {
  if (!getDb && !process.env.DATABASE_URL) return;
  let data;
  try { data = mailLogRow(entry); } catch { return; }
  if (!data.to) return;
  (async () => {
    const p = getDb ? await getDb() : await (await import('./lib.mjs')).db();
    // Attach the account the (single) address belonged to, so erasing it removes these rows.
    let userId = null;
    if (!data.to.includes(',')) {
      const u = await p.user.findFirst({ where: { email: ciEquals(data.to) }, select: { id: true } }).catch(() => null);
      userId = u?.id || null;
    }
    await p.mailLog.create({ data: { ...data, userId } });
    if (random() < MAIL_LOG_PRUNE_ODDS) await pruneMailLog(p);
  })().catch(() => { /* logging must never break sending */ });
}
