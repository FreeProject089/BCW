// Surfaces, policies, and the one function that turns a score into a decision.
//
// A SURFACE is a place content enters the site (the ids are shared with the AI layer, see the
// contract in lib/moderation/ai.mjs). A POLICY says, per surface, what the engine may do:
//
//   auto      act on the decision: hold (quarantine) or refuse (block) where the surface can
//   flag      never hold or refuse; anything over the flag threshold opens a FLAG case
//   review    never hold or refuse; anything over the flag threshold opens a REVIEW case
//   analyze   act on nothing and open nothing in the queue: the case is only LOGGED, so the
//             stats show what the rules would have done before anybody lets them act
//
// `report` and `legal` are SENSITIVE: whatever the stored policy says, their decision is
// REVIEW and their mode cannot be set to auto. A report about abuse must never be silently
// dropped by the thing it may be reporting, and a legal notice has a person's rights attached.
// The AI is never allowed to close them either (engine.mjs).

export const SURFACES = Object.freeze(['contact', 'report', 'legal', 'crash', 'bug', 'suggestion',
  'member_message', 'team_message', 'community', 'discord_automod', 'phishing']);
export const SENSITIVE = Object.freeze(['report', 'legal']);
export const DECISIONS = Object.freeze(['ALLOW', 'FLAG', 'REVIEW', 'QUARANTINE', 'BLOCK']);
export const MODES = Object.freeze(['auto', 'flag', 'review', 'analyze']);
const RANK = Object.fromEntries(DECISIONS.map((d, i) => [d, i]));
export const rank = (d) => RANK[d] ?? 0;
export const maxDecision = (a, b) => (rank(a) >= rank(b) ? a : b);

export const DEFAULT_THRESHOLDS = Object.freeze({ flag: 30, review: 55, quarantine: 75, block: 90 });

const base = (mode, extra = {}) => ({
  mode,
  thresholds: { ...DEFAULT_THRESHOLDS },
  // Consult the AI layer in the grey zone. On by default because the AI layer has its own
  // switches (global, per surface, kill): with the layer off this does nothing. Turning it off
  // here lets the engine opt a surface out whatever the layer says.
  ai: true,
  aiBlocking: false,   // wait for it (with a hard timeout) instead of after the response
  aiTimeoutMs: 1500,
  notify: true,        // tell staff about a new REVIEW / QUARANTINE case
  flood: { max: 6, windowSec: 60 },
  dup: { windowSec: 3600, crossAuthors: 3 },
  ...extra,
});

/**
 * The shipped defaults. Conservative on purpose: NOTHING holds or refuses content until an
 * admin chooses `auto` for a surface. Every surface starts by flagging (a case in the queue,
 * the content untouched), report and legal by review, and a crash report, which is a log and
 * looks like noise to every heuristic, is only analysed. The one exception is `phishing`,
 * which only the Discord bot asks about (POST /bot/moderation/check) and which only ADVISES:
 * the bot decides what to do with the answer.
 *
 * Why not `auto` for messages between members from day one: the flood and duplicate rules
 * cannot tell a spammer from a person who sends the same polite message to three teams, and
 * a rule that hides a real person's message on its first day is a rule that gets switched
 * off. Watch the flagged cases for a week, then switch the surfaces you trust to auto.
 */
export const DEFAULT_POLICIES = Object.freeze({
  contact: base('flag', { flood: { max: 3, windowSec: 600 } }),
  report: base('review', { flood: { max: 5, windowSec: 600 } }),
  legal: base('review', { flood: { max: 5, windowSec: 3600 } }),
  crash: base('analyze', { flood: { max: 30, windowSec: 600 }, dup: { windowSec: 0, crossAuthors: 3 } }),
  bug: base('flag', { flood: { max: 10, windowSec: 600 } }),
  suggestion: base('flag', { flood: { max: 6, windowSec: 600 } }),
  member_message: base('flag', { flood: { max: 12, windowSec: 60 } }),
  team_message: base('flag', { flood: { max: 12, windowSec: 60 } }),
  community: base('flag', { flood: { max: 5, windowSec: 600 } }),
  discord_automod: base('flag', { flood: { max: 6, windowSec: 10 }, dup: { windowSec: 600, crossAuthors: 3 } }),
  phishing: base('auto', { flood: { max: 0, windowSec: 60 }, dup: { windowSec: 0, crossAuthors: 3 } }),
});

