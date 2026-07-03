import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

// Shared markdown renderer — same feature set as the BMM app's update-notes
// (frontend/src/ui/update-notes.ts): inline change badges + GitHub-style alerts,
// on top of GFM (tables, task lists, strikethrough) and raw HTML (images, embeds).

// [NEW] [FIXED] [IMPROVED] … → coloured chips (EN + FR spellings).
const BADGES = {
  NEW: 'new', NOUVEAU: 'new', FIXED: 'fixed', 'FIXÉ': 'fixed', IMPROVED: 'improved', 'AMÉLIORÉ': 'improved',
  REFINE: 'refine', RAFFINEMENT: 'refine', VISUAL: 'visual', VISUEL: 'visual', MAJOR: 'major', MAJEUR: 'major',
};
// > [!NOTE] blocks → callout boxes (EN + FR spellings).
const ALERTS = {
  NOTE: 'note', REMARQUE: 'note', TIP: 'tip', ASTUCE: 'tip', IMPORTANT: 'important',
  WARNING: 'warning', AVERTISSEMENT: 'warning', CAUTION: 'caution', ATTENTION: 'caution',
};
const ALERT_TITLE = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function preprocessMd(md) {
  let s = md || '';

  // GitHub-style alerts: a run of blockquote lines whose first line is [!TYPE].
  s = s.replace(/(^|\n)((?:[ \t]*>[^\n]*(?:\n|$))+)/g, (block, lead, quote) => {
    const lines = quote.replace(/\n$/, '').split('\n').map((l) => l.replace(/^[ \t]*>[ \t]?/, ''));
    const m = lines[0].match(/^\[!(\w+)\]\s*$/i);
    if (!m) return block; // plain blockquote — leave it to the markdown parser
    const type = ALERTS[m[1].toUpperCase()] || 'note';
    const body = lines.slice(1).join('<br>');
    return `${lead}<div class="md-alert md-alert-${type}"><div class="md-alert-title">${ALERT_TITLE[type]}</div><div class="md-alert-body">${body}</div></div>\n`;
  });

  // Change badges. Skip fenced code so `[NEW]` inside code stays literal.
  const parts = s.split(/(```[\s\S]*?```|`[^`]*`)/g);
  s = parts.map((part, i) => (i % 2 === 1 ? part : part.replace(/\[([A-ZÀ-Ÿ]+)\]/g, (mm, w) =>
    BADGES[w] ? `<span class="md-badge md-badge-${BADGES[w]}">${esc(w)}</span>` : mm))).join('');

  return s;
}

// Pick the language variant of a note filename: keeps files ending _EN/_FR that
// match `lang`, plus language-neutral files (no suffix). e.g. lang='fr' keeps
// *_FR.md and neutral files, drops *_EN.md.
export function matchesLang(name, lang) {
  const n = (name || '').toLowerCase();
  const other = lang === 'fr' ? '_en' : '_fr';
  if (n.replace(/\.md$/, '').endsWith(other)) return false;
  return true;
}

export default function Markdown({ children, className = '' }) {
  return (
    <div className={`md-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{preprocessMd(children || '')}</ReactMarkdown>
    </div>
  );
}
