# B.MD — better.markdown

Everything ordinary markdown does, plus the block directives below. They work anywhere the site
renders markdown: blog posts, docs pages, FAQ answers, project pages, poll notes, and newsletter
bodies — all of them go through the same renderer.

**This list and every attribute in it were extracted from the renderer, not written from
memory.** The renderer is `apps/web/src/markdown/` — `ui/md.jsx` is a thirty-line adapter
around it, and `directives.js` is the file that decides what a directive means. A directive that is not here does not exist — an unknown `:::name` renders as
literal text, which is how a typo shows up: visibly, rather than as a silently missing block.

> **Changed August 2026.** The Steps and Columns examples in the previous version of this file
> used `::step` / `::column` (two colons). That never worked: two colons is a *leaf* directive,
> which cannot hold a body, so the text fell outside the block and a literal `::` leaked into the
> page. Everything below uses three colons, which is now also the only form you need.

---

## Nesting: always three colons

Write every block with `:::`, including blocks inside blocks:

```
:::steps
:::step[First]
Body.
:::
:::step[Second]
Body.
:::
:::
```

The renderer re-counts the fences before parsing, so an inner block stays inside its parent.
(Underneath, markdown wants the outer block to use *more* colons than the inner one — `::::steps`
around `:::step`. You may still write it that way if you like; a document that already uses four
or more colons anywhere is left exactly as typed. But you no longer have to.)

Two habits that still matter:

**Blank lines around a directive.** `:::note` on the line immediately after a paragraph, with no
blank line between, is parsed as part of that paragraph and renders as text.

**Close what you open.** An unclosed `:::` swallows the rest of the page. The re-counting only
pairs up blocks that *have* an end — an unclosed one is left exactly as written, so the breakage
stays where you can see it instead of being silently reinterpreted.

---

## Callouts

```
:::note
Ordinary markdown goes in here — **bold**, lists, links.
:::
```

Eleven names, mapping onto five looks. The synonyms exist so you can write the word you mean:

| write | you get |
|---|---|
| `note` · `info` | Note |
| `tip` · `hint` | Tip |
| `success` · `check` | Success |
| `warning` · `caution` · `important` | Warning |
| `danger` · `error` | Danger |

A custom title goes in square brackets, and `:::callout` (alias `:::custom`) takes its own icon
and colour:

```
:::warning[Back up first]
This rewrites the file in place.
:::

:::callout{icon=rocket color=#c2410c}[Shipping]
Anything you like.
:::
```

