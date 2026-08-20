// Who can find a poll, and who can open one.
//
// These are two different questions and conflating them is the bug this module exists to
// prevent. A poll can be answerable by anybody and still not be listed anywhere; a poll can be
// listed and closed. `audience` already answers "who may ANSWER" — this answers "where can it
// be FOUND".
//
// It is a separate module for the reason the repo learned the hard way elsewhere: a visibility
// rule written twice diverges. The list endpoint, the single-poll endpoint, the home page feed
// and the admin preview all ask the same question, and the day one of them is updated and
// another is not is the day a staff-only poll appears on the front page.
import crypto from 'node:crypto';

export const POLL_VISIBILITIES = ['public', 'unlisted', 'private'];
const STAFF = ['MOD', 'ADMIN', 'SUPERADMIN'];

export const isStaffRole = (role) => STAFF.includes(role);

/** Constant-time compare, same shape as lib.mjs's safeEqual.
 *
 *  Hashed first so two different lengths can still be compared — timingSafeEqual throws on
 *  mismatched buffers, and catching that throw is itself a length oracle. */
function ctEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * May this viewer OPEN this poll, given the key they arrived with?
 *
 * @param poll   at least { status, visibility, shareKey }
 * @param role   the viewer's role, or null when signed out
 * @param key    the `k` query parameter, or null
 */
export function mayViewPoll(poll, { role = null, key = null } = {}) {
  if (!poll) return false;
  // Staff see drafts too — that is what makes an admin preview a preview of the real thing
  // rather than a second rendering that can disagree with it.
  if (isStaffRole(role)) return true;
  if (poll.status === 'draft') return false;
  const vis = poll.visibility || 'public';
  if (vis === 'public') return true;
  if (vis === 'unlisted') {
    // An empty shareKey must never be openable by an empty key. Without this, every unlisted
    // poll whose key was not generated would be readable by anyone who omitted `?k=`.
    if (!poll.shareKey || !key) return false;
    return ctEq(key, poll.shareKey);
  }
  return false; // private
}

/**
 * Should this poll appear in a LIST — /polls, the home page, search?
 *
 * Deliberately does not take a key: a link grants access to one poll, never a place in a
 * listing. If it did, holding one key would enumerate the rest.
 */
export function mayListPoll(poll, { role = null, includeDrafts = false } = {}) {
  if (!poll) return false;
  if (poll.status === 'draft' && !(includeDrafts && isStaffRole(role))) return false;
  if (isStaffRole(role)) return true;
  return (poll.visibility || 'public') === 'public';
}

/**
 * The Prisma `where` that selects exactly what `mayListPoll` would accept.
 *
 * It lives HERE, three lines from the predicate, because the alternative is writing the rule a
 * second time in the route — and a filter that takes 50 rows and then drops most of them is
 * not an option either (you get three polls on a page that asked for fifty). The two are kept
 * honest by a test that runs every sample poll through both and asserts they agree; if you
 * change one, that test fails until you change the other.
 */
export function listWhere({ role = null, includeDrafts = false } = {}) {
  const live = { status: { in: ['open', 'closed'] } };
  if (isStaffRole(role)) return includeDrafts ? {} : live;
  return { ...live, visibility: 'public' };
}

/**
 * What of the key is safe to send back.
 *
 * The share key is the secret in the URL, so it goes out ONLY to somebody who could already
 * open the poll without it — staff, or a holder who just proved they have it. Returning it on
 * a list would hand out the keys to everything the list is hiding.
 */
export function shareKeyFor(poll, { role = null } = {}) {
  if (!poll || (poll.visibility || 'public') !== 'unlisted') return null;
  return isStaffRole(role) ? (poll.shareKey || null) : null;
}

/** A fresh share key. 16 bytes: long enough that guessing is not a strategy, short enough
 *  that the resulting URL survives being pasted into a chat window. */
export const newShareKey = () => crypto.randomBytes(16).toString('base64url');
