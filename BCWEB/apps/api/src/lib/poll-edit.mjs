// Deciding what an edit to a poll's questions is allowed to do.
//
// Separated from the route because the dangerous case is not the writing, it is the DELETING.
// PollAnswer cascades from PollQuestion, so replacing a poll's question set drops every answer
// to any question that goes — silently, with a 200, and with nothing to restore from.
//
// A form owner editing a typo in a question label does not expect to lose the responses. So the
// rule is stated here, tested, and the route asks it rather than deciding for itself.

/** A question is unchanged-enough to keep its answers if its id and KIND survive. */
const sameShape = (before, after) => before.kind === after.kind;

/**
 * What this edit would destroy, and whether it may proceed.
 *
 * @param existing  the poll's current questions: [{ id, kind }]
 * @param incoming  the submitted set: [{ id?, kind, ... }] — no id means "new"
 * @param answerCounts  answers per question id: { [questionId]: number }
 * @param opts.force  the caller has been told what would be lost and said yes anyway
 */
export function planQuestionUpdate(existing, incoming, answerCounts = {}, opts = {}) {
    const keptIds = new Set(incoming.map((q) => q.id).filter(Boolean));

    // Removed outright.
    const removed = existing.filter((q) => !keptIds.has(q.id));

    // Kept by id but changed KIND. The answer's value lives in a column chosen by kind, so a
    // `text` answer to a question that is now a `scale` is not a wrong answer — it is a value
    // in a column nothing will ever read again. Treated as destructive, because it is.
    const retyped = existing.filter((q) => {
        const match = incoming.find((i) => i.id === q.id);
        return match && !sameShape(q, match);
    });

    const casualties = [...removed, ...retyped];
    const answersLost = casualties.reduce((n, q) => n + (answerCounts[q.id] || 0), 0);

    // An id the poll does not own. Accepting it would move another poll's question — or create
    // one with a caller-chosen id — so it is refused rather than treated as new.
    const known = new Set(existing.map((q) => q.id));
    const foreign = incoming.filter((q) => q.id && !known.has(q.id)).map((q) => q.id);

    if (foreign.length) return { ok: false, error: 'unknown_question', ids: foreign };

    if (answersLost > 0 && !opts.force) {
        return {
            ok: false,
            error: 'would_lose_answers',
            answersLost,
            // Named, not just counted: "this deletes 12 answers" is a number to click past,
            // "this deletes the 12 answers to 'Why did you leave?'" is a decision.
            questions: casualties.map((q) => ({ id: q.id, kind: q.kind, answers: answerCounts[q.id] || 0 })),
        };
    }

    return {
        ok: true,
        removedIds: removed.map((q) => q.id),
        retypedIds: retyped.map((q) => q.id),
        answersLost,
        // Order is taken from the submitted array, not from a `sort` the caller supplies: two
        // questions claiming sort 3 is a state the UI can produce and the reader cannot resolve.
        ordered: incoming.map((q, i) => ({ ...q, sort: i })),
    };
}
