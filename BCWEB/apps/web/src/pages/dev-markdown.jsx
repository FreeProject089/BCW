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
import { Copy, Package, Palette, ShieldCheck, Puzzle, ExternalLink, RotateCcw, BookOpen, Download, FileCode } from 'lucide-react';
import { Card, Button, Textarea, Badge, copyText, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import Markdown from '../ui/md.jsx';
import { KIT_PARTS, KIT_FLAVOURS, buildKit, zipKit } from './kit-pack.js';

const INSTALL = 'npm i react react-dom react-markdown remark-gfm remark-directive rehype-raw rehype-sanitize unist-util-visit lucide-react';
const INSTALL_OPT = 'npm i rehype-highlight remark-math rehype-katex katex';

const USAGE = `import Markdown from './markdown/index.jsx';

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
            className={`text-left rounded-xl border p-2.5 flex-1 min-w-[220px] transition-colors ${
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
              {p.bytes > 0 && <span className="ml-1.5 text-[11px] text-[var(--faint)] tabular-nums">{Math.round(p.bytes / 1024)} KB</span>}
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
        <span className="text-[11px] text-[var(--faint)] tabular-nums ml-auto">{Math.round(bytes / 1024)} KB</span>
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
  const ta = useRef(null);

  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12 space-y-10">
      <header className="max-w-2xl">
        <span className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-orange-500/25 mb-4"><Puzzle size={22} /></span>
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">
          {t('devmd.title', 'The markdown kit')}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          {t('devmd.lede', 'A GitBook-style block system on GitHub-flavoured Markdown — callouts, cards, tabs, steps, columns, brand buttons, file downloads, opening hours, maths. It is a React component you copy into your project, and it is the same one every page on this site renders with.')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{t('devmd.b1', '32 block types')}</Badge>
          <Badge>{t('devmd.b2', 'No build step')}</Badge>
          <Badge>{t('devmd.b3', 'Sanitised by default')}</Badge>
        </div>
      </header>

      {/* ── The playground, first: it is what settles whether the kit does what you want ── */}
      <section>
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-lg font-semibold">{t('devmd.try', 'Try it')}</h2>
          <button type="button" onClick={() => setSrc(SAMPLE)} className="ml-auto text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1">
            <RotateCcw size={12} /> {t('devmd.reset', 'Reset')}
          </button>
        </div>
        <div className="grid lg:grid-cols-2 gap-3 items-start">
          <Textarea ref={ta} rows={22} value={src} onChange={(e) => setSrc(e.target.value)}
            className="!font-mono !text-[12.5px] !leading-relaxed" spellCheck={false} />
          {/* min-w-0: a long unbroken token in a rendered code block would otherwise blow the
              grid track and take the page's horizontal scroll with it. */}
          <Card className="p-4 min-w-0 overflow-x-auto">
            <Markdown>{src}</Markdown>
          </Card>
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          {t('devmd.tryNote', 'Nothing here is saved. The full vocabulary, block by block, is in the Markdown guide.')}{' '}
          <Link to="/blog/markdown-guide" className="underline">{t('devmd.guide', 'Open the guide')}</Link>
        </p>
      </section>

      {/* ── Install ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Package size={16} /> {t('devmd.install', 'Put it in your project')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('devmd.install.1', 'Copy the six files of the kit — the renderer, its nesting and shorthand pre-passes, the emoji table, the brand marks and one stylesheet. There is no package to publish and nothing to configure to get the first document on screen.')}
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
        <Link to="/dev"><Button><ExternalLink size={15} /> {t('devmd.cta.dev', 'Back to the developer hub')}</Button></Link>
      </div>
    </div>
  );
}
