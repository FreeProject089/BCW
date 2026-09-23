# @bettercommunity/studio

The studio document of BetterCommunity: what a hand-placed page is, how an old one becomes a new
one, how it is drawn, and what may be saved. Pure ESM, no dependencies, no React, no DOM. The site
renders with it and the API validates every studio write with it, so the two cannot disagree.

## The model (v2)

A page is a free **board** with two **frames** on it:

| frame | width | height |
|---|---|---|
| `frames.desktop` | 1200 | `fit: 'fixed'` (the handle) or `fit: 'content'` (as tall as what crosses it) |
| `frames.phone` | 390 | the same, plus `mode: 'stack'` (reading order) or `'board'` (placed by hand) |

Blocks have board coordinates: they may sit left of the page, above it or far beyond it, within
`±BOUND` (20 000). A reader gets the frame and nothing else: what crosses its edge is clipped, what
is entirely outside it is not mounted. The frame starts at (0,0), so every v1 coordinate keeps its
meaning.

## The four functions

```js
import { migrate, normalizeDoc, serializeDoc, validateDoc } from '@bettercommunity/studio';

normalizeDoc(stored);   // v1 or v2 in, a complete v2 document out; tolerant, never throws
serializeDoc(doc, {});  // the only way to storage: defaults and derived heights left out
validateDoc(doc);       // [] or [{ path, reason, key }]; strict, unknown fields refused
migrate(v1);            // pure; a migrated page renders as it did
```

Also exported: the layout rules (`layoutFor`, `inFrame`, `phoneBoardBlocks`), the editing maths
(`dragTo`, `resizeTo`, `moveMany`, the board operations, undo), the camera (`zoomAt`,
`wheelZoom`, `pinchView`, `fitFrameView`, `showAllView`), the link policy (`safeLink`,
`buttonTarget`), the CSS scoper (`scopeCss`, `safeCssValue`) and the SVG sanitiser
(`sanitizeSvg`). Types are in `src/index.d.ts`.

## Limits

A page is at most 300 KB of JSON and 500 blocks; `props` are an allow-list per block kind. See
`LIMITS` and `KIND_PROPS`.

## License

MIT
