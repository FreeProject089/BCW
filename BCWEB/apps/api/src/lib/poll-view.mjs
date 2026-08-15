// What a given viewer is allowed to see of a poll.
//
// Separated from the route because the interesting half is not the shaping, it is the rule
// about the TALLY — and that rule has consequences. Showing a running total before somebody
// answers steers the answer, which is why `after_vote` is the default; `staff` means the
// numbers are not public at all. Getting this wrong does not throw, it just quietly publishes
// something, so it belongs somewhere it can be tested.
//
// An allowlist, like the rest of this API's serialisers: a field that is not named here never
// reaches the client. A new column is invisible until someone adds it on purpose, which is the
// failure direction to prefer.

/** Can this viewer see the numbers? */
export function maySeeResults(poll, viewer = {}) {
    const rule = String(poll?.results || 'after_vote');
    if (viewer.isStaff) return true;              // staff see every tally, by definition of the rule
    if (rule === 'staff') return false;           // …and nobody else does
    if (rule === 'always') return true;
    // 'after_vote' — and a CLOSED poll counts as having been answered by everyone who was
    // going to. Withholding the result of a poll nobody can vote in any more protects nothing
    // and just looks broken.
    if (String(poll?.status) === 'closed') return true;
    return Boolean(viewer.hasVoted);
}

/**
 * The poll as this viewer should receive it.
 *
 * `tally` is omitted entirely rather than zeroed when it may not be shown. Zeros are a claim —
 * "nobody has voted" — and a client that renders them shows a false result rather than no
 * result.
 */
export function viewPoll(poll, viewer = {}, tally = null) {
    const showResults = maySeeResults(poll, viewer);
    const out = {
        id: poll.id,
        title: poll.question,
        description: poll.description || '',
        status: poll.status,
        multiple: Boolean(poll.multiple),
        maxChoices: poll.maxChoices ?? 0,
        opensAt: poll.opensAt ?? null,
        closesAt: poll.closesAt ?? null,
        pinned: Boolean(poll.pinned),
        canVote: canVote(poll, viewer),
        showResults,
        questions: (poll.questions || [])
            .slice()
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
            .map((q) => ({
                id: q.id,
                kind: q.kind,
                label: q.label,
                help: q.help || '',
                required: Boolean(q.required),
                sort: q.sort ?? 0,
                config: q.config ?? {},
                showIf: q.showIf ?? null,
                choices: (q.choices || [])
                    .slice()
                    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
                    .map((c) => ({ id: c.id, label: c.label, sort: c.sort ?? 0 })),
            })),
    };
    if (showResults && tally) out.tally = tally;
    return out;
}

/**
 * May this viewer answer right now?
 *
 * Time is passed in rather than read, so a test can state the moment instead of arranging for
 * it — and so two calls in one request cannot straddle a boundary and disagree.
 */
export function canVote(poll, viewer = {}, now = new Date()) {
    if (String(poll?.status) !== 'open') return false;
    if (poll?.opensAt && new Date(poll.opensAt) > now) return false;
    if (poll?.closesAt && new Date(poll.closesAt) <= now) return false;
    // 'users' means signed-in only. Anonymous voters are identified by a device key, which is
    // a deterrent and not an identity, so a poll can say it wants accounts.
    if (String(poll?.audience) === 'users' && !viewer.userId) return false;
    return !viewer.hasVoted;
}
