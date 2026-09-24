// SVG an author pastes into a studio block, made safe for a page every visitor loads.
//
// No DOMParser on purpose: the same function runs in the browser (the block's field) and
// under react-dom/server (check-studio.mjs), so it is a small tokenizer over the markup.
// The rule is an ALLOW-list, never a deny-list: a tag or attribute that is not named here
// is dropped, whatever it is. What survives is drawing — paths, shapes, gradients, filters,
// text — and nothing that runs, fetches or frames.

const TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath', 'mask', 'symbol', 'use', 'title', 'desc',
  'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'femerge', 'femergenode', 'feflood', 'fecomposite',
  'fedropshadow', 'feturbulence', 'fedisplacementmap', 'femorphology', 'fecomponenttransfer', 'fefunca', 'fefuncr', 'fefuncg', 'fefuncb',
  'marker', 'metadata',
]);
// Tags whose CONTENT must go with them: a script's body is code, a style's body is CSS
// that could fetch, a foreignObject is HTML.
// (<a> is not here: an unknown tag is unwrapped and its drawing kept, which is what a link
// around a shape should become.)
const DROP_WITH_CONTENT = ['script', 'style', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'image', 'img', 'animate', 'set', 'animatemotion', 'animatetransform'];

// `image-set()` / `src()` name a URL without writing `url(` (the same pair css-scope.js refuses).
const BAD_VALUE = /javascript:|vbscript:|data:(?!image\/(?:png|jpeg|gif|webp|svg\+xml))|expression\s*\(|behavior\s*:|@import|url\s*\(\s*['"]?(?!#)|image-set\s*\(|(?:^|[^\w-])src\s*\(/i;
// A pasted drawing sits in a box on somebody's page; pinned, it would sit over the page instead.
const ESCAPES_BOX = /position\s*:\s*(?:fixed|sticky)/i;

// The character references an attribute value is decoded through before anything reads it.
// Only these five by name: any other named reference (`&colon;`, `&lpar;`, …) makes the
// attribute unreadable here, and an attribute this cannot read is dropped, not trusted.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeRefs(v) {
  let unreadable = false;
  const out = v.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);?/g, (all, ref) => {
    if (ref[0] === '#') {
      const n = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '�';
    }
    if (Object.prototype.hasOwnProperty.call(NAMED, ref) && all.endsWith(';')) return NAMED[ref];
    unreadable = true;
    return all;
  });
  return unreadable ? null : out;
}
const escAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cleanAttrs(attrs) {
  const out = [];
  const re = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m;
  while ((m = re.exec(attrs))) {
    const name = m[1]; const lname = name.toLowerCase();
    const raw = m[2] == null ? '' : m[2];
    // Judged as the HTML parser will hand it to the CSS / URL machinery: character references
    // decoded. A backslash is a CSS escape (`\75 rl(`), which no drawing attribute needs.
    const val = decodeRefs(raw.replace(/^["']|["']$/g, ''));
    if (val == null || val.includes('\\')) continue;
    if (lname.startsWith('on')) continue;                       // every event handler
    if (lname === 'href' || lname === 'xlink:href') { if (!/^#[\w:-]+$/.test(val.trim())) continue; }
    if (BAD_VALUE.test(val)) continue;                          // scripts, external urls, imports
    if (lname === 'style' && ((/url\s*\(/i.test(val) && !/url\s*\(\s*['"]?#/i.test(val)) || ESCAPES_BOX.test(val))) continue;
    // Emitted re-encoded from the decoded value: what was checked is exactly what is parsed.
    out.push(m[2] == null ? name : `${name}="${escAttr(val)}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

/**
 * The sanitised markup, or '' when there is no <svg> root to keep. Capped at 200 KB — a
 * bigger file is an asset to upload, not a block to paste.
 */
export function sanitizeSvg(input) {
  let s = String(input || '').slice(0, 200_000);
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  for (const tag of DROP_WITH_CONTENT) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '').replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }
  // ONE pass that rebuilds the markup: an allow-listed tag is written back from its parts, and
  // every other `<` or `>` becomes text. Removing an unknown tag used to leave its neighbours
  // side by side, so `<<x>img src=x onerror=…>` came out as `<img src=x onerror=…>` — a real
  // HTML element once innerHTML parses it (full audit Sept 24 2026, W1). Now the only `<` in
  // the result is one this function wrote.
  s = s.replace(/<\/?([a-zA-Z_:][\w:.-]*)([^<>]*)>|[<>]/g, (all, tag, attrs) => {
    if (!tag) return all === '<' ? '&lt;' : '&gt;';
    const lname = tag.toLowerCase();
    if (!TAGS.has(lname)) return '';
    if (all.startsWith('</')) return `</${tag}>`;
    const selfClose = /\/\s*$/.test(attrs);
    return `<${tag}${cleanAttrs(attrs.replace(/\/\s*$/, ''))}${selfClose ? '/' : ''}>`;
  });
  s = s.trim();
  const start = s.toLowerCase().indexOf('<svg');
  if (start < 0) return '';
  s = s.slice(start);
  const end = s.toLowerCase().lastIndexOf('</svg>');
  if (end < 0) return '';
  return s.slice(0, end + 6);
}

/** Does the markup still hold anything the sanitiser would remove? (for a "what was dropped" note) */
export function svgRefusals(input) {
  const s = String(input || '');
  const found = [];
  if (/<script\b/i.test(s)) found.push('script');
  if (/\son[a-z]+\s*=/i.test(s)) found.push('event handlers');
  if (/<(foreignObject|iframe|image|img|a)\b/i.test(s)) found.push('embedded content');
  if (/(?:xlink:)?href\s*=\s*["']?(?!#)/i.test(s)) found.push('external references');
  if (/<style\b/i.test(s)) found.push('style blocks');
  if (/<animate/i.test(s)) found.push('SMIL animation');
  return found;
}
