// Is this a valid answer to this question?
//
// Pulled out as a pure function because the vote endpoint is the one place a poll takes
// untrusted input, and "the client already checks it" is how a required question gets skipped
// and a scale gets a 999. The endpoint must not be the only thing that knows these rules.
//
// Returns { ok: true, value } with the value COERCED into the one column its kind uses, or
// { ok: false, error } with a machine-readable reason. Never throws: a bad answer is an
// expected outcome of taking input from the internet, not an exception.

/** Exactly one column per kind — the same mapping PollAnswer's four typed columns encode. */
export const COLUMN_FOR_KIND = {
    choice: 'choiceId',
    text: 'text',
    scale: 'number',
    number: 'number',
    date: 'date',
    // ranking sets choiceId AND number — see the note on PollAnswer in schema.prisma. It is
    // listed here so an unknown-kind check does not reject it, and handled by validateRanking
    // rather than validateAnswer, because its errors are properties of the whole list.
    ranking: 'number',
};

/**
 * A ranking submission: the choice ids in the order the person put them.
 *
 * Validated as a WHOLE rather than one answer at a time, because the errors are properties of
 * the list — a duplicate, a stranger, a short list — and none of them is visible from a single
 * item. Returns rows ready for PollAnswer: choiceId says which, number says what rank.
 *
 * Rank starts at 1. Zero-based ranks read as "0th place" on every screen that shows them, and
 * somebody would eventually add 1 in one place and forget in another.
 */
export function validateRanking(order, choiceIds, { required = false } = {}) {
    if (!Array.isArray(order) || !order.length) {
        return required ? { ok: false, error: 'required' } : { ok: true, rows: [] };
    }
    const seen = new Set();
    for (const raw of order) {
        const id = String(raw);
        // A duplicate would give one item two ranks and silently shift everything below it.
        if (seen.has(id)) return { ok: false, error: 'duplicate_choice', choiceId: id };
        // Membership of THIS question, same reason as validateAnswer: an id from another
        // question is a real row and would file a rank under something nobody ranked.
        if (!choiceIds.includes(id)) return { ok: false, error: 'unknown_choice', choiceId: id };
        seen.add(id);
    }
    // A partial ranking is refused. "Rank these five" answered with two is not a ranking of
    // five, and averaging ranks across submissions that ranked different subsets compares
    // numbers that do not mean the same thing.
    if (seen.size !== choiceIds.length) {
        return { ok: false, error: 'incomplete_ranking', expected: choiceIds.length, got: seen.size };
    }
    return { ok: true, rows: order.map((id, i) => ({ choiceId: String(id), number: i + 1 })) };
}

/**
 * How a `scale` is drawn. Presentation only — never a kind of its own.
 *
 * "Five stars" and "rate it 1 to 5" are the same question with the same answer in the same
 * column; making stars a KIND would fork the validation, the aggregate and the storage rule for
 * a choice of glyph, and the two copies would drift the way every other duplicated rule in this
 * codebase has. So it rides in `config.style`, and anything unknown falls back to the plain
 * number input rather than rendering nothing.
 */
export const SCALE_STYLES = ['number', 'stars', 'buttons'];
export const scaleStyle = (q) => (SCALE_STYLES.includes(q?.config?.style) ? q.config.style : 'number');

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * @param question {{ kind, required, config }} — config is the per-kind Json on PollQuestion
 * @param raw      the value as it arrived
 * @param choiceIds the ids of this question's choices, for `choice` only
 */
export function validateAnswer(question, raw, choiceIds = []) {
    const kind = String(question?.kind || 'choice');
    const cfg = question?.config || {};
    const column = COLUMN_FOR_KIND[kind];
    if (!column) return { ok: false, error: 'unknown_kind' };

    // Blank is the ONLY place `required` is consulted. A required question refuses an empty
    // answer; an optional one accepts it and stores nothing — which is different from storing
    // an empty string, because "skipped" and "answered with nothing" are different facts and
    // the completion funnel counts them differently.
    if (isBlank(raw)) {
        return question?.required ? { ok: false, error: 'required' } : { ok: true, value: null, column };
    }

    // Ranking never comes through here. Its column resolves, so it passes the unknown-kind
    // check above and would fall all the way to the date branch at the bottom and be parsed as
    // a date — a whole answer type quietly mangled by the default case. It is validated as a
    // list by validateRanking, and reaching this point with one is a caller bug worth naming.
    if (kind === 'ranking') return { ok: false, error: 'use_validate_ranking' };

    if (kind === 'choice') {
        const id = String(raw);
        // Membership, not existence. A choice id from ANOTHER question is a real row, so a
        // check that only asked "does this id exist" would accept it and file the answer under
        // a question nobody answered.
        if (!choiceIds.includes(id)) return { ok: false, error: 'unknown_choice' };
        return { ok: true, value: id, column };
    }

    if (kind === 'text') {
        const s = String(raw);
        const max = Number(cfg.maxLength) > 0 ? Number(cfg.maxLength) : 2000;
        // Truncating silently would store something the person did not write and show it back
        // to them as their own answer.
        if (s.length > max) return { ok: false, error: 'too_long' };
        return { ok: true, value: s, column };
    }

    if (kind === 'scale' || kind === 'number') {
        // The TYPE gate comes first, and it is the point. Number([]) is 0 and Number([5]) is 5,
        // so a JSON body sending `[]` or `[5]` where a number belongs would sail through any
        // amount of isNaN checking and record an answer nobody gave. Only a number or a string
        // is a number here; a caller sending anything else has a bug, not a value.
        if (typeof raw !== 'number' && typeof raw !== 'string') return { ok: false, error: 'not_a_number' };
        const n = Number(raw);
        if (!Number.isFinite(n)) return { ok: false, error: 'not_a_number' };
        const min = cfg.min === undefined || cfg.min === null ? null : Number(cfg.min);
        const max = cfg.max === undefined || cfg.max === null ? null : Number(cfg.max);
        if (min !== null && n < min) return { ok: false, error: 'below_min' };
        if (max !== null && n > max) return { ok: false, error: 'above_max' };
        if (kind === 'scale' && !Number.isInteger(n)) return { ok: false, error: 'not_an_integer' };
        return { ok: true, value: n, column };
    }

    // date
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return { ok: false, error: 'not_a_date' };
    if (cfg.min && d < new Date(cfg.min)) return { ok: false, error: 'below_min' };
    if (cfg.max && d > new Date(cfg.max)) return { ok: false, error: 'above_max' };
    return { ok: true, value: d, column };
}

/**
 * How many answers this question accepts at once.
 *
 * Only `choice` can take more than one, and only when it says so. Everything else is one, which
 * is why the caller can treat a multi-answer submission to a text question as a bug rather than
 * silently keeping the last one.
 */
export function maxAnswers(question) {
    if (String(question?.kind) !== 'choice') return 1;
    const cfg = question?.config || {};
    if (!cfg.multiple) return 1;
    const cap = Number(cfg.maxChoices);
    // 0 means no cap, matching what Poll.maxChoices has always meant.
    return Number.isFinite(cap) && cap > 0 ? cap : Infinity;
}
