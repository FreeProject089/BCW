// /dev/bmd — B.MD for developers: install it, try it, look a directive up, wire it in.
//
// /dev/markdown is the long playground and the folder download; /dev/editor is the editor.
// This page is the package's home on the site, and it is built so it cannot drift from the
// package:
//   · the directive list is `DIRECTIVES` from packages/bmd/src/registry.js, the same data the
//     npm README table is generated from and that a test holds to the parser;
//   · the version comes from packages/bmd/package.json, the changelog is CHANGELOG.md itself;
//   · the "Published on npm" block (ui/bmd-npm.jsx) reads both packages' package.json at build
//     time: 3.1.0 went to npm on 2026-09-29 with provenance, and no version is typed here;
//   · the sizes are docs/size.json, written by packages/bmd/scripts/gen-readme.mjs from a real
//     build, labelled with the version they were measured for.
// The playground renders through the site's own <Markdown>, inside the site CSP (no inline
// script, nothing fetched that the site's URL policy refuses).
import { useState, useMemo, useRef, useDeferredValue } from 'react';
import { Link } from 'react-router-dom';
import { Package, Layers, ShieldCheck, ExternalLink, BookOpen, PenLine, Puzzle, Play, Search, History, Gauge, RotateCcw, Github } from 'lucide-react';
import { Button, Badge, Textarea, Input } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import Markdown from '../ui/md.jsx';
import { CodeSnippet, SnippetTabs, CopyButton } from '../ui/dev-snippet.jsx';
import { BmdNpmBlock } from '../ui/bmd-npm.jsx';
import { DIRECTIVES, DIRECTIVE_GROUPS } from '@bettercommunity/bmd/registry';
import { version as BMD_VERSION } from '../../../../packages/bmd/package.json';
import changelogSrc from '../../../../packages/bmd/CHANGELOG.md?raw';
import SIZE from '../../../../packages/bmd/docs/size.json';

const NPM = 'https://www.npmjs.com/package/@bettercommunity/bmd';
const NPM_EDITOR = 'https://www.npmjs.com/package/@bettercommunity/bmd-editor';
const SOURCE = 'https://github.com/FreeProject089/BCW/tree/master/BCWEB/packages/bmd';
const CHANGELOG_URL = 'https://github.com/FreeProject089/BCW/blob/master/BCWEB/packages/bmd/CHANGELOG.md';

const INSTALL_OPT = 'npm i mermaid rehype-highlight remark-math rehype-katex katex';

const QUICK = `import Markdown from '@bettercommunity/bmd';
import '@bettercommunity/bmd/markdown.css';

export default function Post({ body }) {
  return <Markdown lang="en" toc="auto">{body}</Markdown>;
}`;

