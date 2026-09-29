// Text normalisation for the moderation engine: the one place that decides what "the same
// words" means, so the keyword lists, the duplicate detector and the lookalike-domain check
// all agree on it.
//
// Three views of a text, from strict to loose:
//
//   folded    NFKC, lower case, combining marks and invisible characters removed, the common
//             Cyrillic/Greek lookalikes mapped to Latin. What a keyword is matched against.
//   skeleton  folded, then leetspeak digits mapped to letters, everything that is not a
//             letter dropped and runs of the same letter collapsed. "Fr33  N1TRO!!" and
//             "free nitro" have the same skeleton. What the loose duplicate hash and the
//             brand lookalike check use.
//   hashes    sha1 of both, for the duplicate detector. Never the text itself.
//
// Pure functions, no dependencies: everything here is unit-tested without a database.
import crypto from 'node:crypto';

/** Zero-width, bidi overrides, soft hyphen, word joiners, BOM: characters that change how a
 *  text is read or matched without changing how it looks. */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁦-⁩ㅤ﻿ﾠ]/g;

/** Scripts that only look Latin. Not the full Unicode confusables table (tens of thousands of
 *  rows): the letters phishing and keyword evasion actually use. */
const CONFUSABLE = {
  // Cyrillic
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
  'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'һ': 'h', 'ӏ': 'l', 'ո': 'n', 'ց': 'g', 'ս': 'u',
  // Greek
  'α': 'a', 'β': 'b', 'γ': 'y', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w',
  // Latin extensions and symbols that pass for letters
  'ɡ': 'g', 'ı': 'i', 'ł': 'l', 'ø': 'o', 'ß': 'ss', 'ǀ': 'l', 'ℓ': 'l',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE).join('')}]`, 'g');
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's' };

/** How many invisible characters the text carries. */
export function countInvisible(text) {
  return (String(text || '').match(INVISIBLE) || []).length;
}

/** How many combining marks: the raw material of "zalgo" text. */
export function countCombining(text) {
  return (String(text || '').normalize('NFD').match(/\p{M}/gu) || []).length;
}

/** Folded form (see top). */
export function fold(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(CONFUSABLE_RE, (c) => CONFUSABLE[c] || c)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Skeleton form (see top). */
export function skeleton(text) {
  return fold(text)
    .replace(/[0-9@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** The two duplicate hashes. Both are null for texts too short to mean anything as a
 *  duplicate ("ok", "thanks, fixed it"): two people saying thanks is not a spam campaign. */
export function textHashes(text) {
  const f = fold(text);
  const s = skeleton(text);
  return {
    exact: f.length >= 30 ? sha1(`e:${f}`).slice(0, 32) : null,
    loose: s.length >= 24 ? sha1(`l:${s}`).slice(0, 32) : null,
  };
}

/** Is `term` present in folded `hay` as a whole word (or phrase)? A manual boundary check
 *  rather than a regex built from admin input: the term is data, never a pattern. */
export function hasWord(hay, term) {
  if (!term) return false;
  const isW = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
  let at = hay.indexOf(term);
  while (at !== -1) {
    if (!isW(hay[at - 1]) && !isW(hay[at + term.length])) return true;
    at = hay.indexOf(term, at + 1);
  }
  return false;
}

/** Levenshtein distance with an early exit above `max` (the lookalike check only ever asks
 *  "is it within 1 or 2"). */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** A short excerpt for the review queue: invisible characters shown, length capped. */
export function excerptOf(text, max = 2000) {
  const s = String(text || '').replace(INVISIBLE, (c) => `[U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
