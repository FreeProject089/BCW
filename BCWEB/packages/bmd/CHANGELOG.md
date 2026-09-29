# Changelog

## Unreleased

## 3.1.0 — 2026-09-26

The first release on the npm registry, for both packages (`@bettercommunity/bmd` and
`@bettercommunity/bmd-editor`, versioned together).

### Packaging
- **Built for npm**: the tarball ships `dist/` (plain ES modules, one file per entry, shared chunks beside them) instead of the JSX sources, so the package imports in Node, in Next.js without `transpilePackages`, and in any bundler. `prepack` builds it (`scripts/build.mjs`).
- **Types per entry**: `@bettercommunity/bmd/config`, `/export`, `/registry`… each carry their own `.d.ts` holding only what that entry exports; `exports` lists `types` first; `typesVersions` covers `moduleResolution: node`.
- **Dependencies**: the Markdown pipeline (`react-markdown`, `remark-*`, `rehype-*`, `unified`, `unist-util-visit`) and `lucide-react` are now `dependencies`, installed for you. `react` and `react-dom` (18 or 19) stay peers; `mermaid`, `rehype-highlight`, `remark-math`, `rehype-katex`, `katex` stay optional peers. `npm i @bettercommunity/bmd` is the whole install.
- **The stylesheet is imported explicitly**: `import '@bettercommunity/bmd/markdown.css'` (and `@bettercommunity/bmd-editor/editor.css`). The built entry no longer imports CSS itself, so it runs under Node and server renderers.
- Verified from the packed tarball with npm and pnpm (strict `node_modules`), React 18 and 19, TypeScript `node16` and `bundler`, `publint` and `arethetypeswrong` (ESM-only profile).
- The `./src/*` subpath is gone from `exports`: the sources are no longer in the tarball.

### Added
- **Directive registry**: `DIRECTIVES`, `DIRECTIVE_GROUPS`, `directiveNames()`, `findDirective()`, `directiveSyntax()` (also at `@bettercommunity/bmd/registry`). Every block as data (name, aliases, forms, attributes, an English and French summary, an example); the README table and bettercommunity.ch/dev/bmd are generated from it, and a test fails when it and the parser disagree.
- **Isometric icons**: `iso:<name>` (or `isometric:`), 83 full-colour SVGs shipped in `assets/iso/` from three MIT sets (Isoflow isopack, MI2, Jolloficons; MI2's glyphs are Material Design Icons, Apache-2.0), with every notice in `assets/iso/LICENSES.txt`. Drawn as an `<img>`; `cdn.iso` in the config says where from (jsDelivr's copy of this package by default, `null` switches the family off). `ISO_NAMES` and `isoRef()` exported from `./icons`; `./iso/icons.json` is the picker manifest.

- **`policy.allowApiHosts`** (and `policy.origin`): a strict allowlist for what live blocks FETCH (`kind: 'api'`). An array, even empty, means the page's own origin plus the listed hosts; `[]` is same origin only. `null` (the default) keeps the `allowHosts` rule.

### Unchanged
- Every existing icon name resolves as before: `iso:` was not a valid name in any family.
- With `allowApiHosts` left `null`, the URL policy behaves exactly as in 3.0.0.

## 3.0.0 — 2026-09-07

