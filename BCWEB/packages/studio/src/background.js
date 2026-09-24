// A studio page's background: a CLOSED value (PLAN-STUDIO-2026, 2.4 and phase 4).
//
// Up to phase 3 a page's background was `bg`, a free CSS string written into a style attribute
// on a public page. It went through `safeCssValue`, which refuses what it can recognise as
// dangerous; a closed value refuses by construction instead. A background is now one of seven
// kinds, each with named fields, and the CSS a reader receives is REBUILT from those fields
// here, never copied from the author: a colour is a hex or one of the site's tokens, a gradient
// is an angle and 2 to 4 of those colours, an image is a path on this site's own media, a
// pattern is an id from patterns.js. Nothing an author types reaches a CSS property as text.
//
//   site      nothing of its own: the site's background (and its 3D scene) shows through
//   color     one colour behind the frame
//   gradient  a linear gradient, angle + 2 to 4 stops
//   image     /api/media/... or /uploads/..., cover | contain | tile, and a position
//   pattern   a tiling pattern (patterns.js): id, colour, tile size, opacity
//   scene3d   the site's 3D scene vocabulary (scene.js), drawn for this page alone
//   board     a colour and an optional dot grid that continue past the page's edges
//
// Same split as the document: `normalizeBackground` is tolerant (whatever is stored becomes a
// valid value, `site` when nothing can be made of it) and `backgroundProblems` is strict (it
// names every field that would have been dropped, for `validateDoc` and so for the API).
//
// The old `bg` string is still READ (`backgroundFromLegacy`): a colour, an rgb() colour, a
// linear gradient of such colours or a same-site media url() becomes the matching kind, and
// anything else becomes `site`, which the studio says once ("background not recognised,
// replaced"). It is never written again (`serializeDoc`).
import { PATTERN_IDS, patternStyle } from './patterns.js';
import { SCENE_SHAPES, SCENE_SURFACES, SCENE_BOUNDS, clampSceneNumber, detailMaxFor } from './scene.js';

/** The kinds, in the order the editor offers them. */
export const BACKGROUND_TYPES = ['site', 'color', 'gradient', 'image', 'pattern', 'scene3d', 'board'];

/**
 * The site colours a background may name, as `var(--<name>)`. They follow the reader's theme,
 * which a hex cannot. A token outside this list is refused: a custom property is a value the
 * site defines, and one the site does not define here is either a typo or a probe.
 */
export const BG_TOKENS = [
  'bg', 'bg-solid', 'surface', 'surface-2', 'surface-3', 'primary', 'primary-2',
  'text', 'muted', 'line', 'success', 'warning', 'error', 'info',
];
/** Where a background image may come from: this site's own media, nothing else. */
export const BG_IMAGE_PREFIXES = ['/api/media/', '/uploads/'];
export const BG_IMAGE_FITS = ['cover', 'contain', 'tile'];
export const BG_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];
/** Where the 3D shape sits in the frame. */
export const SCENE3D_POSITIONS = ['center', 'left', 'right'];
/** The board's dot grid, in px. 0 = no grid. */
export const BOARD_GRIDS = [0, 16, 24, 32, 48];
/** A gradient has at least two stops and at most four. */
export const GRADIENT_STOPS = { min: 2, max: 4 };

/** The fields each kind may carry, besides `type`. */
export const BACKGROUND_FIELDS = {
  site: [],
  color: ['color'],
  gradient: ['angle', 'stops'],
  image: ['src', 'fit', 'position'],
  pattern: ['id', 'color', 'size', 'opacity'],
  scene3d: ['shape', 'surface', 'position', ...Object.keys(SCENE_BOUNDS)],
  board: ['color', 'grid'],
};

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const numOr = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const TOKEN = /^var\(\s*--([a-z0-9-]{1,40})\s*\)$/i;
const RGB = /^rgba?\(\s*(\d{1,3}(?:\.\d+)?)\s*[\s,]\s*(\d{1,3}(?:\.\d+)?)\s*[\s,]\s*(\d{1,3}(?:\.\d+)?)\s*(?:[,/]\s*(\d*\.?\d+)(%?)\s*)?\)$/i;

const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/**
 * A background colour, or '' when the value is not one.
 *
 * Accepted: a hex (#rgb, #rgba, #rrggbb, #rrggbbaa), `transparent`, or `var(--token)` with a
 * token from BG_TOKENS. Everything else, `rgb()` included, is '': rgb() is READ by the legacy
 * conversion (turned into a hex there), never stored.
 */
