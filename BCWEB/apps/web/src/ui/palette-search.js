// The matcher behind ⌘K. Pure data in, pure data out: no React, no DOM, no i18n — so it can
// be unit-tested and benchmarked from plain node, which is how the numbers in the report were
// produced (test/palette-search.test.mjs, bench in scripts-free scratch).
//
// WHY IT IS NOT A `.includes()` FILTER
// -----------------------------------
// People do not type labels. They type what they want: "money", "dark mode", "se deconnecter",
// "hebergemnt". A substring filter answers none of those. This does four things instead:
//
//   1. every entry carries SYNONYMS (EN + FR + the words people actually use), so a concept
//      finds the page;
//   2. the query is split into tokens and EVERY token must match something — "dark mode" is
//      two constraints, not one literal string, so word order stops mattering;
//   3. ranking is ordered by how strong the evidence is: exact > title prefix > word-start >
//      title substring > synonym hit > subsequence > typo;
//   4. what you picked before wins ties, because the thing you use is the thing you meant.
//
// WHY IT IS FAST
// --------------
// The index is built ONCE (buildIndex) and queried per keystroke (searchIndex). The expensive
// part of the old code was not the scorer, it was rebuilding the candidate array — lowercasing
// and re-allocating every label on every keypress. Here that happens once.
//
// The per-keystroke win is the character bitmask. Each entry stores a 28-bit set of the
// characters it contains; a query whose characters are not a subset can be rejected with one
// AND, before a single string is touched. On a realistic list that throws away the large
// majority of entries for any query longer than two characters, and it is what keeps the
// typo pass (the only superlinear step) affordable.

// Bit 0-25 = a-z, bit 26 = a digit, bit 27 = anything else.
function charMask(s) {
  let m = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) m |= 1 << (c - 97);
    else if (c >= 48 && c <= 57) m |= 1 << 26;
    else if (c !== 32) m |= 1 << 27;
  }
  return m;
}

