# Blocks

Every directive B.MD renders, with its syntax. `:::name` opens a container block and `:::`
closes it; `:name[…]{…}` is inline. Attributes go in `{}`: `key=value`, quoted when the value
has spaces. Blocks nest; leave a blank line before a directive that follows a paragraph.

## Callouts

```
:::note[Title]      :::tip[Title]      :::success[Title]      :::warning[Title]      :::danger[Title]
```
Aliases: `info`, `hint` → tip · `check` → success · `caution`, `important` → warning · `error` →
danger. `:::callout{icon=rocket color="#7c3aed"}` / `:::custom` for your own; `> [!NOTE]`
GitHub alerts work too.

## Cards
```
:::cards
:::card[Title]{href=/x icon=rocket image=/cover.png color=#0a7}
body
:::
:::
```
`:::ref` = `:::card`. Outside `:::cards` a card is a single box.

## Tabs · Steps · Columns · Grid
```
:::tabs
:::tab{title="Windows"}
…
:::
:::

:::steps[Title]{type=1|a|i|dot start=1 orientation=vertical|horizontal color=}
:::step[Title]{icon= done}
…
:::
:::

:::columns          (alias :::row)
:::column           (alias :::col)
…
:::
:::

:::grid{cols=3 gap=sm|lg}     fixed columns, folds to 2 then 1 on narrow screens
```

## Collapse · Spoiler · FAQ
```
:::details[Summary]  (alias :::collapse)
:::spoiler[Reveal]                       hidden until clicked
:::faq[Title]
:::q[Question]{open}                     (alias :::question)
answer
:::
:::
```

## Timeline
```
:::timeline[Title]
:::event[Title]{date="2026-09-01" state=done|now|next icon= color=}
body
:::
:::
```
`state` aliases: past/shipped → done, current/active → now, planned/future/soon → next.
`:::moment` = `:::event`.

## Compare
```
:::compare{before="Before" after="After"}
:::before
…
:::
:::after
…
:::
:::
```
Side labels can also be `:::before[Label]`.

## Stats
```
:::stats
:::stat[Label]{value="12 400" delta="+8%" icon=download color=#16a34a}
small print (optional)
:::
:::
```
`:::kpi` = `:::stat`. A delta starting with `-` is red, `+` green, else neutral.

## Quote · Hero
```
:::quote[Author]{role="Title" avatar=/a.png href=https://… color=}
…
:::

:::hero[Title]{subtitle="…" image=/cover.png icon=rocket color=#7c3aed align=left|center|right}
:button[Go]{href=/x size=lg}
:::
```

## Changelog
```
:::changelog[Title]
:::version[1.4.0]{date="2026-09-01" label=latest}
- [NEW] …   - [FIXED] …   - [IMPROVED] …
:::
:::
```
`:::release` = `:::version`. The chips are the standard `[NEW]` shorthand.

## Checklist
```
:::checklist[Title]{color=}
- [x] done
- [ ] not yet
:::
```
The header counts the ticked items and draws a bar; all ticked turns it green.

## Roadmap · Schedule · Time · Replay
```
:::roadmap[Title]{orientation=horizontal}     (alias :::progress)
:::stage[Shipped]{state=done percent=}        (alias :::phase)
- item
:::
:::

:::schedule[Support]{tz=Europe/Paris}         (alias :::hours) — a table of repeating rows
:time[2026-09-01T20:00]{tz=Europe/Paris}      (alias :at) — one instant, converted
:::replay{src=/x.bmmreplay title=…}           (alias :::bmmreplay)
```

## Files · Buttons · Links
```
:file[report.pdf]{href=/x size="1.2 MB" icon=}
:button[Label]{href= brand=discord|github|youtube|… color= size=sm|md|lg outline icon=}   (alias :btn)
:link[text]{href= color=}
```

## Inline
```
:badge[NEW]{color=}   :tag[…]   :icon[rocket]   :icon[ph:rocket]   :icon[simple:github]   :icon[app:bmm]
:kbd[Ctrl+K]   :meter[60]{label=Done max=100 color=}   ::toc[On this page]   $$E=mc^2$$   :rocket:
```

## Alignment
```
:::center   :::left   :::right
```
