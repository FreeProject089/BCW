# B.MD in your framework

One component, one stylesheet, and a `configureMarkdown()` call once at startup. What differs
between frameworks is where that call goes and whether the component renders on the server.

```bash
npm i @bettercommunity/bmd react react-dom react-markdown remark-gfm remark-directive rehype-raw rehype-sanitize unist-util-visit unified remark-parse lucide-react
# optional, loaded only when a document needs them
npm i rehype-highlight remark-math rehype-katex katex mermaid
```

The stylesheet reads a handful of CSS variables and defines none (`--text --muted --faint
--line --line-strong --surface --surface-2 --bg-solid --primary --primary-2 --error`); give it
yours or paste the ten-line block from `/dev/markdown`.

## Vite + React

```jsx
// src/main.jsx
import '@bettercommunity/bmd/markdown.css';
import { configureMarkdown } from '@bettercommunity/bmd/config';

configureMarkdown({
  appIcons: { mine: '/icons/mine.png' },
  loadMermaid: () => import('mermaid'),          // installed → no CDN request
  policy: { allowHosts: ['example.com'] },       // where authored links may point (optional)
});
```

```jsx
// anywhere
import Markdown from '@bettercommunity/bmd';
export const Post = ({ body }) => <Markdown lang="en" toc="auto">{body}</Markdown>;
```

## Next.js (app router)

The renderer holds state (tabs, the lightbox, live values), so it is a client component. A
server component can still render the HTML string with `renderHtml()` when the page must be
static.

```jsx
// app/markdown.jsx
'use client';
import '@bettercommunity/bmd/markdown.css';
import Markdown, { configureMarkdown } from '@bettercommunity/bmd';
configureMarkdown({ loadMermaid: () => import('mermaid') });
export default function Md({ children, lang = 'en' }) { return <Markdown lang={lang}>{children}</Markdown>; }
```

```jsx
// app/docs/[slug]/page.jsx (server)
import Md from '../../markdown.jsx';
export default async function Page({ params }) {
  const body = await loadDoc(params.slug);
  return <Md>{body}</Md>;
}
```

Static HTML instead (no client JavaScript for the document):

```js
import { renderHtml } from '@bettercommunity/bmd/export';
const html = renderHtml(body, { lang: 'en' });   // <div class="md-body">…</div>
```

Add `mermaid` to `transpilePackages` only if your Next version complains about its ESM build.

## Remix

```jsx
// app/root.jsx
import bmdCss from '@bettercommunity/bmd/markdown.css?url';   // or a plain import with Vite
export const links = () => [{ rel: 'stylesheet', href: bmdCss }];
```

```jsx
// app/routes/docs.$slug.jsx
import Markdown from '@bettercommunity/bmd';
export default function Doc() { const { body } = useLoaderData(); return <Markdown>{body}</Markdown>; }
```

Call `configureMarkdown()` in `entry.client.jsx` (and in `entry.server.jsx` if you render on the
server — the config is module-level, so each runtime sets its own).

## Astro

```astro
---
// src/components/Doc.astro
import Md from './Md.jsx';
const { body } = Astro.props;
---
<Md client:load body={body} />
```

```jsx
// src/components/Md.jsx
import '@bettercommunity/bmd/markdown.css';
import Markdown from '@bettercommunity/bmd';
export default function Md({ body }) { return <Markdown>{body}</Markdown>; }
```

`client:load` because the blocks are interactive; `client:visible` works for a page whose
document is below the fold. For a fully static page, render the string at build time with
`documentHtml()` and set it as `set:html`.

## Create React App / Parcel / webpack

Same as Vite: import the stylesheet once, configure once, use the component. If your bundler
refuses `import.meta.url` (old webpack), the only place the kit uses it is `cssUrl` in
`export.jsx` — import from `@bettercommunity/bmd` (the renderer) rather than from `/export`.

## Node — an e-mail, a PDF, a static site

```js
import { readFileSync } from 'node:fs';
import { documentHtml, cssUrl } from '@bettercommunity/bmd/export';
const css = readFileSync(new URL(cssUrl), 'utf8');
const page = documentHtml(body, { title: 'Release notes', css, scheme: 'light' });
```

The interactive blocks render their resting state (a tab strip with the first panel open, a
counter with no number, a diagram as its source), which is the right output for a medium that
cannot run scripts.

## A page map

`pageMap` powers hover cards on internal links, `[[wiki links]]` and the link checker:

```js
const pageMap = {
  '/docs/install': { title: 'Install', category: 'Guides', desc: 'Two minutes.', icon: 'download', anchors: ['windows', 'linux'] },
};
<Markdown pageMap={pageMap}>{body}</Markdown>
validateLinks(body, { pageMap });
```

## Content Security Policy

What the defaults reach for: `cdn.jsdelivr.net` (uncurated lucide and Phosphor icons, the
isometric icons from this package's own `assets/iso`, mermaid when not installed), `cdn.simpleicons.org` (brand icons not bundled), `www.youtube-nocookie.com`
and `open.spotify.com` (frames). Every one is a config knob: `cdn.lucide: null`,
`cdn.brand: null`, `cdn.phosphor: null`, `cdn.iso` (or serve `assets/iso` yourself), `cdn.mermaid: null`,
`allowIframes: /…/`.
