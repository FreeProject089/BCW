# B.MD — better.markdown

A block system on top of GitHub-flavoured Markdown, as a **React component** —
the `@bettercommunity/bmd` package. Seventy-odd directives — callouts, cards, tabs, steps, columns,
buttons with brand logos, file downloads, a roadmap, a media embed, a table of contents,
maths — and no build step of its own.

It is the same code that renders every blog post, doc page, FAQ answer and legal document on
BetterCommunity, and the same code the page builder uses for a text block. There is one
renderer, not a copy: `apps/web/src/ui/md.jsx` is a thirty-line adapter around this folder.

## What is in here

| File | What it is |
|---|---|
| `index.jsx` | the assembly — the pipeline, the component map, `<Markdown>` |
| `directives.js` | the parser: markdown-with-directives → an mdast tree. No React |
| `blocks.jsx` | one React component per block the parser emits |
| `icons.jsx` | the icon set, and where a non-bundled icon comes from |
| `sanitize.js` | what survives, and what a URL and a `style` are allowed to be |
| `url.js` | the URL policy itself — one function, every link in a document |
| `config.js` | everything a host application points at itself |
| `plugins.js` | a block B.MD does not have, added without editing B.MD |
| `roadmap.jsx` | the built-in `:::roadmap` |
| `replay.jsx` | the built-in `:::replay` |
| `nesting.js` | the pre-pass that makes `:::` blocks nest the way people write them |
| `emoji.js` | 384 `:shortcode:` names — replace this file to bring your own set |
| `shorthand.js` | the pre-parser rewrites: `> [!NOTE]` alerts and bare `[NEW]` chips |
| `brands.jsx` | brand marks (Discord, Ko-fi, YouTube…) — lucide has none of these |
| `markdown.css` | every style, scoped to `.md-body` and `.doc-*` |
| `markdown.d.ts` | the types — see **TypeScript** below |

It was one 1081-line file. Those seams were already in it; being in one file meant every one
of them was reachable from every other, so "add a block" and "change what a URL may be" were
edits to the same thing.

Install the package (this folder IS the package: `packages/bmd`, with its `package.json`, `docs/`
and `CHANGELOG.md`), or copy the `src/` folder — both work, and the second one has no build step
of its own either. Inside this monorepo the web app reads it in place through a Vite alias.

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

### TypeScript

The kit stays JSX — one renderer, not two. A hand-ported `.tsx` copy would be a second
renderer, and the one that is wrong is whichever nobody looked at last. The types come as
declarations instead, which check the boundary without changing what the code does:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "allowJs": true,        // the kit is .js / .jsx
    "jsx": "react-jsx"
  }
}
```

`markdown.d.ts` sits beside the sources, so `import Markdown from './markdown/index.jsx'` is
typed with no path mapping and no `@types` package: props are checked, return types are
known, and `configureMarkdown` autocompletes.

It covers every export of every file in the folder — including `EMOJI`, `replaceEmoji`,
`normalizeDirectiveNesting` and the thirteen brand marks. In this repo a check holds the two
in step, because a declaration file rots quietly: a function added to the kit and missing
from the types is not an error anywhere, it just becomes `any` and stops being checked.

## Pointing it at your project

Everything specific to one site by *value* rather than by import is in `config.js`. Call this
once at import time, before anything renders:

```js
import { configureMarkdown } from './markdown/index.jsx';

configureMarkdown({
  // `:icon[app:acme]` — your own logos.
  appIcons: { acme: '/logo.png' },

  // Where an icon that is not bundled comes from. `null` for a family turns it off entirely:
  // the glyph falls back to a neutral one and NOTHING is fetched. That is the switch a
  // project behind a strict CSP actually needs.
  cdn: { lucide: null, brand: null },

  // Where authored URLs may point. Empty by default: a documentation site whose authors are
  // staff needs no allowlist, and one whose authors are the public very much does.
  policy: {
    allowHosts: ['example.com', 'github.com'],   // and their subdomains
    allowDownloadHosts: ['files.example.com'],   // narrower, for :::file buttons
    rewrite: (url) => `/away?to=${encodeURIComponent(url)}`,
  },

  // Which iframes survive sanitising. One regexp, because the answer is a list of hosts.
  allowIframes: /^https:\/\/(www\.)?youtube(-nocookie)?\.com\//i,
});
```

### Replacing a built-in block

`:::roadmap` and `:::replay` used to be the two blocks B.MD could not draw — it rendered a
box saying a component was missing. Both are drawn now: the roadmap is a progress tracker
(percentages are divs; it needs nothing), and the replay plays a video, an audio file or an
image inline and links anything else.

A project with something better passes it in. These are **overrides**, not requirements:

```jsx
<Markdown
  lang={lang}
  roadmap={MyProgressTracker}   /* ({ data, title, lang }) => node */
  replay={MyRrwebPlayer}        /* ({ src, title, autoplay, loop }) => node */
