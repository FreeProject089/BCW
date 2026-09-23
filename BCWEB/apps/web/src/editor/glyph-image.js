// A name from the site's icon picker, as an IMAGE (M17).
//
// A project's mark is stored as an image URL: Site theme > App icons is `{ key, label, url }`,
// and every place that draws it (the topbar, the project header, the `app:` entry of the icon
// picker) is an <img src>. The picker, though, answers with a NAME: `rocket`, `ph:rocket`,
// `simple:github`, `app:bmm`. Storing the name would need every one of those renderers to learn
// a second format, and a renderer that is missed draws a broken image. So the name is turned
// into what the field already holds: the glyph's SVG, coloured, uploaded like any other logo,
// and its URL stored. An `app:` pick already IS an image: its URL is reused, nothing uploaded.
//
// The SVG comes from the same CDN the picker previews from (markdownConfig().cdn), so what was
// clicked is what is stored. The pure half lives in lib/glyph-svg.js, with its tests.
import { markdownConfig } from '@bettercommunity/bmd';
import { lucideFileName } from './icon-picker.jsx';
import { glyphSource, colourSvg, glyphFileName } from '../lib/glyph-svg.js';

/** name → the URL to store: an existing image's, or the uploaded SVG's (`upload(file)`). */
export async function glyphToImageUrl(name, color, upload) {
  const src = glyphSource(name, markdownConfig(), lucideFileName);
  if (!src) throw new Error('unsupported_icon');
  if (src.kind === 'url') return src.url;
  const r = await fetch(src.url);
  if (!r.ok) throw new Error('icon_fetch_failed');
  const svg = colourSvg(await r.text(), color, { brand: !!src.brand });
  return upload(new File([svg], glyphFileName(name), { type: 'image/svg+xml' }));
}