### Added
- **Tables**: `:::table[Caption]{style="striped bordered compact hover plain wide sticky numbers" align= width=}` around a GFM table; cells keep holding markdown.
- **Images**: `:img[Alt]{src= width= height= align= caption= link= zoom=false lazy=false border rounded}`; a plain `![alt](src "title")` gets its title as a caption.
- **Media**: `:audio[Title]{src=}`, `::youtube{src=}` / `::yt{id=}`, `::spotify{src=}` (track, album, playlist, episode, show, artist).
- **API docs**: `:::api[GET /path]{auth= summary= deprecated}` with `:::params` / `:::request` / `:::response{status=}` sections; `::openapi{src= tag= filter=}` draws a whole OpenAPI document as those cards; `openapiToBmd()` is exported for the generator.
- **Live and interactive**: `:counter[Label]{src= path= refresh= format=}` / `::live{…}` read a value from a URL; `:action[Label]{href= method= body= confirm= done= counter= once}` calls one when pressed and refreshes the named counter.
- **Includes**: `::include{src=…}` renders another document in place (two levels deep; `resolveInclude` in the config decides how it is fetched).
- **Diagrams**: ```` ```mermaid ```` fences and `:::mermaid` blocks, rendered by Mermaid under its strict level — `loadMermaid: () => import('mermaid')` when the package is installed, a CDN module otherwise.
- **Text**: `==marked==` → `<mark>`; `[[Page]]`, `[[Page|text]]`, `[[Page#section]]` resolve against `pageMap` (a missing page stays as text with `doc-ref-missing`); GFM strikethrough, footnotes and autolinks documented and styled.
- **Table of contents**: `::toc{depth=4 numbered}`; `<Markdown toc="auto">` adds one when a document has three headings and none written.
- **Radius**: `{radius=8}` on any block, `<Markdown radius="10px">` or `configureMarkdown({ radius })` for all of them — every block reads `--r` then `--bmd-radius`.
- **Every block**: `variant=` (→ `doc-variant-<name>` for a project's own styles), `class=`, `.class` / `#id` shorthands.
- **Public AST**: `parseMarkdown()`, `walkAst()`, `extractHeadings()`, `extractLinks()`, `extractText()`.
- **Link checker**: `validateLinks(md, { pageMap })` — anchors against the document's headings, paths against the page map, refused and insecure URLs.
- **Export**: `renderHtml()` and `documentHtml()` (react-dom/server) with `cssUrl`.
- **Plugins**: `registerBlocks()`, `definePlugin({ name, blocks, css })`.
- **Editor**: `@bettercommunity/bmd-editor` — `<BmdEditor>` with a block palette, live preview, phone and desktop layouts, link check and HTML export. Separate package; the core stays a renderer.
- Sanitiser: `mark`, `ins`, `sup`, `sub`, `time`, `figure` attributes, image `width`/`height`; the iframe allowlist now reads `configureMarkdown({ allowIframes })` and includes Spotify's embed.

### Changed
- README, package description and keywords no longer describe the kit by another product's name.

### Unchanged
- Every 1.x and 2.x directive, class name and attribute. Existing documents render identically.

## 2.0.0 — 2026-09-06

The kit becomes a package: `packages/bmd` with `package.json`, `exports`, `docs/`, this file.
`apps/web` reads it in place (Vite alias + `resolve.dedupe`); the `/dev/markdown` zip is unchanged.

### Added
- `:::timeline` / `:::event[Title]{date= state=done|now|next icon= color=}` (`:::moment` alias).
- `:::compare{before= after=}` with `:::before` / `:::after` sides.
- `:::stats` / `:::stat[Label]{value= delta= icon= color=}` (`:::kpi` alias) — the delta's sign colours it.
- `:::quote[Author]{role= avatar= href= color=}` (`:::testimonial` alias).
- `:::hero[Title]{subtitle= image= icon= color= align=}`.
- `:::changelog` / `:::version[1.4.0]{date= label=}` (`:::release` alias).
- `:::spoiler[Reveal]` — a `<details>`, no script.
- `:::faq[Title]` / `:::q[Question]{open}` (`:::question` alias).
- `:::checklist[Title]` — counts the `- [x]` items and draws a bar.
- `:::grid{cols=1..6 gap=sm|lg}`.
- `:meter[60]{label= max= color=}` — inline progress.
- **Phosphor icons**: `ph:name`, `ph-thin:` / `ph-light:` / `ph-bold:` / `ph-fill:` / `ph-duotone:`; `cdn.phosphor` in the config (null switches the family off); `phosphorRef()` exported.
- Types: `registerAppIcons`, `appIconLabel`, `phosphorRef` declared; `cdnIconUrl` accepts `'phosphor'`.

### Unchanged
- Every 1.x directive, class name and attribute. Existing documents render identically.

## 1.x

The copy-the-folder era (`apps/web/src/markdown`): 48 directives, the roadmap and replay
components, the URL policy, the sanitiser, the plugin hook, the TypeScript declarations.