function popcount(n) {
  let v = n - ((n >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  return (((v + (v >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

// Accents are a matching problem, not a display one: somebody typing "hebergement" on a phone
// keyboard means "hébergement", and somebody typing "télécharger" means the same row as
// "telecharger". Both sides get folded, so neither has to guess.
export function fold(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Bounded Damerau-Levenshtein. Returns a distance, or `max + 1` as soon as it is certain the
// distance exceeds `max` — the early exit is what makes it usable per keystroke.
export function editDistance(a, b, max) {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (a === b) return 0;
  let prev2 = null;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const row = new Array(bl + 1);
    row[0] = i;
    let best = i;
    const lo = Math.max(1, i - max), hi = Math.min(bl, i + max);
    for (let j = 1; j <= bl; j++) {
      if (j < lo || j > hi) { row[j] = max + 1; continue; }
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      // transposition ("hositng" → "hosting" is one mistake, not two)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = row;
  }
  return prev[bl];
}

// How many typos we forgive, by query length. One character of slack is plenty for a short
// word and would otherwise make "doc" match "dev"; long words earn a second.
export function typoBudget(len) { return len >= 8 ? 2 : len >= 5 ? 1 : 0; }

const MAX_TOKENS = 6; // a query longer than this is pathological, not a search

/**
 * Turn the raw entries into a queryable index. Call once per (language, signed-in state),
 * NOT per keystroke.
 *
 * Each entry: { id, title, synonyms?, kind?, weight?, ...anything else you need back }.
 * Everything you pass through is handed back untouched on the result as `item`.
 */
export function buildIndex(entries) {
  const out = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const title = fold(e.title);
    const syn = fold(e.synonyms || '');
    const hay = syn ? `${title} ${syn}` : title;
    const words = title ? title.split(' ') : [];
    // Every word the entry knows, title AND synonyms, for the typo pass. A misspelling of a
    // SYNONYM is the common case in the language that is not the label's ("hebergemnt" for
    // Hosting), and comparing only against title words missed exactly those. Each word gets
    // its own character mask so the edit-distance matrix is only built for words that could
    // plausibly be it.
    const typoWords = { words: [], masks: [] };
    for (const w of new Set(hay.split(' '))) {
      if (w.length < 4) continue;
      typoWords.words.push(w);
      typoWords.masks.push(charMask(w));
    }
    out[i] = {
      item: e,
      title,
      hay,
      words,
      // The acronym, so "mp" finds "My profile" — the shortcut everybody tries once.
      initials: words.map((w) => w[0] || '').join(''),
      // Every word the entry knows, title AND synonyms, for the typo pass. A misspelling of a
      // SYNONYM is the common case in the language that is not the label's ("hebergemnt"), and
      // comparing only against title words missed exactly those.
      typoWords: typoWords.words,
      typoMasks: typoWords.masks,
      mask: charMask(hay),
      len: title.length || 1,
      weight: e.weight || 0,
    };
  }
  return out;
}

// Score one token against one indexed entry. 0 means "this token is not in here".
// `allowTypo` gates the only expensive branch — see the two-pass note in searchIndex.
function tokenScore(tok, ent, allowTypo) {
  const { title, hay, words } = ent;
  if (title === tok) return 10000;
  if (title.startsWith(tok)) return 7000 - Math.min(title.length - tok.length, 400);
  if (ent.initials.length > 1 && ent.initials.startsWith(tok) && tok.length > 1) return 6200;

  // Word-start inside the title ("profile" in "My profile") beats a substring anywhere.
  for (let i = 0; i < words.length; i++) if (words[i].startsWith(tok)) return 5200 - i * 30;

  const ti = title.indexOf(tok);
  if (ti > 0) return 3800 - Math.min(ti, 300);

  // Synonyms: the concept layer. A word-start hit in the synonym list ("money" → Hosting) is
  // real evidence; a mid-word hit is weaker but still better than a subsequence.
  const hi = hay.indexOf(tok);
  if (hi >= 0) {
    const atWordStart = hi === 0 || hay[hi - 1] === ' ';
    const wholeWord = atWordStart && (hi + tok.length === hay.length || hay[hi + tok.length] === ' ');
    if (wholeWord) return 3200;
    if (atWordStart) return 2600;
    return 1800 - Math.min(hi, 300);
  }

  // Subsequence: "stgs" → "settings". Against the TITLE only, and deliberately so. Run over
  // the synonym blob it matched practically everything — those lists are 150 characters of
  // common letters, so almost any eight-character query is a subsequence of one, and the
  // noise it produced also hid real misspellings: "settnigs" found enough junk that the typo
  // pass below never needed to run, and the top hit was "Switch language".
  const sub = subsequence(tok, title);
  if (sub > 0) return 900 + sub;

  // Last resort: a misspelling of a real word. Only reached when nothing above matched, which
  // is what keeps this affordable.
  const budget = allowTypo ? typoBudget(tok.length) : 0;
  if (budget > 0) {
    const cand = ent.typoWords, cmask = ent.typoMasks, tmask = charMask(tok);
    let best = budget + 1;
    for (let i = 0; i < cand.length; i++) {
      const w = cand[i];
      if (Math.abs(w.length - tok.length) > budget) continue;
      // A word that is missing more distinct characters than the budget allows cannot be
      // within the budget, and this costs one AND and a popcount instead of a DP matrix.
      if (popcount(tmask & ~cmask[i]) > budget) continue;
      const d = editDistance(tok, w, budget);
      if (d < best) best = d;
      if (best === 1) break;
    }
    if (best <= budget) return 620 - (best - 1) * 140;
  }
  return 0;
}

// Ordered-character match with bonuses for contiguous runs and word starts.
function subsequence(tok, text) {
  let ti = 0, bonus = 0, prev = -2;
  for (let qi = 0; qi < tok.length; qi++) {
    const c = tok[qi];
    const found = text.indexOf(c, ti);
    if (found === -1) return 0;
    if (found === 0 || text[found - 1] === ' ') bonus += 26;
    if (found === prev + 1) bonus += 14;
    prev = found; ti = found + 1;
  }
  return bonus;
}

/**
 * Query the index.
 *
 * `recent` is an array of ids, most-recent first: a thing you picked before outranks a thing
 * you never have, which is most of the ranking people actually notice.
 * `limit` caps what comes back — the list is capped anyway, and sorting 2000 rows to show 8
 * is work nobody sees.
 */
export function searchIndex(index, rawQuery, opts = {}) {
  const limit = opts.limit || 24;
  const recent = opts.recent || [];
  const recentRank = new Map();
  for (let i = 0; i < recent.length; i++) if (!recentRank.has(recent[i])) recentRank.set(recent[i], i);

  const q = fold(rawQuery);
  if (!q) {
    // No query: recency first, then the declared weight, then declaration order.
    const all = index.map((ent, i) => ({
      item: ent.item,
      score: 100000 - (recentRank.has(ent.item.id) ? recentRank.get(ent.item.id) * 100 : 5000) + ent.weight - i,
    }));
    all.sort((a, b) => b.score - a.score);
    return all.slice(0, limit);
  }

  const tokens = q.split(' ').filter(Boolean).slice(0, MAX_TOKENS);
  const masks = tokens.map(charMask);
  // Typo tolerance is opt-OUT per index, and the on-page index opts out. Forgiving a
  // misspelling makes sense against a fixed vocabulary of ~30 commands, where the user is
  // recalling a name. It makes no sense against a few hundred strings scraped off the screen
  // in front of them: they can SEE the words, the fuzzy hits are noise, and it is the one
  // place where the cost is multiplied by the corpus size.
  const canTypo = opts.typo !== false && tokens.some((tk) => typoBudget(tk.length) > 0);

  // TWO PASSES, and this is where the per-keystroke time actually went.
  //
  // Levenshtein over every word of every candidate is the one superlinear step here, and on a
  // page with a few hundred collected elements it dominated everything else — while paying
  // for a result the user almost never needs, because a query that is spelled correctly
  // already has plenty of matches. So the first pass refuses to spend it. Only when the strict
  // pass comes back nearly empty (which is exactly the "I mistyped something" case) does the
  // second pass run with the typo branch on. The user sees the same answers; the common
  // keystroke stops paying for the rare one.
  const scan = (allowTypo) => {
    const results = [];
    for (let i = 0; i < index.length; i++) {
      const ent = index[i];
      // One AND per token, before any string work. A typo budget can forgive a WRONG
      // character, so on the typo pass a mask that is off by exactly one bit still goes
      // through; on the strict pass the query's characters must all be present.
      let ok = true;
      for (let k = 0; k < tokens.length; k++) {
        const missing = masks[k] & ~ent.mask;
        if (missing === 0) continue;
        if (allowTypo && typoBudget(tokens[k].length) > 0 && (missing & (missing - 1)) === 0) continue;
        ok = false; break;
      }
      if (!ok) continue;

      let total = 0;
      for (let k = 0; k < tokens.length; k++) {
        const s = tokenScore(tokens[k], ent, allowTypo);
        if (s === 0) { total = 0; break; }
        total += s;
      }
      if (total === 0) continue;
      total = total / tokens.length;
      // Shorter titles win ties: "Blog" should beat "Blog permissions" for "blog".
      total -= Math.min(ent.len, 60) * 0.5;
      total += ent.weight;
      if (recentRank.has(ent.item.id)) total += 900 - recentRank.get(ent.item.id) * 60;
      results.push({ item: ent.item, score: total });
    }
    return results;
  };

  let results = scan(false);
  if (results.length < 3 && canTypo) results = scan(true);
  results.sort((a, b) => b.score - a.score);
  return results.length > limit ? results.slice(0, limit) : results;
}
