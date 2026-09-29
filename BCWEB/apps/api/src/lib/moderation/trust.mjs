// Author trust: who wrote it, as a nudge on the score.
//
// Trust never creates a case by itself. It AMPLIFIES a message that already tripped something
// (a new account posting a shortened link is more worrying than an old one doing it) and it
// DAMPENS staff, who paste odd links in the course of the job. That is why the engine adds
// these reasons only when the content score is already above zero, except the staff one.
//
// One small query per author, cached briefly in a bounded map: a flood of messages from one
// account costs one lookup, not one per message.
import { boundedSet } from '../boundedmap.mjs';

const TTL_MS = 60_000;
const cache = new Map(); // authorId -> { at, v }

export function _resetTrust() { cache.clear(); }

const DAY = 864e5;

/** Facts about an author, or null for an anonymous sender / an unknown id. */
export async function authorFacts(p, authorId) {
  if (!authorId || !p) return null;
  const hit = cache.get(authorId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  let v = null;
  try {
    const u = await p.user.findUnique({ where: { id: authorId }, select: { createdAt: true, emailVerified: true, role: true, status: true } });
    if (u) {
      const sanctions = await p.sanction.count({ where: { userId: authorId, status: 'active' } }).catch(() => 0);
      v = { ageDays: (Date.now() - new Date(u.createdAt).getTime()) / DAY, verified: !!u.emailVerified, staff: ['MOD', 'ADMIN', 'SUPERADMIN'].includes(u.role), status: u.status || 'active', sanctions };
    }
  } catch { v = null; }
  boundedSet(cache, authorId, { at: Date.now(), v }, 5000);
  return v;
}

/**
 * Trust reasons. `facts` is authorFacts() (null = anonymous or unknown); `external` is for a
 * sender identified elsewhere (a Discord member), where only anonymity is known.
 */
export function trustReasons(facts, { anonymous = false, contentScore = 0 } = {}) {
  const out = [];
  if (facts?.staff) { out.push({ rule: 'trust.staff', weight: -50, detail: 'staff account' }); return out; }
  if (contentScore <= 0) return out;
  if (!facts) {
    if (anonymous) out.push({ rule: 'trust.anonymous', weight: 5, detail: 'no account' });
    return out;
  }
  if (facts.ageDays < 1) out.push({ rule: 'trust.new_account', weight: 15, detail: 'account less than a day old' });
  else if (facts.ageDays < 7) out.push({ rule: 'trust.new_account', weight: 8, detail: `account ${Math.floor(facts.ageDays)} day(s) old` });
  if (!facts.verified) out.push({ rule: 'trust.unverified', weight: 10, detail: 'e-mail not confirmed' });
  if (facts.sanctions > 0) out.push({ rule: 'trust.prior_sanctions', weight: Math.min(30, 15 * facts.sanctions), detail: `${facts.sanctions} active sanction(s)` });
  if (facts.status && facts.status !== 'active') out.push({ rule: 'trust.restricted', weight: 20, detail: `account ${facts.status}` });
  if (facts.ageDays >= 90 && facts.verified && !facts.sanctions) out.push({ rule: 'trust.established', weight: -10, detail: 'verified account older than 90 days' });
  return out;
}
