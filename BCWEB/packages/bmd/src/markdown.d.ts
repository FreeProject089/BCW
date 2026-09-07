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
  /** The renderer itself, for `::include` and `::openapi`. */
  Nested?: ComponentType<Record<string, unknown>> | null;
  /** How many documents deep this one is. */
  depth?: number;
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
export function preprocessMd(src: string, opts?: { pageMap?: Record<string, unknown> | null }): string;

/**
 * Render markdown.
 *
 * `pageMap` resolves `doc:` links to real paths; without it they render as plain text rather
 * than as a link to nowhere.
 */
export default function Markdown(props: {
  children?: string | null;
  className?: string;
  pageMap?: Record<string, string | { title?: string; category?: string; desc?: string; icon?: string; anchors?: string[] }> | null;
  lang?: string;
  roadmap?: ComponentType<Record<string, unknown>> | null;
  replay?: ComponentType<Record<string, unknown>> | null;
  /** `'auto'` adds a table of contents when there are three or more headings and none written; `true` always. */
  toc?: 'auto' | boolean | null;
  /** Corner radius for every block — a CSS length, or a number of pixels. */
  radius?: string | number | null;
  /** Nesting depth; set by `::include`, not by callers. */
  depth?: number;
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

/** `[NEW]` chips, `> [!NOTE]` alerts, `==marks==`, `[[wiki links]]` and the rest, expanded before the parser sees them. */
export function preprocessMd(src: string, opts?: { pageMap?: Record<string, unknown> | null }): string;

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

/* ── config.js ─────────────────────────────────────────────────────────── */

/** How a URL may be written. See url.js for what each field does. */
export interface MarkdownUrlPolicy {
  /** Hostnames (and subdomains) links may point at. Empty/absent = any https host. */
  allowHosts?: string[] | null;
  /** The same, narrower, for `:::file` download buttons. */
  allowDownloadHosts?: string[] | null;
  /** Schemes, as a RegExp or an array of names. Default: http(s), mailto, tel, xmpp, irc. */
  allowProtocols?: RegExp | string[] | null;
  /** Last-chance rewrite, e.g. through a redirect notice. */
  rewrite?: ((url: string, ctx: { kind: string; host: string }) => string) | null;
}

/** Everything a host application points at itself. */
export interface MarkdownOptions {
  /** `app:<key>` → an image URL. */
  appIcons?: Record<string, string>;
  /** Where a non-bundled icon comes from. `null` for a family switches it off entirely. `mermaid` is an ES-module URL. */
  cdn?: { lucide?: ((name: string) => string) | null; brand?: ((slug: string) => string) | null; phosphor?: ((path: string) => string) | null; mermaid?: string | null };
  policy?: MarkdownUrlPolicy;
  /** Which iframes survive sanitising — a RegExp on the src, or a predicate. */
  allowIframes?: RegExp | ((src: string) => boolean);
  /** Corner radius for every block, as a CSS length. Null keeps each block's own. */
  radius?: string | null;
  /** How `::include{src=…}` gets its text. Default: fetch it, subject to the URL policy. */
  resolveInclude?: ((src: string) => Promise<string> | string) | null;
  /** `() => import('mermaid')` when the package is installed; otherwise `cdn.mermaid` is used. */
  loadMermaid?: (() => Promise<unknown>) | null;
}

/** Point B.MD at your project. Call once, at import time. */
export function configureMarkdown(next?: MarkdownOptions): void;

/** The whole current configuration. */
export function markdownConfig(): Required<MarkdownOptions>;

/** The URL policy alone. */
export function urlPolicy(): MarkdownUrlPolicy;

/** `app:<key>` → its image URL, or '' when the host configured none. */
export function appIcon(key: string): string;

/** The URL for a remote icon, or '' when that family is switched off. */
export function cdnIconUrl(family: 'lucide' | 'brand' | 'phosphor' | 'mermaid', name: string): string;

/**
 * Register the `app:<key>` icons from a list ({ key, url, label }) — what a host that loads
 * its app list at runtime calls, instead of the static map in configureMarkdown.
 */
export function registerAppIcons(list?: Array<{ key: string; url: string; label?: string }>): void;

/** The label registered for an `app:` key, or the key itself. */
export function appIconLabel(key: string): string;

/** `ph:rocket` / `ph-bold:rocket` → the `<weight>/<file>` path under Phosphor's assets, or null. */
export function phosphorRef(name: string): string | null;

/* ── url.js ────────────────────────────────────────────────────────────── */

export interface SafeUrlResult {
  ok: boolean;
  href: string;
  external: boolean;
  reason?: 'empty' | 'protocol_relative' | 'protocol' | 'host' | 'unparseable';
}

/** Is this a URL the kit is willing to emit, and in what form? */
export function safeUrl(raw: string, opt?: { kind?: 'link' | 'media' | 'download' | 'api'; policy?: MarkdownUrlPolicy }): SafeUrlResult;

/** The attributes an anchor needs, given where it points. `null` when the URL is refused. */
export function linkAttrs(url: string, opt?: { kind?: 'link' | 'media' | 'download'; policy?: MarkdownUrlPolicy }): { href: string; target?: string; rel?: string } | null;

/* ── plugins.js ────────────────────────────────────────────────────────── */

export interface BlockSpec {
  component?: ComponentType<{ node?: unknown; children?: ReactNode }>;
  tag?: string;
  className?: string[];
  attrs?: (ctx: { label: string; attrs: Record<string, string>; text: string }) => Record<string, string>;
  leaf?: boolean;
}

/** Add a block B.MD does not have. Returns a function that removes it again. */
export function registerBlock(name: string, spec?: BlockSpec): () => void;

/** Every registered block name. */
export function blockNames(): string[];

/** One block's spec, or undefined. */
export function blockSpec(name: string): BlockSpec | undefined;

/** The element a registered block emits — `doc-x-<name>`. */
export function blockTag(name: string): string;

/** The component map the renderer merges in. */
export function blockComponents(): Record<string, ComponentType<unknown>>;

/** The tags and attributes the sanitiser must keep for the registered blocks. */
export function blockSanitizeRules(): { tagNames: string[]; attributes: Record<string, string[]> };

/** Several blocks at once. Returns one function that removes them all. */
export function registerBlocks(map?: Record<string, BlockSpec>): () => void;

/** A plugin: a name, its blocks, an optional stylesheet injected once on install. */
export function definePlugin(spec?: { name?: string; blocks?: Record<string, BlockSpec>; css?: string }): { name?: string; install(): unknown; uninstall(): void };

/* ── directives.js ─────────────────────────────────────────────────────── */

/** The remark transform: directives → the hast elements the components draw. */
export function remarkDocBlocks(): (tree: unknown) => void;

/** A heading's id — what `::toc` links and every `#anchor` are built from. */
export function slugify(s: string): string;

/* ── sanitize.js ───────────────────────────────────────────────────────── */

/** The rehype-sanitize schema, extended to permit exactly what the kit emits. */
export const SANITIZE_SCHEMA: Record<string, unknown>;

/** rehype-sanitize itself, re-exported so a consumer does not import it twice. */
export const rehypeSanitize: unknown;

/** Puts the sanitiser's id prefix on in-document links, so `#anchor` resolves. */
export function rehypeAnchorPrefix(): (tree: unknown) => void;

/** Drops any iframe whose src is not on the allowlist. */
export function rehypeIframeAllowlist(): (tree: unknown) => void;

/** Runs every href/src through the URL policy, after sanitising. */
export function rehypeSafeUrls(): (tree: unknown) => void;

/** One `style` attribute, declaration by declaration, with the attacking ones removed. */
export function safeStyle(value: string): string;

/** Runs every author-written `style` through safeStyle. */
export function rehypeSafeStyle(): (tree: unknown) => void;

/* ── blocks.jsx ────────────────────────────────────────────────────────── */

/** One component per block the parser emits. Reached through the component map. */
export type DocBlock = ComponentType<{ node?: unknown; children?: ReactNode }>;

export const DocIcon: DocBlock;
export const DocKbd: DocBlock;
export const DocComment: DocBlock;
export const DocTabs: DocBlock;
export const DocSchedule: DocBlock;
export const DocTime: DocBlock;
export const DocRoadmap: DocBlock;
export const DocReplay: DocBlock;
/** `:counter` / `::live` — a value read from a URL. */
export const DocFetch: DocBlock;
/** `:action` — a button that calls a URL. */
export const DocAction: DocBlock;
/** `::include` — another document, rendered here. */
export const DocInclude: DocBlock;
/** `::openapi` — a spec, drawn as `:::api` cards. */
export const DocOpenapi: DocBlock;
/** ```mermaid fences and `:::mermaid`. */
export const DocMermaid: DocBlock;

/** The box a block draws when its component was not supplied. */
export const MissingBlock: ComponentType<{ name: string }>;

/* ── roadmap.jsx / replay.jsx ──────────────────────────────────────────── */

/** The built-in `:::roadmap`. Pass `roadmap={…}` to `<Markdown>` to replace it. */
export const Roadmap: ComponentType<{ data: unknown; title?: string; lang?: string }>;

/** The built-in `:::replay`. Pass `replay={…}` to `<Markdown>` to replace it. */
export const Replay: ComponentType<{ src: string; title?: string; autoplay?: boolean; loop?: boolean; lang?: string }>;

/* ── openapi.js ────────────────────────────────────────────────────────── */

/** An OpenAPI 3.x / Swagger 2 document, written out as B.MD (`:::api` cards). */
export function openapiToBmd(spec: unknown, opt?: { tag?: string; filter?: string; header?: boolean; toc?: boolean }): string;

/** Counts: title, version, paths, operations, tags. */
export function openapiSummary(spec: unknown): { title: string; version: string; paths: number; operations: number; tags: string[] };

/** A schema in a few words (`array<Item>`, `integer (int64)`). */
export function schemaLabel(spec: unknown, schema: unknown, depth?: number): string;

/** An example value for a schema — the spec's own, or a sketch. */
export function schemaExample(spec: unknown, schema: unknown, depth?: number): unknown;

/* ── export.jsx ────────────────────────────────────────────────────────── */

/** Where markdown.css lives, for whoever wants to inline it. */
export const cssUrl: string;

/** The document as HTML — the `.md-body` element and nothing around it. */
export function renderHtml(md: string, opt?: { lang?: string; pageMap?: Record<string, unknown> | null; toc?: 'auto' | boolean; radius?: string | number; className?: string }): string;

/** A whole standalone page: doctype, tokens, the kit's CSS when given, the document. */
export function documentHtml(md: string, opt?: { title?: string; css?: string; extraCss?: string; scheme?: 'light' | 'dark'; lang?: string; render?: Record<string, unknown> }): string;

/* ── ast.js ────────────────────────────────────────────────────────────── */

/** A parsed document, as mdast, after the same transform the renderer runs. */
export function parseMarkdown(md: string, opt?: { pageMap?: Record<string, unknown> | null; raw?: boolean }): unknown;

/** Depth-first walk. Return `false` to skip a node's children. */
export function walkAst(tree: unknown, fn: (node: any, parent: any) => unknown, parent?: unknown): void;

/** Every heading with the id the renderer gives it. */
export function extractHeadings(md: string, opt?: { pageMap?: Record<string, unknown> | null }): Array<{ depth: number; text: string; id: string }>;

/** Every link, image and directive destination. */
export function extractLinks(md: string, opt?: { pageMap?: Record<string, unknown> | null }): Array<{ href: string; text: string; kind: string; line?: number }>;

/** The document's plain text. */
export function extractText(md: string, opt?: { pageMap?: Record<string, unknown> | null }): string;

/* ── links.js ──────────────────────────────────────────────────────────── */

export interface LinkIssue { level: 'error' | 'warning'; code: string; href: string; text: string; line?: number; hint: string }

/** Anchors against the document's headings, internal paths against the page map, and the shapes that are wrong on their face. */
export function validateLinks(md: string, opt?: { pageMap?: Record<string, unknown> | null; anchors?: string[]; policy?: MarkdownUrlPolicy; warnHttp?: boolean }): { ok: boolean; issues: LinkIssue[]; count: number };

/* ── editor-blocks.js ──────────────────────────────────────────────────── */

/** One top-level block of a B.MD document. `src` is the exact source, newlines included. */
export interface BmdBlock { id: string; kind: string; src: string }

/** Split into ordered, lossless blocks. Invariant: joinBlocks(splitBlocks(md)) === md. */
export function splitBlocks(md: string): BmdBlock[];
/** Back to one document, byte-for-byte. */
export function joinBlocks(blocks: BmdBlock[]): string;
/** A fresh block of a kind, with optional starter source. */
export function newBlock(kind: string, src?: string): BmdBlock;

/** A `.bmd` file: `---` front matter over the document body. */
export function parseBmdFile(text: string): { meta: Record<string, string>; body: string };
export function serializeBmdFile(file?: { meta?: Record<string, string>; body?: string }): string;
export function bmdFileToBlocks(text: string): BmdBlock[];
export function blocksToBmdFile(blocks: BmdBlock[], meta?: Record<string, string>): string;

/** The head of a directive block, as named values — null when the block does not open with one. */
export interface BmdDirectiveHead { name: string; label: string; attrs: Record<string, string>; indent: string; colons: string }
export function parseDirectiveHead(src: string): BmdDirectiveHead | null;
/** Rewrite ONLY the head; every other line comes back byte-identical. '' removes an attribute. */
export function setDirectiveHead(src: string, patch?: { label?: string; attrs?: Record<string, string> }): string;

/**
 * The `space=` scale — the gap a block leaves under itself. A closed set of words, not a
 * free number, so two documents written months apart still share a rhythm; the pixel
 * values live in markdown.css and retune every document at once.
 */
export const SPACE_STEPS: Record<'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl', number>;
/** The two looks every block understands: `a` is the default and needs no attribute. */
export const VARIANTS: readonly string[];

/** A markdown table read as a structure. `null` when the source is not one. */
export interface BmdTable { header: string[]; align: string[]; rows: string[][]; before: string; after: string }
export function parseTable(src: string): BmdTable | null;
/** Put a table back together, padded so the source stays readable by hand. */
export function serializeTable(t: BmdTable): string;
/** Column and row edits. `at` defaults to the end; an out-of-range index is clamped. */
export function tableAddColumn(src: string, at?: number): string;
export function tableRemoveColumn(src: string, at?: number): string;
export function tableAddRow(src: string, at?: number): string;
export function tableRemoveRow(src: string, at?: number): string;
export function tableSetAlign(src: string, at: number, how: '' | 'left' | 'center' | 'right'): string;

/** How many direct `child` directives a container block holds (`:::tabs` → 'tab'). */
export function countChildren(src: string, child: string): number;
/** Append a child, using one fewer colon than the parent — the rule that makes these nest. */
export function addChild(src: string, child: string, label?: string, body?: string): string;