const num = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dflt);

/** One surface's policy, from untrusted stored JSON, over its default. */
export function normalizePolicy(surface, raw) {
  const d = DEFAULT_POLICIES[surface] || base('flag');
  const r = raw && typeof raw === 'object' ? raw : {};
  const t = r.thresholds && typeof r.thresholds === 'object' ? r.thresholds : {};
  const th = {
    flag: num(t.flag, 1, 1000, d.thresholds.flag),
    review: num(t.review, 1, 1000, d.thresholds.review),
    quarantine: num(t.quarantine, 1, 1000, d.thresholds.quarantine),
    block: num(t.block, 1, 1000, d.thresholds.block),
  };
  // Thresholds must climb. A block threshold below the flag one would make the ladder mean
  // nothing; each step is pushed up to at least the one before it.
  th.review = Math.max(th.review, th.flag); th.quarantine = Math.max(th.quarantine, th.review); th.block = Math.max(th.block, th.quarantine);
  let mode = MODES.includes(r.mode) ? r.mode : d.mode;
  if (SENSITIVE.includes(surface) && mode === 'auto') mode = 'review';
  const fl = r.flood && typeof r.flood === 'object' ? r.flood : {};
  const dp = r.dup && typeof r.dup === 'object' ? r.dup : {};
  return {
    mode,
    thresholds: th,
    ai: r.ai === undefined ? d.ai : r.ai === true,
    aiBlocking: r.aiBlocking === true,
    aiTimeoutMs: num(r.aiTimeoutMs, 200, 5000, d.aiTimeoutMs),
    notify: r.notify === undefined ? d.notify : r.notify !== false,
    flood: { max: num(fl.max, 0, 1000, d.flood.max), windowSec: num(fl.windowSec, 1, 86400, d.flood.windowSec) },
    dup: { windowSec: num(dp.windowSec, 0, 7 * 86400, d.dup.windowSec), crossAuthors: num(dp.crossAuthors, 2, 100, d.dup.crossAuthors) },
    sensitive: SENSITIVE.includes(surface),
  };
}

export function normalizePolicies(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(SURFACES.map((s) => [s, normalizePolicy(s, r[s])]));
}

/** The raw decision a score earns against the thresholds, before the mode is applied. */
export function scoreToDecision(score, th) {
  if (score >= th.block) return 'BLOCK';
  if (score >= th.quarantine) return 'QUARANTINE';
  if (score >= th.review) return 'REVIEW';
  if (score >= th.flag) return 'FLAG';
  return 'ALLOW';
}

/**
 * What the policy makes of a raw decision.
 *
 * @returns {{ decision, status }}  status is the case status to write: 'open' for the queue,
 *   'logged' for analysis only, null when no case is needed.
 */
export function applyMode(raw, policy) {
  if (policy.sensitive) return { decision: 'REVIEW', status: raw === 'ALLOW' ? null : 'open' };
  if (raw === 'ALLOW') return { decision: 'ALLOW', status: null };
  switch (policy.mode) {
    case 'analyze': return { decision: 'ALLOW', status: 'logged' };
    case 'flag': return { decision: 'FLAG', status: 'open' };
    case 'review': return { decision: 'REVIEW', status: 'open' };
    default: return { decision: raw, status: 'open' };
  }
}

/**
 * What the CALLER should do with the content, given what the surface can do.
 *
 *   'refuse'  do not store it; tell the sender it was refused
 *   'hold'    store it out of sight (quarantine) until staff release it
 *   'allow'   store and publish it as usual (a FLAG or REVIEW case may still be open)
 *
 * A BLOCK on a surface that cannot refuse is held instead; a QUARANTINE on a surface that
 * cannot hold is allowed, with its case open for review.
 */
export function actionFor(decision, { canHold = false, canRefuse = false } = {}) {
  if (decision === 'BLOCK') return canRefuse ? 'refuse' : canHold ? 'hold' : 'allow';
  if (decision === 'QUARANTINE') return canHold ? 'hold' : 'allow';
  return 'allow';
}
