// Code highlighting and the JSON editor, with Prism.
//
// M18 (agent-perf-M18): moved verbatim out of pages/pages.jsx. pages.jsx is in the first-load
// graph (catalog.jsx imports it), and its static `import Prism` put Prism and four grammars in
// every visitor's download for tools that only the admin, the dashboard and the developer
// pages draw. Import them from here.
import { useEffect, useRef, useState } from 'react';
import { FileJson, Wand2 } from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-python';

// A friendlier JSON editor: framed panel with a live valid/invalid indicator, a
// one-click Format button, and tab-to-indent — replaces the raw ugly <textarea>.
// Both layers must lay text out identically or the caret and the glyphs part company.
const EDITOR_TEXT = 'px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words';

/** JSON, highlighted with Prism into the classes prism-bmm.css already styles. Escaped first:
 *  this renders with dangerouslySetInnerHTML, and the value is whatever is being typed. */
// Exported for the Projects-config editor, which has its own chrome (line gutter, fixed
// height) and so reuses the highlighting rather than the whole JsonEditor.
//
// Safe for dangerouslySetInnerHTML: Prism.highlight() escapes the source it tokenises, and
// the no-Prism fallback escapes explicitly. Nothing here interpolates raw input.
export function highlightJson(src) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  try {
    if (Prism?.languages?.json) return Prism.highlight(src, Prism.languages.json, 'json');
  } catch { /* fall through to plain text */ }
  return esc(src);
}

/** The same treatment for the other languages the snippet generator emits.
 *
 *  Same safety note as highlightJson: Prism escapes what it tokenises, and the fallback
 *  escapes explicitly, so the result is safe for dangerouslySetInnerHTML even though the
 *  source contains whatever the user typed into the request body.
 */
export function highlightCode(src, lang) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const g = { curl: 'bash', bash: 'bash', fetch: 'javascript', js: 'javascript', javascript: 'javascript', python: 'python', json: 'json' }[lang] || lang;
  try {
    if (Prism?.languages?.[g]) return Prism.highlight(src, Prism.languages[g], g);
  } catch { /* fall through to plain text */ }
  return esc(src);
}

export function JsonEditor({ value, onChange, placeholder, minH = 170 }) {
  const [err, setErr] = useState(null);
  const taRef = useRef(null); const preRef = useRef(null);
  // The overlay does not scroll on its own; it follows the textarea exactly.
  const syncScroll = () => { if (preRef.current && taRef.current) { preRef.current.scrollTop = taRef.current.scrollTop; preRef.current.scrollLeft = taRef.current.scrollLeft; } };
  useEffect(() => { try { if ((value || '').trim()) JSON.parse(value); setErr(null); } catch (e) { setErr(String(e.message || e)); } }, [value]);
  const format = () => { try { onChange(JSON.stringify(JSON.parse(value || '{}'), null, 2)); } catch {} };
  const onKey = (e) => {
    if (e.key === 'Tab') { // indent instead of leaving the field
      e.preventDefault(); const el = e.target; const s = el.selectionStart, en = el.selectionEnd;
      onChange(value.slice(0, s) + '  ' + value.slice(en));
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  };
  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${err ? 'border-error-border' : 'border-[var(--line)]'}`} style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--line)]">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]"><FileJson size={12} /> JSON</span>
        <div className="flex items-center gap-2.5 text-[10px]">
          <span className={`flex items-center gap-1 ${err ? 'text-error' : 'text-success'}`}><span className={`w-1.5 h-1.5 rounded-full ${err ? 'bg-error' : 'bg-success'}`} />{err ? 'invalid' : 'valid'}</span>
          <button type="button" onClick={format} className="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"><Wand2 size={11} /> Format</button>
        </div>
      </div>
      {/* Highlighted overlay: a <pre> Prism paints, with the real <textarea> transparent on top.
          A textarea cannot render markup, so this is the only way to colour what is being typed.
          The two must agree on font, size, line-height, padding and wrapping or the caret drifts
          away from the glyphs — hence the shared EDITOR_TEXT class rather than two style props. */}
      <div className="relative">
        <pre aria-hidden="true" ref={preRef}
             className={`${EDITOR_TEXT} pointer-events-none absolute inset-0 overflow-hidden m-0`}
             style={{ minHeight: minH }}><code className="language-json"
             dangerouslySetInnerHTML={{ __html: highlightJson(value || '') }} /></pre>
      <textarea ref={taRef} onScroll={syncScroll} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder={placeholder} spellCheck={false}
        className={`${EDITOR_TEXT} relative w-full bg-transparent outline-none resize-y text-transparent caret-[var(--text)]`} style={{ minHeight: minH }} />
      </div>
      {err && <div className="px-3 py-1.5 text-[10px] text-error border-t border-error-border truncate" title={err}>{err}</div>}
    </div>
  );
}
