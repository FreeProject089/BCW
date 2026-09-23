// What survives the sanitiser, and what happens to a URL on the way through.
//
// Author-written raw HTML reaches this renderer, so this file is the boundary: everything
// executable is removed, and every URL is checked against the policy in url.js afterwards —
// the schema decides which ATTRIBUTES exist, and only url.js decides where they may point.
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import { safeUrl } from './url.js';
import { safeStyle } from './style-safe.js';
import { urlPolicy, markdownConfig } from './config.js';

export { rehypeSanitize };

// Sanitisation schema (CWE-79): author-written raw HTML in blog/doc bodies is stripped
// of anything executable (scripts, on* handlers, javascript: URLs) by extending the
// safe default schema to ALSO permit exactly what our doc-block system emits — no more.
export const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames || []),
    'div', 'span', 'section', 'details', 'summary', 'nav', 'figure', 'figcaption',
    'video', 'audio', 'source', 'iframe', 'kbd', 'doc-icon', 'doc-kbd', 'doc-comment', 'doc-roadmap', 'doc-replay',
    'doc-tabs', 'doc-schedule', 'doc-time',
    // B.MD 3.0
    'mark', 'ins', 'sup', 'sub', 'time', 'doc-fetch', 'doc-action', 'doc-include', 'doc-openapi', 'doc-mermaid'])],
  attributes: {
    ...defaultSchema.attributes,
    // data-* here are hast (camelCased) property names — rehype-sanitize matches those,
    // so `data-comment` in the source must be allowed as `dataComment` (the DocComment
    // component reads both forms). Without this the whole <doc-comment> was stripped.
    '*': [...new Set([...((defaultSchema.attributes || {})['*'] || []), 'className', 'id', 'style', 'dataName', 'dataKeys', 'dataComment', 'dataLink', 'dataImg', 'dataVideo', 'dataSrc', 'dataJson', 'dataTitle', 'dataAlign', 'dataStatus'])],
    // `a` needs its className tuple REMOVED, not merely extended.
    //
    // The GitHub default schema lists it as ['className', 'data-footnote-backref'] — an
    // allowlist of VALUES, not a permission — and a per-tag entry for an attribute overrides
    // the blanket one in '*'. So every class on every anchor was filtered down to nothing:
    // React then rendered `class=""`, which is why a :button rendered with its href, its
    // colour and its logo, and no styling at all. A `<span>` two characters away kept its
    // class, because `span` has no per-tag entry.
    //
    // Found by comparing a :badge (span, kept) with a :button (anchor, emptied) on the same
    // line. The tuple is dropped and className allowed plainly; the footnote value is still
    // covered, because plainly means every value.
    a: [...new Set([
      ...(((defaultSchema.attributes || {}).a) || []).filter((x) => !(Array.isArray(x) && x[0] === 'className')),
      'className', 'href', 'target', 'rel', 'download',
    ])],
    img: [...new Set([...(((defaultSchema.attributes || {}).img) || []), 'src', 'alt', 'loading', 'className', 'width', 'height', 'decoding'])],
    video: ['src', 'controls', 'poster', 'className', 'style', 'loading'],
    audio: ['src', 'controls', 'className', 'preload'],
    figure: ['className', 'style', 'dataAlign'],
    figcaption: ['className'],
    source: ['src', 'type'],
    iframe: ['src', 'allow', 'allowFullScreen', 'frameBorder', 'loading', 'className'],
    'doc-icon': ['className', 'dataName'],
    'doc-kbd': ['className', 'dataKeys'],
    'doc-comment': ['className', 'dataComment', 'dataLink', 'dataImg', 'dataVideo'],
    'doc-roadmap': ['className', 'dataSrc', 'dataJson', 'dataTitle', 'dataOrientation'],
    'doc-replay': ['className', 'dataSrc', 'dataTitle', 'dataAutoplay', 'dataLoop'],
    'doc-tabs': ['className'],
    'doc-schedule': ['className', 'dataTz', 'dataTitle'],
    'doc-time': ['className', 'dataAt', 'dataTz', 'dataFormat'],
    'doc-fetch': ['className', 'dataSrc', 'dataPath', 'dataRefresh', 'dataFormat', 'dataLabel', 'dataPrefix', 'dataSuffix', 'dataCounter'],
    'doc-action': ['className', 'dataHref', 'dataMethod', 'dataBody', 'dataConfirm', 'dataDone', 'dataLabel', 'dataColor', 'dataOnce', 'dataIcon', 'dataCounter'],
    'doc-include': ['className', 'dataSrc'],
    'doc-openapi': ['className', 'dataSrc', 'dataTag', 'dataFilter', 'dataTitle', 'dataToc'],
    'doc-mermaid': ['className', 'dataCode', 'dataTitle', 'dataTheme', 'dataLook'],
  },
};

// After sanitising, drop any iframe whose src is not on the allowlist — YouTube and the
// Spotify embed by default, whatever `configureMarkdown({ allowIframes })` says otherwise.
// Only embeds the host vouches for survive; an author can't smuggle an arbitrary frame.
export function rehypeIframeAllowlist() {
  return (tree) => {
    const allow = markdownConfig().allowIframes;
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'iframe' || !parent) return;
      const src = String(node.properties?.src || '');
      const ok = allow instanceof RegExp ? allow.test(src) : typeof allow === 'function' ? !!allow(src) : false;
      if (!ok) { parent.children.splice(index, 1); return index; }
    });
  };
}