const FRAMEWORKS = [
  { id: 'vite', label: 'Vite + React', lang: 'jsx', code: `// src/main.jsx
import '@bettercommunity/bmd/markdown.css';
import { configureMarkdown } from '@bettercommunity/bmd/config';

configureMarkdown({
  loadMermaid: () => import('mermaid'),        // installed: no CDN request
  policy: { allowHosts: ['example.com'] },     // optional: where authored links may point
});

// anywhere
import Markdown from '@bettercommunity/bmd';
export const Post = ({ body }) => <Markdown lang="en" toc="auto">{body}</Markdown>;` },
  { id: 'next', label: 'Next.js', lang: 'jsx', code: `// app/md.jsx: a client component (tabs, the lightbox and live values hold state)
'use client';
import '@bettercommunity/bmd/markdown.css';
import Markdown, { configureMarkdown } from '@bettercommunity/bmd';
configureMarkdown({ loadMermaid: () => import('mermaid') });
export default function Md({ children, lang = 'en' }) { return <Markdown lang={lang}>{children}</Markdown>; }

// app/docs/[slug]/page.jsx: a server component can use it as is
import Md from '../../md.jsx';
export default async function Page({ params }) {
  const body = await loadDoc(params.slug);
  return <Md>{body}</Md>;
}

// or HTML with no client JavaScript for the document:
import { renderHtml } from '@bettercommunity/bmd/export';
// webpack resolves every import() at build time: install the optional packages you use.
const html = renderHtml(body, { lang: 'en' });` },
  { id: 'remix', label: 'Remix / React Router', lang: 'jsx', code: `// app/root.jsx
import bmdCss from '@bettercommunity/bmd/markdown.css?url';
export const links = () => [{ rel: 'stylesheet', href: bmdCss }];

// app/routes/docs.$slug.jsx
import Markdown from '@bettercommunity/bmd';
export default function Doc() {
  const { body } = useLoaderData();
  return <Markdown>{body}</Markdown>;
}` },
  { id: 'astro', label: 'Astro', lang: 'jsx', code: `---
// src/components/Doc.astro
import Md from './Md.jsx';
const { body } = Astro.props;
---
<Md client:load body={body} />

// src/components/Md.jsx
import '@bettercommunity/bmd/markdown.css';
import Markdown from '@bettercommunity/bmd';
export default function Md({ body }) { return <Markdown>{body}</Markdown>; }` },
  { id: 'node', label: 'Node (e-mail, PDF, static)', lang: 'js', code: `import { readFileSync, writeFileSync } from 'node:fs';
import { documentHtml, cssUrl } from '@bettercommunity/bmd/export';

const css = readFileSync(new URL(cssUrl), 'utf8');
const page = documentHtml(body, { title: 'Release notes', css, scheme: 'light' });
// a standalone page: tokens, the kit's CSS, the rendered document. Interactive blocks
// render their resting state (first tab open, a counter with no number).
writeFileSync('notes.html', page);` },
  { id: 'editor', label: 'The editor', lang: 'jsx', code: `import BmdEditor from '@bettercommunity/bmd-editor';
import '@bettercommunity/bmd/markdown.css';
import '@bettercommunity/bmd-editor/editor.css';

function Compose() {
  const [md, setMd] = useState('# Hello');
  return <BmdEditor value={md} onChange={setMd} lang="en" onSave={save} />;
}` },
];

const SECURITY_CFG = `import { configureMarkdown } from '@bettercommunity/bmd/config';

configureMarkdown({
  policy: {
    allowHosts: ['example.com'],             // links: example.com and its subdomains
    allowDownloadHosts: ['cdn.example.com'], // :file and download buttons
    allowApiHosts: [],                       // live blocks: this origin only
  },
  allowIframes: /^https:\\/\\/(www\\.)?youtube-nocookie\\.com\\//,
  cdn: { lucide: null, brand: null, phosphor: null, mermaid: null },  // no third-party requests
});`;

const CSP = `default-src 'self';
img-src 'self' data: https://cdn.jsdelivr.net https://cdn.simpleicons.org;   /* icons drawn as masks */
script-src 'self' https://cdn.jsdelivr.net;                                   /* mermaid, when not installed */
frame-src https://www.youtube-nocookie.com https://open.spotify.com;         /* ::youtube ::spotify */
connect-src 'self';                                                          /* :counter :action ::include ::openapi */`;

const SAMPLE = `# Try it

:::tip[Edit on the left]
This renders through the **same component** as every page of this site. :badge[${BMD_VERSION}]{color="#0a7"}
:::

:::tabs
:::tab{title="npm"}
\`npm i @bettercommunity/bmd\`
:::
:::tab{title="pnpm"}
\`pnpm add @bettercommunity/bmd\`
:::
:::

Pick a directive below and press **Try**.
`;

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const syntaxOf = (d, f) => `${f === 'container' ? ':::' : f === 'leaf' ? '::' : ':'}${d.name}`;

/** CHANGELOG.md as `[{ title, body }]`, newest first, an empty "Unreleased" left out. */
function releases(src) {
  return String(src || '').split(/^## /m).slice(1).map((chunk) => {
    const nl = chunk.indexOf('\n');
    return { title: chunk.slice(0, nl).trim(), body: chunk.slice(nl + 1).trim() };
  }).filter((r) => r.body);
}

