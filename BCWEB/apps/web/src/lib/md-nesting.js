// Making nested `:::` blocks mean what their author meant.
//
// remark-directive closes a container at the first fence with the SAME number of colons, so
// this — the obvious thing to write, and the thing every example of ours showed —
//
//   :::steps
//   :::step[First]
//   …
//   :::
//   :::step[Second]
//   …
//   :::
//   :::
//
// parses as: a `steps` holding ONE step, then a loose second step, then a stray fence. The
// author sees step 1 numbered and step 2 wearing a bullet, and nothing anywhere says why.
// Getting it right requires `::::steps` around `:::step` — a rule no one guesses and the
// editor never mentions.
//
// So the fences are re-counted before parsing: `:::name` opens, a bare `:::` closes the
// innermost open block, and each block is re-emitted with enough colons to outrank the
// deepest thing inside it. The author's mental model becomes the real one.
//
// Deliberately NOT applied when the source already uses 4+ colons anywhere: an author who
// wrote `::::` knows the rule, may be nesting on purpose, and must not have their document
// rewritten underneath them.

const OPEN = /^([ \t]*)(:{3,})([A-Za-z][A-Za-z0-9-]*)([\s\S]*)$/;
const CLOSE = /^([ \t]*)(:{3,})[ \t]*$/;

/**
 * Re-fence naive same-depth `:::` nesting so inner blocks stay inside their parent.
 *
 * Text inside fenced code is passed through untouched — `:::` in a code sample is a literal
 * the reader is meant to copy, and rewriting it would teach the syntax wrong.
 *
 * @param {string} src markdown
 * @returns {string} markdown with container fences re-counted
 */
export function normalizeDirectiveNesting(src) {
    const text = String(src ?? '');
    if (!text.includes(':::')) return text;

    // Split on fenced code so the walk never sees a sample. The capture group keeps the
    // fences in the array, at odd indices.
    const chunks = text.split(/(^[ \t]*(?:```|~~~)[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$)/m);
    return chunks.map((chunk, i) => (i % 2 === 1 ? chunk : rewrite(chunk))).join('');
}

function rewrite(text) {
    const lines = text.split('\n');

    // An author who already uses 4+ colons is driving manually. Leave the whole chunk alone
    // rather than half-rewriting a document that was already correct.
    for (const line of lines) {
        const m = line.match(OPEN) || line.match(CLOSE);
        if (m && m[2].length > 3) return text;
    }

    // Pass 1 — pair each opener with its closer, the way the author reads it: a bare fence
    // closes the innermost block that is still open.
    const stack = [];
    const nodes = [];            // { open, close, depth }  (line indices)
    for (let i = 0; i < lines.length; i += 1) {
        if (CLOSE.test(lines[i])) {
            const node = stack.pop();
            // A closer with nothing open is the author's typo, not ours to guess at. Left
            // exactly as written so remark reports it the same way it always has.
            if (node) node.close = i;
            continue;
        }
        if (OPEN.test(lines[i])) {
            const node = { open: i, close: -1, depth: stack.length };
            stack.push(node);
            nodes.push(node);
        }
    }
    // An unclosed block gets no rewrite: without an end, "what is inside it" is a guess.
    const closed = nodes.filter((n) => n.close >= 0);
    if (!closed.length) return text;

    // Pass 2 — height of each block: how deep the nesting goes BELOW it. A block containing
    // nothing keeps three colons; one holding a step needs four; one holding a step that
    // holds a card needs five.
    const height = new Map();
    for (let i = closed.length - 1; i >= 0; i -= 1) {
        const n = closed[i];
        let h = 0;
        for (const other of closed) {
            if (other !== n && other.open > n.open && other.close < n.close) {
                h = Math.max(h, (height.get(other) ?? 0) + 1);
            }
        }
        height.set(n, h);
    }

    const out = lines.slice();
    for (const n of closed) {
        const colons = ':'.repeat(3 + height.get(n));
        if (colons.length === 3) continue;
        out[n.open] = lines[n.open].replace(OPEN, (_, pad, __, name, rest) => `${pad}${colons}${name}${rest}`);
        out[n.close] = lines[n.close].replace(CLOSE, (_, pad) => `${pad}${colons}`);
    }
    return out.join('\n');
}
