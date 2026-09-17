// Reading an amount a human typed.
//
// Every "how many points?" box in the bot used to do the same one-liner:
//
//     Number(String(raw).replace(/[^0-9]/g, ''))
//
// which is not a parser: it deletes the characters that carry the MEANING and then trusts
// what is left. Three ways that silently places a bet nobody asked for —
//
//   · `2.5`  → `25`   — ten times the intended bet, no error, no confirmation;
//   · `1,5`  → `15`   — the French decimal comma, the same accident in the language most of
//                       this bot's readers use;
//   · `-50`  → `50`   — a sign is "not a digit", so it is simply dropped;
//   · `50%`  → `50`   — a percentage of the balance read as fifty flat points.
//
// The same strip is what makes the box look like it accepts words: it does not, it just
// throws them away and keeps whatever digits were nearby (`bet 20 max` → 20).
//
// So: one parser, which understands what people actually type, and which REFUSES what it
// cannot read instead of inventing a number. It never clamps — the caller owns min/max — and
// it never rounds up: an amount is floored, so a misread can only ever cost less, never more.
//
// Returns `{ ok: true, kind, value, pct }` or `{ ok: false, reason }`:
//   kind 'abs'  — a plain amount (`value`)
//   kind 'pct'  — a percentage of the balance (`pct`, plus `value` when a balance was given)
//   kind 'all'  — "everything I have" (the caller's own all-in path, cap included)
//   reason      — 'empty' | 'nan' | 'pct' | 'nobalance'

/** Group separators people type or paste: spaces (incl. NBSP / narrow NBSP / thin), apostrophes, underscores. */
const GROUP = /[\s   '’_]/g;
/** "everything", in the four languages the bot speaks, plus what the cards themselves say. */
const ALL_IN = /^(all|allin|all-in|max|maximum|tapis|todo|alles)$/;

/**
 * A digit string with group separators and/or ONE decimal separator, as a number.
 *
 * `,` and `.` are both group separator and decimal point depending on where you live, so the
 * position decides, not the character: the last one wins when both appear, and a lone
 * separator followed by exactly three digits is a group separator (`1,500` is fifteen
 * hundred — which is also what `n()` prints, so pasting the balance back in works).
 * Anything else is a decimal point, so `2.5` and `1,5` both mean two and a half.
 */
function toNumber(body) {
  if (!/\d/.test(body)) return null;
  const commas = (body.match(/,/g) || []).length;
  const dots = (body.match(/\./g) || []).length;
  let dec = null;
  if (commas && dots) dec = body.lastIndexOf(',') > body.lastIndexOf('.') ? ',' : '.';
  else if (commas === 1 && !/,\d{3}(?!\d)/.test(body)) dec = ',';
  else if (dots === 1 && !/\.\d{3}(?!\d)/.test(body)) dec = '.';
  let intPart = body, frac = '';
  if (dec) { const k = body.lastIndexOf(dec); intPart = body.slice(0, k); frac = body.slice(k + 1); }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  const v = Number(`${intPart || '0'}.${frac || '0'}`);
  return Number.isFinite(v) ? v : null;
}

/**
 * @param {string} input   what the player typed
 * @param {object} [opts]
 * @param {number|null} [opts.balance] the player's balance, so a percentage can be resolved
 */
export function parseAmount(input, { balance = null } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const s = raw.toLowerCase().replace(GROUP, '');
  if (ALL_IN.test(s)) return { ok: true, kind: 'all', value: null, pct: 100 };
  const isPct = s.endsWith('%');
  const body = isPct ? s.slice(0, -1) : s;
  // A sign, a letter, an `e`, a `k` suffix: none of them are digits, and none of them are
  // silently droppable. `-50` is not a bet and `20k` is not twenty.
  if (!body || /[^0-9.,]/.test(body)) return { ok: false, reason: 'nan' };
  const num = toNumber(body);
  if (num === null) return { ok: false, reason: 'nan' };
  if (!isPct) return { ok: true, kind: 'abs', value: Math.floor(num), pct: null };
  if (!(num > 0) || num > 100) return { ok: false, reason: 'pct' };
  if (num === 100) return { ok: true, kind: 'all', value: null, pct: 100 };
  const bal = Number(balance);
  if (!Number.isFinite(bal)) return { ok: true, kind: 'pct', value: null, pct: num };
  return { ok: true, kind: 'pct', value: Math.max(0, Math.floor((bal * num) / 100)), pct: num };
}

/**
 * The same parse, resolved to a number of points against a balance and a cap — for the
 * callers that have both to hand. `null` when the text could not be read.
 */
export function resolveAmount(input, { balance = 0, max = Infinity } = {}) {
  const r = parseAmount(input, { balance });
  if (!r.ok) return null;
  const bal = Math.max(0, Math.floor(Number(balance) || 0));
  if (r.kind === 'all') return Math.min(max, bal);
  if (r.kind === 'pct') return Math.min(max, Math.max(0, Math.floor((bal * r.pct) / 100)));
  return r.value;
}

/**
 * A whole number in a closed range, or `null`. The roulette box used the same digit-strip, so
 * `-1` became `1` and `3.7` became `37` — a number outside the wheel, silently kept.
 */
export function parseWholeInRange(input, lo, hi) {
  const s = String(input ?? '').trim().replace(GROUP, '');
  if (!/^\d+$/.test(s)) return null;
  const v = Number(s);
  return Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}

/**
 * A CHOICE, validated against the list that was actually offered — the other half of the same
 * mistake. `cl:pick` did `Number(raw)` with nothing to compare it to, so a hand-made custom id
 * (or a stale card) could seat a player on a car that does not exist, or on `NaN`, which then
 * loses every round in silence.
 */
export function parseChoice(raw, allowed) {
  if (!Array.isArray(allowed) || !allowed.length) return null;
  const numeric = typeof allowed[0] === 'number';
  if (raw == null || raw === '') return null;
  const v = numeric ? Number(raw) : String(raw);
  if (numeric && !Number.isFinite(v)) return null;
  return allowed.includes(v) ? v : null;
}
