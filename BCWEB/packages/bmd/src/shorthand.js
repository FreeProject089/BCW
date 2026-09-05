// The shorthands that run BEFORE the markdown parser sees the document.
//
// Plain JS and its own file, for two reasons. It is pure string work — no JSX, no DOM — so
// a gate can import it and assert on what it does, which is the only way to keep the rules
// below honest. And the rules below are the ones most likely to surprise somebody, because
// they rewrite a document that has not been parsed yet.
import { normalizeDirectiveNesting } from './nesting.js';

// [NEW] [FIXED] … → coloured chips (EN + FR spellings) — kept for update-note parity.
const BADGES = {
  NEW: 'new', NOUVEAU: 'new', FIXED: 'fixed', 'FIXÉ': 'fixed', IMPROVED: 'improved', 'AMÉLIORÉ': 'improved',
  REFINE: 'refine', RAFFINEMENT: 'refine', VISUAL: 'visual', VISUEL: 'visual', MAJOR: 'major', MAJEUR: 'major',
};
const ALERTS = {
  NOTE: 'note', REMARQUE: 'note', TIP: 'tip', ASTUCE: 'tip', IMPORTANT: 'important',
  WARNING: 'warning', AVERTISSEMENT: 'warning', CAUTION: 'caution', ATTENTION: 'caution',
};
const ALERT_TITLE = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function preprocessMd(md) {
  // Re-count `:::` fences first, so a block written the obvious way keeps its children.
  // Everything below works on lines and must not see a document mid-rewrite.
  let s = normalizeDirectiveNesting(md || '');
  // GitHub-style alerts: a run of blockquote lines whose first line is [!TYPE].
  s = s.replace(/(^|\n)((?:[ \t]*>[^\n]*(?:\n|$))+)/g, (block, lead, quote) => {
    const lines = quote.replace(/\n$/, '').split('\n').map((l) => l.replace(/^[ \t]*>[ \t]?/, ''));
    const m = lines[0].match(/^\[!(\w+)\]\s*$/i);
    if (!m) return block;
    const type = ALERTS[m[1].toUpperCase()] || 'note';
    const body = lines.slice(1).join('<br>');
    return `${lead}<div class="md-alert md-alert-${type}"><div class="md-alert-title">${ALERT_TITLE[type]}</div><div class="md-alert-body">${body}</div></div>\n`;
  });
  // Change badges. Skip fenced/inline code so `[NEW]` inside code stays literal.
  //
  // And skip a DIRECTIVE'S LABEL, which is the collision this guard exists for:
  // `:badge[NEW]{color="#0a7"}` was rewritten to `:badge<span…>NEW</span>{color="#0a7"}`
  // before remark-directive ever ran. The directive then had no label and no attributes, so
  // it rendered an EMPTY badge and spat `{color="#0a7"}` into the sentence as text.
  //
  // Two upper-case words, one bracket, two meanings — and the losing one was the explicit
  // one. It shipped in the guide, in the docs page and in the /dev playground's sample,
  // where the broken example sat under a heading explaining how badges work.
  const parts = s.split(/(```[\s\S]*?```|`[^`]*`)/g);
  s = parts.map((part, i) => (i % 2 === 1 ? part : part.replace(/\[([A-ZÀ-Ÿ]+)\]/g, (mm, w, at, whole) =>
    // `…:badge` or `…:::note` immediately before the bracket: this is a label, not a chip.
    (/:[a-zA-Z][\w-]*$/.test(whole.slice(0, at))
      ? mm
      : (BADGES[w] ? `<span class="md-badge md-badge-${BADGES[w]}">${esc(w)}</span>` : mm))))).join('');
  return s;
}
