// The icon an admin chose for a built-in topbar button, drawn the same way everywhere.
//
// nav.config.utility[key] = { visible, order, type, icon?, iconDark?, size? }
//
//   icon      a picker name (lucide kebab, ph:…, simple:…, app:…) or a site image path.
//             Used in the light theme, and in the dark one when iconDark is empty.
//   iconDark  the dark-theme choice. A white glyph that vanishes on a light bar, or a logo
//             that has a dark variant, is exactly why this is per theme.
//   size      pixels. Empty = the size the bar has always used for that button.
//
// Read by the real topbar (App.jsx), its phone menu, and through them the admin Live preview,
// which renders those same components. One reader, so the three cannot disagree about which
// icon a button has; they already disagreed once about which BUTTONS exist.
import { IconGlyph } from './md-lite.js'; // M18: icons without the renderer

// The size each button has always been drawn at. A config with no `size` must look exactly
// like the site did before the field existed.
export const UTIL_DEFAULT_SIZE = {
  notifications: 16, projects: 16, lang: 16, theme: 11, settings: 16,
  dashboard: 15, admin: 15, profile: 28, logout: 15, login: 15, brand: 32,
};
// The bounds the server accepts (misc.mjs utilEntry.size), so the editor cannot offer a
// value the save would refuse.
export const UTIL_SIZE_MIN = 12;
export const UTIL_SIZE_MAX = 48;

/** The stored icon for this theme, or '' for "the built-in one". */
export function utilIconFor(entry, theme) {
  if (!entry) return '';
  const light = String(entry.icon || '').trim();
  const dark = String(entry.iconDark || '').trim();
  return theme === 'dark' ? (dark || light) : light;
}

/** The size for a button: the configured one when it is a sane number, else the default. */
export function utilSize(key, entry) {
  const n = Number(entry?.size);
  return Number.isInteger(n) && n >= UTIL_SIZE_MIN && n <= UTIL_SIZE_MAX ? n : (UTIL_DEFAULT_SIZE[key] || 16);
}

// PascalCase from the old nav whitelist → the kebab name IconGlyph resolves (BookOpen →
// book-open). Prefixed names pass through untouched.
const glyphName = (v) => (/^(simple|app|ph|ph-[a-z]+):/.test(v) ? v : v.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-zA-Z])([0-9])/g, '$1-$2').toLowerCase());

/**
 * The glyph for one button. `fallback` is the component the bar has always drawn (a lucide
 * component); it is used whenever nothing is configured for the current theme.
 */
export function UtilGlyph({ k, entry, theme, fallback: Fallback, className = '', size }) {
  const px = size || utilSize(k, entry);
  const v = utilIconFor(entry, theme);
  if (v && (v.startsWith('/') || /^https:\/\//.test(v))) {
    return <img src={v} alt="" width={px} height={px} className={`object-contain ${className}`} style={{ width: px, height: px }} />;
  }
  if (v) return <IconGlyph name={glyphName(v)} size={px} className={className} />;
  return Fallback ? <Fallback size={px} className={className} /> : null;
}
