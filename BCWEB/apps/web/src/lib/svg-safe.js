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

const BAD_VALUE = /javascript:|vbscript:|data:(?!image\/(?:png|jpeg|gif|webp|svg\+xml))|expression\s*\(|behavior\s*:|@import|url\s*\(\s*['"]?(?!#)/i;

function cleanAttrs(attrs) {
  const out = [];
  const re = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m;
  while ((m = re.exec(attrs))) {
    const name = m[1]; const lname = name.toLowerCase();
    const raw = m[2] == null ? '' : m[2];
    const val = raw.replace(/^["']|["']$/g, '');
    if (lname.startsWith('on')) continue;                       // every event handler
    if (lname === 'href' || lname === 'xlink:href') { if (!/^#[\w:-]+$/.test(val.trim())) continue; }
    if (BAD_VALUE.test(val)) continue;                          // scripts, external urls, imports
    if (lname === 'style' && /url\s*\(/i.test(val) && !/url\s*\(\s*['"]?#/i.test(val)) continue;
    out.push(m[2] == null ? name : `${name}="${val.replace(/"/g, '&quot;')}"`);
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
  s = s.replace(/<\/?([a-zA-Z_:][\w:.-]*)([^>]*)>/g, (all, tag, attrs) => {
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
