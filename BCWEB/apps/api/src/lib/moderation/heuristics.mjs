// Shape heuristics: what a message looks like, independent of what it says.
//
// Each one is a weak signal on purpose. A message in capitals is somebody who is angry or
// whose caps lock is on; it only matters next to three other things. Weights are defaults the
// admin can change per rule id.
import { countInvisible, countCombining } from './text.mjs';

/**
 * @param text   the raw text
 * @param opts   { discord: boolean } (Discord mention syntax)
 * @returns [{ rule, weight, detail }]
 */
export function heuristics(text, opts = {}) {
  const s = String(text || '');
  const out = [];
  if (!s) return out;

  const letters = s.match(/\p{L}/gu) || [];
  if (letters.length >= 20) {
    const upper = letters.filter((c) => c !== c.toLowerCase()).length;
    const ratio = upper / letters.length;
    if (ratio >= 0.7) out.push({ rule: 'heur.caps', weight: 10, detail: `${Math.round(ratio * 100)}% capitals` });
  }

  // The same character 12+ times in a row, or the same word 6+ times. Separator characters
  // (----, ====, ####) are left out: bug reports and logs are full of them.
  const run = s.match(/([^\s\-=_*#.~+/\\|])\1{11,}/su);
  if (run) out.push({ rule: 'heur.repetition', weight: 15, detail: `"${run[1]}" ×${run[0].length}` });
  else {
    const words = s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
    if (words.length >= 8) {
      const freq = new Map();
      for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
      const [top, n] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n >= 6 && n / words.length >= 0.4) out.push({ rule: 'heur.repetition', weight: 15, detail: `"${top.slice(0, 20)}" ×${n}` });
    }
  }

  // Zalgo: stacked combining marks. Accented text has about one mark per accented letter; zalgo
  // has several per letter.
  const marks = countCombining(s);
  if (marks >= 12 && marks / Math.max(1, letters.length) >= 0.5) out.push({ rule: 'heur.zalgo', weight: 25, detail: `${marks} combining marks` });

  const invisible = countInvisible(s);
  if (invisible >= 3) out.push({ rule: 'heur.invisible', weight: 20, detail: `${invisible} invisible characters` });

  // Mass mentions. On Discord the syntax is <@id> / <@&role> and @everyone / @here; on the
  // site an @name token.
  const everyone = /@(?:everyone|here)\b/i.test(s);
  const mentions = opts.discord ? (s.match(/<@[!&]?\d{5,}>/g) || []).length : (s.match(/(?<![\w.])@[\w.-]{2,32}/g) || []).length;
  if (everyone) out.push({ rule: 'heur.mass_mentions', weight: 30, detail: '@everyone / @here' });
  else if (mentions >= (opts.discord ? 5 : 8)) out.push({ rule: 'heur.mass_mentions', weight: 30, detail: `${mentions} mentions` });

  return out;
}
