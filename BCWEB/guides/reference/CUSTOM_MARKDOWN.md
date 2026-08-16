# BCWEB's custom markdown

Everything ordinary markdown does, plus the block directives below. They work anywhere the site
renders markdown: blog posts, docs pages, FAQ answers, project pages, poll notes, and newsletter
bodies — all of them go through the same renderer.

**This list and every attribute in it were extracted from `apps/web/src/ui/md.jsx`, not written
from memory.** A directive that is not here does not exist — an unknown `:::name` renders as
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
puts a heading on the block.

On `:::step`: `icon`, `color` for that one step, `status=done` (or `done=true`) to tick it off,
`marker` to override the number outright. `:::stage` is an alias.

Only direct `:::step` children are counted, so a paragraph between two steps does not consume a
number.

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
