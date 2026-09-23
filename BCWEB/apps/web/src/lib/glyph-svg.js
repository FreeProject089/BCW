// The pure half of editor/glyph-image.js (M17): which file a picker name draws from, and the
// SVG made safe and coloured. No imports, so node --test can load it (test/glyph-svg.test.mjs).

const PH = /^(?:ph|phosphor)(?:-(thin|light|regular|bold|fill|duotone))?:([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/**
 * Where a picker name draws from: `{ kind: 'url'|'svg', url, brand }`, or null.
 * `cfg` is the B.MD config (its `cdn` URL builders and `appIcons`); `fileName` turns a lucide
 * name into its CDN file name (lucideFileName in editor/icon-picker.jsx).
 */
export function glyphSource(name, cfg, fileName = (n) => n) {
  const n = String(name || '').trim();
  const cdn = cfg?.cdn || {};
  const app = n.match(/^app:(.+)$/);
  if (app) { const url = cfg?.appIcons?.[app[1]] || ''; return url ? { kind: 'url', url } : null; }
  const ph = n.toLowerCase().match(PH);
  if (ph) {
    const w = ph[1] && ph[1] !== 'regular' ? ph[1] : 'regular';
    const path = w === 'regular' ? `regular/${ph[2]}` : `${w}/${ph[2]}-${w}`;
    return typeof cdn.phosphor === 'function' ? { kind: 'svg', url: cdn.phosphor(path) } : null;
  }
  const si = n.toLowerCase().match(/^(?:simple|si):([a-z0-9-]+)$/);
  if (si) return typeof cdn.brand === 'function' ? { kind: 'svg', url: cdn.brand(si[1]), brand: true } : null;
  if (/^[A-Za-z0-9-]+$/.test(n) && typeof cdn.lucide === 'function') return { kind: 'svg', url: cdn.lucide(fileName(n)) };
  return null;
}

/**
 * The SVG text, coloured and made safe to host: no script, no event handler, no foreign
 * content, no reference outside the file. A brand keeps its own colour (that is what a brand
 * mark is). Throws `not_svg` on anything that is not an SVG document.
 */
export function colourSvg(text, color, { brand = false } = {}) {
  let s = String(text || '');
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s)) throw new Error('not_svg');
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '');
  // A fixed size for the file; the drawing scales from its viewBox.
  s = s.replace(/<svg\b([^>]*)>/i, (m, attrs) => `<svg${attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')} width="512" height="512">`);
  if (!brand && /^#[0-9a-f]{6}$/i.test(color || '')) {
    if (/currentColor/.test(s)) s = s.replace(/currentColor/g, color);
    else s = s.replace(/<svg\b/i, `<svg fill="${color}"`);
  }
  return s;
}

/** A file name for the uploaded SVG, from the picker name. */
export const glyphFileName = (name) => `${String(name || '').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'icon'}.svg`;
