// The render-side check on every link whose address came from stored data.
//
// The API refuses `javascript:` and friends when a link is WRITTEN (httpUrl, configLinkProblems,
// scripts/check-url-schemas.mjs), and the pages then put the stored value straight into
// `<a href={value}>`: about seventy sinks that trust the write side. React 18 renders a
// `javascript:` href with a console warning and nothing else, so one field the write side
// missed (a new one, an old row stored before the check, an import path) is a stored XSS
// that runs when a visitor clicks (SECURITY_SUMMARY §9, "~70 href sinks").
//
// safeHref() makes that missed field a dead link instead. It is deliberately a SCHEME check,
// not a host policy: which hosts a page may link to is the write side's decision (and the
// studio's link policy's); this only refuses addresses that would run code or load data the
// browser treats as a document.
//
// Returns the address unchanged when it is safe to put in href, `undefined` otherwise (React
// then leaves the attribute out, so the anchor renders as text that goes nowhere).
//
// React 19 refuses `javascript:` URLs itself; when the site moves to it this stays as the
// narrower rule (it also refuses data:, vbscript:, file: and unknown schemes).

/** Schemes a stored link may use. `bmm:` is BetterModsManager's deep link (catalogue, repo). */
const ALLOWED = new Set(['http', 'https', 'mailto', 'tel', 'bmm']);

/** What a browser strips before reading the scheme: `java\tscript:` is `javascript:`. */
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000- \u007f]/g;

export function safeHref(value) {
  if (value == null) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const probe = raw.replace(STRIP, '');
  // Where the scheme would end: a colon BEFORE any of / ? # makes a scheme; a colon after one
  // of them is part of a path (`/a:b`, `?x=a:b`), the same rule the URL parser applies.
  const colon = probe.indexOf(':');
  const cut = probe.search(/[/?#]/);
  if (colon === -1 || (cut !== -1 && cut < colon)) return raw; // relative: same origin
  const scheme = probe.slice(0, colon).toLowerCase();
  return ALLOWED.has(scheme) ? raw : undefined;
}