/**
 * Where every in-page anchor in the docs and the blog goes.
 *
 * rehype-sanitize rewrites each `id` it keeps to `user-content-<id>` — its `clobberPrefix`
 * default, which is what stops a heading called "Body" from shadowing `document.body`. It does
 * NOT rewrite the `href="#…"` pointing at that id, and nothing outside the pipeline knew the
 * prefix existed. So every anchor on the site resolved to nothing: the "On this page" rail, the
 * in-page `:::toc`, a hand-written `[see](#setup)`, a shared `#link`, and the jump from a
 * comment to the paragraph it is about. Clicking did precisely nothing, which reads as a dead
 * page rather than as a bug.
 *
 * Kept as a constant rather than repeated: it is a library default, and a copy of it would be
 * wrong the first time that default changed.
 */
export const ANCHOR_PREFIX = 'user-content-';

/** The element an anchor id points at. Accepts either form — a URL people already shared
 *  carries the bare id, while the DOM carries the prefixed one. */
export function anchorEl(id) {
    const raw = String(id || '').replace(/^#/, '');
    if (!raw) return null;
    return document.getElementById(raw.startsWith(ANCHOR_PREFIX) ? raw : ANCHOR_PREFIX + raw)
        || document.getElementById(raw);
}

/** Put the prefix on every in-document link, so the href matches the id sanitize wrote.
 *  Runs AFTER sanitize — before it, the ids have not been rewritten yet. */
export function rehypeAnchorPrefix() {
    return (tree) => visit(tree, 'element', (n) => {
        if (n.tagName !== 'a') return;
        const href = n.properties?.href;
        if (typeof href !== 'string' || !href.startsWith('#')) return;
        if (href.startsWith(`#${ANCHOR_PREFIX}`) || href === '#') return;
        n.properties.href = `#${ANCHOR_PREFIX}${href.slice(1)}`;
    });
}


// remark transform: directives → styled hast elements, heading anchors, ::toc.
// Step markers. Four alphabets, because a procedure, a set of options and a list of phases
// are not the same shape and reusing "1." for all three is how a document stops being
// scannable. Anything past the alphabet falls back to the number rather than wrapping round
// to A again, which would silently duplicate a marker.

/**
 * Where a URL is allowed to point — after the schema has decided which attributes exist.
 *
 * The two are not the same question and were answered by one mechanism. rehype-sanitize
 * checks the PROTOCOL of `href` and `src` against a list, which stops `javascript:` and
 * `data:` and does nothing about three other things:
 *
 *   · `//evil.com` — no colon before the first slash, so it is "relative" to the schema and
 *     protocol-relative to a browser. A link that reads as internal and is not.
 *   · a host allowlist, for a site whose authors are not staff.
 *   · `target="_blank"` in raw HTML with no `rel`, which hands the opened page a
 *     `window.opener` back to yours.
 *
 * So every URL-bearing attribute goes through url.js here, once, and a refused one takes its
 * element's link with it rather than leaving a dead anchor that looks live.
 */
const URL_ATTR = { a: 'href', img: 'src', video: 'src', audio: 'src', source: 'src', iframe: 'src' };

export function rehypeSafeUrls() {
  const policy = urlPolicy();
  return (tree) => {
    visit(tree, 'element', (node) => {
      const attr = URL_ATTR[node.tagName];
      if (!attr) return;
      const p = node.properties || (node.properties = {});
      const raw = p[attr];
      if (typeof raw !== 'string' || !raw) return;
      const kind = node.tagName === 'a' ? (p.download != null ? 'download' : 'link') : 'media';
      const r = safeUrl(raw, { kind, policy });
      if (!r.ok) {
        // The attribute goes, the content stays. Removing the whole element would delete the
        // author's words because their link was wrong.
        delete p[attr];
        if (node.tagName === 'a') { delete p.target; delete p.rel; delete p.download; }
        p.className = [...(Array.isArray(p.className) ? p.className : p.className ? [p.className] : []), 'doc-url-blocked'];
        return;
      }
      p[attr] = r.href;
      // An anchor that opens a tab gets both keywords, whatever the author wrote. `noreferrer`
      // implies `noopener` in every browser that has the second; the pair is what a reader of
      // this file can check.
      if (node.tagName === 'a' && r.external) {
        p.target = '_blank';
        p.rel = 'noopener noreferrer';
      }
    });
  };
}

// An author-written `style` attribute is filtered by style-safe.js — its own file, with
// no imports, so the rule that decides what an author may put in a `style=` can be run by a
// test runner that does not have this renderer's dependency tree. Re-exported here because
// this is the module the pipeline is assembled from.
export { safeStyle };

/** Run every `style` through it. `@import` cannot appear in an attribute, so it is not here. */
export function rehypeSafeStyle() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      const p = node.properties;
      if (!p || typeof p.style !== 'string' || !p.style) return;
      const clean = safeStyle(p.style);
      if (clean) p.style = clean; else delete p.style;
    });
  };
}
