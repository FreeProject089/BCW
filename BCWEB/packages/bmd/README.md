# @bettercommunity/bmd — B.MD, better.markdown

A block system on GitHub-flavoured Markdown, as **one React component** (3.0): callouts, cards,
tabs, steps, columns, buttons with brand logos, file downloads, a roadmap, timelines, stats,
FAQs, changelogs, a hero, a quote, a checklist that counts, styled tables, images with captions,
audio, YouTube and Spotify embeds, API endpoint cards (hand-written or from an OpenAPI
document), live values and action buttons, includes, Mermaid diagrams, wiki links, marks,
footnotes, an automatic table of contents, maths, emoji, four icon families (lucide, Phosphor,
Simple Icons, and 83 full-colour isometric icons) — ninety-odd directives, no build step. Beside the component: a public AST, a
link checker, an HTML exporter, a plugin API, and a separate editor package.

It is the renderer behind every blog post, doc page, FAQ answer and legal document on
[BetterCommunity](https://bettercommunity.ch), and the same vocabulary BMM renders in-app and
the BMM Docs site renders through MkDocs.

```bash
npm i @bettercommunity/bmd react react-dom react-markdown remark-gfm remark-directive rehype-raw rehype-sanitize unist-util-visit unified remark-parse lucide-react
# optional — loaded only when a document needs them
npm i rehype-highlight remark-math rehype-katex katex mermaid
```

```jsx
import Markdown from '@bettercommunity/bmd';
import '@bettercommunity/bmd/markdown.css';

export default function Post({ body }) {
  return <Markdown lang="en">{body}</Markdown>;
}
```

## Where things are

| | |
|---|---|
| `src/` | the kit — `index.jsx` is the component, `directives.js` the parser, `blocks.jsx` the block components, `markdown.css` the styles. `src/README.md` is the long-form guide (configuration, plugins, security, accessibility). |
| `docs/blocks.md` | **every block**, with its syntax and attributes |
| `docs/icons.md` | the three icon families and how names resolve |
| `docs/configuration.md` | `configureMarkdown`: app icons, CDNs, URL policy, iframes |
| `docs/integration.md` | using the package in place (monorepo), in BMM and in MkDocs |
| `docs/frameworks.md` | Vite, Next.js, Remix, Astro, plain ESM — the wiring for each |
| `docs/extending.md` | plugins, variants, the AST, the link checker, exporting HTML |
| `../bmd-editor/` | the editor package: `<BmdEditor>` for phones and desktops |
| `CHANGELOG.md` | what changed, version by version |

## Not published to npm yet

The package is complete (`package.json`, `exports`, types, `files`), but it is consumed **in
place** by the monorepo: `apps/web` maps `@bettercommunity/bmd` onto this folder through a Vite
alias (see `docs/integration.md`). To use it elsewhere today: `npm pack` in this folder and
install the tarball, or copy `src/`. Publishing is one `npm publish` away.
