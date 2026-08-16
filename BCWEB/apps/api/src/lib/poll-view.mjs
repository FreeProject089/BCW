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
 * A poll's questions, in sort order, as the client may see them.
 *
 * Exported so the existing single-question endpoint and the multi-question reader shape them
 * the SAME way. Writing this twice is how the staff-only tally leak happened: two copies of one
 * rule that agreed until they didn't, and neither looked wrong on its own.
 */
export function viewQuestions(poll) {
    return (poll?.questions || [])
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
        }));
}

/**
 * This viewer's OWN answers, shaped the way the form renders them.
 *
 * Without it a form poll could be answered again and again: `myVotes` is built from PollVote,
 * which the multi-question path never writes, so the page could not tell that anybody had
 * answered — it re-offered a blank form, showed no result, and each submission silently
 * replaced the last. Answering felt like it had not worked.
 *
 * Their own answers only. Returning anybody else's would turn a poll into a way to look up how
 * a named person voted, which is the one thing a poll must never become.
 *
 * The shape per kind matches exactly what the renderer holds in state, so pre-filling is an
 * assignment rather than a second interpretation of the same rows — two readings of one shape
 * is how they drift.
 */
export function viewMyAnswers(questions, rows) {
    const out = {};
    for (const q of questions || []) {
        const mine = (rows || []).filter((r) => r.questionId === q.id);
        if (!mine.length) continue;
        switch (q.kind) {
            case 'ranking':
                // Ordered by the rank itself, not by insertion: the rows come back in
                // whatever order the database returns them.
                out[q.id] = mine.slice().sort((a, b) => (a.number ?? 0) - (b.number ?? 0)).map((r) => r.choiceId);
                break;
            case 'grid':
                out[q.id] = Object.fromEntries(mine.map((r) => [r.slot ?? 0, r.choiceId]));
                break;
            case 'choice':
                // A multiple-choice question is several rows and an array; a single one is a
                // bare id. The renderer branches on exactly that.
                out[q.id] = q.config?.multiple ? mine.map((r) => r.choiceId) : mine[0].choiceId;
                break;
            case 'text': out[q.id] = mine[0].text ?? ''; break;
            case 'scale': case 'number': out[q.id] = mine[0].number; break;
            case 'date': out[q.id] = mine[0].date ? new Date(mine[0].date).toISOString().slice(0, 10) : ''; break;
            default: break;   // a note has no answer, and nothing else should reach here
        }
    }
    return out;
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
        questions: viewQuestions(poll),
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
