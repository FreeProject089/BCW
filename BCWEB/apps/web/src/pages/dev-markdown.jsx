// /dev/markdown — the block system, for somebody who wants it in their own project.
//
// Not a copy of the guide. The guide (a blog post) answers "what can I write here"; this page
// answers "how do I get this renderer, what does it need, and what happens when I change it".
// Different question, different reader — an author versus a developer.
//
// The playground is the point. Every reference page for a markup language is a list of things
// you cannot try, and the one thing that actually settles whether a block does what you want
// is typing it and looking. It renders through the same <Markdown> the site uses, so what you
// see here is what a post looks like.
import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Package, Palette, ShieldCheck, Puzzle, ExternalLink, RotateCcw, BookOpen, Download, FileCode, Link2, FileDown, PenLine, Plus, LayoutGrid } from 'lucide-react';
import { Card, Button, Textarea, Badge, copyText, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import Markdown from '../ui/md.jsx';
import { KIT_PARTS, KIT_FLAVOURS, buildKit, zipKit } from './kit-pack.js';
import { validateLinks } from '@bettercommunity/bmd/links';
import { documentHtml, cssUrl } from '@bettercommunity/bmd/export';
import { extractHeadings } from '@bettercommunity/bmd/ast';
import { SNIPPET_GROUPS, expandSnippet } from '@bettercommunity/bmd-editor/snippets';
import BmdBlockCanvas from '@bettercommunity/bmd-editor/block-canvas';
import '@bettercommunity/bmd-editor/editor.css';

const INSTALL = 'npm i @bettercommunity/bmd react react-dom react-markdown remark-gfm remark-directive rehype-raw rehype-sanitize unist-util-visit unified remark-parse lucide-react';
const INSTALL_OPT = 'npm i rehype-highlight remark-math rehype-katex katex mermaid';

const USAGE = `import Markdown from '@bettercommunity/bmd';

<Markdown lang="en">{body}</Markdown>`;

const WIRING = `<Markdown
  lang={lang}
  roadmap={MyProgressTracker}
  replay={MyReplayPlayer}
>{body}</Markdown>`;

const TOKENS = `:root {
  --text: #17140f; --muted: #57514a; --faint: #726b61;
  --line: #e6e0d8; --line-strong: #d5cec4;
  --surface: #f3eee6; --surface-2: #ece5db; --bg-solid: #fff;
  --primary: #f97316; --primary-2: #ea580c;
  --error: #dc2626;
}`;

/** What the playground opens with — one of most families, so the first edit is a change. */
const SAMPLE = `# Try it

Edit on the left. This renders through the **same component** the blog uses.

:::tip[Everything is a block]
Callouts take a title in brackets. :badge[NEW]{color="#0a7"} and :kbd[Ctrl+K] are inline.
:::

:button[Watch]{brand=youtube href=https://youtube.com} :button[Join]{brand=discord href=https://discord.gg}

:::columns
:::column
### Left
A column holds any markdown.
:::
:::column
### Right
Including \`code\`, lists and images.
:::
:::

| Block | Written |
|---|---|
| Steps | \`:::steps\` + \`:::step[Title]\` |
| Tabs | \`:::tabs\` + \`:::tab{title="…"}\` |
| Emoji | \`:rocket:\` → :rocket: |

:file[report.pdf]{href=/api/assets/setup.exe size="1.2 MB"}

:::schedule[Support]{tz=Europe/Paris}
| Day | Open |
|---|---|
| Mon-Fri | 09:00-18:00 |
:::

The rows above are not converted — the card tells you how far you are from that zone right
now. A single moment is: the stream starts at :time[2026-09-01T20:00]{tz=Europe/Paris}.

## New in 2.0

:::stats
:::stat[Blocks]{value="70" delta="+22" icon=ph:stack}
:::
:::stat[Icons]{value="3 000+" icon=ph:palette}
:::
:::

:::checklist[Try these]
- [x] A stat tile
- [ ] A timeline — \:::timeline / \:::event
- [ ] A FAQ — \:::faq / \:::q
:::

Progress: :meter[60]{label=Done} · :icon[ph-bold:rocket] Phosphor works everywhere an icon does.

## New in 3.0

:::table[Tables keep their markdown]{style="striped bordered" radius=6}
| Block | Inline |
|---|---|
| \`:::api\` cards, \`::openapi\` | :counter[Live]{src=/api/health path=ok} :action[Ping]{href=/api/health method=GET done="Alive"} |
| ==marks== and [[wiki links]] | :kbd[Ctrl+K] :badge[3.0]{color=#7c3aed} |
:::

:::api[GET /api/feedback/:project/config]{auth=none summary="What a client may send"}
:::response{status=200}
\`\`\`json
{ "enabled": true, "maxAttachMB": 25 }
\`\`\`
:::
:::

:img[A captioned picture]{src=/logo.png width=72 align=center caption="Every block takes radius=, variant= and class=" rounded}

\`\`\`mermaid
graph LR
  A[Write] --> B[Preview] --> C[Export]
\`\`\`

::youtube{src=https://youtu.be/dQw4w9WgXcQ}
`;

function Snippet({ code, lang = 'bash' }) {
  const toast = useToast();
  const { t } = useI18n();
  return (
    <div className="relative group">
      <pre className="text-[12px] leading-relaxed rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 overflow-x-auto"><code>{code}</code></pre>
      <button
        type="button"
        onClick={() => { copyText(code); toast.success(t('common.copied', 'Copied.')); }}
        className="absolute top-2 right-2 p-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg-solid)] text-[var(--muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
        aria-label={t('common.copy', 'Copy')}
      >
        <Copy size={13} />
      </button>
      <span className="sr-only">{lang}</span>
    </div>
  );
}

/** The part picker, the file list, and the button. */
function KitPacker() {
  const { t } = useI18n();
  const toast = useToast();
  const [on, setOn] = useState(() => new Set(KIT_PARTS.map((p) => p.id)));
  // TypeScript by default: it is the same files plus two, and somebody who does not want them
  // loses nothing by deleting them. The reverse is a download that silently stops type-checking.
  const [flavour, setFlavour] = useState('ts');
  const [busy, setBusy] = useState(false);

  // Built on every change rather than on download: the file list and the size ARE the answer
  // to "what am I about to get", and showing them after the fact is showing them too late.
  let files = [];
  let err = null;
  try { files = buildKit(on, flavour); } catch (e) { err = String(e?.message || e); }
  const bytes = files.reduce((n, f) => n + f.text.length, 0);

  const toggle = (id) => setOn((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const download = async () => {
    setBusy(true);
    try {
      const blob = await zipKit(on, flavour);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bcweb-markdown.zip';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(String(e?.message || e));
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-4 space-y-3">
      {/* Above the parts, because it changes what the parts list MEANS: on JavaScript the
          declarations are not in the zip at all, and the README loses the section describing
          them. */}
      <div className="flex flex-wrap gap-2">
        {KIT_FLAVOURS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFlavour(f.id)}
            aria-pressed={flavour === f.id}
            className={`text-start rounded-xl border p-2.5 flex-1 min-w-[220px] transition-colors ${
              flavour === f.id
                ? 'border-[var(--primary)] bg-[var(--primary)]/[0.06]'
                : 'border-[var(--line)] hover:border-[var(--line-strong)]'
            }`}>
            <span className="text-sm font-semibold">{f.label}</span>
            <span className="block text-[12px] text-[var(--muted)] leading-snug mt-0.5">
              <Markdown className="!text-[12px]">{f.detail}</Markdown>
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {KIT_PARTS.map((p) => (
          <label key={p.id} className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={on.has(p.id)} onChange={() => toggle(p.id)} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="text-sm font-medium">{p.label}</span>
              {p.bytes > 0 && <span className="ms-1.5 text-[11px] text-[var(--faint)] tabular-nums">{Math.round(p.bytes / 1024)} KB</span>}
              <span className="block text-[12px] text-[var(--muted)] leading-snug"><Markdown className="!text-[12px]">{p.detail}</Markdown></span>
            </span>
          </label>
        ))}
      </div>

      <div className="pt-2 border-t border-[var(--line)] flex flex-wrap items-center gap-2">
        {/* The file list, because "what is in the zip" is the question a checkbox raises. */}
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {files.map((f) => (
            <span key={f.name} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-[var(--line)] text-[var(--muted)]">
              <FileCode size={10} />{f.name}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-[var(--faint)] tabular-nums ms-auto">{Math.round(bytes / 1024)} KB</span>
        <Button variant="primary" onClick={download} loading={busy} disabled={!!err}>
          <Download size={15} /> {t('devmd.dl.btn', 'Download the folder')}
        </Button>
      </div>

      {/* A marker that has moved is a file with a dangling import. It says so here rather
          than shipping one. */}
      {err && <p className="text-[11px] text-error">{t('devmd.dl.err', 'The kit could not be packed: {x}').replace('{x}', err)}</p>}
    </Card>
  );
}

export default function DevMarkdown() {
  const { t } = useI18n();
  const [src, setSrc] = useState(SAMPLE);
  const [editMode, setEditMode] = useState('text'); // 'text' (raw) | 'blocks' (drag-drop canvas)
  const ta = useRef(null);
  const toast = useToast();
  const [linkReport, setLinkReport] = useState(null);
  const checkLinks = () => { try { setLinkReport(validateLinks(src)); } catch (e) { toast.error(String(e?.message || e)); } };
  // One chip per block, by family — the same list the editor package's menu uses, so the
  // playground and the editor cannot disagree about what exists. A chip appends the block's
  // starter text to the playground and scrolls to it; the point is to try, not to read.
  const addBlock = (md) => {
    const { text } = expandSnippet(md, '');
    setSrc((prev) => `${prev.replace(/\s+$/, '')}\n\n${text}\n`);
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.scrollTop = el.scrollHeight; el.setSelectionRange(el.value.length, el.value.length); } });
  };
  const openInEditor = () => { try { localStorage.setItem('bcw.dev.editor.draft', src); } catch { /* private mode */ } };
  const exportHtml = async () => {
    let css = '';
    try { css = await fetch(cssUrl).then((r) => (r.ok ? r.text() : '')); } catch { css = ''; }
    const html = documentHtml(src, { title: (extractHeadings(src)[0]?.text) || 'B.MD', css });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); a.download = 'bmd-export.html'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12 space-y-10">
      <header className="max-w-2xl">
        <span className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-orange-500/25 mb-4"><Puzzle size={22} /></span>
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">
          {t('devmd.title', 'B.MD — better.markdown')}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          {t('devmd.lede3', 'A block system on GitHub-flavoured Markdown — callouts, cards, tabs, steps, columns, brand buttons, file downloads, a roadmap, opening hours, API cards, embeds, live values, diagrams, maths. It is a React component you install or copy into your project, and it is the same one every page on this site renders with.')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{t('devmd.b1b', '92 directives')}</Badge>
          <Badge>3.0</Badge>
          <Badge>{t('devmd.b2', 'No build step')}</Badge>
          <Badge>{t('devmd.b3', 'Sanitised by default')}</Badge>
          <Badge>{t('devmd.b4', 'Extensible')}</Badge>
        </div>
      </header>

      {/* ── The playground, first: it is what settles whether the kit does what you want ── */}
      <section>
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-lg font-semibold">{t('devmd.try', 'Try it')}</h2>
          <div className="ms-auto flex items-center gap-3 flex-wrap">
            <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden text-xs">
              {[['text', t('devmd.mode.text', 'Text')], ['blocks', t('devmd.mode.blocks', 'Blocks')]].map(([m, l]) => (
                <button key={m} type="button" onClick={() => setEditMode(m)} className={`px-2.5 py-1 ${editMode === m ? 'bg-[var(--primary)] text-white font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>
              ))}
            </div>
            <button type="button" onClick={checkLinks} className="text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"><Link2 size={12} /> {t('devmd.links', 'Check links')}</button>
            <button type="button" onClick={exportHtml} className="text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"><FileDown size={12} /> {t('devmd.export', 'Export HTML')}</button>
            <button type="button" onClick={() => setSrc(SAMPLE)} className="text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"><RotateCcw size={12} /> {t('devmd.reset', 'Reset')}</button>
          </div>
        </div>
        {linkReport && <div className="mb-2 text-xs rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
          {linkReport.issues.length
            ? <ul className="space-y-0.5">{linkReport.issues.map((i, n) => <li key={n} className={i.level === 'error' ? 'text-[var(--error)]' : 'text-[var(--warning)]'}><code>{i.href || '(empty)'}</code> — {i.hint}{i.line ? ` · l.${i.line}` : ''}</li>)}</ul>
            : <span className="text-[var(--success)]">✓ {t('devmd.links.ok', 'Every link goes somewhere')} ({linkReport.count})</span>}
        </div>}
        <div className="grid lg:grid-cols-2 gap-3 items-start">
          {editMode === 'blocks'
            ? <div className="min-w-0"><BmdBlockCanvas value={src} onChange={setSrc} snippetGroups={SNIPPET_GROUPS} renderer={Markdown} /></div>
            : <Textarea ref={ta} rows={22} value={src} onChange={(e) => setSrc(e.target.value)}
                className="!font-mono !text-[12.5px] !leading-relaxed" spellCheck={false} />}
          {/* min-w-0: a long unbroken token in a rendered code block would otherwise blow the
              grid track and take the page's horizontal scroll with it. */}
          <Card className="p-4 min-w-0 overflow-x-auto">
            <Markdown>{src}</Markdown>
          </Card>
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          {t('devmd.tryNote', 'Nothing here is saved. The full vocabulary, block by block, is in the Markdown guide.')}{' '}
          <Link to="/blog/markdown-guide" className="underline">{t('devmd.guide', 'Open the guide')}</Link>{' · '}
          <Link to="/dev/editor" className="underline" onClick={openInEditor}>{t('devmd.editor.take', 'Open this text in the full editor')}</Link>{' · '}
          <Link to="/dev/bmd" className="underline">{t('devmd.installpage', 'Install in your framework')}</Link>
        </p>
      </section>

      {/* ── Every block, by family ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><LayoutGrid size={16} /> {t('devmd.fam', 'Every block, by family')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('devmd.fam.d', 'Click one to drop its starter text into the playground above. The syntax and attributes of each are in the guide; the same list is the editor package’s Insert menu.')}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SNIPPET_GROUPS.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="text-sm font-semibold mb-2 flex items-center justify-between gap-2">
                <span>{t(`devmd.fam.${g.id}`, g.label)}</span>
                <Link to="/blog/markdown-guide" className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"><BookOpen size={11} /> {t('devmd.fam.guide', 'guide')}</Link>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((it) => (
                  <button key={it.id} type="button" onClick={() => addBlock(it.md)} title={it.md.split('\n')[0]}
                    className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:text-[var(--primary-2)] transition">
                    <Plus size={11} /> {it.label}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Install ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Package size={16} /> {t('devmd.install', 'Put it in your project')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('devmd.install.1b', 'B.MD is the `@bettercommunity/bmd` package (packages/bmd in the repo: sources, a README, docs/ block by block, a CHANGELOG). Install it with its peer dependencies — or copy its src/ folder — the renderer, its nesting and shorthand pre-passes, the emoji table, the brand marks and one stylesheet. There is no package to publish and nothing to configure to get the first document on screen.')}
        </p>
        <Snippet code={INSTALL} />
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('devmd.install.2', 'Three more are optional and load only when a document needs them, so a project that never writes maths never downloads a typesetting engine. Without them a code block is still a styled code block and a formula is still its source text — nothing throws.')}
        </p>
        <Snippet code={INSTALL_OPT} />
        <Snippet code={USAGE} lang="jsx" />
      </section>

      {/* ── Download it ──
          Packed in the browser from the real sources (Vite `?raw`), so what lands on disk is
          the code this page renders with. A button whose payload is a hand-kept copy is worse
          than a link to a repository. */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Download size={16} /> {t('devmd.dl', 'Take it')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('devmd.dl.1', 'Switch off what you do not want and the code goes with it \u2014 the imports and the lines that used them are removed when the folder is packed, not commented out.')}
        </p>
        <KitPacker />
        <p className="text-[11px] text-[var(--muted)] max-w-2xl">
          {t('devmd.dl.note', 'Maths and syntax highlighting have no switch on purpose: both load only when a document actually contains a formula or a code block, so leaving them in costs a line in package.json and nothing at runtime.')}
        </p>
      </section>

      {/* ── The two injected components ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Puzzle size={16} /> {t('devmd.inject', 'The two blocks it does not ship')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('devmd.inject.1', '`:::roadmap` is a progress tracker and `:::replay` is a session player. Bundling either would cost every project a dependency for a block most documents never use, so you pass your own — and a project that has neither gets a box saying which component is missing, rather than a crash.')}
        </p>
        <Snippet code={WIRING} lang="jsx" />
      </section>

      {/* ── Theming ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Palette size={16} /> {t('devmd.theme', 'Make it yours')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('devmd.theme.1', 'The stylesheet defines no colours of its own — it reads variables you already have, or that you can write in ten lines. Change them and every block follows: callouts, cards, buttons, the step rail, the table of contents. There is no theme prop and no !important anywhere, so overriding one rule in your own stylesheet just works.')}
        </p>
        <Snippet code={TOKENS} lang="css" />
      </section>

      {/* ── Security ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck size={16} /> {t('devmd.sec', 'It renders text other people wrote')}</h2>
        <div className="text-sm text-[var(--muted)] max-w-2xl space-y-2">
          <p>{t('devmd.sec.1', 'Raw HTML in a document is allowed and then sanitised against a schema that permits exactly what the block system emits and nothing else: no script tags, no on* handlers, no javascript: URLs. An iframe survives sanitising and is then filtered again to YouTube only, so an author cannot smuggle an arbitrary frame into a page.')}</p>
          <p>{t('devmd.sec.2', 'Two choices worth knowing before you change them. KaTeX runs after the sanitiser — it has to, its output would be stripped as unknown markup — and that is safe because it renders from the text of a math node with trust left false, which is what disables the commands that can emit markup. And single-dollar inline maths is off: remark-math reads "$5 and $10" as a formula, which is a silent failure on any site that quotes a price.')}</p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 pt-2">
        <Link to="/blog/markdown-guide"><Button variant="primary"><BookOpen size={15} /> {t('devmd.cta.guide', 'The full vocabulary')}</Button></Link>
        <Link to="/dev/bmd"><Button><Package size={15} /> {t('devmd.cta.install', 'Install in your framework')}</Button></Link>
        <Link to="/dev/editor"><Button><PenLine size={15} /> {t('devmd.cta.editor', 'The editor')}</Button></Link>
        <Link to="/dev"><Button><ExternalLink size={15} /> {t('devmd.cta.dev', 'Back to the developer hub')}</Button></Link>
      </div>
    </div>
  );
}
