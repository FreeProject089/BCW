// The document as a tree — B.MD's public AST.
//
// `<Markdown>` parses and draws in one motion, and there was no way to ask "what is in this
// document" without rendering it. Now there is: the same plugins in the same order, stopped
// after the transform, handed back as mdast. What a link checker, a table-of-contents builder,
// a search indexer or an editor's outline needs — none of which should have to render a page
// to read it.
//
// mdast is the syntax-tree standard the whole remark ecosystem shares, so the tree this
// returns can be fed to any remark utility. The kit's own directives arrive as
// `containerDirective` / `leafDirective` / `textDirective` nodes carrying `data.hName` and
// `data.hProperties` — exactly what the renderer sees.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import { preprocessMd } from './shorthand.js';
import { remarkDocBlocks, slugify } from './directives.js';

/**
 * Parse a document.
 *
 * @param {string} md
 * @param {object} [opt]
 * @param {object} [opt.pageMap]   resolves `[[wiki links]]`, as `<Markdown pageMap>` does
 * @param {boolean} [opt.raw]      skip the shorthand pre-pass and the directive transform —
 *                                 the tree exactly as remark reads the source
 */
export function parseMarkdown(md, opt = {}) {
  const src = opt.raw ? String(md || '') : preprocessMd(md || '', { pageMap: opt.pageMap });
  const proc = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);
  if (!opt.raw) proc.use(remarkDocBlocks);
  const tree = proc.parse(src);
  return proc.runSync(tree);
}

/** Depth-first walk. Return `false` from `fn` to skip a node's children. */
export function walkAst(tree, fn, parent = null) {
  if (!tree || typeof tree !== 'object') return;
  const r = fn(tree, parent);
  if (r === false || !Array.isArray(tree.children)) return;
  for (const child of tree.children) walkAst(child, fn, tree);
}

const textOf = (n) => (n == null ? '' : typeof n.value === 'string' ? n.value : (n.children || []).map(textOf).join(''));

/** Every heading: `{ depth, text, id }` — the ids the renderer gives them. */
export function extractHeadings(md, opt) {
  const out = [];
  walkAst(parseMarkdown(md, opt), (n) => {
    if (n.type === 'heading') out.push({ depth: n.depth, text: textOf(n).trim(), id: slugify(textOf(n)) });
  });
  return out;
}

/**
 * Every link and image, with where it came from.
 *
 * Markdown links (`[x](u)`), images, autolinks, and the directives that carry an `href`/`src`
 * (buttons, cards, files, embeds) are all here — a checker that only read `[x](u)` would miss
 * every download button on a page.
 */
export function extractLinks(md, opt) {
  const out = [];
  walkAst(parseMarkdown(md, opt), (n) => {
    if (n.type === 'link') out.push({ href: n.url, text: textOf(n).trim(), kind: 'link', line: n.position?.start?.line });
    else if (n.type === 'image') out.push({ href: n.url, text: n.alt || '', kind: 'image', line: n.position?.start?.line });
    else if (n.type === 'definition') out.push({ href: n.url, text: n.label || '', kind: 'definition', line: n.position?.start?.line });
    else if (/Directive$/.test(n.type)) {
      const a = n.attributes || {};
      const p = n.data?.hProperties || {};
      const href = a.href || a.url || a.src || p.href || p.src || p['data-src'] || p['data-href'] || '';
      if (href) out.push({ href: String(href), text: textOf(n).trim() || a.title || '', kind: `:${n.name}`, line: n.position?.start?.line });
    }
  });
  return out;
}

/** The document's plain text — for a search index or an excerpt. Code blocks included. */
export function extractText(md, opt) {
  return textOf(parseMarkdown(md, opt)).replace(/[ \t]+\n/g, '\n').trim();
}
