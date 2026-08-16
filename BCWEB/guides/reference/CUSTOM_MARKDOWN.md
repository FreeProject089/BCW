# BCWEB's custom markdown

Everything ordinary markdown does, plus the block directives below. They work anywhere the site
renders markdown: blog posts, docs pages, FAQ answers, and newsletter bodies.

**This list was extracted from `apps/web/src/ui/md.jsx`, not written from memory.** A directive
that is not here does not exist — an unknown `:::name` renders as literal text, which is how a
typo shows up: visibly, rather than as a silently missing block.

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

A custom title goes in square brackets, and `:::callout` takes its own icon and colour:

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

`:::collapse` is the same thing under another name.

---

## Cards

```
:::cards
::card{icon=book}[Getting started](/docs/start)
Two lines about it.
::

::card[Hosting](/hosting)
Another one.
::
:::
```

`::ref` is an alias for `::card`. Cards outside a `:::cards` wrapper still render — they just do
not sit in the grid.

---

## Steps

```
:::steps
::step[Install]
Download and run the installer.
::

::step[Sign in]
Use your BetterCommunity account.
::
:::
```

`::stage` is an alias for `::step`. The numbering is automatic — do not number the titles
yourself, or every step reads "1. 1. Install".

---

## Columns

```
:::columns
::column
Left.
::

::column
Right.
::
:::
```

`:::row` is an alias for `:::columns`. They stack on narrow screens, so never put "the table on
the left" in the prose.

---

## Roadmap

```
:::roadmap{src="https://site/progress.json" title="Roadmap"}
:::
```

Reads a JSON feed and renders it as progress. The URL is fetched by the reader's browser, so it
must be publicly reachable and CORS-friendly.

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

Prefer an asset served by this site (`/api/assets/…`) over a foreign URL — a replay that 404s
leaves a dead frame in the middle of the page.

---

## Two habits worth having

**Blank lines around a directive.** `:::note` immediately after a paragraph, with no blank line,
is parsed as part of that paragraph and renders as text.

**Close what you open.** An unclosed `:::` swallows the rest of the page into the block. It is
obvious in preview and invisible while writing, which is why the blog and newsletter editors
both have one.
