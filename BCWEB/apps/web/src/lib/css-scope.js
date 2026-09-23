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
    // A backslash before a newline is a LINE CONTINUATION inside a string: the browser deletes
    // both characters and joins the halves, so `"https:\⏎//evil/x"` is `"https://evil/x"`. It
    // is removed here, before anything matches literal text, for the same reason the hex
    // escapes below are — and because the string scanner's `\\.` cannot match it (`.` is not a
    // newline), which made it a way to write a URL that no rule in this file could see.
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
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
const FN_START = /(?:-webkit-|-ms-|-moz-)?(?:image-set|src)\s*\(/gi;
const STR_RE = /(['"])((?:[^'"\\]|\\.)*)\1/g;
/** Functions that may appear INSIDE an image-set()/src(): a URL we have already checked, or a
 *  descriptor that carries no URL at all. Anything else — `var()`, `env()`, `attr()` — hides
 *  its value from this file, and a value this file cannot read is refused, not trusted. */
const FN_NESTED_OK = /^(?:-webkit-|-ms-|-moz-)?(?:url|src|image-set|type|format|tech|local)$/i;
/** Descriptors whose string argument is a MIME type or a font name, not a URL. */
const FN_META = /(?:type|format|tech|local)\s*\([^()]*\)/gi;

/** Index just past the `)` that closes the `(` at `open`, or -1 (strings are skipped). */
function closeParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") {
      const q = c;
      for (i++; i < s.length; i++) { if (s[i] === '\\') { i++; } else if (s[i] === q) break; }
      if (i >= s.length) return -1; // unterminated string: nothing here can be read
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/** What makes this argument list unreadable or forbidden, or null when every part checks out. */
function badImageArgs(inner) {
  for (const f of inner.matchAll(/([\w-]+)\s*\(/g)) if (!FN_NESTED_OK.test(f[1])) return `${f[1]}()`;
  for (const m of inner.replace(FN_META, '').matchAll(STR_RE)) if (!urlOk(m[2])) return m[2];
  return null;
}

/**
 * `image-set(…)` and `src(…)` take a URL as a bare STRING, so URL_RE never sees them.
 *
 * Scanned with balanced parentheses rather than `([^()]*)`, because the regex form could not
 * see past a nested function — which made `image-set(var(--u) 1x)` invisible to it, with the
 * URL parked in a custom property. The whole function is replaced rather than edited: half a
 * rewritten image-set is not a value.
 */
function refuseImageFns(s, refused) {
  let out = ''; let i = 0; let m;
  FN_START.lastIndex = 0;
  while ((m = FN_START.exec(s))) {
    if (m.index > 0 && /[\w-]/.test(s[m.index - 1])) continue; // part of a longer identifier
    const open = m.index + m[0].length - 1;
    const end = closeParen(s, open);
    out += s.slice(i, m.index);
    // No balanced close: the function is refused, and scanning resumes just after its `(`.
    // Returning here instead would drop the rest of the stylesheet — a refusal that deletes
    // the author's next rule is the failure mode this file has already been bitten by once.
    if (end < 0) {
      refused.add('image url(unterminated)');
      out += 'none';
      i = open + 1; FN_START.lastIndex = i;
      continue;
    }
    const bad = badImageArgs(s.slice(open + 1, end - 1));
    if (bad === null) out += s.slice(m.index, end);
    else { refused.add(`image url(${String(bad).slice(0, 40)})`); out += 'none'; }
    i = end;
    FN_START.lastIndex = end;
  }
  return out + s.slice(i);
}

/** A declaration that takes a box out of the page's flow and pins it to the viewport. */
const POSITION_ESCAPE = /^\s*(fixed|sticky)\s*(!\s*important\s*)?$/i;
const POSITION_ESCAPE_G = /position\s*:\s*(fixed|sticky)\s*(?:!\s*important\s*)?;?/gi;

/**
 * One author-typed CSS VALUE (a background, a colour, a border colour) that is written into a
 * `style` attribute on a public page. Returns it when it is safe, '' when it is not.
 *
 * The page stylesheet and the inline-style field go through `scopeCss` / `safeInlineStyle`;
 * the inspector's own colour and background fields did not, so `background: url(https://…)`
 * typed there fetched a third-party pixel from every visitor (S4). Same rules, read on the
 * DECODED text: no url() off this site, no image-set()/src() with a URL, none of the refused
 * constructs, and no `;`, `{`, `}` or `<` — a value is one value, not a way to start another
 * declaration.
 */
export function safeCssValue(input) {
  const raw = typeof input === 'string' ? input.trim().slice(0, 600) : '';
  if (!raw) return '';
  const read = decodeCssEscapes(raw);
  if (/[;{}<>]/.test(read) || /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(read)) return '';
  if (REFUSE.some(([re]) => re.test(read))) return '';
  const urls = [...read.matchAll(URL_RE)];
  if (urls.some((m) => !urlOk(m[2]))) return '';
  // A `url(` the pattern above could not read (an unterminated one, a nested quote) is not
  // a value this function can vouch for: every opening must be one that was checked.
  if ((read.match(/url\s*\(/gi) || []).length !== urls.length) return '';
  const refused = new Set();
  refuseImageFns(read, refused);
  return refused.size ? '' : raw;
}

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
  // `position: fixed` / `sticky`: the declaration is taken out, the rule around it is kept.
  // A prefixed selector confines what a rule MATCHES, not where a fixed box is PAINTED: it
  // resolves against the viewport unless an ancestor has a transform, and the stacked phone
  // layout had none — so a block could cover the whole site, header included (S5). Same
  // refusal as B.MD's style-safe.js, for the same reason.
  s = s.replace(POSITION_ESCAPE_G, (all, how) => { refused.add(`position: ${how.toLowerCase()}`); return ''; });
  s = s.replace(URL_RE, (all, q, u) => { if (urlOk(u)) return all; refused.add(`url(${u.slice(0, 40)})`); return 'none'; });
  // After url(), because a url() inside an image-set has already been dealt with and a
  // refused one now reads `none`, which is a legal image-set entry.
  s = refuseImageFns(s, refused);
  const out = [];
  walk(s, scope, out, 0);
  return { css: out.join('\n'), refused: [...refused] };
}

/** Class tokens an author may put on a block: plain utility-shaped names only. */
export function safeClasses(input) {
  return String(input || '').split(/\s+/).filter((c) => c && c.length <= 80 && /^[a-zA-Z0-9_:\-/[\]#%.!()]+$/.test(c)).slice(0, 40).join(' ');
}

/**
 * Inline declarations typed by an author → a React style object, with the same refusals.
 *
 * Every test runs against the DECODED declaration — what the browser will read — while what is
 * emitted is what the author wrote. The two used to be the same string, so this door had none
 * of the three protections the stylesheet door has: `\75 rl(https://…)` carried no literal
 * `url(` to match, and `image-set("https://…" 1x)` / `src("https://…")` name a URL without one
 * at all. All three reached the DOM and fetched.
 */
export function safeInlineStyle(input) {
  const style = {};
  const src = String(input || '').slice(0, 4000);
  if (REFUSE.some(([re]) => re.test(decodeCssEscapes(src)))) return style;
  for (const decl of src.split(';')) {
    const k = decl.indexOf(':'); if (k < 0) continue;
    const prop = decl.slice(0, k).trim().toLowerCase(); const val = decl.slice(k + 1).trim();
    if (!/^[a-z-]+$/.test(prop) || !val) continue;
    const read = decodeCssEscapes(val);
    // See POSITION_ESCAPE: the stack layout gave a fixed box nothing to be confined by.
    if (decodeCssEscapes(prop) === 'position' && POSITION_ESCAPE.test(read)) continue;
    if (/url\s*\(/i.test(read) && !urlOk((read.match(URL_RE) ? read.replace(URL_RE, (a, q, u) => u) : ''))) continue;
    const refused = new Set();
    refuseImageFns(read, refused);
    if (refused.size) continue;
    const camel = prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    style[camel] = val;
  }
  return style;
}
