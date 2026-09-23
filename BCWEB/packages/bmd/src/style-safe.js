// An author-written `style` attribute, filtered declaration by declaration.
//
// Its own file, with no imports, so the rule can be run by a test runner that does not have
// the renderer's dependency tree — the checks below are the security boundary for every
// `style=` an author writes in a blog post, a doc page or a comment, and a boundary nothing
// can execute is a boundary nobody measures. sanitize.js re-exports it, so nothing that
// imported it from there had to change.
//
// The schema allows `style` on everything, and that is not a mistake — cards carry a colour,
// a card's cover carries a background image, and taking it away would take those with it. It
// is also the one allowed attribute whose VALUE nothing looked at:
//
//   · `expression(…)` and `url(javascript:…)` are legacy script vectors. Dead in every
//     current browser, and free to refuse.
//   · `position: fixed` needs no script at all. A `<div style="position:fixed;inset:0">` in
//     a comment covers the page — a defacement, or a login box drawn over somebody else's.
//   · `@import` and `-moz-binding` pull in a stylesheet, or in one old engine, code.
//
// A property allowlist would be the stricter answer and the wrong one here: it would have to
// grow every time somebody styles something, and the day it is missing a property is the day
// a card renders wrong for a reason nobody can find. This refuses the constructs that attack
// and leaves ordinary CSS alone.

const CSS_BAD_VALUE = /expression\s*\(|javascript\s*:|vbscript\s*:|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data:text\/html)/i;
const CSS_BAD_PROP = /^(behavior|-moz-binding|-ms-behavior)$/i;

/** Declarations whose VALUE decides it: `position` is fine until it takes over the page.
 *  A Map, not an object literal: `prop` comes from the author, and `style="constructor:1"`
 *  looked up `Object`'s own constructor on a plain object, found something that is not a
 *  RegExp, and threw — inside a tree walk, which took the whole document's render with it. */
const CSS_ESCAPES_FLOW = new Map([['position', /^\s*(fixed|sticky)\s*$/i]]);

/**
 * A CSS escape is part of the SYNTAX, not of the value.
 *
 * `position: \66 ixed` is `position: fixed` to every browser — an escape is decoded while the
 * ident is tokenised, in a property name exactly as in a value. Every rule above matches
 * literal text, so each one was one escape away from matching nothing at all. The declaration
 * that is CHECKED is therefore the decoded one; the declaration that is KEPT is what the
 * author wrote, so nothing legitimate is rewritten on the way through.
 */
export function decodeCssEscapes(input) {
  return String(input)
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
    .replace(/\\([0-9a-fA-F]{1,6})(\r\n|[ \t\r\n\f])?/g, (all, hex) => {
      const cp = parseInt(hex, 16);
      if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '�';
      return String.fromCodePoint(cp);
    })
    .replace(/\\([^\r\n\f0-9a-fA-F])/g, '$1');
}

export function safeStyle(value) {
  return String(value || '')
    .split(';')
    .map((decl) => {
      const read = decodeCssEscapes(decl);
      if (CSS_BAD_VALUE.test(read)) return '';
      const at = read.indexOf(':');
      if (at < 0) return '';
      const prop = read.slice(0, at).trim().toLowerCase();
      const val = read.slice(at + 1);
      if (!prop || CSS_BAD_PROP.test(prop)) return '';
      if (CSS_ESCAPES_FLOW.get(prop)?.test(val)) return '';
      return decl.trim();
    })
    .filter(Boolean)
    .join('; ');
}
