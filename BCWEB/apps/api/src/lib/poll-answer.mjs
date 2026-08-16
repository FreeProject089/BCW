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
    // grid stores the picked COLUMN in choiceId and the ROW in `slot`, not in `number`. The
    // design said `number` and the design was wrong: the unique key is (question, voter,
    // choice), and a grid repeating a column across two rows is the normal case, so the row has
    // to live in a column the KEY can see. Whole-submission validation, like ranking.
    grid: 'choiceId',
};

/** The kinds whose errors are properties of the whole submission, not of one answer. */
export const WHOLE_SUBMISSION_KINDS = { ranking: 'use_validate_ranking', grid: 'use_validate_grid' };

/**
 * Kinds that are CONTENT, not questions: a heading, an explanation, a warning before the part
 * that matters. They take no answer and have no column.
 *
 * Deliberately NOT given a column in COLUMN_FOR_KIND rather than a null one. That map answers
 * "where does this answer go", and an entry meaning "nowhere" makes every reader of it handle
 * a case that is not an answer at all. Kept separate so `isAnswerable` is the single question
 * the endpoint, the stats and the completion funnel all ask.
 */
export const CONTENT_KINDS = ['note'];
export const isAnswerable = (kind) => !CONTENT_KINDS.includes(String(kind));

/** Every kind a question may be — answerable or not. The admin editor's allowlist. */
export const ALL_QUESTION_KINDS = [...Object.keys(COLUMN_FOR_KIND), ...CONTENT_KINDS];

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
 * A grid's rows. Labels, not answerable things, so they live in config rather than a table.
 *
 * Anything that is not a list of usable labels reads as "no rows", which makes a malformed grid
 * answerable-by-nobody rather than answerable-wrongly.
 */
export function gridRows(question) {
    const rows = question?.config?.rows;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => String(r ?? '')).filter((r) => r.trim() !== '');
}

/**
 * A grid submission: which COLUMN was picked for each ROW.
 *
 * Input is a list of `{ row, choiceId }` rather than an object keyed by row, on purpose. An
 * object makes "the same row twice" unrepresentable, which sounds like a feature until you
 * realise it also makes it undetectable — a client that sends a row twice is broken, and the
 * shape that can say so is the shape that can refuse it.
 *
 * Validated as a whole for the same reason as a ranking: a missing row is not visible from any
 * single answer. Rows are indices from 0 into `config.rows`; columns are the question's choices.
 * The result rows carry `slot`, not `number` — see COLUMN_FOR_KIND for why that matters.
 *
 * Every row must be answered when `config.requireAllRows` says so — and it defaults to the
 * question's own `required`, because "you must answer this grid" and "you must answer every row
 * of it" are the same thing to everyone except the person who wrote the config.
 */
export function validateGrid(entries, question, choiceIds = []) {
    const rows = gridRows(question);
    const cfg = question?.config || {};
    const requireAll = cfg.requireAllRows === undefined ? !!question?.required : !!cfg.requireAllRows;

    if (!Array.isArray(entries) || !entries.length) {
        return question?.required ? { ok: false, error: 'required' } : { ok: true, rows: [] };
    }
    // A grid with no rows can be answered by nothing, so an answer to one is an answer to a
    // question that does not exist. Refusing beats storing rows nobody can ever read back.
    if (!rows.length) return { ok: false, error: 'no_rows' };

    const seen = new Set();
    const out = [];
    for (const raw of entries) {
        const row = raw?.row;
        // A row index must arrive AS a number — not as something Number() is willing to turn
        // into one. `null` and `[]` both become 0, so a gate written as
        // `!Number.isInteger(Number(row))` accepts them and files every malformed entry under
        // row 0, where the duplicate check then blames the client's second honest answer. The
        // renderer computes this index; nobody types it, so there is no string form to accept.
        if (!Number.isInteger(row)) return { ok: false, error: 'bad_row', row };
        if (row < 0 || row >= rows.length) return { ok: false, error: 'unknown_row', row };
        // Two answers for one row means one of them silently wins, and which one depends on
        // insertion order at write time.
        if (seen.has(row)) return { ok: false, error: 'duplicate_row', row };
        const id = String(raw?.choiceId ?? '');
        // Membership of THIS question, same reason as everywhere else: an id from another
        // question is a real row and would file a pick under a column nobody offered.
        if (!choiceIds.includes(id)) return { ok: false, error: 'unknown_choice', choiceId: id, row };
        seen.add(row);
        out.push({ choiceId: id, slot: row });
    }

    // Averaging a column across people who filled different rows compares numbers that do not
    // mean the same thing — the same trap a partial ranking sets.
    if (requireAll && seen.size !== rows.length) {
        return { ok: false, error: 'incomplete_grid', expected: rows.length, got: seen.size };
    }
    return { ok: true, rows: out };
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
    // Content, not a question. Answering one is a caller bug rather than a bad answer, and
    // saying so beats `unknown_kind`, which would send somebody looking for a typo.
    if (!isAnswerable(kind)) return { ok: false, error: 'not_a_question' };
    const column = COLUMN_FOR_KIND[kind];
    if (!column) return { ok: false, error: 'unknown_kind' };

    // Blank is the ONLY place `required` is consulted. A required question refuses an empty
    // answer; an optional one accepts it and stores nothing — which is different from storing
    // an empty string, because "skipped" and "answered with nothing" are different facts and
    // the completion funnel counts them differently.
    if (isBlank(raw)) {
        return question?.required ? { ok: false, error: 'required' } : { ok: true, value: null, column };
    }

    // Ranking and grid never come through here. Their column resolves, so they pass the
    // unknown-kind check above and would fall all the way to the date branch at the bottom and
    // be parsed as dates — a whole answer type quietly mangled by the default case. They are
    // validated as lists, and reaching this point with one is a caller bug worth naming.
    if (WHOLE_SUBMISSION_KINDS[kind]) return { ok: false, error: WHOLE_SUBMISSION_KINDS[kind] };

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
