# Icons

One name, five families, resolved in this order:

1. **`app:<key>`** — your own logos, registered with `configureMarkdown({ appIcons })` or
   `registerAppIcons([{ key, url, label }])`.
2. **Isometric** — `iso:<name>` (or `isometric:`), 83 full-colour drawings shipped in this
   package under `assets/iso/`, drawn as an `<img>` (a mask would flatten them into one
   colour). `ISO_NAMES` lists them and `isoRef(name)` resolves one; a name that is not in the
   list draws the neutral glyph. `cdn.iso` says where the files are served from: jsDelivr's
   copy of this package by default, `/icons/iso/${name}.svg` once you serve the folder yourself.
   See [Isometric icons](#isometric-icons) for where they come from.
3. **Phosphor** — `ph:<name>` (regular), or a weight as prefix: `ph-thin:`, `ph-light:`,
   `ph-bold:`, `ph-fill:`, `ph-duotone:`. Drawn as a `currentColor` mask from
   `cdn.phosphor` (jsDelivr's `@phosphor-icons/core` by default). `phosphorRef(name)` gives the
   `<weight>/<file>` path.
4. **Simple Icons brands** — `simple:<slug>` (or `si:`); thirteen common ones are bundled as
   local SVGs (`brands.jsx`), the rest come from `cdn.brand`.
5. **lucide** — a curated set is bundled as components; any other kebab-case lucide name is a
   mask from `cdn.lucide`.

Anything unresolved draws a neutral `#` glyph, never nothing.

Set a family's CDN to `null` to switch it off (strict CSP, or simply not telling a third party
which page is read): `configureMarkdown({ cdn: { phosphor: null } })`.

The site's icon pickers (topbar, badges, cards, the bot's button icons…) list every lucide name,
every Phosphor name (`phosphor-names.json`, generated from the package listing), every
isometric name (`ISO_NAMES`) and every
Simple Icons brand, and insert the exact string above.

## Isometric icons

Three third-party sets, chosen because each licence allows redistribution inside software.
Every file, its origin, its licence and the full licence texts are in
[`assets/iso/LICENSES.txt`](../assets/iso/LICENSES.txt), which ships beside the icons.

| Prefix | Set | Icons | Licence |
|---|---|---|---|
| `iso:` | [Isoflow isopack](https://github.com/markmanx/isopacks) (`collections/isoflow`) | 37 | MIT, © 2023 Mark Mankarious |
| `iso:cube-` | [MI2, My Isometric Icons](https://github.com/richbl/isometric-icons) | 15 | MIT, © 2018 Rich; glyphs from Google Material Design Icons, Apache-2.0 |
| `iso:solid-` | [Jolloficons](https://github.com/gbmillz/jolloficons), its "Isometric" page | 31 | MIT, © 2018 Gbolahan Fawale (granted in the README) |

The files are built by `apps/web/scripts/build-iso-icons.mjs` from pinned commits: editor
metadata removed, coordinates rounded, then passed through the studio's allow-list SVG
sanitiser. `apps/web/test/iso-icons.test.mjs` checks every committed file still passes it and
refers to nothing outside itself.

Looked at and **not** embedded:

- **Nucleo** (nucleoapp.com, and the `nucleo-isometric` npm package): proprietary; its licence
  forbids redistributing the icons, which is what a picker offering them to every author does.
  `iconify-json-nucleo-isometric` is an MIT wrapper around the same proprietary files.
- **The Noun Project** "isometric": attribution per icon or a paid licence, and its terms
  prohibit large-scale copying.
- **SVG Repo** collections: the licence could not be read at the source (the site answered
  429 and a bot checkpoint), and its site terms forbid redistributing material in a way
  similar to SVG Repo, which an icon library is.
- **The isopacks AWS, Azure and GCP packs**: vendor icon terms, trademarks.
- **The isopacks Kubernetes pack**: flat, not isometric, and the logo is a Linux Foundation
  trademark.
- **danieljoos/isometric-cloud-icons**: nine icons, mostly AWS marks, glyphs from Font Awesome.
