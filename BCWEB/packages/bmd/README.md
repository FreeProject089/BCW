# @bettercommunity/bmd

**B.MD, better.markdown**: GitHub-flavoured Markdown plus a block system (callouts, cards, tabs,
steps, timelines, stats, FAQs, changelogs, styled tables, API endpoint cards drawn from an
OpenAPI document, YouTube and Spotify embeds, live values, action buttons, includes, Mermaid
diagrams) as **one React component**. Beside it: a public syntax tree, a link checker, an HTML
exporter for e-mail and static pages, a plugin API, and a URL policy that every link and every
fetch goes through.

It renders every blog post, doc page, FAQ answer and legal page on
[bettercommunity.ch](https://bettercommunity.ch), and the same vocabulary is rendered by the BMM
desktop app and the BMM Docs site.

[![npm](https://img.shields.io/npm/v/@bettercommunity/bmd)](https://www.npmjs.com/package/@bettercommunity/bmd)
[![license](https://img.shields.io/npm/l/@bettercommunity/bmd)](./LICENSE)
[![types](https://img.shields.io/npm/types/@bettercommunity/bmd)](#typescript)

**Try it in the browser:** [bettercommunity.ch/dev/bmd](https://bettercommunity.ch/dev/bmd) (install, live playground, every directive).

**Published on npm** since 3.1.0 (2026-09-29), with
[provenance](https://www.npmjs.com/package/@bettercommunity/bmd#provenance): every version is
built and published by GitHub Actions from this repository, and the npm page names the workflow
run and the commit it came from. The editor is its own package,
[@bettercommunity/bmd-editor](https://www.npmjs.com/package/@bettercommunity/bmd-editor),
published beside it with the same version.

## Install

```bash
npm i @bettercommunity/bmd
pnpm add @bettercommunity/bmd
yarn add @bettercommunity/bmd
bun add @bettercommunity/bmd
```

That is the whole install: the Markdown pipeline (react-markdown, remark, rehype, unified) and
the icons come with it. You bring **React 18 or 19** (`react`, `react-dom`), which your app
already has.

pnpm installs from the same npm registry; there is no separate "pnpm publish". The package is
tested from its tarball under pnpm's strict `node_modules`, where a dependency that was used and
never declared fails at the first import instead of working by accident.

Optional, loaded only when a document needs them:

```bash
npm i mermaid                                   # ```mermaid fences and :::mermaid blocks
npm i rehype-highlight                          # syntax colours in fenced code
npm i remark-math rehype-katex katex            # $$maths$$
```

Without them the document still renders: code stays uncoloured, maths stays as source, and
Mermaid loads from a CDN unless you switch that off (see [Configuration](#configuration)). With
webpack (Next.js), install the ones you use: webpack resolves every `import()` at build time,
while Vite stubs a missing optional peer.

## Quick start

```jsx
import Markdown from '@bettercommunity/bmd';
import '@bettercommunity/bmd/markdown.css';

export default function Post({ body }) {
  return <Markdown lang="en" toc="auto">{body}</Markdown>;
}
```

```md
:::tip[Install]
`npm i @bettercommunity/bmd`, then render a string. :badge[3.x]{color="#0a7"}
:::

:::steps
:::step[Write]
Plain Markdown, plus blocks.
:::
:::step[Render]
`<Markdown>{body}</Markdown>`
:::
:::
```

The stylesheet is imported once, anywhere in your app. It reads a handful of CSS variables
(`--text`, `--muted`, `--line`, `--surface`, `--primary`…) so it follows your theme; see
[docs/configuration.md](./docs/configuration.md).

### On the server, in e-mail, as a static page

```js
import { readFileSync } from 'node:fs';
import { renderHtml, documentHtml, cssUrl } from '@bettercommunity/bmd/export';

const fragment = renderHtml(body, { lang: 'en' });                 // <div class="md-body">…</div>
const css = readFileSync(new URL(cssUrl), 'utf8');
const page = documentHtml(body, { title: 'Release notes', css, scheme: 'light' });
```

The package is plain ES modules and runs in Node 18.18+ with `react-dom/server`. Interactive
blocks render their resting state (the first tab open, a counter with its label).

### Frameworks

| | |
|---|---|
| **Vite + React** | import the component and the CSS; call `configureMarkdown()` once in `main.jsx` |
| **Next.js (App Router)** | render it from a `'use client'` wrapper (tabs, live values and the lightbox hold state), or use `renderHtml()` in a server component for zero client JavaScript |
| **Remix / React Router** | `import css from '@bettercommunity/bmd/markdown.css?url'` in `links()` |
| **Astro** | a React island with `client:load`, or `documentHtml()` at build time |
| **Node** | `@bettercommunity/bmd/export` |

Copy-paste wiring for each: [docs/frameworks.md](./docs/frameworks.md).

## Directives

`:::name` opens a container block and `:::` closes it; `::name{…}` is a block on one line;
`:name[…]{…}` sits inside a sentence. Attributes go in `{}` (`key=value`, quoted when the value
has spaces). Every block also takes `radius=`, `variant=`, `class=` and the `.class` / `#id`
shorthands. Full syntax with examples: [docs/blocks.md](./docs/blocks.md).

<!-- directives:start -->
65 blocks, 95 names with the aliases. Generated from `src/registry.js` (also exported as `DIRECTIVES`), which a test holds to the parser.

#### Callouts

| Directive | Aliases | What it does | Attributes |
|---|---|---|---|
| `:::note` | `info` | A neutral note with a title. | `title` `icon` `color` |
| `:::tip` | `hint` | A suggestion worth following. | `title` `icon` `color` |
| `:::success` | `check` | Something that worked, or a done state. | `title` `icon` `color` |
| `:::warning` | `caution` `important` | Read this before going on. | `title` `icon` `color` |
| `:::danger` | `error` | Something that loses data or money. | `title` `icon` `color` |
| `:::callout` | `custom` | A callout with your own icon and colour. | `title` `icon` `color` |

#### Layout

| Directive | Aliases | What it does | Attributes |
|---|---|---|---|
| `:::cards` |  | A responsive grid of cards. |  |
| `:::card` | `ref` | One card: a title, a body, an optional link and cover. | `title` `href` `icon` `image` `video` `color` |
| `:::tabs` |  | Tabs; one :::tab per panel. |  |
| `:::tab` |  | One panel of a :::tabs block. Inside `tabs`. | `title` |
| `:::steps` |  | A numbered procedure (1/2/3, a/b/c, i/ii/iii, dots or icons). | `title` `type` `marker` `start` `orientation` `shape` `color` |
| `:::step` |  | One step of a :::steps block. Inside `steps`. | `title` `icon` `done` `color` |
| `:::columns` | `row` | Equal columns that stack on a phone. |  |
| `:::column` | `col` | One column of a :::columns block. Inside `columns`. |  |
| `:::grid` |  | A fixed-column grid (1 to 6) that folds on narrow screens. | `cols` `gap` |
| `:::center` |  | Centre what is inside. |  |
| `:::left` |  | Align what is inside to the start. |  |
| `:::right` |  | Align what is inside to the end. |  |
| `::divider` `:::divider` |  | A horizontal rule, optionally labelled. | `title` |
| `:::details` | `collapse` | A collapsed section the reader opens. | `title` |
| `:::spoiler` |  | Hidden until clicked, no script needed. | `title` |
| `:::faq` |  | A list of questions that open on their answers. | `title` |
| `:::q` | `question` | One question of a :::faq block. Inside `faq`. | `title` `open` |

#### Content blocks

| Directive | Aliases | What it does | Attributes |
|---|---|---|---|
| `:::table` |  | A styled GFM table with a caption. | `title` `style` `align` `width` |
| `:::timeline` |  | Dated events on a rail. | `title` |
| `:::event` | `moment` | One event of a :::timeline (state done, now or next). Inside `timeline`. | `title` `date` `state` `icon` `color` |
| `:::compare` |  | Two sides, before and after. | `before` `after` |
| `:::before` |  | The left side of a :::compare. Inside `compare`. | `title` |
| `:::after` |  | The right side of a :::compare. Inside `compare`. | `title` |
| `:::stats` |  | A row of key numbers. |  |
| `:::stat` | `kpi` | One number; the sign of its delta colours it. Inside `stats`. | `title` `value` `delta` `icon` `color` |
| `:::quote` | `testimonial` | A quotation with its author. | `title` `role` `avatar` `href` `color` |
| `:::hero` |  | A page header with a title, a subtitle and actions. | `title` `subtitle` `image` `icon` `color` `align` |
| `:::changelog` |  | Release notes, one :::version each. | `title` |
| `:::version` | `release` | One release of a :::changelog. Inside `changelog`. | `title` `date` `label` |
| `:::checklist` |  | A task list whose header counts the ticked items. | `title` `color` |
| `:::field` | `setting` | A labelled settings row: a label, a type, a key and a description. | `title` `type` `key` `icon` `color` `anchor` |

#### Inline

| Directive | Aliases | What it does | Attributes |
|---|---|---|---|
| `:badge` | `tag` | A small coloured label. | `color` |
| `:icon` |  | An icon: lucide, ph:, simple:, iso: or app: names. | `name` |
| `:kbd` |  | Keyboard keys, drawn as keycaps. |  |
| `:meter` |  | A small inline progress bar. | `label` `max` `color` |
| `:button` | `btn` | A link drawn as a button; brand= picks a logo and colour. | `href` `brand` `color` `size` `outline` `icon` |
| `:link` |  | A coloured link. | `href` `color` |
| `:file` `::file` |  | A download row with an icon picked from the extension. | `href` `size` `icon` `name` |
| `:time` | `at` | One instant, shown in the reader’s own time zone. | `tz` `format` |
| `::toc` |  | A table of contents built from the headings. | `title` `depth` `numbered` |

#### Media and diagrams

| Directive | Aliases | What it does | Attributes |
|---|---|---|---|
| `:img` `::img` | `image` | An image with size, alignment, caption and zoom. | `src` `width` `height` `align` `caption` `link` `zoom` `lazy` `border` `rounded` |
| `:audio` `::audio` |  | An audio player. | `src` `title` |
| `::youtube` | `yt` | A YouTube video, from youtube-nocookie. | `src` `id` `start` |
| `::spotify` |  | A Spotify track, album, playlist, episode, show or artist. | `src` `compact` `theme` |
| `:::mermaid` | `diagram` | A Mermaid diagram (strict security level). A ```mermaid fence works too. | `title` `theme` `look` |

#### API documentation

| Directive | Aliases | What it does | Attributes |
|---|---|---|---|
| `:::api` | `endpoint` | An endpoint card: method, path, auth and sections. | `title` `auth` `summary` `deprecated` |
| `:::params` |  | The parameters table of an :::api card. Inside `api`. | `title` |
| `:::request` |  | The request body of an :::api card. Inside `api`. | `title` |
| `:::response` |  | One response of an :::api card, by status. Inside `api`. | `title` `status` |
| `::openapi` | `swagger` | Fetches an OpenAPI 3 / Swagger 2 document and draws every operation as :::api cards. Fetches. | `src` `tag` `filter` `toc` |

#### Live and interactive

| Directive | Aliases | What it does | Attributes |
|---|---|---|---|
| `:counter` |  | A number read from a JSON URL, refreshed on a timer. Fetches. | `src` `path` `refresh` `format` `prefix` `suffix` |
| `:fetch` |  | Any value read from a JSON URL, inline. Fetches. | `src` `path` `refresh` `format` |
| `::live` |  | A value read from a JSON URL, as its own block. Fetches. | `src` `path` `refresh` `format` |
| `:action` |  | A button that calls a URL, always without the reader’s cookies; a write asks first. Fetches. | `href` `method` `body` `confirm` `done` `counter` `once` `icon` `color` |
| `::include` | `embed-md` | Renders another markdown document in place (two levels deep). Fetches. | `src` |
| `:::schedule` | `hours` | A table of repeating hours, converted to the reader’s time zone. | `title` `tz` |
| `:::roadmap` | `progress` | A roadmap in stages, with progress. | `title` `orientation` |
| `:::stage` | `phase` | One stage of a :::roadmap. Inside `roadmap`. | `title` `state` `percent` |
| `:::replay` | `bmmreplay` | A recorded .bmmreplay session, played in place. Fetches. | `title` `src` |
<!-- directives:end -->

Plus the Markdown extensions: `==marked==`, `~~struck~~`, footnotes, `[[Wiki links]]` against a
page map, `> [!NOTE]` GitHub alerts, `:rocket:` emoji, `[NEW]` chips, four icon families
(lucide, Phosphor `ph:`, Simple Icons `simple:`, isometric `iso:`), see
[docs/icons.md](./docs/icons.md).

The list is also data you can use: `import { DIRECTIVES, findDirective } from '@bettercommunity/bmd/registry'`
(an editor's block menu, your own reference page, a linter).

## Security

B.MD renders text other people wrote, so the defaults assume the author is hostile.

- **Sanitised HTML.** Raw HTML is allowed and then filtered by `rehype-sanitize` against a
  schema that permits what the blocks emit and nothing else: no `<script>`, no `<style>`, no
  `on*` handlers.
- **One URL policy for every `href` and `src`**, including the ones directives build
  (`safeUrl()` in `@bettercommunity/bmd`). Only `http(s)`, `mailto`, `tel`, `xmpp`, `irc(s)` and
  relative URLs pass; `javascript:` and `data:` are refused, control characters are stripped
  before the scheme is read (`java\tscript:` is a working URL in a browser), protocol-relative
  `//host` is refused in all its spellings, and every link that opens a tab gets
  `rel="noopener noreferrer"`.
- **Host allowlists**, all in `configureMarkdown({ policy })`:
  - `allowHosts` for links;
  - `allowDownloadHosts` for `:file` and download buttons;
  - **`allowApiHosts` for what live blocks fetch** (`:counter`, `::live`, `:action`,
    `::include`, `::openapi`). Stricter on purpose: an array, even an empty one, means the
    page's own origin plus the listed hosts and nothing else, because a fetch runs in every
    reader's browser as soon as the page is shown. `null` (the default) falls back to
    `allowHosts`.
- **No cookies on fetches.** Every live request is sent with `credentials: 'omit'`: a button
  somebody else wrote can only do what its author could do alone, never act with the reader's
  session. A mutating `:action` always asks first, naming the method and the URL.
- **Styles and colours.** `color=` accepts a colour or a `var(--token)` and nothing else;
  inline `style` values are read, and `expression()`, `url(javascript:…)` and
  `position: fixed` overlays are refused.
- **Frames.** An `<iframe>` survives only if its `src` matches `allowIframes` (YouTube's
  no-cookie domain and Spotify's embed by default).
- **Mermaid** runs at its `strict` security level. **KaTeX** runs with `trust: false`.
- **Your CSP.** With the defaults the kit reaches `cdn.jsdelivr.net` (icons, and Mermaid when
  it is not installed) and `cdn.simpleicons.org` (brand icons). Set the `cdn` entries to `null`
  and it requests nothing from anyone.

```js
import { configureMarkdown } from '@bettercommunity/bmd/config';

configureMarkdown({
  policy: {
    allowHosts: ['example.com'],          // links: example.com and its subdomains
    allowApiHosts: [],                    // live blocks: this origin only
  },
  cdn: { lucide: null, brand: null, phosphor: null, mermaid: null },   // no third-party requests
  loadMermaid: () => import('mermaid'),
});
```

## Configuration

`configureMarkdown(options)` is called once, at startup. Every value that was specific to
BetterCommunity is a knob: `appIcons` (`:icon[app:name]` logos), `cdn` (where each icon family
and Mermaid come from, `null` switches one off), `policy` (above), `allowIframes`, `radius`,
`resolveInclude` (how `::include` fetches), `loadMermaid`. Details:
[docs/configuration.md](./docs/configuration.md). `<Markdown>` itself takes `lang`, `pageMap`
(for `[[wiki links]]`), `toc="auto"`, `radius`, `className`, and `roadmap` / `replay` to swap
those blocks for your own components.

## What else is in the package

| Import | What |
|---|---|
| `@bettercommunity/bmd` | `<Markdown>` (default), and everything below re-exported |
| `@bettercommunity/bmd/config` | `configureMarkdown`, `MarkdownConfig` (a React context) |
| `@bettercommunity/bmd/export` | `renderHtml`, `documentHtml`, `cssUrl` |
| `@bettercommunity/bmd/ast` | `parseMarkdown`, `walkAst`, `extractHeadings`, `extractLinks`, `extractText` |
| `@bettercommunity/bmd/links` | `validateLinks(md, { pageMap })`: dead anchors, unknown pages, refused URLs |
| `@bettercommunity/bmd/openapi` | `openapiToBmd(spec)`: an OpenAPI 3 / Swagger 2 document as `:::api` cards |
| `@bettercommunity/bmd/plugins` | `registerBlocks`, `definePlugin`: add a block without forking |
| `@bettercommunity/bmd/registry` | `DIRECTIVES`, `DIRECTIVE_GROUPS`, `findDirective`, `directiveNames` |
| `@bettercommunity/bmd/icons` | `DocIcon`, `IconGlyph`, `ICON_NAMES`, `phosphorRef`, `isoRef` |
| `@bettercommunity/bmd/editor-blocks` | the lossless block model the editor uses (`splitBlocks`, `joinBlocks`) |
| `@bettercommunity/bmd/markdown.css` | the stylesheet |

Extending (plugins, variants, the AST, exporting): [docs/extending.md](./docs/extending.md).

### The editor

[`@bettercommunity/bmd-editor`](https://www.npmjs.com/package/@bettercommunity/bmd-editor) is a
separate package, so a site that only reads documents never ships it: a block menu with every
directive, a live preview through this renderer, phone and desktop layouts, a link checker, an
outline and an HTML export.

```bash
npm i @bettercommunity/bmd @bettercommunity/bmd-editor
```

### TypeScript

Types ship in the package, one declaration file per entry, holding only what that entry
exports. Checked with `moduleResolution` `node16`, `nodenext` and `bundler` (strict, no
`skipLibCheck`), and `node` through `typesVersions`. The package is ESM-only, like
react-markdown and the unified ecosystem it builds on: from CommonJS, use `await import()`.

## Size

<!-- size:start -->
Measured for 3.1.0 by `scripts/gen-readme.mjs` (minified, gzip -9).

- **In the browser**, `import Markdown from '@bettercommunity/bmd'` with the Markdown pipeline bundled in (react-markdown, remark, rehype, lucide icons): **149.4 kB gzipped** (490.3 kB minified). React and React DOM are not counted: the page has them already.
- **The stylesheet**: 13.2 kB gzipped.
- **Loaded only when a document needs them**, never at startup: Mermaid (a diagram), KaTeX (maths), highlight.js (a fenced code block).

B.MD's own code per entry, its shared chunks included:

| Import | Minified | Gzipped |
|---|---|---|
| `@bettercommunity/bmd` | 113.8 kB | 40.6 kB |
| `@bettercommunity/bmd/export` | 114.1 kB | 40.9 kB |
| `@bettercommunity/bmd/config` | 2.1 kB | 0.9 kB |
| `@bettercommunity/bmd/registry` | 19.2 kB | 6.2 kB |
| `@bettercommunity/bmd/ast` | 40.4 kB | 13.3 kB |
| `@bettercommunity/bmd/links` | 42.1 kB | 14.1 kB |
| `@bettercommunity/bmd/openapi` | 5.3 kB | 2.2 kB |
<!-- size:end -->

## Links

- Playground, install guide and directive reference: <https://bettercommunity.ch/dev/bmd>
- The editor, live: <https://bettercommunity.ch/dev/editor>
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Source and issues: <https://github.com/FreeProject089/BCW/tree/master/BCWEB/packages/bmd>

MIT licensed. The isometric icons in `assets/iso/` come from three MIT sets (one of them
drawing Material Design Icons, Apache-2.0); every notice is in `assets/iso/LICENSES.txt`.
