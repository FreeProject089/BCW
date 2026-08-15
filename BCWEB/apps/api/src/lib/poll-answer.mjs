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
};

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
