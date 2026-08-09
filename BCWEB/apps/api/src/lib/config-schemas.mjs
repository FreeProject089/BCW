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
export const THEME_DEFAULTS = { accent: '#f97316', accent2: '#f59e0b', mode: 'light', preset: '', light: null, dark: null, shared: null };
// A token value is emitted into a <style> element on every visitor's page, so it is a CSS
// injection point: a stray `}` would end the rule and everything after it would be
// attacker-chosen CSS. Only colour SHAPES are accepted — hex, rgb/hsl functions, and
// color-mix — and the token NAME is checked against an allowlist, not merely pattern-matched,
// so a superadmin cannot set `--anything` the stylesheet does not already define.
//
// The same regex lives in apps/web/src/ui/theme.jsx. Duplicated deliberately: the client copy
// makes the admin PREVIEW refuse what the server would refuse, and a preview that renders
// something the server rejects is a preview that lies.
const COLOUR = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([0-9.,%\s/-]+\)|color-mix\(in srgb[^;{}]*\))$/;
const TOKEN_NAMES = new Set([
  '--primary', '--primary-2', '--on-primary',
  '--bg', '--bg-solid', '--surface', '--surface-2', '--surface-3', '--avatar-ring',
  '--text', '--muted', '--faint',
  '--line', '--line-strong', '--control-border',
  '--info', '--success', '--warning', '--error',
  '--ring', '--primary-glow', '--glow-a', '--glow-b', '--glow-c',
]);
const colour = z.string().max(120).regex(COLOUR);
// `bg` and `text` are the two inputs the surface set is derived from; every other key must be
// a known token name.
// One radial "light spot" in the page background. Geometry is numeric and clamped, so a
// configured background cannot push a gradient somewhere that breaks the layout, and the
// colour goes through the same COLOUR regex as every token — these end up inside a CSS
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