export function bgColor(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (s.length > 40) return '';
  if (HEX.test(s)) return s.toLowerCase();
  if (s.toLowerCase() === 'transparent') return 'transparent';
  const m = TOKEN.exec(s);
  return m && BG_TOKENS.includes(m[1].toLowerCase()) ? `var(--${m[1].toLowerCase()})` : '';
}

/** `rgb()`/`rgba()` as a hex, for reading an old background. '' when it is not one. */
function rgbToHex(raw) {
  const m = RGB.exec(String(raw || '').trim());
  if (!m) return '';
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  if ([r, g, b].some((v) => v > 255)) return '';
  let a = m[4] == null || m[4] === '' ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  a = clamp(a, 0, 1);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`;
}

/** A colour a PATTERN can use: the SVG it is drawn into is a data URI, which cannot see the
 *  page's custom properties, so only a hex works there. Returned as #rrggbb. */
export function patternColor(raw) {
  const c = bgColor(raw);
  if (!c.startsWith('#')) return '';
  const h = c.slice(1);
  if (h.length === 3 || h.length === 4) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  return `#${h.slice(0, 6)}`;
}

/**
 * A background image path, or ''. This site's media only (BG_IMAGE_PREFIXES), in characters
 * that need no escaping inside `url("…")`, with no `..` or `//` segment either as typed or once
 * percent-decoded. Never a URL with a scheme or a host: a background is fetched by every
 * visitor, and a third-party one tells that third party who read the page.
 */
export function bgImagePath(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s || s.length > 1000) return '';
  if (!BG_IMAGE_PREFIXES.some((p) => s.startsWith(p))) return '';
  if (!/^[A-Za-z0-9._~\-/%]+$/.test(s)) return '';
  let dec = '';
  try { dec = decodeURIComponent(s); } catch { return ''; }
  for (const v of [s, dec]) if (/\/\/|\\|(^|\/)\.\.?(\/|$)/.test(v)) return '';
  return s;
}

function normStops(raw) {
  const list = (Array.isArray(raw) ? raw : []).slice(0, GRADIENT_STOPS.max);
  const out = [];
  list.forEach((s, i) => {
    const color = bgColor(isObj(s) ? s.color : s);
    if (!color) return;
    const even = list.length > 1 ? Math.round((i / (list.length - 1)) * 100) : 0;
    out.push({ color, at: Math.round(clamp(numOr(isObj(s) ? s.at : null, even), 0, 100)) });
  });
  return out;
}

/**
 * Whatever is stored, as a valid background. Tolerant: an unknown kind, a missing colour or an
 * image from elsewhere is `site`, never an exception and never a half-built value.
 */
export function normalizeBackground(raw) {
  const o = isObj(raw) ? raw : {};
  const type = BACKGROUND_TYPES.includes(o.type) ? o.type : 'site';
  const site = { type: 'site' };
  switch (type) {
    case 'color': {
      const color = bgColor(o.color);
      return color ? { type, color } : site;
    }
    case 'gradient': {
      const stops = normStops(o.stops);
      if (stops.length < GRADIENT_STOPS.min) return site;
      return { type, angle: Math.round(clamp(numOr(o.angle, 180), 0, 360)), stops };
    }
    case 'image': {
      const src = bgImagePath(o.src);
      if (!src) return site;
      return {
        type, src,
        fit: BG_IMAGE_FITS.includes(o.fit) ? o.fit : 'cover',
        position: BG_POSITIONS.includes(o.position) ? o.position : 'center',
      };
    }
    case 'pattern': {
      if (!PATTERN_IDS.includes(o.id)) return site;
      return {
        type, id: o.id,
        color: patternColor(o.color) || '#000000',
        size: Math.round(clamp(numOr(o.size, 24), 6, 160)),
        opacity: clamp(numOr(o.opacity, 0.35), 0, 1),
      };
    }
    case 'scene3d': {
      const shape = SCENE_SHAPES.includes(o.shape) ? o.shape : 'orb';
      const out = {
        type, shape,
        surface: SCENE_SURFACES.includes(o.surface) ? o.surface : 'solid',
        position: SCENE3D_POSITIONS.includes(o.position) ? o.position : 'center',
      };
      for (const k of Object.keys(SCENE_BOUNDS)) out[k] = clampSceneNumber(k, o[k], shape);
      return out;
    }
    case 'board': {
      const grid = Number(o.grid);
      return { type, color: bgColor(o.color), grid: BOARD_GRIDS.includes(grid) ? grid : 24 };
    }
    default: return site;
  }
}

