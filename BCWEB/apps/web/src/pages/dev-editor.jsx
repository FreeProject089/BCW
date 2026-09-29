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
//
// Below the demo, #npm: the package as it is on npm since 3.1.0 (2026-09-29, with provenance).
// Name, version, licence and the peer range come from packages/bmd-editor/package.json at build
// time (ui/bmd-npm.jsx), so the page cannot advertise a version the registry does not have.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PenLine, RotateCcw, ExternalLink, Package } from 'lucide-react';
import { Button } from '../ui/ui.jsx';
import { CodeSnippet } from '../ui/dev-snippet.jsx';
import { BmdNpmBlock, BMD_PACKAGES } from '../ui/bmd-npm.jsx';
import { useI18n } from '../i18n.jsx';
import BmdEditor from '@bettercommunity/bmd-editor';
import { MarkdownEditor } from '../editor/markdown-editor.jsx';

const USAGE = `import { useState } from 'react';
import BmdEditor from '@bettercommunity/bmd-editor';
import '@bettercommunity/bmd/markdown.css';
import '@bettercommunity/bmd-editor/editor.css';

export default function Compose() {
  const [md, setMd] = useState('# Hello');
  return <BmdEditor value={md} onChange={setMd} lang="en" />;
}`;
const CSS = `import '@bettercommunity/bmd/markdown.css';        // the renderer's styles (the preview)
import '@bettercommunity/bmd-editor/editor.css';  // the editor's own`;

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
    <div className="max-w-6xl mx-auto py-8 sm:py-12 space-y-6 min-w-0">
      {/* bcwvisual (agent-bcw-visual) : en-tête allégé. Plus d'icône en dégradé avec halo ni de
          rangée de quatre pastilles : un titre, une phrase, une ligne de métadonnées. */}
      <header className="max-w-2xl">
        <p className="text-[13px] font-medium text-[var(--muted)] flex items-center gap-1.5 mb-2"><PenLine size={14} aria-hidden="true" /> {BMD_PACKAGES.editor.name}</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight tracking-tight">{t('dve.title', 'The B.MD editor')}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          {t('dve.lede2', 'A block menu, a live preview through the real renderer, a link checker and an HTML export. Your draft stays in this browser.')}
        </p>
        <p className="mt-3 text-[12.5px] text-[var(--faint)] tabular-nums">
          v{BMD_PACKAGES.editor.version} · {t('bmdpub.published', 'Published on npm')} · {t('dve.b2', 'Phone and desktop')} · {t('dve.b3', 'Nothing is sent')}
        </p>
      </header>
      {/* fin bcwvisual */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* The same document in both, so switching compares the two rather than restarting. */}
        <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-[13px]" role="group">
          {[['site', t('dve.m.site', 'As BetterCommunity uses it')], ['pkg', t('dve.m.pkg', 'The package')]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setWhich(k)} aria-pressed={which === k}
              className={`px-3 min-h-[36px] rounded-md font-medium ${which === k ? 'bg-[var(--surface-2)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{label}</button>
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
      <section id="npm" className="space-y-3 scroll-mt-20 min-w-0 pt-4">
        {/* bmdpub (agent-bmd-published): the package as npm serves it, read from its package.json. */}
        <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2"><Package size={17} className="text-[var(--accent-ink)] shrink-0" /> {t('bmdpub.ed.title', 'Install the editor')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('bmdpub.ed.lede', '{name} is on npm. {bmd} {range} is a peer dependency: install both, and the preview goes through the renderer your site already has.').replace('{name}', BMD_PACKAGES.editor.name).replace('{bmd}', BMD_PACKAGES.bmd.name).replace('{range}', BMD_PACKAGES.editor.peer)}
        </p>
        <BmdNpmBlock only="editor" />
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('bmdpub.ed.css', 'Two stylesheets, imported once: the renderer’s and the editor’s.')}</p>
        <CodeSnippet code={CSS} lang="js" />
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('bmdpub.ed.use', 'The smallest page that edits a document: a controlled value, and nothing else required.')}</p>
        <CodeSnippet code={USAGE} lang="jsx" />
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('bmdpub.ed.more', 'Frameworks, the security model and every directive are on the B.MD page.')}{' '}
          <Link className="text-[var(--accent-ink)] underline" to="/dev/bmd#npm">{t('bmdpub.ed.back', 'B.MD on npm')}</Link>
        </p>
      </section>
      <div className="flex flex-wrap gap-2 pt-2">
        <Link to="/dev/bmd"><Button variant="primary"><Package size={15} /> {t('dve.cta.install', 'Install it')}</Button></Link>
        <Link to="/dev/markdown"><Button><ExternalLink size={15} /> {t('dvb.cta.play', 'The playground')}</Button></Link>
      </div>
    </div>
  );
}
