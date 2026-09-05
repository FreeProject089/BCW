# @bettercommunity/bmd — B.MD, better.markdown

GitBook-style blocks on GitHub-flavoured Markdown, as **one React component**: callouts, cards,
tabs, steps, columns, buttons with brand logos, file downloads, a roadmap, timelines, stats,
FAQs, changelogs, a hero, a quote, a checklist that counts, tables of contents, maths, emoji,
three icon families (lucide, Phosphor, Simple Icons) — seventy directives, no build step.

It is the renderer behind every blog post, doc page, FAQ answer and legal document on
[BetterCommunity](https://bettercommunity.ch), and the same vocabulary BMM renders in-app and
the BMM Docs site renders through MkDocs.

```bash
npm i @bettercommunity/bmd react react-dom react-markdown remark-gfm remark-directive rehype-raw rehype-sanitize unist-util-visit lucide-react
# optional — loaded only when a document needs them
npm i rehype-highlight remark-math rehype-katex katex
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
| `CHANGELOG.md` | what changed, version by version |

## Not published to npm yet

The package is complete (`package.json`, `exports`, types, `files`), but it is consumed **in
place** by the monorepo: `apps/web` maps `@bettercommunity/bmd` onto this folder through a Vite
alias (see `docs/integration.md`). To use it elsewhere today: `npm pack` in this folder and
install the tarball, or copy `src/`. Publishing is one `npm publish` away.
