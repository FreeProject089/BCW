// Types for the markdown kit.
//
// The kit itself is JSX with no annotations, and it stays that way on purpose: it is one
// renderer, shipped to people who drop it into their own project, and maintaining a second
// TypeScript copy of it would mean two renderers — the exact thing `index.jsx`'s own header
// argues against for the preview canvas.
//
// So the TypeScript story is declarations. Drop the kit in, keep `allowJs: true`, and every
// import is typed at the boundary: props checked, return types known, autocompletion on the
// directive config. Nothing here changes what the JavaScript does, which is what makes it
// safe — a hand-ported .tsx could drift from the .jsx and only the ported one would be
// checked.
//
// `scripts/check-md-types.mjs` holds this file to the real exports: a function added to the
// kit and missing here is a silent `any` on somebody else's build.

import type { ComponentType, ReactElement, ReactNode, Context } from 'react';

/* ── index.jsx ─────────────────────────────────────────────────────────── */

/**
 * What a `:::roadmap` or `:::replay` renders as, and the language everything is read in.
 *
 * Both components are OPTIONAL. A kit packed without them (see `/dev/markdown`) leaves the
 * directive rendering its own content in a plain div — measured, not assumed: nothing is
 * lost and nothing needs wiring up.
 */
export interface MarkdownConfigValue {
  lang?: string;
  Roadmap?: ComponentType<Record<string, unknown>> | null;
  Replay?: ComponentType<Record<string, unknown>> | null;
}
export const MarkdownConfig: Context<MarkdownConfigValue>;

/**
 * The prefix `rehype-sanitize` puts on every heading id it keeps (`clobberPrefix`).
 *
 * Exported because in-page links have to carry it too. They did not, once, and every anchor
 * in the docs and the blog pointed at nothing — silently, since a link to a missing id is
 * not an error anywhere.
 */
export const ANCHOR_PREFIX: string;

/** The element an in-page `#id` refers to, prefix applied. `null` when there is none. */
export function anchorEl(id: string): HTMLElement | null;

/** Every icon name `IconGlyph` and `ShowcaseIcon` accept, minus the `app:` namespace. */
export const ICON_NAMES: readonly string[];

/**
 * An icon by name, a URL, or an `app:<key>` reference.
 *
 * `fallback` is returned when `icon` is empty — so a caller can decide between nothing and a
 * placeholder without testing the string itself.
 */
export function ShowcaseIcon(props: {
  icon?: string | null;
  size?: number;
  className?: string;
  rounded?: number;
  fallback?: ReactNode;
}): ReactElement | null;

/** One icon glyph by name. `app:<key>` resolves against `configureMarkdown`'s map. */
export function IconGlyph(props: {
  name?: string | null;
  size?: number;
  className?: string;
}): ReactElement | null;

/**
 * Register the `app:<key>` icons.
 *
 * Call once at startup. Called again, it REPLACES the map rather than merging — a kit that
 * accumulated icons across calls would keep an app that had been removed.
 */
export function configureMarkdown(opts?: { appIcons?: Record<string, string> }): void;

/** The `app:` keys currently registered, minus `installer`. */
export function appIconKeys(): string[];

/**
 * Does a `_en` / `_fr` suffixed name belong to this language?
 *
 * A name with NEITHER suffix belongs to every language — which is what makes an untranslated
 * file visible rather than hidden from everyone.
 */
export function matchesLang(name: string, lang: string): boolean;

/** Re-exported from `shorthand.js` so a consumer needs one import. */
export function preprocessMd(src: string): string;

/**
 * Render markdown.
 *
 * `pageMap` resolves `doc:` links to real paths; without it they render as plain text rather
 * than as a link to nowhere.
 */
export default function Markdown(props: {
  children?: string | null;
  className?: string;
  pageMap?: Record<string, string> | null;
  lang?: string;
  roadmap?: ComponentType<Record<string, unknown>> | null;
  replay?: ComponentType<Record<string, unknown>> | null;
}): ReactElement;

/* ── nesting.js ────────────────────────────────────────────────────────── */

/**
 * Rewrite `:::` fences so a directive nested in a directive parses.
 *
 * remark-directive closes on the first fence of equal or greater length, so a three-colon
 * block inside a three-colon block ends its parent. This lengthens the outer ones.
 */
export function normalizeDirectiveNesting(src: string): string;

/* ── shorthand.js ──────────────────────────────────────────────────────── */

/** `[NEW]` chips, `> [!NOTE]` alerts, and the rest, expanded before the parser sees them. */
export function preprocessMd(src: string): string;

/* ── emoji.js ──────────────────────────────────────────────────────────── */

/** 384 GitHub shortcodes, `name` → character. */
export const EMOJI: Readonly<Record<string, string>>;

/** Replace `:name:` with the character. Unknown names are left exactly as typed. */
export function replaceEmoji(src: string): string;

/* ── brands.jsx ────────────────────────────────────────────────────────── */

/** One brand mark. All inline SVG — nothing here fetches from a CDN. */
export type BrandIcon = ComponentType<{ size?: number; className?: string }>;

export const GithubIcon: BrandIcon;
export const GoogleIcon: BrandIcon;
export const KofiIcon: BrandIcon;
export const DiscordIcon: BrandIcon;
export const RedditIcon: BrandIcon;
export const XIcon: BrandIcon;
export const YoutubeIcon: BrandIcon;
export const TwitchIcon: BrandIcon;
export const MastodonIcon: BrandIcon;
export const BlueskyIcon: BrandIcon;
export const InstagramIcon: BrandIcon;
export const TelegramIcon: BrandIcon;
export const TiktokIcon: BrandIcon;
