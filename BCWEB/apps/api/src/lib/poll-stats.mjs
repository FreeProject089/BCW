// What a poll's answers actually say.
//
// The tally on the poll page answers "which option won". These are the questions you ask
// afterwards and could not: how many PEOPLE answered rather than how many boxes were ticked,
// whether it is still moving or finished days ago, and whether the result rests on enough
// answers to mean anything.
//
// Pure functions over rows, so they are testable and the numbers on a screen come from the
// same code as the numbers in an export. Nothing here reads a database.

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
