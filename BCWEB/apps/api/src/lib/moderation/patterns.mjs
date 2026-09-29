// Admin-written regular expressions, made safe to run on untrusted text.
//
// A moderation regex runs on text an attacker wrote, and JavaScript cannot interrupt a regex
// once it has started: a pattern like `(a+)+$` against thirty "a"s and a "!" takes longer than
// the heat death of the request. So a pattern is refused at SAVE time unless it passes every
// one of these, in this order:
//
//   1. length ≤ 200, flags limited to i, m, s, u
//   2. no backreferences (\1, \k<name>): they make matching NP-hard in general
//   3. no quantified group that itself contains a quantifier or an alternation
//      ((a+)+, (a|aa)*, (\w+\s?)*): the three shapes of exponential backtracking
//   4. at most ONE unbounded quantifier (*, +, {n,}) in the whole pattern: two of them
//      (`.*foo.*bar`) are polynomial, and polynomial on 10 000 characters is still minutes
//   5. it compiles
//   6. a timed probe against adversarial inputs stays under PROBE_MS
//
// And at RUN time, on top of that: the text is matched in chunks of CHUNK characters (so even
// the one allowed quadratic is quadratic in 1 000, not in the message), and the whole pattern
// pass stops when the per-message budget is spent, saying so in the reasons.
//
// Plain keywords never become a regex at all: they are matched as data (text.mjs hasWord).

export const LIMITS = Object.freeze({ maxLen: 200, maxPatterns: 200, probeMs: 20, budgetMs: 25, chunk: 1000, overlap: 100, maxChunks: 10 });

/** Does the pattern contain a quantified group with a quantifier or an alternation inside,
 *  and how many unbounded quantifiers does it have? A small scanner rather than a regex over
 *  the regex, because character classes and escapes change what every character means. */
export function analyseShape(src) {
  const stack = [];
  let inClass = false;
  let unbounded = 0;
  let nested = false;
  const quantAt = (i) => {
    const c = src[i];
    if (c === '*' || c === '+') return { unbounded: true, len: 1 };
    if (c === '?') return { unbounded: false, len: 1 };
    if (c === '{') {
      const m = /^\{(\d*)(,?)(\d*)\}/.exec(src.slice(i));
      if (m && (m[1] || m[3])) return { unbounded: m[2] === ',' && !m[3], len: m[0].length };
    }
    return null;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(') {
      stack.push({ q: false, alt: false });
      // Skip the group-type prefix so its "?" is not read as a quantifier.
      if (src[i + 1] === '?') {
        if (src[i + 2] === '<' && src[i + 3] !== '=' && src[i + 3] !== '!') { const end = src.indexOf('>', i); i = end === -1 ? i + 2 : end; }
        else i += (src[i + 2] === '<' ? 3 : 2);
      }
      continue;
    }
    if (c === ')') {
      const g = stack.pop() || { q: false, alt: false };
      const q = quantAt(i + 1);
      // `?` (zero or one) on a group is harmless; any repetition of a group that can itself
      // match in several ways is the exponential shape, bounded ({10}) or not.
      if (q && src[i + 1] !== '?' && (g.q || g.alt)) nested = true;
      if (q?.unbounded) unbounded++;
      if (stack.length && (g.q || q)) stack[stack.length - 1].q = true;
      if (q) { i += q.len; if (src[i + 1] === '?') i++; }
      continue;
    }
    if (c === '|') { if (stack.length) stack[stack.length - 1].alt = true; continue; }
    const q = quantAt(i);
    if (q) {
      if (q.unbounded) unbounded++;
      if (stack.length) stack[stack.length - 1].q = true;
      i += q.len - 1;
      if (src[i + 1] === '?') i++; // lazy modifier
    }
  }
  return { nested, unbounded };
}

/** Inputs that make a backtracking engine work hardest, built partly from the pattern's own
 *  literal characters (a pattern about "a" is slow on "aaaa…", not on "zzzz…"). */
function probes(src) {
  const lits = [...new Set(src.replace(/\\./g, '').replace(/[^\p{L}\p{N}\s]/gu, ''))].slice(0, 6).join('') || 'a';
  const n = LIMITS.chunk;
  return [
    'a'.repeat(n), `${'a'.repeat(n - 1)}!`, ' '.repeat(n), `${lits.repeat(Math.ceil(n / lits.length)).slice(0, n)}!`,
    `${'ab'.repeat(n / 2)}`, `${'1'.repeat(n - 1)}x`, `${'é'.repeat(n)}`,
  ];
}

/**
 * Check and compile one pattern. Never throws.
 * @returns {{ ok: true, re: RegExp, flags: string } | { ok: false, error: string }}
 */
export function compilePattern(src, flags = 'i', { probe = true } = {}) {
  if (typeof src !== 'string' || !src.trim()) return { ok: false, error: 'empty' };
  if (src.length > LIMITS.maxLen) return { ok: false, error: 'too_long' };
  const f = [...new Set(String(flags || ''))].filter((c) => 'imsu'.includes(c)).join('');
  if (/\\[1-9]|\\k</.test(src)) return { ok: false, error: 'backreference' };
  const shape = analyseShape(src);
  if (shape.nested) return { ok: false, error: 'nested_quantifier' };
  if (shape.unbounded > 1) return { ok: false, error: 'too_many_unbounded' };
  let re;
  try { re = new RegExp(src, f); } catch { return { ok: false, error: 'invalid' }; }
  // A pattern that matches the empty string matches every message.
  if (re.test('')) return { ok: false, error: 'matches_empty' };
  if (!probe) return { ok: true, re, flags: f };
  const t0 = performance.now();
  for (const s of probes(src)) {
    re.lastIndex = 0;
    re.test(s);
    if (performance.now() - t0 > LIMITS.probeMs) return { ok: false, error: 'too_slow' };
  }
  return { ok: true, re, flags: f };
}

/** The text in overlapping chunks (see top). */
export function chunks(text) {
  const s = String(text || '');
  if (s.length <= LIMITS.chunk) return [s];
  const out = [];
  for (let at = 0; at < s.length && out.length < LIMITS.maxChunks; at += LIMITS.chunk - LIMITS.overlap) out.push(s.slice(at, at + LIMITS.chunk));
  return out;
}

/**
 * Run compiled patterns over a text within the time budget.
 * @param list  [{ id, re, weight, label }]
 * @returns {{ hits: [{ id, weight, label, sample }], exhausted: boolean }}
 */
export function runPatterns(list, text, budgetMs = LIMITS.budgetMs) {
  const hits = [];
  const parts = chunks(text);
  const t0 = performance.now();
  for (const p of list) {
    if (performance.now() - t0 > budgetMs) return { hits, exhausted: true };
    for (const part of parts) {
      p.re.lastIndex = 0;
      const m = p.re.exec(part);
      if (m) { hits.push({ id: p.id, weight: p.weight, label: p.label, sample: String(m[0]).slice(0, 80) }); break; }
    }
  }
  return { hits, exhausted: false };
}
