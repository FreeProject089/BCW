// Custom CSS for a studio page, confined to that page.
//
// A project editor may style their page; they may not restyle the site around it, fetch
// from other origins, or run anything. So every selector is prefixed with the canvas's own
// scope, and the handful of CSS features that reach outside the page are refused by name
// and REPORTED — a rule that vanished silently is a rule the author rewrites five times.
//
// The scoper is a tokenizer over `{ }` nesting, not a CSS parser: at-rules with blocks
// (@media, @supports, @container, @layer) are recursed into; @keyframes and @font-face are
// kept as they are (their inner "selectors" are steps and descriptors, not elements).

const REFUSE = [
  [/@import\b/i, '@import'],
  [/expression\s*\(/i, 'expression()'],
  [/behavior\s*:/i, 'behavior:'],
  [/-moz-binding\s*:/i, '-moz-binding'],
  [/javascript\s*:/i, 'javascript:'],
  [/@namespace\b/i, '@namespace'],
];
// url() may point at this site, at an anchor, or at an inline image — never elsewhere.
const URL_RE = /url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const urlOk = (u) => /^(\/(?!\/)|#|data:image\/(?:png|jpeg|gif|webp|svg\+xml);)/i.test(u.trim());

/**
 * A CSS escape is part of the SYNTAX, not of the value.
 *
 * `background: \75 rl(https://…)` is `url(https://…)` to every browser: `\75` is the code
 * point for `u`, and the single space after a hex escape is the terminator, not a space in
 * the value. A filter that matches the literal text `url(` therefore sees nothing, passes
 * the declaration through untouched, and the browser then fetches the third-party URL — the
 * exact channel this file exists to close.
 *
 * So escapes are decoded FIRST, and every later rule runs against the text the browser will
 * actually read. Decoding is lossless for anything legitimate: a decoded `content: "\201C"`
 * is the same character the escape stood for.
 */
function decodeCssEscapes(input) {
  return String(input)
    .replace(/\\([0-9a-fA-F]{1,6})(\r\n|[ \t\r\n\f])?/g, (all, hex) => {
      const cp = parseInt(hex, 16);
      // 0 and anything past the last code point are replaced, as CSS says.
      if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD';
      return String.fromCodePoint(cp);
    })
    .replace(/\\([^\r\n\f0-9a-fA-F])/g, '$1');
}

/**
 * The image functions that take a URL WITHOUT writing `url()`.
 *
 * `image-set("https://evil/x.png" 1x)` and `src("https://evil/x.png")` both fetch, and
 * neither contains a `url(` token, so URL_RE never saw them. Each string inside one of
 * these is a URL and goes through the same test; if any of them fails, the whole function
 * is replaced rather than edited, because half a rewritten image-set is not a value.
 */
const FN_URL_RE = /\b(?:-webkit-|-ms-|-moz-)?(?:image-set|src)\s*\(([^()]*)\)/gi;
const STR_RE = /(['"])((?:[^'"\\]|\\.)*)\1/g;

const BLOCK_AT = /^@(media|supports|container|layer|scope)\b/i;
const KEEP_AT = /^@(keyframes|-webkit-keyframes|font-face|property|counter-style|page)\b/i;

function prefixSelector(sel, scope) {
  return sel.split(',').map((raw) => {
    const s = raw.trim();
    if (!s) return '';
    // :root / html / body mean "the page" to an author; here the page is the scope.
    if (/^(:root|html|body)\b/i.test(s)) return s.replace(/^(:root|html|body)/i, scope);
    if (s.startsWith(scope)) return s;
    return `${scope} ${s}`;
  }).filter(Boolean).join(', ');
}

function walk(src, scope, out, depth) {
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    // the matching close brace
    let d = 1, j = open + 1;
    while (j < src.length && d > 0) { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++; }
    const body = src.slice(open + 1, j - 1);
    if (head.startsWith('@')) {
      if (BLOCK_AT.test(head)) { out.push(`${head}{`); walk(body, scope, out, depth + 1); out.push('}'); }
      else if (KEEP_AT.test(head)) out.push(`${head}{${body}}`);
      // any other at-rule with a block (unknown) is dropped
    } else if (head) {
      out.push(`${prefixSelector(head, scope)}{${body.trim()}}`);
    }
    i = j;
  }
}

/**
 * `{ css, refused }` — the scoped stylesheet and the names of what was taken out.
 * `scope` is a selector, e.g. `[data-cv="c1"]`.
 */
export function scopeCss(input, scope) {
  const refused = new Set();
  // Escapes first: every rule below matches literal text, and a CSS escape is how you write
  // the same token without that text. See decodeCssEscapes.
  let s = decodeCssEscapes(String(input || '').slice(0, 40_000)).replace(/\/\*[\s\S]*?\*\//g, '');
  // Statement-level at-rules (`@import …;`, `@charset …;`) go FIRST, whole statement and
  // semicolon included. Refusing them token by token instead left `/*refused*/ none;` behind,
  // and `walk()` reads that leftover as the start of the NEXT rule's selector — so refusing an
  // @import silently took the rule that followed it down with it. The author saw one line
  // refused and a second, valid rule do nothing.
  s = s.replace(/@(import|charset)\b[^;}]*;?/gi, (all, name) => { refused.add(`@${name.toLowerCase()}`); return ''; });
  for (const [re, name] of REFUSE) if (re.test(s)) { refused.add(name); s = s.replace(new RegExp(re.source, 'gi'), '/*refused*/'); }
  s = s.replace(URL_RE, (all, q, u) => { if (urlOk(u)) return all; refused.add(`url(${u.slice(0, 40)})`); return 'none'; });
  // After url(), because a url() inside an image-set has already been dealt with and a
  // refused one now reads `none`, which is a legal image-set entry.
  s = s.replace(FN_URL_RE, (all, inner) => {
    let bad = null;
    for (const m of inner.matchAll(STR_RE)) if (!urlOk(m[2])) { bad = m[2]; break; }
    if (bad === null) return all;
    refused.add(`image url(${bad.slice(0, 40)})`);
    return 'none';
  });
  const out = [];
  walk(s, scope, out, 0);
  return { css: out.join('\n'), refused: [...refused] };
}

/** Class tokens an author may put on a block: plain utility-shaped names only. */
export function safeClasses(input) {
  return String(input || '').split(/\s+/).filter((c) => c && c.length <= 80 && /^[a-zA-Z0-9_:\-/[\]#%.!()]+$/.test(c)).slice(0, 40).join(' ');
}

/** Inline declarations typed by an author → a React style object, with the same refusals. */
export function safeInlineStyle(input) {
  const style = {};
  const src = String(input || '').slice(0, 4000);
  if (REFUSE.some(([re]) => re.test(src))) return style;
  for (const decl of src.split(';')) {
    const k = decl.indexOf(':'); if (k < 0) continue;
    const prop = decl.slice(0, k).trim().toLowerCase(); let val = decl.slice(k + 1).trim();
    if (!/^[a-z-]+$/.test(prop) || !val) continue;
    if (/url\s*\(/i.test(val) && !urlOk((val.match(URL_RE) ? val.replace(URL_RE, (a, q, u) => u) : ''))) continue;
    const camel = prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    style[camel] = val;
  }
  return style;
}
