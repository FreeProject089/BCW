# Icons

One name, three families, resolved in this order:

1. **`app:<key>`** — your own logos, registered with `configureMarkdown({ appIcons })` or
   `registerAppIcons([{ key, url, label }])`.
2. **Phosphor** — `ph:<name>` (regular), or a weight as prefix: `ph-thin:`, `ph-light:`,
   `ph-bold:`, `ph-fill:`, `ph-duotone:`. Drawn as a `currentColor` mask from
   `cdn.phosphor` (jsDelivr's `@phosphor-icons/core` by default). `phosphorRef(name)` gives the
   `<weight>/<file>` path.
3. **Simple Icons brands** — `simple:<slug>` (or `si:`); thirteen common ones are bundled as
   local SVGs (`brands.jsx`), the rest come from `cdn.brand`.
4. **lucide** — a curated set is bundled as components; any other kebab-case lucide name is a
   mask from `cdn.lucide`.

Anything unresolved draws a neutral `#` glyph, never nothing.

Set a family's CDN to `null` to switch it off (strict CSP, or simply not telling a third party
which page is read): `configureMarkdown({ cdn: { phosphor: null } })`.

The site's icon pickers (topbar, badges, cards, the bot's button icons…) list every lucide name,
every Phosphor name (`phosphor-names.json`, generated from the package listing) and every
Simple Icons brand, and insert the exact string above.
