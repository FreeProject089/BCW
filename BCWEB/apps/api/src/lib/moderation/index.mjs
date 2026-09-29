// The moderation engine's public face, and the small glue each route uses.
//
// Routes import from HERE, never from the engine's files directly, so the wiring into the
// existing forms stays a few lines each and the contract (moderate / linkCase) has one door.
//
// Where each surface's content enters today, and what the engine may do there:
//
//   surface          route                                     can refuse   can hold
//   contact          POST /contact (misc.mjs)                  no (*)       yes: kept in the case until released
//   legal            POST /contact legal kinds, POST /rights/notice   never: sensitive, review only
//   bug/suggestion   POST /contact with that kind; POST /feedback/:key (feedback, bug)
//   crash            POST /feedback/:key kind crash           yes (422)    yes: row filed as "ignored"
//   report           POST /reports, POST /me/reports/:id/messages     never: sensitive, review only
//   member_message   POST /threads, thread replies (threads.mjs)   yes (422)  yes: message hidden
//   team_message     the same, when a team answers the inbox   yes (422)    yes: message hidden
//   community        PUT /projects-reviews/:ref/mine           yes (400)    no (already pending)
//   discord_automod  POST /bot/moderation/check (the bot asks; the bot acts)
//   phishing         POST /bot/moderation/check with a link list
//
// (*) the contact form never tells a sender "refused": a spammer learns nothing, and a person
// caught by mistake loses nothing, because the held message waits in the queue to be released.
export { moderate, linkCase, aiModule } from './engine.mjs';
export { SURFACES, SENSITIVE, DECISIONS, MODES } from './policy.mjs';
import { moderate } from './engine.mjs';

/** Contact kinds that are legal requests (a clock or somebody's rights attached). */
export const LEGAL_CONTACT_KINDS = Object.freeze(['report', 'copyright', 'data_export', 'data_delete', 'appeal']);

export function contactSurface(kind) {
  if (LEGAL_CONTACT_KINDS.includes(kind)) return 'legal';
  if (kind === 'bug') return 'bug';
  if (kind === 'suggestion') return 'suggestion';
  return 'contact';
}

/**
 * The contact form. A security report is moderated for spam signals but its text is never
 * copied into a case (it is readable in exactly one place, see contact-inbox.test.mjs), and it
 * is never held: a real vulnerability report caught by a heuristic must still arrive.
 */
export function moderateContact(p, { name, email, body, kind, ip, userId }, log) {
  const surface = contactSurface(kind);
  const secret = kind === 'security';
  return moderate(surface, { text: `${name}\n${body}`, authorId: userId || null, ip, meta: { kind, secret } }, {
    p, log, subject: { type: 'contact_message' }, holdType: 'contact_held', canHold: !secret,
    payload: { name, email, body, kind, ip, userId: userId || null },
  });
}

/** Which surface a contact thread is: a team answering is team_message, the rest is between members. */
export function threadSurface(t) {
  return t?.kind === 'team' || t?.ownerTeamId || t?.teamId ? 'team_message' : 'member_message';
}

/** A message in a contact thread (new thread or reply). Staff messages are not moderated:
 *  the caller skips them. A hold hides the message (ContactThreadMessage.hidden, the same
 *  flag staff already use) and the caller tells nobody until a moderator releases it. */
export function moderateThread(p, t, text, { authorId = null, ip = '' } = {}, log) {
  return moderate(threadSurface(t), { text, authorId, ip }, { p, log, subject: { type: 'thread_message' }, canHold: true, canRefuse: true });
}

/** Moderate after the response, for surfaces where the result never changes what the sender
 *  is told (reports, legal notices): the case appears in the queue a moment later. */
export function moderateLater(surface, input, opts) {
  setImmediate(() => { moderate(surface, input, opts).catch(() => {}); });
}
