// /dev/bmd — install B.MD in your own project, framework by framework.
//
// /dev/markdown is the playground and the download; this page is the wiring. Somebody who
// knows what the blocks look like and has decided to use them needs three things: the install
// line, the config call, and where those go in THEIR framework. Each tab is a copy-paste that
// works, taken from packages/bmd/docs/frameworks.md.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Package, Layers, ShieldCheck, ExternalLink, BookOpen, PenLine, Puzzle } from 'lucide-react';
import { Card, Button, Badge, copyText, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';

const INSTALL = 'npm i @bettercommunity/bmd react react-dom react-markdown remark-gfm remark-directive rehype-raw rehype-sanitize unist-util-visit unified remark-parse lucide-react';
const INSTALL_OPT = 'npm i rehype-highlight remark-math rehype-katex katex mermaid';
const INSTALL_EDITOR = 'npm i @bettercommunity/bmd-editor';

const FRAMEWORKS = [
  { id: 'vite', label: 'Vite + React', code: `// src/main.jsx
import '@bettercommunity/bmd/markdown.css';
import { configureMarkdown } from '@bettercommunity/bmd/config';

configureMarkdown({
  appIcons: { mine: '/icons/mine.png' },
  loadMermaid: () => import('mermaid'),        // installed → no CDN request
  policy: { allowHosts: ['example.com'] },     // optional: where authored links may point
});

// anywhere
import Markdown from '@bettercommunity/bmd';
export const Post = ({ body }) => <Markdown lang="en" toc="auto">{body}</Markdown>;` },
  { id: 'next', label: 'Next.js', code: `// app/markdown.jsx — a client component: tabs, the lightbox and live values hold state
'use client';
import '@bettercommunity/bmd/markdown.css';
import Markdown, { configureMarkdown } from '@bettercommunity/bmd';
configureMarkdown({ loadMermaid: () => import('mermaid') });
export default function Md({ children, lang = 'en' }) { return <Markdown lang={lang}>{children}</Markdown>; }

// app/docs/[slug]/page.jsx — a server component can still use it
import Md from '../../markdown.jsx';
export default async function Page({ params }) {
  const body = await loadDoc(params.slug);
  return <Md>{body}</Md>;
}

// or static HTML with no client JavaScript for the document:
import { renderHtml } from '@bettercommunity/bmd/export';
const html = renderHtml(body, { lang: 'en' });` },
  { id: 'remix', label: 'Remix', code: `// app/root.jsx
import bmdCss from '@bettercommunity/bmd/markdown.css?url';
export const links = () => [{ rel: 'stylesheet', href: bmdCss }];

// app/routes/docs.$slug.jsx
import Markdown from '@bettercommunity/bmd';
export default function Doc() {
  const { body } = useLoaderData();
  return <Markdown>{body}</Markdown>;
}

// entry.client.jsx (and entry.server.jsx when rendering on the server — the config is
// module-level, each runtime sets its own)
configureMarkdown({ loadMermaid: () => import('mermaid') });` },
  { id: 'astro', label: 'Astro', code: `---
// src/components/Doc.astro
import Md from './Md.jsx';
const { body } = Astro.props;
---
<Md client:load body={body} />

// src/components/Md.jsx
import '@bettercommunity/bmd/markdown.css';
import Markdown from '@bettercommunity/bmd';
export default function Md({ body }) { return <Markdown>{body}</Markdown>; }

// fully static instead: build-time HTML
import { documentHtml } from '@bettercommunity/bmd/export';
const page = documentHtml(body, { title: 'Docs', css });` },
  { id: 'node', label: 'Node (e-mail, PDF, static)', code: `import { readFileSync } from 'node:fs';
import { documentHtml, cssUrl } from '@bettercommunity/bmd/export';

const css = readFileSync(new URL(cssUrl), 'utf8');
const page = documentHtml(body, { title: 'Release notes', css, scheme: 'light' });
// → a standalone page: tokens, the kit's CSS, the rendered document.
// Interactive blocks render their resting state (first tab open, a counter with no number).` },
  { id: 'editor', label: 'The editor', code: `import BmdEditor from '@bettercommunity/bmd-editor';
import '@bettercommunity/bmd/markdown.css';

function Compose() {
  const [md, setMd] = useState('# Hello');
  return <BmdEditor value={md} onChange={setMd} lang="en" pageMap={pageMap} onSave={save} />;
}
// Side by side on a desktop, Write / Preview tabs on a phone; a block menu with every
// directive; link check, outline, AST; "Export HTML". Separate package: readers never ship it.` },
];

const CONFIG = `configureMarkdown({
  appIcons: { bmm: '/icons/bmm.png' },                     // app:<key> logos
  cdn: { lucide: null, brand: null, phosphor: null, mermaid: null },   // no third-party requests at all
  policy: { allowHosts: ['bettercommunity.ch'], allowDownloadHosts: ['cdn.example.com'] },
  allowIframes: /^https:\\/\\/(www\\.)?youtube-nocookie\\.com\\//,
  radius: '8px',                                          // every block, unless {radius=} says otherwise
  resolveInclude: async (src) => (await fetch(src)).text(),
  loadMermaid: () => import('mermaid'),
});`;

const CSP = `default-src 'self';
img-src 'self' data: https://cdn.jsdelivr.net https://cdn.simpleicons.org;   /* icons drawn as masks */
script-src 'self' https://cdn.jsdelivr.net;                                   /* mermaid, when not installed */
frame-src https://www.youtube-nocookie.com https://open.spotify.com;         /* ::youtube ::spotify */
connect-src 'self';                                                          /* :counter :action ::include ::openapi */`;

function Snippet({ code }) {
  const toast = useToast(); const { t } = useI18n();
  return (
    <div className="relative group">
      <pre className="text-[12px] leading-relaxed rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 overflow-x-auto"><code>{code}</code></pre>
      <button type="button" onClick={() => { copyText(code); toast.success(t('common.copied', 'Copied.')); }}
        className="absolute top-2 right-2 p-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg-solid)] text-[var(--muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition" aria-label={t('common.copy', 'Copy')}>
        <Copy size={13} />
      </button>
    </div>
  );
}

export default function DevBmd() {
  const { t } = useI18n();
  const [fw, setFw] = useState('vite');
  const cur = FRAMEWORKS.find((f) => f.id === fw) || FRAMEWORKS[0];
  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12 space-y-10">
      <header className="max-w-2xl">
        <span className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-orange-500/25 mb-4"><Package size={22} /></span>
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">{t('dvb.title', 'Install B.MD')}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          {t('dvb.lede', 'One component, one stylesheet, one configuration call. What changes between frameworks is where the call goes and whether the document renders on the server — pick yours below and copy.')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>@bettercommunity/bmd 3.0</Badge>
          <Badge>@bettercommunity/bmd-editor 3.0</Badge>
          <Badge>{t('dvb.b3', '92 directives')}</Badge>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Package size={16} /> {t('dvb.install', 'Install')}</h2>
        <Snippet code={INSTALL} />
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('dvb.install.opt', 'Optional, loaded only when a document needs them: syntax highlighting, maths, diagrams.')}</p>
        <Snippet code={INSTALL_OPT} />
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('dvb.install.ed', 'The editor is its own package, so a site that only reads documents never ships it.')}</p>
        <Snippet code={INSTALL_EDITOR} />
        <p className="text-[12px] text-[var(--muted)]">{t('dvb.npmnote', 'Not on the npm registry yet: `npm pack` in packages/bmd (and packages/bmd-editor) and install the tarballs, or take the folder from /dev/markdown.')}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Layers size={16} /> {t('dvb.fw', 'Your framework')}</h2>
        <div className="flex flex-wrap gap-1.5">
          {FRAMEWORKS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFw(f.id)} aria-pressed={fw === f.id}
              className={`px-3 py-1.5 rounded-lg text-sm border ${fw === f.id ? 'bg-[var(--primary)] text-white border-transparent' : 'border-[var(--line)] hover:bg-[var(--surface-2)]'}`}>{f.label}</button>
          ))}
        </div>
        <Snippet code={cur.code} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Puzzle size={16} /> {t('dvb.cfg', 'Everything configurable')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('dvb.cfg.d', 'Every value that was specific to this site is a knob: the app logos, the icon CDNs (null switches a family off and nothing is fetched), where authored links may point, which frames survive, the corner radius, how an include is resolved, where Mermaid comes from.')}</p>
        <Snippet code={CONFIG} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck size={16} /> {t('dvb.csp', 'Content Security Policy')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('dvb.csp.d', 'What the defaults reach for, so the policy can name them — or set the CDN knobs to null and list nothing.')}</p>
        <Snippet code={CSP} />
      </section>

      <div className="flex flex-wrap gap-2 pt-2">
        <Link to="/dev/markdown"><Button variant="primary"><Puzzle size={15} /> {t('dvb.cta.play', 'The playground')}</Button></Link>
        <Link to="/dev/editor"><Button><PenLine size={15} /> {t('dvb.cta.editor', 'Try the editor')}</Button></Link>
        <Link to="/blog/markdown-guide"><Button><BookOpen size={15} /> {t('dvb.cta.guide', 'Every block')}</Button></Link>
        <Link to="/dev"><Button><ExternalLink size={15} /> {t('devmd.cta.dev', 'Back to the developer hub')}</Button></Link>
      </div>
    </div>
  );
}
