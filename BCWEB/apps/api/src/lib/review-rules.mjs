// The rules a member's review is held to, written ONCE for both places a member writes one:
// the landing review (routes/misc.mjs, M11 + N10) and a project's review (routes/project-reviews.mjs,
// agent-prerelease). They were constants inside misc.mjs; a second copy in the project routes
// would have been the "two rules, one truth" drift the repo already paid for once.
//
//   · plain text, 20 to 600 characters, and no links at all (a review with a URL is an advert,
//     and refusing the shape is simpler than judging each one);
//   · an account at least a day old (a review written by an account made for it is the spam
//     case), and an active one;
//   · public (may be shown after a moderator approves it) or private (the team only, never
//     shown whatever its status), signed or anonymous ("a member", no avatar);
//   · always `pending` when written or edited: what visitors read is something a person looked at.
import { z } from 'zod';

export const memberReviewSchema = z.object({
  body: z.string().trim().min(20).max(600),
  rating: z.number().int().min(1).max(5).nullish(),
  role: z.string().trim().max(60).optional(),
  lang: z.enum(['en', 'fr']).optional(),
  visibility: z.enum(['public', 'private']).default('public'),
  anonymous: z.boolean().default(false),
});

export const REVIEW_HAS_LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|xyz|ru|cn|ch|fr|de|me|app|dev)\b)/i;
export const REVIEW_MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

/** Why this account may not write a review now, or null. `me` = { createdAt, status }. */
export function reviewerRefusal(me, now = Date.now()) {
  if (!me || (me.status && me.status !== 'active')) return 'forbidden';
  if (now - new Date(me.createdAt).getTime() < REVIEW_MIN_ACCOUNT_AGE_MS) return 'account_too_new';
  return null;
}

/** An anonymous review's public face: no name, and a neutral avatar (the member's own seed
 *  would tie it to their profile). */
export const ANONYMOUS_AVATAR = Object.freeze({ variant: 'beam', seed: 'bc-anonymous-member' });
