// /dev/editor — the editor package, on a page of its own.
//
// The site's own composer (blog, docs) is built around its content model; this is the
// standalone one a project installs. Same renderer underneath, so what is written here looks
// exactly like a post — and the draft stays in this browser, nowhere else.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PenLine, RotateCcw, ExternalLink, Package } from 'lucide-react';
import { Button, Badge } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import BmdEditor from '@bettercommunity/bmd-editor';

const KEY = 'bcw.dev.editor.draft';
const SAMPLE = `# A page, written here

Everything in the **Insert** menu is a real block. Side by side on a desktop, tabs on a phone.

:::tip[Try the menu]
Press :kbd[Ctrl+/] — or the button — and pick a block. The caret lands where you type next.
:::

::::steps[Three things to try]
:::step[Links]
Add \`[[Docs]]\` or a broken \`#anchor\` and open the **Links** panel.
:::
:::step[Outline]
The **Outline** panel lists the headings and jumps to them.
:::
:::step[Export]
**Export HTML** downloads a standalone page — stylesheet included.
:::
::::

:::table[A styled table]{style="striped bordered"}
| Feature | Where |
|---|---|
| Live values | :counter[Blocks]{src=/api/health path=ok} |
| Diagrams | see below |
:::

\`\`\`mermaid
graph LR
  A[Write] --> B[Preview] --> C[Export]
\`\`\`
`;

export default function DevEditor() {
  const { t, lang } = useI18n();
  const [md, setMd] = useState(() => { try { return localStorage.getItem(KEY) || SAMPLE; } catch { return SAMPLE; } });
  useEffect(() => { try { localStorage.setItem(KEY, md); } catch { /* private mode */ } }, [md]);
  return (
    <div className="max-w-6xl mx-auto py-8 sm:py-12 space-y-6">
      <header className="max-w-2xl">
        <span className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-orange-500/25 mb-4"><PenLine size={22} /></span>
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">{t('dve.title', 'The B.MD editor')}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          {t('dve.lede', 'The editor that ships as @bettercommunity/bmd-editor: a block menu that knows every directive, a live preview through the real renderer, a link checker, an outline, the syntax tree, and an HTML export. Your draft stays in this browser.')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>@bettercommunity/bmd-editor</Badge>
          <Badge>{t('dve.b2', 'Phone and desktop')}</Badge>
          <Badge>{t('dve.b3', 'Nothing is sent')}</Badge>
        </div>
      </header>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setMd(SAMPLE)} className="text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"><RotateCcw size={12} /> {t('devmd.reset', 'Reset')}</button>
      </div>
      <BmdEditor value={md} onChange={setMd} lang={lang === 'fr' ? 'fr' : 'en'} pageMap={null} height="62vh" exportTitle="bmd-draft" />
      <div className="flex flex-wrap gap-2 pt-2">
        <Link to="/dev/bmd"><Button variant="primary"><Package size={15} /> {t('dve.cta.install', 'Install it')}</Button></Link>
        <Link to="/dev/markdown"><Button><ExternalLink size={15} /> {t('dvb.cta.play', 'The playground')}</Button></Link>
      </div>
    </div>
  );
}
