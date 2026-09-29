// Copyable code for the /dev pages: one block, or a strip of tabs over several.
//
// Two things the older per-page copies got wrong, fixed once here:
//   · the copy button was `opacity-0` until hover. A phone has no hover, so on the device
//     where copying by hand is hardest the button did not exist. It is always drawn now.
//   · `copyText` is async and returns whether it worked; the pages ignored the promise and
//     toasted "Copied." even when the clipboard refused (non-HTTPS origin, a webview). The
//     toast now says what happened.
//
// The code scrolls sideways inside its own box, so a long install line never widens the page.
import { useState, useRef, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyText, useToast } from './ui.jsx';
import { useI18n } from '../i18n.jsx';
import { highlightCode } from './code-highlight.jsx';

const LANG_LABEL = { bash: 'shell', js: 'js', jsx: 'jsx', javascript: 'js', css: 'css', json: 'json', python: 'python', md: 'markdown' };
const PRISM = { jsx: 'javascript', js: 'javascript', md: 'markdown' };

export function CopyButton({ text, className = '' }) {
  const { t } = useI18n(); const toast = useToast();
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(text);
    if (!ok) { toast.error(t('devsn.copyfail', 'Could not copy. Select the text and copy it by hand.')); return; }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1600);
    toast.success(t('common.copied', 'Copied.'));
  };
  return (
    <button type="button" onClick={copy}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--line)] bg-[var(--bg-solid)] text-[11px] text-[var(--muted)] hover:text-[var(--text)] ${className}`}
      aria-label={t('common.copy', 'Copy')} title={t('common.copy', 'Copy')}>
      {done ? <Check size={13} /> : <Copy size={13} />}
      <span className="hidden sm:inline">{done ? t('devsn.copied', 'Copied') : t('common.copy', 'Copy')}</span>
    </button>
  );
}

export function CodeSnippet({ code, lang = 'bash', label = null, className = '' }) {
  return (
    // bcwvisual (agent-bcw-visual) : en-tête séparé du code par un filet, libellé en casse normale, code un peu plus grand.
    <div className={`rounded-xl border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden min-w-0 ${className}`}>
      <div className="flex items-center gap-2 ps-3 pe-1.5 py-1.5 border-b border-[var(--line)]">
        <span className="text-[11.5px] font-medium font-mono text-[var(--faint)] select-none">{label || LANG_LABEL[lang] || lang}</span>
        <CopyButton text={code} className="ms-auto" />
      </div>
      <pre className="text-[12.5px] leading-relaxed px-3.5 py-3 overflow-x-auto m-0"><code dangerouslySetInnerHTML={{ __html: highlightCode(code, PRISM[lang] || lang) }} /></pre>
    </div>
  );
}

/** Several snippets behind one strip of tabs: `tabs` = [{ id, label, code, lang, note? }]. */
export function SnippetTabs({ tabs, initial = null, className = '' }) {
  const [cur, setCur] = useState(initial || tabs[0]?.id);
  const tab = tabs.find((x) => x.id === cur) || tabs[0];
  if (!tab) return null;
  return (
    <div className={`min-w-0 ${className}`}>
      {/* bcwvisual (agent-bcw-visual) : onglets soulignés au lieu de boutons orange pleins. */}
      <div className="flex gap-4 overflow-x-auto mb-2 border-b border-[var(--line)] -mx-0.5 px-0.5" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === tab.id} onClick={() => setCur(x.id)}
            className={`shrink-0 -mb-px py-2 text-[13px] border-b-2 transition-colors ${x.id === tab.id ? 'border-[var(--primary)] text-[var(--text)] font-semibold' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {x.label}
          </button>
        ))}
      </div>
      <CodeSnippet code={tab.code} lang={tab.lang || 'bash'} />
      {tab.note && <p className="text-[12px] text-[var(--muted)] mt-1.5">{tab.note}</p>}
    </div>
  );
}
