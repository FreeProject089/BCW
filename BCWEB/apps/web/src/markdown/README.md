# The BetterCommunity markdown kit

A GitBook-style block system on top of GitHub-flavoured Markdown, as a **React component you
copy into your project**. Thirty-two block types — callouts, cards, tabs, steps, columns,
buttons with brand logos, file downloads, a table of contents, maths — and no build step of
its own.

It is the same code that renders every blog post, doc page, FAQ answer and legal document on
BetterCommunity, and the same code the page builder uses for a text block. There is one
renderer, not a copy: `apps/web/src/ui/md.jsx` is a thirty-line adapter around this folder.

## What is in here

| File | What it is |
|---|---|
| `index.jsx` | the renderer, `<Markdown>` and the pieces it exports |
| `nesting.js` | the pre-pass that makes `:::` blocks nest the way people write them |
| `emoji.js` | 384 `:shortcode:` names — replace this file to bring your own set |
| `brands.jsx` | brand marks (Discord, Ko-fi, YouTube…) — lucide has none of these |
| `markdown.css` | every style, scoped to `.md-body` and `.doc-*` |

Copy the folder. That is the install.

## Dependencies

```bash
npm i react react-dom react-markdown remark-gfm remark-directive rehype-raw rehype-sanitize unist-util-visit lucide-react
```

Three more are **optional** and loaded only when a document needs them, so a project that
never writes maths never downloads a typesetting engine:

```bash
npm i rehype-highlight        # ``` code blocks get colours
npm i remark-math rehype-katex katex   # $$…$$ formulas
```

Without them a code block is still a styled code block and a formula is still its source
text. Nothing throws.

## Use it

```jsx
import Markdown from './markdown/index.jsx';

export default function Post({ body }) {
  return <Markdown lang="en">{body}</Markdown>;
}
```

That is the whole API for the common case. `className` is added to the wrapper, and `pageMap`
turns internal links into hover-preview cards (see below).

## The three things it cannot know

Two blocks are React components rather than markup, and the kit does not ship either — they
would drag in a charting library and an rrweb player for features most documents never use.
Pass your own, or the block says so instead of crashing:

```jsx
<Markdown
  lang={lang}
  roadmap={MyProgressTracker}   /* ({ data, title, lang }) => node   — :::roadmap */
  replay={MyReplayPlayer}       /* ({ src, title, autoplay, loop }) => node — :::replay */
>{body}</Markdown>
```

The third is your own logos, for the `app:` icon namespace (`:icon[app:acme]`). Call this once
at import time, before anything renders:

```js
import { configureMarkdown } from './markdown/index.jsx';
configureMarkdown({ appIcons: { acme: '/logo.png' } });
```

## Make it yours

`markdown.css` defines no colours of its own — it reads variables you already have, or that
you can define in ten lines:

```css
:root {
  --text: #17140f; --muted: #57514a; --faint: #726b61;
  --line: #e6e0d8; --line-strong: #d5cec4;
  --surface: #f3eee6; --surface-2: #ece5db; --bg-solid: #fff;
  --primary: #f97316; --primary-2: #ea580c;
  --error: #dc2626;
}
```

Change those and every block follows: callouts, cards, buttons, the step rail, the table of
contents. There is no theme prop and no `!important` anywhere, so overriding a single rule in
your own stylesheet works normally.

## Hover-preview cards for internal links

Pass a `pageMap` and an internal link grows a card on hover with the target's title, category,
icon and first line:

```jsx
<Markdown pageMap={{ '/docs/intro': { title: 'Introduction', category: 'Start here', icon: 'book', desc: 'What this is.' } }}>
```

## Security, since this renders text other people wrote

Raw HTML in a document is allowed and then **sanitised** (`rehype-sanitize`) against a schema
that permits exactly what the block system emits and nothing else — no `<script>`, no `on*`
handlers, no `javascript:` URLs. `<iframe>` survives sanitising and is then filtered again to
YouTube only, so an author cannot smuggle an arbitrary frame into a page.

Two deliberate choices worth knowing before you change them:

- **KaTeX runs after the sanitiser.** It has to: its output is a deep tree of KaTeX classes
  that the schema would strip. That is safe because KaTeX renders from the *text* of a math
  node and `trust` is left false — which is what disables `\href`, `\url` and the `\html*`
  commands, the only ones that can emit author-controlled markup. Turning `trust` on undoes
  this paragraph.
- **Single-dollar inline maths is off.** `$x$` is what TeX users expect and it cannot be had
  on a site that quotes prices: remark-math reads `$5 and $10` as a formula and prints
  `5and10`. Measured on a live page before choosing. Maths is `$$…$$`, inline or display.

## The vocabulary

`/dev/markdown` on a running BetterCommunity has the full reference with a live editor. The
short version:

```
:::note :::tip :::success :::warning :::danger      callouts, each takes [A title]
:::callout{icon=rocket color="#7c3aed"}             one of your own
:::cards / :::card{title= href= icon= image=}       card and card grid
:::tabs / :::tab{title="…"}                         tabs
:::steps / :::step[Title]                           numbered steps
:::columns / :::column                              responsive columns
:::collapse[Summary]                                a disclosure
:::center :::left :::right                          alignment
:::roadmap{src=…} / :::replay{src=…}                the two injected components
:button[Label]{brand=discord href=…}                a button, eight brands, three sizes
:link[text]{color=#e11 href=…}                      a coloured link
:badge[NEW]{color="#0a7"}  :tag[…]                  chips
:icon[rocket]  :kbd[Ctrl+K]                         inline icon, keycaps
:file[report.pdf]{href=… size="1.2 MB"}             a download, icon by extension
:::roadmap[Where we are] / :::stage[Done]{state=done}  a progress tracker (:::progress is the same block)
::toc[On this page]                                 table of contents
$$E = mc^2$$                                        maths
:rocket: :tada: :+1:                                emoji, by GitHub's names
```

## What it is not

It does not parse or store anything: `<Markdown>` takes a string and returns elements. Where
the string comes from, who may edit it, and how it is saved are your application's problem —
which is why this folder has no API client, no auth, and no router in it.
