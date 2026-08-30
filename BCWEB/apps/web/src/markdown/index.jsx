// B.MD — better.markdown
//
// A GitBook-style block system on top of GitHub-flavoured Markdown, as a React component you
// copy into a project. This file is the ASSEMBLY: the pipeline, the component map, and the
// `<Markdown>` everything else imports. The work is next door —
//
//   directives.js  markdown-with-directives → an mdast tree     (no React)
//   blocks.jsx     one component per block the parser emits
//   icons.jsx      the icon set, and where a non-bundled one comes from
//   sanitize.js    what survives, and what a URL is allowed to be
//   url.js         the URL policy itself
//   config.js      everything a host application points at itself
//   plugins.js     a block B.MD does not have, added without editing B.MD
//   roadmap.jsx    the built-in `:::roadmap`
//   replay.jsx     the built-in `:::replay`
//   nesting.js     the pre-pass that makes `:::` nest the way people write it
//   shorthand.js   `> [!NOTE]` alerts and bare `[NEW]` chips
//   emoji.js       `:shortcode:` names
//   brands.jsx     brand marks lucide does not have
//
// It was one 1081-line file. The seams above were already there — a sanitiser, a transform,
// an icon set, a dozen components and this — and being in one file meant every one of them
// was reachable from every other, so "add a block" and "change what a URL may be" were edits
// to the same thing.
import { createPortal } from 'react-dom';
import { useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import rehypeRaw from 'rehype-raw';
// The kit’s own stylesheet, so the renderer and its CSS arrive together. A component
// whose styles live in the host application’s stylesheet is a component that arrives naked
// in the next project.
import './markdown.css';
import { preprocessMd } from './shorthand.js';
import { remarkDocBlocks } from './directives.js';
import { rehypeSanitize, SANITIZE_SCHEMA, rehypeAnchorPrefix, rehypeIframeAllowlist, rehypeSafeUrls, rehypeSafeStyle } from './sanitize.js';
import { MarkdownConfig } from './config.js';
import { DocIcon, IconGlyph } from './icons.jsx';
import { DocKbd, DocComment, DocTabs, DocSchedule, DocTime } from './blocks.jsx';
import { blockComponents } from './plugins.js';
/* kit:injected:start */
import { DocRoadmap, DocReplay } from './blocks.jsx';
import BuiltInRoadmap from './roadmap.jsx';
import BuiltInReplay from './replay.jsx';
/* kit:injected:end */

// ── the public surface ────────────────────────────────────────────────────────
// Re-exported from here because ~20 files already import them from this path, and where a
// function lives inside the kit is the kit's business.
export { preprocessMd } from './shorthand.js';
export { ANCHOR_PREFIX, anchorEl } from './sanitize.js';
export { ICON_NAMES, ShowcaseIcon, IconGlyph, DocIcon } from './icons.jsx';
export { matchesLang } from './blocks.jsx';
export { MarkdownConfig, configureMarkdown, appIconKeys, markdownConfig } from './config.js';
export { registerBlock } from './plugins.js';
export { safeUrl, linkAttrs } from './url.js';
/* kit:injected:start */
export { default as Roadmap } from './roadmap.jsx';
export { default as Replay } from './replay.jsx';
/* kit:injected:end */

// NOT a static import. rehype-highlight drags in highlight.js and a grammar per language
// — 180kB raw, 55kB gzipped — and a static import put all of it in the ENTRY chunk, so
// every visitor downloaded a syntax highlighter to read pages that may contain no code.
// Splitting it into its own chunk was not enough on its own: the entry still imported it
// statically, so Vite emitted a <link modulepreload> and the browser fetched it anyway.
//
// Loaded on first markdown render instead. The document renders immediately WITHOUT
// highlighting and re-renders with it a moment later — code blocks are styled by CSS
// either way, so the change is colour appearing, not layout moving.
let _rehypeHighlight = null;
let _highlightPromise = null;
// ── Math, and why it is not simply imported ──────────────────────────────────
//
// KaTeX is ~150 KB gzipped plus a stylesheet, and md.jsx is reached from App.jsx, so a plain
// import would land the whole of it in the ENTRY chunk — paid by every visitor to the home
// page, for a feature a handful of documents use. That is the exact shape bundle-budget.mjs
// exists to catch, and the exact shape it caught once before with a lazy page.
//
// So it loads when a document actually contains math, and never otherwise. Same pattern as
// the highlighter above, plus the stylesheet, which KaTeX cannot render without: no CSS means
// raw markup where the formula should be, which looks like a broken formula rather than a
// missing file.
let _math = null;          // [remarkMath, rehypeKatex] once loaded
let _mathPromise = null;

/**
 * Does this document have any math in it?
 *
 * `$$…$$` on its own, or `$…$` inline. Deliberately narrow: a dollar sign that is money must
 * not pull in a typesetting engine, so inline math has to have a non-space next to each
 * delimiter and no dollar in between — which "$5 and $10" fails and "$x^2$" passes.
 */
const HAS_MATH = /\$\$[\s\S]+?\$\$|(?<![\w$])\$(?![\s$])[^$\n]*[^\s$]\$(?![\w$])/;

function useMath(source) {
  const wanted = typeof source === 'string' && HAS_MATH.test(source);
  const [, force] = useState(0);
  useEffect(() => {
    if (!wanted || _math) return;
    _mathPromise ??= Promise.all([
      import('remark-math'), import('rehype-katex'), import('katex/dist/katex.min.css'),
    ])
      .then(([rm, rk]) => { _math = [rm.default, rk.default]; })
      .catch(() => { _math = false; });   // offline / blocked: the source text, not a crash
    let alive = true;
    _mathPromise.then(() => { if (alive) force((n) => n + 1); });
    return () => { alive = false; };
  }, [wanted]);
  return wanted && Array.isArray(_math) ? _math : null;
}

function useRehypeHighlight() {
  const [, force] = useState(0);
  useEffect(() => {
    if (_rehypeHighlight) return;
    _highlightPromise ??= import('rehype-highlight')
      .then((m) => { _rehypeHighlight = m.default; })
      .catch(() => { _rehypeHighlight = false; }); // offline / blocked: plain code, not a crash
    let alive = true;
    _highlightPromise.then(() => { if (alive) force((n) => n + 1); });
    return () => { alive = false; };
  }, []);
  return _rehypeHighlight || null;
}

const COMPONENTS = {
  'doc-icon': DocIcon, 'doc-kbd': DocKbd, 'doc-comment': DocComment, 'doc-tabs': DocTabs,
  'doc-schedule': DocSchedule, 'doc-time': DocTime,
/* kit:injected:start */
  'doc-roadmap': DocRoadmap, 'doc-replay': DocReplay,
/* kit:injected:end */
};

// Internal link with a GitBook-style hover-preview card (title + category), shown
// only when the href is a known page in `pageMap`.
function MdLink({ pageMap, href, children, ...rest }) {
  const info = href && (pageMap[href] || pageMap[String(href).replace(/#.*$/, '')]);
  const [open, setOpen] = useState(false);
  if (!info) return <a href={href} {...rest}>{children}</a>;
  return (
    <span className="md-linkprev" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <a href={href} {...rest}>{children}</a>
      {open && (
        <span className="md-linkprev-card">
          {info.category && <span className="md-linkprev-cat">{info.category}</span>}
          <span className="md-linkprev-title">
            {/* The page's own icon, the one its sidebar entry already wears. It was stored,
                listed and never shown here — so two links to two different pages produced two
                cards that differed by a line of text. */}
            {info.icon && <IconGlyph name={info.icon} size={13} className="md-linkprev-icon" />}
            {info.title}
          </span>
          {info.desc && <span className="md-linkprev-desc">{info.desc}</span>}
        </span>
      )}
    </span>
  );
}

/**
 * Render a document.
 *
 * `lang`, `roadmap` and `replay` go on a context rather than through props: the blocks that
 * read them are reached through remark's component map, and there is no prop path from here
 * to there.
 *
 * `roadmap` and `replay` are OVERRIDES. B.MD draws both itself — pass one only to replace it
 * (the site passes its rrweb player, which this file has no business bundling).
 */
export default function Markdown({ children, className = '', pageMap, lang = 'en', roadmap = null, replay = null }) {
  const [zoom, setZoom] = useState(null);
  // The two blocks that used to render a "component not supplied" box now have one. A host
  // that passes its own still wins — `roadmap`/`replay` are overrides, not requirements.
  const cfg = useMemo(() => ({
    lang,
    /* kit:injected:start */
    Roadmap: roadmap || BuiltInRoadmap,
    Replay: replay || BuiltInReplay,
    /* kit:injected:end */
  }), [lang, roadmap, replay]);
  const rehypeHighlight = useRehypeHighlight();
  const math = useMath(children);
  // Click any non-card image to open it full-screen (lightbox).
  //
  // Memoised, and this is not micro-tuning. A fresh object here means every `img` and every
  // `a` is a NEW component type on each render, so react-markdown remounts the whole tree —
  // which throws away the syntax highlighting that was just applied, the tab you had open,
  // and the scroll position inside a long panel. The two lazy loaders each force a re-render
  // when they land, so this happens two or three times on an ordinary page.
  const components = useMemo(() => ({
    // Registered blocks FIRST, so a plugin cannot displace a built-in by choosing its name.
    // (It cannot anyway — plugin tags are prefixed `doc-x-` — and the order says so.)
    ...blockComponents(),
    ...COMPONENTS,
    img: ({ node, ...props }) => {
      if (/doc-card-media|doc-comment-img/.test(props.className || '')) return <img loading="lazy" {...props} />;
      return <img loading="lazy" {...props} className={`${props.className || ''} md-zoomable`} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setZoom(props.src); }} />;
    },
    // A table scrolls inside its own wrapper. Without it a wide one widens the article and
    // the whole page scrolls sideways — on a phone that moves the text you are reading.
    table: ({ node, ...props }) => <div className="md-table-wrap"><table {...props} /></div>,
    ...(pageMap ? { a: ({ node, ...props }) => <MdLink pageMap={pageMap} {...props} /> } : {}),
  }), [pageMap]);

  // The pre-parser walks the whole document with half a dozen regexes. It ran again on every
  // render for a string that had not changed.
  const source = useMemo(() => preprocessMd(children || ''), [children]);
  return (
    <MarkdownConfig.Provider value={cfg}>
    <div className={`md-body ${className}`}>
      <ReactMarkdown
        // remark-math BEFORE the directive plugins: `$x$` has to become a math node before
        // anything else looks at the text, or a formula containing a colon is read as a
        // directive and typeset as nothing.
        // `singleDollarTextMath: false` — math is written `$$…$$`, inline or display.
        //
        // Single-dollar inline math is what TeX users expect, and it cannot be had on this
        // site: remark-math reads `$5 and $10` as a formula and prints `5and10`. Measured on
        // a live page before choosing. That is a blog and documentation platform that sells
        // hosting in dollars, so the sentence is not hypothetical, and the failure is silent —
        // the price does not error, it becomes italic nonsense.
        //
        // The existing seeded content has zero such spans today, so nothing breaks now; this
        // is about the post somebody writes next month.
        remarkPlugins={[...(math ? [[math[0], { singleDollarTextMath: false }]] : []), remarkGfm, remarkDirective, remarkDocBlocks]}
        // rehype-katex AFTER the sanitiser: it emits a deep span tree with dozens of KaTeX
        // classes, and running it first would have all of it stripped as unknown markup.
        //
        // Which puts its output past the sanitiser, so it is worth saying why that is safe:
        // KaTeX renders from the TEXT of a math node, never from HTML, and `trust` defaults to
        // false — which is what disables \href, \url and the \html* commands, the only ones
        // that can emit author-controlled markup. `throwOnError: false` prints the offending
        // source in an error span rather than throwing, and that source is escaped text too.
        // Turning `trust` on would undo this paragraph.
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], rehypeSafeUrls, rehypeSafeStyle, rehypeAnchorPrefix, rehypeIframeAllowlist,
          ...(math ? [[math[1], { output: 'html', throwOnError: false, errorColor: 'var(--error)' }]] : []),
          ...(rehypeHighlight ? [[rehypeHighlight, { detect: true, ignoreMissing: true }]] : [])]}
        components={components}
      >{source}</ReactMarkdown>
      {/* Portal to body so the fixed overlay escapes any modal's transform/stacking
          context (e.g. the Edit-history modal's anim-pop) and truly fills the viewport. */}
      {zoom && createPortal(<div className="md-lightbox" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>, document.body)}
    </div>
    </MarkdownConfig.Provider>
  );
}