>{body}</Markdown>
```

BetterCommunity passes an rrweb player, which is the one thing a markdown renderer has no
business bundling — 120 KB for a block most documents never use.

### A block B.MD does not have

Adding one used to mean forking `directives.js`, and a fork is a copy that stops receiving
the fixes. Register it instead:

```jsx
import { registerBlock } from './markdown/index.jsx';

registerBlock('pricing', {
  component: ({ node, children }) => <PricingTable plan={node.properties.dataPlan}>{children}</PricingTable>,
  attrs: ({ attrs }) => ({ 'data-plan': attrs.plan || 'free' }),
});
```

`:::pricing{plan=pro}` now renders your component. Nothing about the pipeline changes: the
block is sanitised, anchored and packed exactly like a built-in — which is what stops a
plugin being a hole in the sanitiser. Its element is `doc-x-pricing`, prefixed so it cannot
collide with an HTML tag, with one of B.MD's own, or with another plugin.

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
handlers, no `javascript:` URLs. Three passes run after it, each for something a schema
cannot express:

- **`rehypeSafeUrls`** — every `href` and `src`, including the ones directives build, goes
  through `url.js`. A schema checks the *protocol*, which stops `javascript:` and does
  nothing about `//evil.com`: no colon before the first slash, so it is "relative" to the
  schema and protocol-relative to a browser — a link that reads as internal and is not. This
  also strips control characters before reading the scheme (a browser does; `java\tscript:`
  is a working URL), applies the host allowlist, and puts `rel="noopener noreferrer"` on
  every anchor that opens a tab, whatever the author wrote.
- **`rehypeSafeStyle`** — `style` is allowed (cards carry a colour) and its *value* was never
  read. `expression()` and `url(javascript:…)` are refused, and so is `position: fixed`,
  which needs no script at all: a `<div style="position:fixed;inset:0">` in a comment covers
  the page.
- **`rehypeIframeAllowlist`** — an `<iframe>` survives sanitising and is then filtered again
  against `allowIframes`, so an author cannot smuggle an arbitrary frame into a page.

In this repo `scripts/check-md-security.mjs` renders 38 hostile documents through the real
component and asserts on the output rather than on the schema — because a schema is a *claim*
about the output, and the protocol-relative hole above is exactly the kind a reviewer reads
past.

Two deliberate choices worth knowing before you change them:

- **KaTeX runs after the sanitiser.** It has to: its output is a deep tree of KaTeX classes
  that the schema would strip. That is safe because KaTeX renders from the *text* of a math
  node and `trust` is left false — which is what disables `\href`, `\url` and the `\html*`
  commands, the only ones that can emit author-controlled markup. Turning `trust` on undoes
  this paragraph.
- **Single-dollar inline maths is off.** `$x$` is what TeX users expect and it cannot be had
  on a site that quotes prices: remark-math reads `$5 and $10` as a formula and prints
  `5and10`. Measured on a live page before choosing. Maths is `$$…$$`, inline or display.

## Accessibility

The blocks that are interactive behave like the widgets they claim to be:

- `:::tabs` is a real tablist — `aria-controls`/`aria-labelledby` pairing, roving tabindex,
  and Left/Right/Home/End move between tabs. A `role="tablist"` without the arrow keys is a
  promise the widget does not keep.
- The inline comment (`<doc-comment>`) is a disclosure: `role="button"`, `aria-expanded`,
  Enter/Space to open, Escape to close.
- `:time` renders a `<time datetime="…">`, so the machine-readable instant is in the markup.
- Every decorative icon is `aria-hidden`; the roadmap prints each percentage as text beside
  its bar, so nothing is conveyed by a bar alone.
- A wide table scrolls inside its own wrapper rather than widening the article — on a phone a
  sideways-scrolling page moves the text you are reading.

## The vocabulary

`/dev/markdown` on a running BetterCommunity has the full reference with a live editor. The
short version:

