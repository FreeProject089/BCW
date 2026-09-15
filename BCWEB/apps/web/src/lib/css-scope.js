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
  let s = String(input || '').slice(0, 40_000).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [re, name] of REFUSE) if (re.test(s)) { refused.add(name); s = s.replace(new RegExp(re.source, 'gi'), '/*refused*/'); }
  s = s.replace(URL_RE, (all, q, u) => { if (urlOk(u)) return all; refused.add(`url(${u.slice(0, 40)})`); return 'none'; });
  // a stray statement-level @import survives as `@import …;` with no block: drop such lines
  s = s.replace(/^\s*@(import|charset)[^;]*;/gim, '');
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
