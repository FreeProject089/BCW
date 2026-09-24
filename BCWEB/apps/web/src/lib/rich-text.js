// A translated sentence with a few words of markup in it, drawn WITHOUT innerHTML.
//
// Five strings carry markup (`cc.sub`, `cc.pluginnote`, `kf.sub`, `radm.paste`, `cart.agree`):
// a <b>, a <code>, a link to a legal page. They used to reach the page through
// dangerouslySetInnerHTML — and a string reaches `t()` from more than the compiled dictionary.
// The SiteLocale override layer (GET /api/site/i18n/:code) is written by `translate_site`, a
// capability that exists precisely so a TRANSLATOR who is not an admin can reword the site. So
// the wording of `cart.agree` was, in effect, HTML that a non-admin could write into the
// hosting checkout of every visitor, and `cc.sub` / `kf.sub` into the screens admins open
// (full audit Sept 24 2026, W2).
//
// This reads the markup as data: a short allow-list of inline tags is built with
// React.createElement, every other character is text (React escapes it), and nothing in the
// string can name an attribute this file does not set itself. A link goes to a path on this
// site or nowhere. Written in plain JS (no JSX) so node --test can render it.
import { createElement, Fragment } from 'react';

const INLINE = new Set(['b', 'strong', 'i', 'em', 'code', 'span', 'a', 'br']);
// Classes a translated sentence may ask for. Anything else is dropped: `fixed inset-0 z-50`
// would draw a translator's element over the page.
const CLASSES = new Set(['font-mono', 'underline', 'font-semibold', 'text-[var(--accent-ink)]']);
const TOKEN = /<(\/?)([a-zA-Z]+)\b([^<>]*)>/g;

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** A path on this site, or null. `//host` and `/\host` are other sites to a browser. */
export function sitePath(href) {
  const h = String(href || '').trim();
  return /^\/(?![/\\])[^\s"'<>\\]*$/.test(h) ? h : null;
}

/**
 * The string as a tree of `{ tag, props, children }` and text. Unknown tags, stray `<`, and
 * closers without an opener are TEXT (drawn as typed), so nothing is lost and nothing runs.
 */
export function parseRich(input) {
  const src = String(input ?? '');
  const root = { tag: null, props: {}, children: [] };
  const stack = [root];
  let last = 0; let m;
  TOKEN.lastIndex = 0;
  const text = (s) => { if (s) stack[stack.length - 1].children.push(s); };
  while ((m = TOKEN.exec(src))) {
    const [all, close, rawTag, attrs] = m;
    const tag = rawTag.toLowerCase();
    if (!INLINE.has(tag)) continue;                      // stays in the text run
    text(src.slice(last, m.index));
    last = m.index + all.length;
    if (close) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;                     // close it (and anything left open inside)
      else text(all);                                    // a closer with no opener is text
      continue;
    }
    if (tag === 'br') { stack[stack.length - 1].children.push({ tag: 'br', props: {}, children: [] }); continue; }
    const props = {};
    const cls = (attr(attrs, 'class') || '').split(/\s+/).filter((c) => CLASSES.has(c));
    if (cls.length) props.className = cls.join(' ');
    if (tag === 'a') {
      const href = sitePath(attr(attrs, 'href'));
      if (href) props.href = href;
      if (href && /^_blank$/i.test(attr(attrs, 'target') || '')) { props.target = '_blank'; props.rel = 'noopener noreferrer'; }
    }
    const node = { tag, props, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  text(src.slice(last));
  return root.children;
}

function toReact(nodes) {
  return nodes.map((n, i) => (typeof n === 'string' ? n
    : createElement(n.tag, { key: i, ...n.props }, ...(n.tag === 'br' ? [] : toReact(n.children)))));
}

/**
 * `<RichText text={t('cart.agree', '…')} />` — the sentence with its inline markup, drawn as
 * React elements. `as` is the wrapper element (default span); other props go on it.
 */
export function RichText({ text, as = 'span', ...rest }) {
  return createElement(as, rest, createElement(Fragment, null, ...toReact(parseRich(text))));
}
