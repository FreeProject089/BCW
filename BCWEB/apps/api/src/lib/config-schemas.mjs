// Validation for the two admin-editable config blobs: the site THEME and the FOOTER.
//
// A separate module, and one that imports nothing but zod, for a reason worth recording.
// These schemas decide whether an admin's edit is kept or silently dropped — zod strips
// unknown keys, so a field that is not declared here saves, returns 200, and changes
// nothing. That is invisible from the outside, so it wants tests.
//
// They used to live inside routes/misc.mjs, which cannot be imported from a test without
// dragging in hosting.mjs (and Stripe), auth.mjs, gitbackup.mjs and server-control.mjs.
// Importing that from a test file did not merely feel heavy: it broke 19 unrelated
// DB-backed tests that run in the same suite. Measured, by running the suite with and
// without the import.

import { z } from 'zod';

// ── Site theme (SUPERADMIN) ────────────────────────────────────────────────────────────
//
// Deliberately NOT a full palette editor. The stylesheet defines ~40 tokens per mode and
// exposing all of them would be a way to make the site unreadable in one click. Light and
// dark already share their accent — the dark block never redefines --primary — so ONE colour
// pair recolours the brand across both modes, which is the whole of what "theme the site"
// usually means here.
//
// `mode` is the default a first-time visitor gets; anyone who has used the toggle keeps their
// own choice (it lives in localStorage and wins).
export const THEME_KEY = 'site.theme';
export const HEX = /^#[0-9a-fA-F]{6}$/;
// `light` / `dark` are OPTIONAL page colours. Absent means "keep the shipped palette", which
// is why they default to null rather than to the current values: storing a copy of the
// built-ins would freeze them, and a later change to the stylesheet would silently stop
// reaching anyone who had ever opened this panel.
// `gradients` is the accent GRADIENTS (button fill, gradient headings, progress bars) as
// stored geometry rather than as three rules in index.css; `logoLight` / `logoDark` are the
// site mark per scheme — one mark cannot serve both, which is why the hero already carried a
// hand-written white copy. All three default to "not set", meaning the shipped look.
export const THEME_DEFAULTS = { accent: '#f97316', accent2: '#f59e0b', mode: 'light', preset: '', light: null, dark: null, shared: null, gradients: null, logoLight: '', logoDark: '' };
// A token value is emitted into a <style> element on every visitor's page, so it is a CSS
// injection point: a stray `}` would end the rule and everything after it would be
// attacker-chosen CSS. The token NAME is checked against an allowlist below, so a superadmin
// cannot set `--anything` the stylesheet does not define — and the VALUE is checked by an
// allowlist too, which it was not.
//
// It used to be a shape check ending in
// `color-mix\(in srgb[^;{}]*\)` — "anything without a semicolon or a brace, ending in a
// paren" — which is far wider than it reads: `color-mix(in srgb, red, blue) url(https://evil/x)`
// passed it, and `background: <colour> <image>` is valid CSS, so one page token turned every
// card on the site into a request to a third party, on every page load, for every visitor,
// and outside anything the cookie banner governs (it gates scripts, not stylesheets). The
// edge CSP does not stop it either: `img-src` allows `https:`.
//
// The September pass closed exactly this class for B.MD's directive `color=` and left this
// copy, which reaches every page rather than one document — so this is the same allowlist,
// here. `apps/web/src/ui/theme-colour.js` is the client's copy, and
// `apps/web/scripts/check-site-theme.mjs` asserts the two agree on a shared corpus, so
// "duplicated deliberately" can no longer quietly become "duplicated and drifted".
const CHEX = /^#[0-9a-fA-F]{3,8}$/;
const CFUNC = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/-]+\)$/;
const NAMED = /^[a-zA-Z]{1,24}$/;
const CVAR = /^var\(\s*--[a-zA-Z0-9_-]{1,48}\s*\)$/;
const PCT = /^-?[0-9.]{1,8}%$/;
const simpleColour = (s) => CHEX.test(s) || CFUNC.test(s) || NAMED.test(s) || CVAR.test(s);
/** Split on commas at depth 0, so `rgb(1, 2, 3) 40%` stays one argument. */
function splitArgs(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
export function safeColour(v) {
  const s = String(v ?? '').trim();
  if (!s || s.length > 120) return null;
  if (simpleColour(s)) return s;
  const m = /^color-mix\(\s*in\s+srgb\s*,([\s\S]+)\)$/i.exec(s);
  if (!m) return null;
  const args = splitArgs(m[1]);
  if (args.length < 2 || args.length > 3) return null;
  for (const a of args) {
    const parts = a.split(/\s+/).filter(Boolean);
    if (!parts.length || parts.length > 2) return null;
    const colour = parts.find((x) => !PCT.test(x));
    const pcts = parts.filter((x) => PCT.test(x));
    if (!colour || pcts.length > 1 || !simpleColour(colour)) return null;
  }
  return s;
}
const TOKEN_NAMES = new Set([
  '--primary', '--primary-2', '--on-primary', '--accent-ink',
  '--bg', '--bg-solid', '--surface', '--surface-2', '--surface-3', '--avatar-ring',
  '--text', '--muted', '--faint',
  '--line', '--line-strong', '--control-border',
  '--info', '--success', '--warning', '--error',
  '--info-bg', '--info-border', '--success-bg', '--success-border',
  '--warning-bg', '--warning-border', '--error-bg', '--error-border',
  '--on-error', '--error-glow',
  '--ring', '--primary-glow', '--glow-a', '--glow-b', '--glow-c', '--page-top',
]);
const colour = z.string().max(120).refine((v) => safeColour(v) !== null, 'colour');
// `bg` and `text` are the two inputs the surface set is derived from; every other key must be
// a known token name.
// One radial "light spot" in the page background. Geometry is numeric and clamped, so a
// configured background cannot push a gradient somewhere that breaks the layout, and the
// colour goes through the same allowlist as every token — these end up inside a CSS
// declaration, and that regex is the thing standing between a stored value and `};`.
const glowSpot = z.object({
  color: colour,
  w: z.number().min(0).max(400).optional().default(55),
  h: z.number().min(0).max(400).optional().default(55),
  x: z.number().min(-200).max(300).optional().default(50),
  y: z.number().min(-200).max(300).optional().default(0),
  fade: z.number().min(0).max(100).optional().default(60),
});
// `bg` and `text` are the two inputs the surface set is derived from; `glows` is the
// background's spot list; every other key must be a known token name. Note `glows` has to
// be declared in the SHAPE rather than left to the catchall — catchall demands a colour
// string, and an array would be rejected.
export const pageColours = z.object({
  bg: colour.optional(),
  text: colour.optional(),
  glows: z.array(glowSpot).max(8).optional(),
})
  .catchall(colour)
  .refine((o) => Object.keys(o).every((k) => k === 'bg' || k === 'text' || k === 'glows' || TOKEN_NAMES.has(k)), {
    message: 'unknown theme token',
  })
  .nullable().optional();

// ── Gradients ────────────────────────────────────────────────────────────────────────
//
// A stop is a colour OR one of four accent references. The references are what let a
// gradient stay tied to the accent instead of freezing today's hex — pick a new accent and
// the buttons follow — so they are allowed by exact string, never by pattern: `var(--x)`
// matching loosely would hand a superadmin any custom property on the page.
//
// The names are an allowlist for the same reason the token names are: these are emitted into
// a <style> element every visitor loads, and a key the stylesheet does not define is either a
// typo or an attempt at something else.
const STOP_REFS = new Set(['var(--primary)', 'var(--primary-2)', 'var(--text)', 'var(--bg)']);
const GRADIENT_NAMES = new Set(['--grad-primary', '--grad-text', '--grad-bar']);
const stop = z.object({
  // A BARE `var(--x)` is narrower here than in a page token: only the four accent references,
  // by exact string. `safeColour` allows any theme token because a derived surface legitimately
  // reads `color-mix(in srgb, var(--text) 12%, …)` — but a gradient stop that could name ANY
  // custom property is a wider door than this needs, and the client enforces the same rule, so
  // the two cannot drift into a preview that renders what the save refuses.
  color: z.string().max(120).refine(
    (v) => STOP_REFS.has(v) || (!/^var\(/i.test(v) && safeColour(v) !== null), 'colour'),
  at: z.number().min(-100).max(200).optional(),
});
const gradientSpec = z.object({
  angle: z.number().min(0).max(360).optional(),
  // Two is the floor because one stop is a flat fill, not a gradient — the client refuses to
  // emit a one-stop gradient, and a stored value the client would silently drop is a stored
  // value that lies about what the site looks like.
  stops: z.array(stop).min(2).max(8),
});
export const gradients = z.record(z.string(), gradientSpec)
  .refine((o) => Object.keys(o).every((k) => GRADIENT_NAMES.has(k)), { message: 'unknown gradient' })
  .nullable().optional();

/** The site mark per scheme: a site-served path or an https image. Empty means "the bundled
 *  one". Never a data URI — it would be shipped to every visitor with the theme — and never
 *  a bare http, which would break the page's mixed-content rules. */
export const logoUrl = z.string().max(600)
  .refine((u) => u === '' || u.startsWith('/') || /^https:\/\//.test(u), 'url')
  .optional();


// ── Footer config schemas ────────────────────────────────────────────────────────────
// At module scope, and exported, so they can be exercised directly. These decide whether
// an admin's edit is KEPT or silently dropped — zod strips unknown keys, so a field that
// is not declared here saves with a success toast and changes nothing. That failure is
// invisible from the outside, which is exactly why it is worth a test rather than a read.
// `to` is an internal path OR an http(s) URL, unlike the topbar where only internal paths
// are allowed: a footer legitimately links out (Ko-fi, Discord, the forum). Everything else
// is refused, so a configured link can never become a `javascript:` URL.
const footLink = z.object({
  label: z.string().trim().min(1).max(40),
  labelFr: z.string().trim().max(40).optional().default(''),
  to: z.string().trim().min(1).max(300)
    .refine((v) => v.startsWith('/') || /^https?:\/\//i.test(v), 'must be an internal path or an http(s) URL'),
  icon: z.string().trim().max(60).optional().default(''),
  // Which devices show it. The footer is the one place where a phone genuinely wants
  // FEWER links than a desktop, so this is per link rather than a single global switch.
  on: z.enum(['both', 'desktop', 'mobile']).optional().default('both'),
});
const footColumn = z.object({
  title: z.string().trim().min(1).max(40),
  titleFr: z.string().trim().max(40).optional().default(''),
  on: z.enum(['both', 'desktop', 'mobile']).optional().default('both'),
  links: z.array(footLink).max(16).default([]),
});

// A social button. `icon` is either one of the bundled brand marks ('github', 'discord',
// 'reddit', 'kofi') or a lucide icon name — the client resolves in that order.
export const footSocial = z.object({
  label: z.string().trim().min(1).max(30),
  href: z.string().trim().min(1).max(300)
    .refine((v) => v.startsWith('/') || /^https?:\/\//i.test(v), 'must be an internal path or an http(s) URL'),
  icon: z.string().trim().min(1).max(40),
});
const footNewsletter = z.object({
  on: z.boolean().optional().default(true),
  title: z.string().trim().max(60).optional().default(''),
  titleFr: z.string().trim().max(60).optional().default(''),
  text: z.string().trim().max(200).optional().default(''),
  textFr: z.string().trim().max(200).optional().default(''),
  placeholder: z.string().trim().max(60).optional().default(''),
  placeholderFr: z.string().trim().max(60).optional().default(''),
  button: z.string().trim().max(30).optional().default(''),
  buttonFr: z.string().trim().max(30).optional().default(''),
});
export const footerSchema = z.object({
  enabled: z.boolean(),
  columns: z.array(footColumn).max(6).default([]),
  brand: z.object({
    // Empty = keep the built-in ("BetterCommunity" / /logo.png), so a site that never
    // touches these still follows the app rather than freezing a copy of it.
    name: z.string().trim().max(40).optional().default(''),
    logo: z.string().trim().max(300).optional()
      .refine((v) => !v || v.startsWith('/') || /^https?:\/\//i.test(v), 'must be a path or an http(s) URL')
      .default(''),
    tagline: z.string().trim().max(200).optional().default(''),
    taglineFr: z.string().trim().max(200).optional().default(''),
    // `socials` used to be a plain on/off boolean and stored configs still hold one, so
    // both forms are accepted: `false` hides the row, `true` means "the built-in row",
    // and an array is the row itself. Rejecting the boolean would have silently emptied
    // the socials of every footer already saved.
    socials: z.union([z.boolean(), z.array(footSocial).max(10)]).optional().default(true),
    // Same story: boolean was "show / hide"; the object adds the copy.
    newsletter: z.union([z.boolean(), footNewsletter]).optional().default(true),
    // "Is everything up", in one line under the newsletter. It used to be a full-height
    // panel in the middle of the landing page, listing every service with thirty day-bars
    // each — a whole section spent saying, almost always, that nothing is wrong.
    status: z.boolean().optional().default(true),
  }).optional().default({}),
  // Phone layout. The desktop grid is driven by the column count; a phone has to choose
  // between one column per row and a two-up grid, and neither is right for every site.
  mobile: z.object({
    layout: z.enum(['stacked', 'grid']).optional().default('stacked'),
    brand: z.boolean().optional().default(true),
  }).optional().default({}),
  bottom: z.object({
    copyright: z.boolean().optional().default(true),
    // Supports one token, {year}, expanded at render time.
    text: z.string().trim().max(120).optional().default(''),
    textFr: z.string().trim().max(120).optional().default(''),
    lang: z.boolean().optional().default(true),
    egg: z.boolean().optional().default(true),
  }).optional().default({}),
});
