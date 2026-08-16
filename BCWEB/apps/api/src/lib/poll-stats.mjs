// What a poll's answers actually say.
//
// The tally on the poll page answers "which option won". These are the questions you ask
// afterwards and could not: how many PEOPLE answered rather than how many boxes were ticked,
// whether it is still moving or finished days ago, and whether the result rests on enough
// answers to mean anything.
//
// Pure functions over rows, so they are testable and the numbers on a screen come from the
// same code as the numbers in an export. Nothing here reads a database.

// The one thing here that is not pure arithmetic: which kinds take an answer at all.
// Imported rather than restated, so "a note is content" is decided in one place.
import { isAnswerable } from './poll-answer.mjs';

/**
 * People, not ticks.
 *
 * On a multiple-choice poll one person produces several PollVote rows, so counting rows
 * overstates turnout — badly, and in a way that looks plausible. A voter is identified by
 * userId when signed in and by voterKey when not, which is exactly how the unique
 * constraints in the schema define "the same voter twice".
 */
export function voterCount(votes) {
  const seen = new Set();
  let unattributed = 0;
  for (const v of votes) {
    const key = v.userId ? `u:${v.userId}` : (v.voterKey ? `k:${v.voterKey}` : null);
    // An anonymised vote from a closed account: it still counted, and it cannot be merged
    // with anything. Counted individually rather than dropped, because dropping it would
    // change a published result after the fact.
    if (!key) { unattributed++; continue; }
    seen.add(key);
  }
  return seen.size + unattributed;
}