`icon=` is a [lucide](https://lucide.dev) icon name.

---

## Collapsible

```
:::details[Show the full output]
Hidden until clicked.
:::
```

`:::collapse` is the same thing under another name. Attribute: `title` (same as the bracketed
label).

---

## Cards

```
:::cards
:::card{title="Install" href=/docs/install icon=download color=#0ea5e9}
One line about it.
:::
:::card{title="Configure" image=/img/cfg.png}
Another.
:::
:::
```

`:::cards` is the grid; `:::card` (alias `:::ref`) is one card. Attributes: `title`, `href`
(alias `link`), `image`, `video`, `icon`, `color`. A card works on its own outside a grid.

---

## Steps

```
:::steps
:::step[Install]
Download and run the installer.
:::
:::step[Sign in]
Use your BetterCommunity account.
:::
:::
```

The numbering is automatic — do not number the titles yourself, or every step reads
"1. 1. Install".

On `:::steps`: `type` picks the marker alphabet (`1` · `a` · `i` · `dot`), `start` offsets it so
a procedure split across two blocks carries on counting, `orientation=horizontal` lays the steps
along a row, `color` sets the marker and rail colour for all of them, `title` (or a `[label]`)
puts a heading on the block. **`marker=icon`** turns it into an ICON list — each step's `icon=`
becomes its marker glyph instead of a number.

On `:::step`: `icon`, `color` for that one step, `status=done` (or `done=true`) to tick it off,
`marker` to override the number outright (or `marker=icon` with an `icon=` for an icon marker).
`:::stage` is an alias.

Only direct `:::step` children are counted, so a paragraph between two steps does not consume a
number.

## Configuration rows

A labelled setting row — the shape of a settings card, as B.MD. Stack several to document a
screen of options without a table.

```
:::field[Tile shape]{key=icons.shape type=select icon=palette}
Rounded, circle, square, or no tile — the shape of every button icon.
:::
```

`:::field` (or `:::setting`) takes `[label]` (or `label=`), `key=` (a monospace identifier shown
on the right), `type=` (a small tag: `size`, `number`, `on / off`, …), an optional `icon=`, a
`color=` accent, and `anchor=` to make the row a deep-link target. The body is the description.

---

## Roadmap

Three ways to fill one, in the order you are likely to want them.

**Write the stages inline** — the plain way, no JSON:

```
:::roadmap[Where we are]
:::stage[Shipped]{state=done}
- Grid questions
- Recipe checker
:::
:::stage[In progress]{state=doing percent=40}
- Blog roadmaps
:::
:::stage[Planned]{state=planned}
- MCP parity
:::
:::
```

Every bullet under a stage becomes a tracked item and inherits that stage's state. `state=` takes
`done` (`complete`, `shipped`), `doing` (`progress`, `in-progress`, `active`), or `planned`
(`todo`, `next`). `percent=` sets the bar for a stage that is under way — a `done` stage is 100%
and a `planned` one is 0%, so it is only meaningful on `doing`. `eta=` adds a date to its items.
`:::phase` is an alias for `:::stage`.

Per-item percentages are deliberately *not* a thing here: a bullet list is what everyone already
knows how to write, and a micro-syntax buried in list text is a rule nobody can see. When you
need that much control, use the JSON form.

**A JSON block inside**, when you want per-item percentages, ETAs or bilingual labels:

````
:::roadmap[Roadmap]
```json
{ "code": 72, "art": 40, "lastUpdate": "2026-08-16",
  "categories": [
    { "name": "Core", "items": [
      { "label": { "en": "Sync", "fr": "Synchro" }, "status": "progress", "percent": 60, "eta": "Q4" }
    ] }
  ] }
```
:::
````

**A remote feed**, when the numbers live somewhere else:

```
:::roadmap{src="https://site/progress.json" title="Roadmap"}
:::
```

The URL is fetched by the reader's browser, so it must be publicly reachable and CORS-friendly.

`:::progress` is an alias for `:::roadmap`. `orientation=horizontal` lays the phases along a
track instead of down a column.

---

## Columns

```
:::columns
:::column
Left.
:::
:::column
Right.
:::
:::
```

`:::row` is an alias for `:::columns`, `:::col` for `:::column`. They stack on narrow screens, so
never write "the table on the left" in the prose.

---

## Alignment

```
:::center
Centred block.
:::
```

`:::left` and `:::right` too. No attributes.

---

## Buttons

One shape, three sizes, any colour — and a logo when it is a brand.

```
:button[Watch]{brand=youtube href=https://youtube.com/…}
:button[Read the guide]{color=#0a7 size=lg href=/docs}
:button[Quietly]{color=#0a7 outline href=/docs}
```

`brand=` sets the colour **and** the logo together — `youtube` `discord` `kofi` `github`
`twitch` `x` `reddit` `telegram` — because a YouTube-red button wearing a Discord glyph is a
mistake nobody makes on purpose. Sizes are `sm` `md` `lg`; `outline` is the quiet version;
`:btn[…]` is the short name.

A button with no `href` renders as a plain span rather than a dead link.

---

## Hours and times

```
:::schedule[Support]{tz=Europe/Paris}
| Day | Open |
|---|---|
| Mon-Fri | 09:00-18:00 |
:::
```

`:::schedule` — alias `:::hours` — states a repeating schedule in ONE timezone. Attributes:
`tz` (an IANA name such as `Europe/Paris`), and the label is the card's title.

**The rows are not converted, and that is the correct answer rather than a missing feature.**
`Monday 09:00 Europe/Paris` is 09:00 in Paris every week of the year; what moves across a
daylight-saving boundary is how far that is from the reader. A converted row would be right
today and wrong in March, with nothing on the page admitting it. So the zone is named on the
card and the block computes the difference **right now**, labelled as being for right now.

A single moment has no such ambiguity, so it IS converted:

```
The stream starts at :time[2026-09-01T20:00]{tz=Europe/Paris}.
```

`:time` — alias `:at` — renders that instant in each reader's own timezone, keeping what you
typed in the tooltip. The date is what makes it exact: it settles which side of a
daylight-saving change the time falls on. A value that cannot be parsed is shown as written
rather than as `Invalid Date` — a reader should see what the author typed, not the failure of
a parser.

Both use `Intl.DateTimeFormat`, so there is no dependency and nothing to configure.

## Tabs

```
::::tabs
:::tab{title="Windows"}
Run `install.exe`.
:::
:::tab{title="Linux"}
Run `./install.sh`.
:::
::::
```

Four colons outside, three inside — the same rule as steps and columns. A panel holds
whatever a document holds, including other blocks; the strip reads its labels off the panels,
so a tab's name and its content cannot drift apart.

---

## Download link

```
:::file{href=/api/assets/setup.exe name="BMM Setup" size="42 MB" icon=download}
:::
```

Renders a file row with a Download and an Open button. Attributes: `href` (alias `url`), `name`
(alias `title`, or a `[label]`), `size`, `icon`. Without `icon` the icon is picked from the file
extension.

---

## Inline bits

| write | what it is |
|---|---|
| `:badge[Beta]{color=#7c3aed}` | a coloured chip. `:tag[…]` is the same |
| `:icon[rocket]` | a lucide icon inline in a sentence |
| `:kbd[Ctrl+K]` | a keyboard key |

These are *inline* directives — one colon, and they sit inside a sentence rather than on their
own line.

---

## Table of contents

```
::toc
```

A leaf directive (two colons, on its own line). It lists the `##` and `###` headings of the page
it is on. Blog posts have a built-in "show a summary" switch that does the same thing, so this is
mainly for docs pages.

---

## Session replay

```
:::replay{src="/api/assets/demo.bmmreplay" title="Installing a plugin"}
:::
```

Plays a `.bmmreplay` recording inline. `autoplay` and `loop` are accepted as bare flags:

```
:::replay{src="…/foo.bmmreplay" autoplay loop}
:::
```

`:::bmmreplay` is an alias. Prefer an asset served by this site (`/api/assets/…`) over a foreign
URL — a replay that 404s leaves a dead frame in the middle of the page.

---

## Two extras that are not directives

**GitHub-style alerts.** A blockquote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
`[!WARNING]` or `[!CAUTION]` renders as the matching callout. Handy when you are pasting from
GitHub. French spellings work too: `[!REMARQUE]`, `[!ASTUCE]`, `[!AVERTISSEMENT]`, `[!ATTENTION]`.

**Change badges.** A bare word in square brackets becomes a coloured badge — six of them, each
with a French spelling:

| English | French |
|---|---|
| `[NEW]` | `[NOUVEAU]` |
| `[FIXED]` | `[FIXÉ]` |
| `[IMPROVED]` | `[AMÉLIORÉ]` |
| `[REFINE]` | `[RAFFINEMENT]` |
| `[VISUAL]` | `[VISUEL]` |
| `[MAJOR]` | `[MAJEUR]` |

Any other word in brackets is left as ordinary text, and so is anything inside code — fenced or
backticked — so `[NEW]` in a sample stays literal.

---

## Where B.MD lives, and what it is made of

`apps/web/src/markdown/` — sixteen files, no build step of its own. `apps/web/src/ui/md.jsx`
is a thirty-line adapter that supplies this site's logo paths and its rrweb player; everything
else is the kit.

| File | What it is |
|---|---|
| `index.jsx` | the assembly — the pipeline, the component map, `<Markdown>` |
| `directives.js` | the parser: markdown-with-directives → an mdast tree. No React |
| `blocks.jsx` | one React component per block the parser emits |
| `icons.jsx` | the icon set, and where a non-bundled icon comes from |
| `sanitize.js` | what survives, and what a URL and a `style` are allowed to be |
| `url.js` | the URL policy — one function, every link in a document |
| `config.js` | everything a host application points at itself |
| `plugins.js` | a block B.MD does not have, added without editing B.MD |
| `roadmap.jsx` · `replay.jsx` | the two built-in blocks |
| `nesting.js` · `shorthand.js` · `emoji.js` · `brands.jsx` | the pre-passes and the assets |
| `markdown.css` · `markdown.d.ts` · `README.md` | styles, types, the kit's own documentation |

The full README ships **inside** the kit, and it is the one the download carries — so the copy
somebody takes away is documented by the same file the repository has.

## Adding a block without forking the parser

```jsx
import { registerBlock } from '../markdown/index.jsx';

registerBlock('pricing', {
  component: ({ node, children }) => <PricingTable plan={node.properties.dataPlan}>{children}</PricingTable>,
  attrs: ({ attrs }) => ({ 'data-plan': attrs.plan || 'free' }),
});
```

`:::pricing{plan=pro}` then renders that component. The block is sanitised, anchored and packed
like a built-in; its element is `doc-x-pricing`, prefixed so it cannot collide with an HTML tag,
with one of B.MD's own, or with another plugin.

## What is checked, and how

Everything below runs in `apps/web`'s lint, against the **real** renderer — esbuild bundles
`index.jsx` for node and renders with `renderToStaticMarkup`, so none of it is checking a
second copy of the pipeline:

| Check | What it would catch |
|---|---|
| `check-md-renders.mjs` | a directive that produces nothing, or its own source back as text |
| `check-md-security.mjs` | 38 hostile documents — script tags, `javascript:`, `//evil.com`, `style` overlays, a missing `rel` |
| `check-md-kit.mjs` | the folder reaching outside itself, an undocumented dependency, an unnamed directive |
| `check-md-types.mjs` | an export with no declaration in `markdown.d.ts`, or the reverse |
| `check-kit-markers.mjs` | an optional region that does not strip cleanly, or a file the download would miss |
| `check-md-roundtrip.mjs` | a block the Visual editor destroys on save |
| `check-md-leaf-text.mjs` | a text directive whose content is emptied before it is read |
| `check-md-brands.mjs` | a brand button with no mark, an anchor whose class the sanitiser empties |

`check-md-security.mjs` asserts on the **output**, not on the schema, and that distinction is
not academic: `rehype-sanitize` refuses `javascript:` on an `href` and does nothing at all
about `//evil.com`, which is not a protocol — so a reviewer reading the schema concludes the
site is covered and it is not.
