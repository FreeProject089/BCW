// B9 Extra languages — the pure helpers, kept out of the route so they are unit-testable.
//
// `en` and `fr` are the COMPILED base dictionaries (they live in the web bundle, not the DB).
// They are always present, always first in the picker, and can never be created or deleted as
// SiteLocale rows — the admin API refuses those two codes. Everything else is a runtime locale
// stored as a SiteLocale, consulted by t() as a partial override with English fallback.

export const BASE_LOCALES = [
  { code: 'en', nativeName: 'English', englishName: 'English', rtl: false, base: true },
  { code: 'fr', nativeName: 'Français', englishName: 'French', rtl: false, base: true },
];

export const RESERVED_CODES = new Set(['en', 'fr']);

/** A BCP-47-ish code we accept for a runtime locale: letters, digits, hyphens; 2–35 chars. */
export function isValidLocaleCode(code) {
  return typeof code === 'string' && /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{2,8})*$/.test(code) && code.length <= 35;
}

/** Normalise a code to lower-case for the primary subtag, preserving script/region casing loosely. */
export function normalizeCode(code) {
  return typeof code === 'string' ? code.trim() : '';
}

/**
 * The public picker list: the compiled base followed by the enabled runtime locales, in `order`
 * then `code`. Only the fields the client needs to render the switcher travel.
 */
export function publicLocaleList(rows) {
  const extra = (rows || [])
    .filter((r) => r.enabled && !RESERVED_CODES.has(r.code))
    .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code))
    .map((r) => ({ code: r.code, nativeName: r.nativeName, rtl: !!r.rtl }));
  return [
    ...BASE_LOCALES.map((l) => ({ code: l.code, nativeName: l.nativeName, rtl: false })),
    ...extra,
  ];
}

/** Keep only string→string entries from an incoming strings blob (drop nested junk / non-strings). */
export function sanitizeStrings(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof k === 'string' && typeof val === 'string') out[k] = val;
  }
  return out;
}