/** Per-option totals, biggest first, with the share of VOTERS each option reached. */
export function optionTally(options, votes) {
  const voters = voterCount(votes);
  const byOption = new Map(options.map((o) => [o.id, 0]));
  for (const v of votes) if (byOption.has(v.optionId)) byOption.set(v.optionId, byOption.get(v.optionId) + 1);
  return [...byOption]
    .map(([id, n]) => ({
      id,
      label: options.find((o) => o.id === id)?.label ?? id,
      votes: n,
      // Of VOTERS, not of votes. On a multiple-choice poll the shares deliberately sum past
      // 100%: "62% of people picked this" is the true statement, and normalising it to sum
      // to 100 would answer a question nobody asked.
      shareOfVoters: voters ? Math.round((n / voters) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.votes - a.votes);
}

/** Votes per day, oldest first — enough to see whether it is still moving. */
export function timeline(votes) {
  const byDay = new Map();
  for (const v of votes) {
    const d = new Date(v.createdAt).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  return [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, n]) => ({ day, votes: n }));
}

/**
 * Is the leader actually ahead?
 *
 * A four-vote poll with a 3–1 split is not a result, and presenting it beside a four-thousand
 * vote one as though both are answers is how a poll gets quoted. This does not compute a
 * confidence interval — that would imply a sampling model this data does not have — it states
 * the margin and the size, and says plainly when they are too small to lean on.
 */
export function leadStrength(tally, voters) {
  if (tally.length < 2 || !voters) return { decided: false, reason: 'not_enough_options' };
  const [first, second] = tally;
  const margin = first.votes - second.votes;
  // Thresholds chosen to be defensible rather than clever: fewer than 20 voters is a room,
  // not a sample, and a margin inside 5% of turnout is inside the noise of who happened to
  // see it that day.
  if (voters < 20) return { decided: false, reason: 'too_few_voters', voters, margin };
  if (margin / voters < 0.05) return { decided: false, reason: 'too_close', voters, margin };
  return { decided: true, winner: first.label, margin, voters };
}

/** Everything, for one poll. */
export function pollStats(poll, options, votes, now = new Date()) {
  const voters = voterCount(votes);
  const tally = optionTally(options, votes);
  const days = timeline(votes);
  const last = votes.length ? new Date(Math.max(...votes.map((v) => new Date(v.createdAt).getTime()))) : null;
  return {
    pollId: poll.id,
    question: poll.question,
    status: poll.status,
    multiple: !!poll.multiple,
    counts: {
      voters,
      votes: votes.length,
      options: options.length,
      // The two differ only on a multiple-choice poll, and the gap is the thing worth seeing:
      // it is how many extra boxes the average voter ticked.
      picksPerVoter: voters ? Math.round((votes.length / voters) * 100) / 100 : 0,
      signedIn: votes.filter((v) => v.wasLoggedIn).length,
    },
    tally,
    timeline: days,
    lastVoteAt: last,
    // Days since anything happened. A poll nobody has answered in a fortnight is finished
    // whatever its status says, and that is worth showing next to the status rather than
    // leaving somebody to subtract dates.
    quietDays: last ? Math.floor((now - last) / 86400000) : null,
    lead: leadStrength(tally, voters),
  };
}

// ── Multi-question shape ─────────────────────────────────────────────────────
//
// The aggregates the four typed columns on PollAnswer exist for. Deliberately built on the
// SAME voterCount and leadStrength as the single-question stats above rather than a second
// set of rules: "62% of voters" must mean the same thing on both screens, and two definitions
// of a percentage is how one report contradicts another.

/** Mean, spread and distribution for a `scale` or `number` question. */
export function numericSummary(answers) {
  const values = answers.map((a) => a.number).filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((t, n) => t + n, 0);
  const mid = Math.floor(sorted.length / 2);
  const distribution = {};
  for (const n of sorted) distribution[n] = (distribution[n] || 0) + 1;
  return {
    count: sorted.length,
    mean: sum / sorted.length,
    // The median is reported beside the mean because one long scale answer drags a mean and
    // leaves the median where the answers actually are — and a mean alone is what gets quoted.
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    distribution,
  };
}

/**
 * How far people got.
 *
 * The number a form owner actually wants and no single-question poll can have: how many
 * started, and how many reached the end. Counted in PEOPLE, by the same identity rule as
 * voterCount — a multi-choice question would otherwise make one person look like three.
 */
export function completion(questions, answers) {
  // A note cannot be required — it takes no answer, so counting one as an unmet requirement
  // would make every submission incomplete for ever. Filtered by the same isAnswerable the
  // endpoint uses rather than by a second rule about which kinds count.
  const required = questions.filter((q) => q.required && isAnswerable(q.kind));
  const started = voterCount(answers);
  if (!required.length) return { started, completed: started, rate: started ? 1 : 0 };

  const byVoter = new Map();
  for (const a of answers) {
    const key = a.userId ? `u:${a.userId}` : (a.voterKey ? `k:${a.voterKey}` : null);
    // An anonymised answer cannot be joined to its siblings, so it can never be shown to have
    // completed anything. Counted as started and not as completed — the honest direction, and
    // the one that cannot overstate the rate.
    if (!key) continue;
    if (!byVoter.has(key)) byVoter.set(key, new Set());
    byVoter.get(key).add(a.questionId);
  }
  let completed = 0;
  for (const answered of byVoter.values()) {
    if (required.every((q) => answered.has(q.id))) completed++;
  }
  return { started, completed, rate: started ? completed / started : 0 };
}

/**
 * A ranking's result: each item's AVERAGE rank, best first.
 *
 * Not a tally of first places. "How many people put it first" is a different and worse question —
 * an item ranked second by everybody beats one ranked first by a third and last by the rest, and
 * only the mean says so.
 *
 * `count` rides along because an average rank over three people and over three hundred look
 * identical on a bar, and the reader deserves to know which they are looking at.
 */
export function rankingSummary(choices, answers) {
  const byChoice = new Map(choices.map((c) => [c.id, []]));
  for (const a of answers) {
    if (!byChoice.has(a.choiceId)) continue;
    if (typeof a.number !== 'number' || !Number.isFinite(a.number)) continue;
    byChoice.get(a.choiceId).push(a.number);
  }
  return [...byChoice]
    .map(([id, ranks]) => ({
      id,
      label: choices.find((c) => c.id === id)?.label ?? id,
      count: ranks.length,
      averageRank: ranks.length ? ranks.reduce((t, n) => t + n, 0) / ranks.length : null,
    }))
    // Lower is better, and an item nobody ranked has no average — it sorts last rather than
    // winning by having no number to beat.
    .sort((a, b) => (a.averageRank ?? Infinity) - (b.averageRank ?? Infinity));
}

/**
 * A grid's result: one tally per ROW.
 *
 * Rows come from the question's config, not from the answers, so a row nobody filled appears
 * with zero rather than vanishing — a missing row and an unanimously-skipped row look the same
 * in the data and are very different facts to a form owner.
 *
 * Deliberately NOT summed into one grand tally across rows. "Speed: good, Docs: bad" averaged
 * into "50% good" answers a question nobody asked, and the whole point of a grid is that the
 * rows are separate.
 */
export function gridSummary(rows, choices, answers) {
  return rows.map((label, i) => {
    const mine = answers.filter((a) => a.slot === i);
    return {
      row: i,
      label,
      voters: voterCount(mine),
      tally: optionTally(choices, mine.map((a) => ({ ...a, optionId: a.choiceId }))),
    };
  });
}

/** Stats for one question, shaped by its kind. */
export function questionStats(question, answers, choices = []) {
  // Content, not a question. It has no answers by construction, and letting it fall through
  // to the date branch would report `answered: 0` — the same default-case trap ranking and
  // grid hit, arrived at from a third direction.
  if (!isAnswerable(question.kind)) {
    return { id: question.id, kind: question.kind, label: question.label, voters: 0, content: true };
  }
  const mine = answers.filter((a) => a.questionId === question.id);
  const voters = voterCount(mine);
  const base = { id: question.id, kind: question.kind, label: question.label, voters };

  if (question.kind === 'choice') {
    // Reuses optionTally so a choice question and a legacy poll compute their percentages
    // identically.
    const tally = optionTally(choices, mine.map((a) => ({ ...a, optionId: a.choiceId })));
    return { ...base, tally, lead: leadStrength(tally, voters) };
  }
  if (question.kind === 'scale' || question.kind === 'number') {
    return { ...base, numeric: numericSummary(mine) };
  }
  if (question.kind === 'text') {
    // Text is never aggregated into a "top answer" — that invents a consensus out of free
    // writing. The count is reported; the words are read.
    return { ...base, answered: mine.filter((a) => typeof a.text === 'string' && a.text !== '').length };
  }
  // Ranking and grid must be named here. Neither matches a branch above, so both used to fall
  // to the date parser at the bottom and report `answered: 0` — a whole question type shown as
  // unanswered on the stats screen while the rows sat in the table, the same default-case trap
  // validateAnswer hit.
  if (question.kind === 'ranking') {
    return { ...base, ranking: rankingSummary(choices, mine) };
  }
  if (question.kind === 'grid') {
    const rows = Array.isArray(question.config?.rows) ? question.config.rows.map((r) => String(r ?? '')) : [];
    return { ...base, grid: gridSummary(rows, choices, mine) };
  }
  const dates = mine.map((a) => a.date).filter(Boolean).map((d) => new Date(d)).sort((a, b) => a - b);
  return { ...base, answered: dates.length, earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null };
}