```
:::note :::tip :::success :::warning :::danger      callouts, each takes [A title]
  aliases  :::info :::hint = tip · :::check = success · :::caution :::important = warning
           :::error = danger · :::custom = a callout of your own
:::callout{icon=rocket color="#7c3aed"}             one of your own
:::cards / :::card{title= href= icon= image=}       card and card grid (:::ref = :::card)
:::tabs / :::tab{title="…"}                         tabs
:::steps / :::step[Title]                           numbered steps ({type=A}, or {marker=icon} + step icon= for an icon list)
:::field[Label]{key= type= icon=}                   a labelled configuration row (:::setting is the same)
:::columns / :::column                              responsive columns (:::row / :::col)
:::collapse[Summary]                                a disclosure (:::details is the same)
:::center :::left :::right                          alignment
:::roadmap{src=…} / :::replay{src=…}                built in; pass your own to replace
                                                    (:::bmmreplay = :::replay)
:button[Label]{brand=discord href=…}                a button, eight brands, three sizes (:btn)
:link[text]{color=#e11 href=…}                      a coloured link
:badge[NEW]{color="#0a7"}  :tag[…]                  chips
:icon[rocket]  :kbd[Ctrl+K]                         inline icon, keycaps
:file[report.pdf]{href=… size="1.2 MB"}             a download, icon by extension
:::roadmap[Where we are] / :::stage[Done]{state=done}  a progress tracker (:::progress is the
                                                    same block; :::phase = :::stage)
:::schedule[Support]{tz=Europe/Paris}               a repeating schedule, in ONE zone (:::hours)
:time[2026-09-01T20:00]{tz=Europe/Paris}            one instant, in the reader's zone (:at)
::toc[On this page]                                 table of contents
:::timeline[Title] / :::event[Title]{date= state=}   a dated timeline (state done|now|next; :::moment = :::event)
:::compare{before= after=} / :::before / :::after   two labelled sides
:::stats / :::stat[Label]{value= delta= icon=}      KPI tiles (:::kpi = :::stat)
:::quote[Author]{role= avatar= href=}               a pull quote with a name under it (:::testimonial)
:::hero[Title]{subtitle= image= color= align=}      a banner
:::changelog / :::version[1.4.0]{date= label=}      release notes (:::release = :::version)
:::spoiler[Reveal]                                  hidden until clicked
:::faq[Title] / :::q[Question]{open}                a question list (:::question = :::q)
:::checklist[Title]                                 a task list that counts — uses `- [x]` items
:::grid{cols=3 gap=lg}                              a fixed-column grid
:meter[60]{label=Done max=100 color=}               an inline progress bar
:icon[ph:rocket]  :icon[ph-bold:rocket]             Phosphor icons, six weights (ph-thin/light/regular/bold/fill/duotone)
$$E = mc^2$$                                        maths
:rocket: :tada: :+1:                                emoji, by GitHub's names
```

B.MD 3.0 adds, in the same spirit:

```
:::table[Caption]{style="striped bordered" align=}   a styled GFM table (compact hover plain wide sticky numbers)
:img[Alt]{src= width= height= align= caption= link=}  an image with its options (:image; zoom=false lazy=false border rounded)
:audio[Title]{src=}                                 an audio player (::audio on its own line)
::youtube{src=} / ::yt{id=}                         a YouTube embed
::spotify{src=}                                     a Spotify embed (track, album, playlist, episode, show, artist)
:::api[GET /path]{auth= summary= deprecated}        an endpoint card (:::endpoint)
:::params / :::request / :::response{status=}       its sections
::openapi{src= tag= filter=}                        a whole OpenAPI document as endpoint cards (::swagger)
:counter[Label]{src= path= refresh= format=}        a live value read from JSON (:fetch; ::live for a block)
:action[Label]{href= method= body= confirm= done=}  a button that calls a URL (counter= refreshes one; once)
::include{src=}                                     another document, rendered here (::embed-md)
:::mermaid[Caption] / ```mermaid                    a diagram (:::diagram)
==marked==   [[Page]]  [[Page|text]]  [[#section]]  a mark; wiki links resolved against pageMap
::toc{depth=4 numbered}                             a deeper or numbered table of contents
{radius=8} {variant=quiet} {class=x}                on any block
```

**The two timezone blocks are not two spellings of one idea.** `:::schedule` states hours that
repeat, and its rows are NOT converted: "Monday 09:00 Europe/Paris" is 09:00 in Paris every
week of the year, and what moves across a daylight-saving boundary is how far that is from the
reader. A converted row would be right today and wrong in March, with nothing on the page
admitting it — so the zone is named on the card and the block computes the reader's distance
from it **right now**, labelled as being for right now. `:time` is a single instant, which has
no such ambiguity, so it IS converted; the date is what makes it exact, because it settles
which side of a daylight-saving change the moment falls on.

```
```

## What it is not

It does not parse or store anything: `<Markdown>` takes a string and returns elements. Where
the string comes from, who may edit it, and how it is saved are your application's problem —
which is why this folder has no API client, no auth, and no router in it.

## 3.0 — what was added and what it needs

The AST (`ast.js`) and the link checker (`links.js`) parse without rendering, which is why the
package now lists `unified` and `remark-parse` — the two pieces react-markdown already carried.
`export.jsx` uses `react-dom/server`, which is `react-dom`. Diagrams need `mermaid`: install it
and pass `configureMarkdown({ loadMermaid: () => import('mermaid') })`, or leave it out and the
module is fetched from `cdn.mermaid` on the first diagram (null switches diagrams off — they
render as their source).

| Import | What it is |
|---|---|
| `@bettercommunity/bmd/ast` | `parseMarkdown`, `walkAst`, `extractHeadings`, `extractLinks`, `extractText` |
| `@bettercommunity/bmd/links` | `validateLinks` |
| `@bettercommunity/bmd/export` | `renderHtml`, `documentHtml`, `cssUrl` |
| `@bettercommunity/bmd/openapi` | `openapiToBmd`, `openapiSummary` |
| `@bettercommunity/bmd/plugins` | `registerBlock`, `registerBlocks`, `definePlugin` |

The blocks that fetch (`:counter`, `::live`, `:action`, `::include`, `::openapi`) put their URL
through the same policy as a link (`kind: 'api'`), so `policy.allowHosts` is what decides which
servers a document may talk to.
