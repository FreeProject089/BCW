// Shared number formatting.
//
// Raw `${n}` renders a funding goal of 1000 as "1000", which reads as a typo next to a
// currency. Everything user-facing that shows a count or an amount should go through here
// so grouping follows the reader's locale: 1,000 in EN, 1 000 (narrow no-break space) in FR.
//
// `lang` comes from useI18n(); pass it explicitly rather than relying on the browser locale,
// because the site's language switcher is independent of the OS setting.

/** Group a number for display: fmtNum(1000, 'fr') → "1 000". Non-numbers pass through as ''. */
export function fmtNum(n, lang = 'en', opts = {}) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '';
  try {
    return new Intl.NumberFormat(lang, opts).format(v);
  } catch {
    // Unknown locale tag → fall back to the default grouping rather than losing the number.
    return v.toLocaleString();
  }
}

/** Same, rounded to whole units — for money totals shown without cents. */
export function fmtInt(n, lang = 'en') {
  return fmtNum(n, lang, { maximumFractionDigits: 0 });
}

/** A byte count for people: 1536 → "1.5 KB". (Was a private helper of pages/admin.jsx.) */
export const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

/** How long ago, in one unit: "42s", "7m", "3h", "12d". (Was a private helper of pages/admin.jsx.) */
export const fmtAgo = (d) => { const s = Math.round((Date.now() - new Date(d).getTime()) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
