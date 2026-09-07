// /dev/editor — the editor, on a page of its own. BOTH of it.
//
// This used to show only the bare package, on the reasoning that the site's own composer is
// built around the site's content model. That was half true and wholly unhelpful: what people
// actually meet on this site — in the blog, the docs, the FAQ and the admin guide — is the
// wrapper, and a demo page that shows something else is a demo of something nobody uses.
//
// So there are two, named, and you can switch between them:
//   · **As BetterCommunity uses it** — the real MarkdownEditor, the same component and the
//     same code path as the blog editor. Mode tabs, the block menu, the selection toolbar, the
//     table builder, the icon/badge/keyboard pickers, .bmd import/export, editable preview.
//   · **The package** — `BmdEditor` exactly as `npm i @bettercommunity/bmd-editor` gives it.
//
// Both, rather than replacing one with the other, because this page also says "Install it".
// Showing the wrapper as though it were the package would promise things the tarball does not
// contain: the image upload goes to this site's API, and the icon picker is the site's.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PenLine, RotateCcw, ExternalLink, Package } from 'lucide-react';
import { Button, Badge } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import BmdEditor from '@bettercommunity/bmd-editor';
import { MarkdownEditor } from '../editor/markdown-editor.jsx';

const KEY = 'bcw.dev.editor.draft';
const WHICH_KEY = 'bcw.dev.editor.which';
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
  // Which of the two is on screen. Remembered, because a reader comparing them switches
  // back and forth and a page that forgets makes that a chore.
  const [which, setWhich] = useState(() => { try { return localStorage.getItem(WHICH_KEY) || 'site'; } catch { return 'site'; } });
  useEffect(() => { try { localStorage.setItem(WHICH_KEY, which); } catch { /* private mode */ } }, [which]);
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
        {/* The same document in both, so switching compares the two rather than restarting. */}
        <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs">
          {[['site', t('dve.m.site', 'As BetterCommunity uses it')], ['pkg', t('dve.m.pkg', 'The package')]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setWhich(k)}
              className={`px-2.5 py-1 rounded-md font-medium ${which === k ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={() => setMd(SAMPLE)} className="text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"><RotateCcw size={12} /> {t('devmd.reset', 'Reset')}</button>
      </div>
      <p className="text-[12px] text-[var(--muted)] -mt-3">
        {which === 'site'
          ? t('dve.m.site.h', 'The exact component the blog and the docs use — one module, one code path, no second copy to drift. Its image upload and icon picker are this site’s; everything else is the package.')
          : t('dve.m.pkg.h', '`BmdEditor` as `npm i @bettercommunity/bmd-editor` gives it, with nothing of this site added.')}
      </p>
      {which === 'site'
        ? <MarkdownEditor value={md} onChange={setMd} full minHeight={420} />
        : <BmdEditor value={md} onChange={setMd} lang={lang === 'fr' ? 'fr' : 'en'} pageMap={null} height="62vh" exportTitle="bmd-draft" />}
      <div className="flex flex-wrap gap-2 pt-2">
        <Link to="/dev/bmd"><Button variant="primary"><Package size={15} /> {t('dve.cta.install', 'Install it')}</Button></Link>
        <Link to="/dev/markdown"><Button><ExternalLink size={15} /> {t('dvb.cta.play', 'The playground')}</Button></Link>
      </div>
    </div>
  );
}