/** The background to STORE: null for `site` (absent is the default), else the normalised value. */
export function serializeBackground(raw) {
  const b = normalizeBackground(raw);
  return b.type === 'site' ? null : b;
}

// ── Reading the old `bg` string ─────────────────────────────────────────────────────────
const SIDES = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
  'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135,
  'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };

/** Split on commas that are not inside parentheses. */
function topLevelParts(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const legacyColor = (s) => bgColor(s) || rgbToHex(s);

function legacyGradient(inner) {
  const parts = topLevelParts(inner);
  if (!parts.length) return null;
  let angle = 180;
  const first = parts[0].toLowerCase().replace(/\s+/g, ' ');
  if (/^-?\d+(\.\d+)?deg$/.test(first)) { angle = ((Math.round(parseFloat(first)) % 360) + 360) % 360; parts.shift(); }
  else if (first in SIDES) { angle = SIDES[first]; parts.shift(); }
  if (parts.length < GRADIENT_STOPS.min || parts.length > GRADIENT_STOPS.max) return null;
  const stops = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/.exec(parts[i]);
    const color = m && legacyColor(m[1]);
    if (!color) return null;
    const even = Math.round((i / (parts.length - 1)) * 100);
    stops.push({ color, at: m[2] != null ? Math.round(clamp(Number(m[2]), 0, 100)) : even });
  }
  return { type: 'gradient', angle, stops };
}

/**
 * The old free-text `bg`, as a background. `recognized: false` means something was typed and
 * could not be kept: the page gets `site`, and the studio says so.
 */
