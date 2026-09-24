// Tiling SVG patterns for block and shape backgrounds, generated on demand as data URIs.
//
// Every pattern is a function of three knobs — colour, tile size, opacity — so the same
// dozen designs cover a subtle paper texture and a loud poster. The SVG is built from
// numbers we control; the colour goes through `encodeURIComponent`, so a value typed by an
// author cannot break out of the attribute it lands in.
//
// In the studio package since phase 4 (PLAN-STUDIO-2026, 2.4): a page BACKGROUND can be one of
// these, and the validator that runs in the API has to know which ids exist. The web's
// lib/patterns.js re-exports this file, so the list is written once.

const enc = (svg) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')}")`;
const wrap = (s, body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"${extra}>${body}</svg>`;

export const PATTERNS = [
  { id: 'dots', name: 'Dots', nameFr: 'Points', draw: (s, c) => wrap(s, `<circle cx="${s / 2}" cy="${s / 2}" r="${Math.max(1, s / 10)}" fill="${c}"/>`) },
  { id: 'grid', name: 'Grid', nameFr: 'Grille', draw: (s, c) => wrap(s, `<path d="M ${s} 0 L 0 0 0 ${s}" fill="none" stroke="${c}" stroke-width="1"/>`) },
  { id: 'diagonal', name: 'Diagonal lines', nameFr: 'Lignes diagonales', draw: (s, c) => wrap(s, `<path d="M -1 ${s / 2} L ${s / 2} -1 M ${s / 2 - 1} ${s + 1} L ${s + 1} ${s / 2 - 1}" stroke="${c}" stroke-width="${Math.max(1, s / 14)}" fill="none"/>`) },
  { id: 'crosshatch', name: 'Cross-hatch', nameFr: 'Hachures croisées', draw: (s, c) => wrap(s, `<path d="M 0 0 L ${s} ${s} M ${s} 0 L 0 ${s}" stroke="${c}" stroke-width="1" fill="none"/>`) },
  { id: 'waves', name: 'Waves', nameFr: 'Vagues', draw: (s, c) => wrap(s, `<path d="M 0 ${s / 2} Q ${s / 4} ${s / 4} ${s / 2} ${s / 2} T ${s} ${s / 2}" stroke="${c}" stroke-width="${Math.max(1, s / 16)}" fill="none"/>`) },
  { id: 'hex', name: 'Hexagons', nameFr: 'Hexagones', draw: (s, c) => { const h = s * 0.866; return `<svg xmlns="http://www.w3.org/2000/svg" width="${s * 1.5}" height="${h * 2}" viewBox="0 0 ${s * 1.5} ${h * 2}"><path d="M ${s * 0.25} 0 L ${s * 0.75} 0 L ${s} ${h / 2} L ${s * 0.75} ${h} L ${s * 0.25} ${h} L 0 ${h / 2} Z M ${s} ${h} L ${s * 1.5} ${h} M ${s * 0.75} ${h} L ${s} ${h * 1.5} L ${s * 0.75} ${h * 2} M ${s * 0.25} ${h} L 0 ${h * 1.5} L ${s * 0.25} ${h * 2}" fill="none" stroke="${c}" stroke-width="1"/></svg>`; } },
  { id: 'circuit', name: 'Circuit', nameFr: 'Circuit', draw: (s, c) => wrap(s, `<path d="M ${s * 0.1} ${s * 0.5} H ${s * 0.4} V ${s * 0.2} H ${s * 0.7} M ${s * 0.4} ${s * 0.5} V ${s * 0.8} H ${s * 0.9}" fill="none" stroke="${c}" stroke-width="1"/><circle cx="${s * 0.1}" cy="${s * 0.5}" r="${s * 0.04}" fill="${c}"/><circle cx="${s * 0.7}" cy="${s * 0.2}" r="${s * 0.04}" fill="${c}"/><circle cx="${s * 0.9}" cy="${s * 0.8}" r="${s * 0.04}" fill="${c}"/>`) },
  { id: 'topo', name: 'Topography', nameFr: 'Topographie', draw: (s, c) => wrap(s, `<path d="M 0 ${s * 0.3} C ${s * 0.3} ${s * 0.1} ${s * 0.6} ${s * 0.5} ${s} ${s * 0.3} M 0 ${s * 0.6} C ${s * 0.3} ${s * 0.4} ${s * 0.6} ${s * 0.8} ${s} ${s * 0.6} M 0 ${s * 0.9} C ${s * 0.3} ${s * 0.7} ${s * 0.6} ${s * 1.1} ${s} ${s * 0.9}" fill="none" stroke="${c}" stroke-width="1"/>`) },
  { id: 'checker', name: 'Checkerboard', nameFr: 'Damier', draw: (s, c) => wrap(s, `<rect width="${s / 2}" height="${s / 2}" fill="${c}"/><rect x="${s / 2}" y="${s / 2}" width="${s / 2}" height="${s / 2}" fill="${c}"/>`) },
  { id: 'plus', name: 'Plus signs', nameFr: 'Croix', draw: (s, c) => wrap(s, `<path d="M ${s / 2} ${s * 0.3} V ${s * 0.7} M ${s * 0.3} ${s / 2} H ${s * 0.7}" stroke="${c}" stroke-width="${Math.max(1, s / 16)}" fill="none"/>`) },
  { id: 'zigzag', name: 'Zigzag', nameFr: 'Zigzag', draw: (s, c) => wrap(s, `<path d="M 0 ${s * 0.75} L ${s * 0.25} ${s * 0.25} L ${s * 0.5} ${s * 0.75} L ${s * 0.75} ${s * 0.25} L ${s} ${s * 0.75}" stroke="${c}" stroke-width="${Math.max(1, s / 16)}" fill="none"/>`) },
  { id: 'triangles', name: 'Triangles', nameFr: 'Triangles', draw: (s, c) => wrap(s, `<path d="M 0 ${s} L ${s / 2} 0 L ${s} ${s} Z" fill="${c}" opacity="0.5"/>`) },
];

export const PATTERN_IDS = PATTERNS.map((p) => p.id);

/** A CSS `background-image` value, or '' for an unknown pattern. */
export function patternImage(id, { color = '#000', size = 24 } = {}) {
  const p = PATTERNS.find((x) => x.id === id);
  if (!p) return '';
  const s = Math.min(160, Math.max(6, Math.round(Number(size) || 24)));
  const c = String(color || '#000').slice(0, 64).replace(/[<>"]/g, '');
  return enc(p.draw(s, c));
}

/** The style a block gets for its pattern: image, tile size, and opacity via a mask of the colour. */
export function patternStyle(cfg) {
  if (!cfg || !cfg.id) return {};
  const size = Math.min(160, Math.max(6, Math.round(Number(cfg.size) || 24)));
  const opacity = Math.min(1, Math.max(0, Number(cfg.opacity ?? 0.35)));
  // Opacity is baked into the colour when it is a plain hex, else left to the caller.
  const color = /^#([0-9a-f]{6})$/i.test(cfg.color || '') ? `${cfg.color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}` : (cfg.color || '#00000040');
  return { backgroundImage: patternImage(cfg.id, { color, size }), backgroundSize: `${cfg.id === 'hex' ? size * 1.5 : size}px auto`, backgroundRepeat: 'repeat' };
}