function Section({ id, icon: Icon, title, children, lede = null }) {
  return (
    <section id={id} className="space-y-3 scroll-mt-20 min-w-0">
      <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2"><Icon size={17} className="text-[var(--accent-ink)] shrink-0" /> {title}</h2>
      {lede && <p className="text-sm text-[var(--muted)] max-w-2xl">{lede}</p>}
      {children}
    </section>
  );
}

function Playground({ value, onChange, boxRef }) {
  const { t } = useI18n();
  const shown = useDeferredValue(value);
  return (
    <div ref={boxRef} className="grid lg:grid-cols-2 gap-3 scroll-mt-20">
      <div className="min-w-0 flex flex-col">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('dvb2.pg.src', 'Source')}</span>
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => onChange(SAMPLE)}><RotateCcw size={13} /> {t('dvb2.pg.reset', 'Reset')}</Button>
          <CopyButton text={value} />
        </div>
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
          aria-label={t('dvb2.pg.src', 'Source')}
          className="font-mono text-[12.5px] leading-relaxed min-h-[260px] lg:min-h-[420px] flex-1 w-full" />
      </div>
      <div className="min-w-0 flex flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 py-1">{t('dvb2.pg.out', 'Preview')}</span>
        <div className="rounded-xl border border-[var(--line)] p-4 overflow-auto min-h-[260px] lg:min-h-[420px] lg:max-h-[640px] flex-1" style={{ background: 'var(--bg-solid)' }}>
          <Markdown>{shown}</Markdown>
        </div>
      </div>
    </div>
  );
}