export function backgroundFromLegacy(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { background: { type: 'site' }, recognized: true };
  const color = legacyColor(s);
  if (color) return { background: { type: 'color', color }, recognized: true };
  const g = /^linear-gradient\(([\s\S]*)\)$/i.exec(s);
  if (g) {
    const grad = legacyGradient(g[1]);
    if (grad) return { background: grad, recognized: true };
  }
  const u = /^url\(\s*(['"]?)([^'")]*)\1\s*\)([\s\S]*)$/i.exec(s);
  if (u && bgImagePath(u[2])) {
    const rest = u[3].toLowerCase();
    const fit = /contain/.test(rest) ? 'contain' : /repeat(?!-)/.test(rest) && !/no-repeat/.test(rest) ? 'tile' : 'cover';
    return { background: { type: 'image', src: bgImagePath(u[2]), fit, position: 'center' }, recognized: true };
  }
  return { background: { type: 'site' }, recognized: false };
}

// ── Painting ────────────────────────────────────────────────────────────────────────────
/** The gradient, rebuilt from its fields. */
export function gradientCss(b) {
  const stops = (b.stops || []).map((s) => `${s.color} ${s.at}%`).join(', ');
  return `linear-gradient(${b.angle}deg, ${stops})`;
}

/**
 * The CSS properties the background layer gets, for every kind that is drawn with CSS. `{}` for
 * `site` (nothing to draw) and for `scene3d` (drawn by the renderer's own layer). Every value is
 * built here from normalised fields: the one `url(` this can produce is a same-site media path
 * or a pattern's `data:image/svg+xml` tile.
 */
export function backgroundStyle(raw) {
  const b = normalizeBackground(raw);
  switch (b.type) {
    case 'color': return { backgroundColor: b.color };
    case 'gradient': return { backgroundImage: gradientCss(b) };
    case 'image': return {
      backgroundImage: `url("${b.src}")`,
      backgroundSize: b.fit === 'tile' ? 'auto' : b.fit,
      backgroundRepeat: b.fit === 'tile' ? 'repeat' : 'no-repeat',
      backgroundPosition: b.position,
    };
    case 'pattern': return patternStyle({ id: b.id, color: b.color, size: b.size, opacity: b.opacity });
    case 'board': return {
      ...(b.color ? { backgroundColor: b.color } : {}),
      // Dots in the text colour, faint: they read on either theme without a second setting.
      ...(b.grid ? {
        backgroundImage: 'radial-gradient(circle, color-mix(in srgb, currentColor 22%, transparent) 1px, transparent 1.6px)',
        backgroundSize: `${b.grid}px ${b.grid}px`,
      } : {}),
    };
    default: return {};
  }
}

// ── Checking what is SAVED ─────────────────────────────────────────────────────────────
/**
 * Every problem in a stored background, through `push(path, reason, value)`. Nothing = accept.
 * The reasons are validateDoc's: bad_type, bad_value, unknown_field, out_of_bounds, too_many,
 * unsafe_url, unsafe_css.
 */
export function backgroundProblems(raw, push, at = 'background') {
  if (raw == null) return;
  if (!isObj(raw)) { push(at, 'bad_type', null); return; }
  if (!BACKGROUND_TYPES.includes(raw.type)) { push(`${at}.type`, 'bad_value', raw.type); return; }
  const allowed = ['type', ...BACKGROUND_FIELDS[raw.type]];
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) push(`${at}.${k}`, 'unknown_field', k);
  // A value that is not a colour. One that tries to FETCH something is named for what it is.
  const colour = (v, path, ok = bgColor) => {
    if (ok(v)) return;
    const fetches = typeof v === 'string' && /url\s*\(|image-set|\bsrc\s*\(|\\/i.test(v);
    push(path, fetches ? 'unsafe_css' : typeof v === 'string' ? 'bad_value' : 'bad_type', v);
  };
  const number = (v, path, lo, hi, required = false) => {
    if (v == null) { if (required) push(path, 'bad_value', v); return; }
    if (!isNum(v)) push(path, 'bad_type', v);
    else if (v < lo || v > hi) push(path, 'out_of_bounds', v);
  };
  const oneOf = (v, list, path, required = false) => {
    if (v == null) { if (required) push(path, 'bad_value', v); return; }
    if (!list.includes(v)) push(path, 'bad_value', v);
  };
  switch (raw.type) {
    case 'color': colour(raw.color, `${at}.color`); break;
    case 'gradient': {
      number(raw.angle, `${at}.angle`, 0, 360);
      if (!Array.isArray(raw.stops)) { push(`${at}.stops`, 'bad_type', null); break; }
      if (raw.stops.length > GRADIENT_STOPS.max) push(`${at}.stops`, 'too_many', raw.stops.length);
      else if (raw.stops.length < GRADIENT_STOPS.min) push(`${at}.stops`, 'bad_value', raw.stops.length);
      raw.stops.forEach((s, i) => {
        const sp = `${at}.stops[${i}]`;
        if (!isObj(s)) { push(sp, 'bad_type', null); return; }
        for (const k of Object.keys(s)) if (k !== 'color' && k !== 'at') push(`${sp}.${k}`, 'unknown_field', k);
        colour(s.color, `${sp}.color`);
        number(s.at, `${sp}.at`, 0, 100);
      });
      break;
    }
    case 'image':
      if (!bgImagePath(raw.src)) push(`${at}.src`, typeof raw.src === 'string' ? 'unsafe_url' : 'bad_type', raw.src);
      oneOf(raw.fit, BG_IMAGE_FITS, `${at}.fit`);
      oneOf(raw.position, BG_POSITIONS, `${at}.position`);
      break;
    case 'pattern':
      oneOf(raw.id, PATTERN_IDS, `${at}.id`, true);
      if (raw.color != null) colour(raw.color, `${at}.color`, patternColor);
      number(raw.size, `${at}.size`, 6, 160);
      number(raw.opacity, `${at}.opacity`, 0, 1);
      break;
    case 'scene3d': {
      oneOf(raw.shape, SCENE_SHAPES, `${at}.shape`);
      oneOf(raw.surface, SCENE_SURFACES, `${at}.surface`);
      oneOf(raw.position, SCENE3D_POSITIONS, `${at}.position`);
      const shape = SCENE_SHAPES.includes(raw.shape) ? raw.shape : 'orb';
      for (const [k, b] of Object.entries(SCENE_BOUNDS)) {
        number(raw[k], `${at}.${k}`, b.min, k === 'detail' ? Math.min(b.max, detailMaxFor(shape)) : b.max);
      }
      break;
    }
    case 'board':
      if (raw.color != null && raw.color !== '') colour(raw.color, `${at}.color`);
      if (raw.grid != null && !BOARD_GRIDS.includes(raw.grid)) push(`${at}.grid`, 'bad_value', raw.grid);
      break;
    default: break;
  }
}