function DirectiveList({ onTry }) {
  const { t, lang } = useI18n();
  const fr = lang === 'fr';
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const needle = q.trim().toLowerCase().replace(/^:+/, '');
  const rows = useMemo(() => DIRECTIVES.filter((d) => (group === 'all' || d.group === group) && (!needle
    || d.name.includes(needle) || d.aliases.some((a) => a.includes(needle))
    || d.summary.en.toLowerCase().includes(needle) || d.summary.fr.toLowerCase().includes(needle)
    || d.attrs.some((a) => a.includes(needle)))), [needle, group]);
  const names = DIRECTIVES.reduce((n, d) => n + 1 + d.aliases.length, 0);
  return (
    <div className="space-y-3 min-w-0">
      <p className="text-sm text-[var(--muted)] max-w-2xl">
        {t('dvb2.dir.lede', '{n} blocks, {m} names with their aliases, read from the package’s own registry: the same list the npm README is generated from, and a test fails when it and the parser disagree.').replace('{n}', String(DIRECTIVES.length)).replace('{m}', String(names))}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative sm:w-72">
          <Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} type="search" name="directive-filter" autoComplete="off" spellCheck={false}
            className="ps-8 w-full" placeholder={t('dvb2.dir.filter', 'Filter: name, alias, attribute')} aria-label={t('dvb2.dir.filter', 'Filter: name, alias, attribute')} />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1 min-w-0">
          {[{ id: 'all', label: { en: 'All', fr: 'Tout' } }, ...DIRECTIVE_GROUPS].map((g) => (
            <button key={g.id} type="button" onClick={() => setGroup(g.id)} aria-pressed={group === g.id}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-[12px] border ${group === g.id ? 'bg-[var(--primary)] text-[var(--on-primary)] border-transparent' : 'border-[var(--line)] hover:bg-[var(--surface-2)]'}`}>
              {fr ? g.label.fr : g.label.en}
            </button>
          ))}
        </div>
      </div>
      {!rows.length && <p className="text-sm text-[var(--muted)]">{t('dvb2.dir.none', 'No directive matches that.')}</p>}
      <div className="grid md:grid-cols-2 gap-3">
        {rows.map((d) => (
          <div key={d.name} className="rounded-xl border border-[var(--line)] p-3.5 min-w-0 flex flex-col gap-1.5" style={{ background: 'var(--surface)' }}>
            <div className="flex flex-wrap items-center gap-1.5">
              {d.forms.map((f) => <code key={f} className="text-[12.5px] font-mono font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-2)]">{syntaxOf(d, f)}</code>)}
              {d.aliases.map((a) => <code key={a} className="text-[11px] font-mono text-[var(--muted)]">{a}</code>)}
              {d.fetches && <Badge tone="amber">{t('dvb2.dir.fetches', 'fetches')}</Badge>}
            </div>
            <p className="text-[13px]">{fr ? d.summary.fr : d.summary.en}
              {d.parent && <span className="text-[var(--muted)]"> {t('dvb2.dir.inside', 'Inside :::{p}.').replace('{p}', d.parent)}</span>}
            </p>
            {d.attrs.length > 0 && (
              <p className="text-[11px] font-mono text-[var(--muted)] break-words">{d.attrs.map((a) => `${a}=`).join('  ')}</p>
            )}
            <div className="flex items-center gap-1.5 mt-auto pt-1">
              <Button size="sm" onClick={() => onTry(d.example)}><Play size={12} /> {t('dvb2.dir.try', 'Try')}</Button>
              <CopyButton text={d.example} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DevBmd() {
  const { t } = useI18n();
  const [md, setMd] = useState(SAMPLE);
  const boxRef = useRef(null);
  const tryIt = (example) => {
    setMd(example);
    boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const rel = useMemo(() => releases(changelogSrc), []);
  const names = DIRECTIVES.reduce((n, d) => n + 1 + d.aliases.length, 0);
  const own = SIZE?.own || {};

  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12 space-y-12 min-w-0">
      <header className="max-w-2xl">
        <span className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-[var(--on-primary)] shadow-lg shadow-orange-500/25 mb-4"><Package size={22} /></span>
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">B.MD</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          {t('dvb2.lede', 'Markdown with blocks, as one React component: callouts, cards, tabs, steps, API cards drawn from OpenAPI, embeds, live values, diagrams. The renderer every page of this site is written in, published on npm.')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>@bettercommunity/bmd {BMD_VERSION}</Badge>
          <Badge tone="green">{t('bmdpub.published', 'Published on npm')}</Badge>
          <Badge>{t('dvb2.b.blocks', '{n} blocks').replace('{n}', String(DIRECTIVES.length))}</Badge>
          <Badge>{t('dvb2.b.names', '{n} directive names').replace('{n}', String(names))}</Badge>
          <Badge>MIT</Badge>
          <Badge>{t('dvb2.b.types', 'TypeScript types')}</Badge>
          <Badge>React 18 / 19</Badge>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <a href={NPM} target="_blank" rel="noopener noreferrer"><Button variant="primary"><Package size={15} /> {t('dvb2.npm', 'On npm')} <ExternalLink size={12} /></Button></a>
          <a href="#playground"><Button><Play size={15} /> {t('dvb2.cta.pg', 'Playground')}</Button></a>
          <a href="#directives"><Button><Puzzle size={15} /> {t('dvb2.cta.dir', 'Every directive')}</Button></a>
          <a href={SOURCE} target="_blank" rel="noopener noreferrer"><Button variant="ghost"><Github size={15} /> {t('dvb2.src', 'Source')}</Button></a>
        </div>
      </header>

      <Section id="npm" icon={Package} title={t('bmdpub.title', 'Published on npm')}
        lede={t('bmdpub.lede', 'Both packages are on the public npm registry, built and published by GitHub Actions with provenance. The versions below are read from each package.json when this site is built.')}>
        <BmdNpmBlock />
      </Section>

      <Section id="install" icon={Package} title={t('dvb.install', 'Install')}>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('dvb2.install.pnpm', 'pnpm, yarn and bun install from the same npm registry: one package, every client. The Markdown pipeline comes with it; you bring React 18 or 19. Checked from the published tarball under pnpm’s strict node_modules, where an undeclared dependency would fail.')}
        </p>
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('dvb.install.opt', 'Optional, loaded only when a document needs them: syntax highlighting, maths, diagrams.')}</p>
        <CodeSnippet code={INSTALL_OPT} />
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          {t('dvb.install.ed', 'The editor is its own package, so a site that only reads documents never ships it.')}{' '}
          <a className="text-[var(--accent-ink)] underline" href={NPM_EDITOR} target="_blank" rel="noopener noreferrer">@bettercommunity/bmd-editor</a>
          {' · '}<Link className="text-[var(--accent-ink)] underline" to="/dev/editor#npm">{t('bmdpub.ed.docs', 'Its install, props and a live demo')}</Link>
        </p>
      </Section>

      <Section id="quick-start" icon={Play} title={t('devp.qs', 'Quick start')}
        lede={t('dvb2.qs.lede', 'Import the component and the stylesheet once. The stylesheet reads your theme’s CSS variables (--text, --line, --surface, --primary…).')}>
        <CodeSnippet code={QUICK} lang="jsx" />
      </Section>

      <Section id="playground" icon={PenLine} title={t('dvb2.pg', 'Playground')}
        lede={t('dvb2.pg.lede', 'Type on the left. Nothing is saved or sent: it renders in your browser through the site’s own renderer, and live blocks only reach this site.')}>
        <Playground value={md} onChange={setMd} boxRef={boxRef} />
        <p className="text-[12px] text-[var(--muted)]">
          {t('dvb2.pg.more', 'Want the block menu, the link checker and the export?')}{' '}
          <Link className="text-[var(--accent-ink)] underline" to="/dev/editor">{t('dvb.cta.editor', 'Try the editor')}</Link>{' · '}
          <Link className="text-[var(--accent-ink)] underline" to="/dev/markdown">{t('dvb2.pg.kit', 'The long playground and the folder download')}</Link>
        </p>
      </Section>

      <Section id="directives" icon={Puzzle} title={t('dvb2.dir', 'Every directive')}>
        <DirectiveList onTry={tryIt} />
      </Section>

      <Section id="frameworks" icon={Layers} title={t('dvb.fw', 'Your framework')}>
        <SnippetTabs tabs={FRAMEWORKS} />
      </Section>

      <Section id="security" icon={ShieldCheck} title={t('dvb2.sec', 'Security model')}
        lede={t('dvb2.sec.lede', 'B.MD renders text other people wrote, so the defaults assume the author is hostile.')}>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            ['dvb2.sec.1t', 'Sanitised HTML', 'dvb2.sec.1', 'Raw HTML is allowed, then filtered by rehype-sanitize against a schema that permits what the blocks emit and nothing else: no script, no style element, no on* handlers.'],
            ['dvb2.sec.2t', 'One URL policy', 'dvb2.sec.2', 'Every href and src, including the ones directives build, goes through safeUrl(): http(s), mailto, tel and relative URLs only. javascript: and data: are refused, control characters stripped first, protocol-relative URLs refused, and every link that opens a tab gets rel="noopener noreferrer".'],
            ['dvb2.sec.3t', 'policy.allowApiHosts', 'dvb2.sec.3', 'What live blocks fetch (:counter, ::live, :action, ::include, ::openapi) has its own allowlist. An array, even empty, means this origin plus the listed hosts, nothing else. Every fetch is sent without the reader’s cookies, and a write asks first.'],
            ['dvb2.sec.4t', 'Styles, frames, diagrams', 'dvb2.sec.4', 'color= takes a colour or a CSS variable only; inline style values are read and fixed-position overlays refused. An iframe survives only if allowIframes matches it. Mermaid runs at its strict level, KaTeX with trust off.'],
          ].map(([tk, title, bk, body]) => (
            <div key={tk} className="rounded-xl border border-[var(--line)] p-4 min-w-0" style={{ background: 'var(--surface)' }}>
              <div className="font-semibold text-[14px] mb-1">{t(tk, title)}</div>
              <p className="text-[13px] text-[var(--muted)]">{t(bk, body)}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('dvb.cfg.d', 'Every value that was specific to this site is a knob: the app logos, the icon CDNs (null switches a family off and nothing is fetched), where authored links may point, which frames survive, the corner radius, how an include is resolved, where Mermaid comes from.')}</p>
        <CodeSnippet code={SECURITY_CFG} lang="js" />
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('dvb.csp.d', 'What the defaults reach for, so the policy can name them, or set the CDN knobs to null and list nothing.')}</p>
        <CodeSnippet code={CSP} lang="css" label="Content-Security-Policy" />
      </Section>

      {SIZE?.component && (
        <Section id="size" icon={Gauge} title={t('dvb2.size', 'Bundle size')}
          lede={t('dvb2.size.lede', 'Measured for {v} from a real build (minified, gzip). Mermaid, KaTeX and the syntax highlighter load only when a document needs them.').replace('{v}', SIZE.version)}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-[var(--line)] p-4" style={{ background: 'var(--surface)' }}>
              <div className="text-2xl font-extrabold">{kb(SIZE.component.gzip)}</div>
              <div className="text-[12px] text-[var(--muted)]">{t('dvb2.size.comp', 'the component, pipeline included, React excluded')}</div>
            </div>
            <div className="rounded-xl border border-[var(--line)] p-4" style={{ background: 'var(--surface)' }}>
              <div className="text-2xl font-extrabold">{kb(SIZE.css.gzip)}</div>
              <div className="text-[12px] text-[var(--muted)]">{t('dvb2.size.css', 'the stylesheet')}</div>
            </div>
            {own.index && (
              <div className="rounded-xl border border-[var(--line)] p-4 col-span-2 sm:col-span-1" style={{ background: 'var(--surface)' }}>
                <div className="text-2xl font-extrabold">{kb(own.index.gzip)}</div>
                <div className="text-[12px] text-[var(--muted)]">{t('dvb2.size.own', 'B.MD’s own code, without its dependencies')}</div>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="text-[12px] w-full min-w-[320px]">
              <thead><tr className="text-start text-[var(--faint)]"><th className="text-start font-medium py-1 pe-3">{t('dvb2.size.entry', 'Import')}</th><th className="text-end font-medium py-1 pe-3">{t('dvb2.size.min', 'Minified')}</th><th className="text-end font-medium py-1">gzip</th></tr></thead>
              <tbody>
                {['index', 'export', 'config', 'registry', 'ast', 'links', 'openapi'].filter((k) => own[k]).map((k) => (
                  <tr key={k} className="border-t border-[var(--line)]">
                    <td className="py-1 pe-3 font-mono">@bettercommunity/bmd{k === 'index' ? '' : `/${k}`}</td>
                    <td className="py-1 pe-3 text-end tabular-nums">{kb(own[k].min)}</td>
                    <td className="py-1 text-end tabular-nums">{kb(own[k].gzip)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section id="changelog" icon={History} title={t('dvb2.cl', 'Version and changelog')}>
        {rel.slice(0, 1).map((r) => (
          <div key={r.title} className="rounded-xl border border-[var(--line)] p-4 min-w-0" style={{ background: 'var(--surface)' }}>
            <div className="font-semibold mb-2">{r.title}</div>
            <Markdown>{r.body}</Markdown>
          </div>
        ))}
        {rel.length > 1 && (
          <details className="rounded-xl border border-[var(--line)] p-4 min-w-0">
            <summary className="cursor-pointer text-sm font-medium">{t('dvb2.cl.older', 'Earlier versions ({n})').replace('{n}', String(rel.length - 1))}</summary>
            <div className="mt-3 space-y-5">
              {rel.slice(1).map((r) => (
                <div key={r.title}>
                  <div className="font-semibold mb-1">{r.title}</div>
                  <Markdown>{r.body}</Markdown>
                </div>
              ))}
            </div>
          </details>
        )}
        <a className="text-sm text-[var(--accent-ink)] underline inline-flex items-center gap-1" href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">CHANGELOG.md <ExternalLink size={12} /></a>
      </Section>

      <div className="flex flex-wrap gap-2 pt-2">
        <Link to="/dev/editor"><Button><PenLine size={15} /> {t('dvb.cta.editor', 'Try the editor')}</Button></Link>
        <Link to="/blog/markdown-guide"><Button><BookOpen size={15} /> {t('dvb.cta.guide', 'Every block')}</Button></Link>
        <a href={NPM} target="_blank" rel="noopener noreferrer"><Button><Package size={15} /> npm <ExternalLink size={12} /></Button></a>
        <Link to="/dev"><Button variant="ghost">{t('devmd.cta.dev', 'Back to the developer hub')}</Button></Link>
      </div>
    </div>
  );
}
