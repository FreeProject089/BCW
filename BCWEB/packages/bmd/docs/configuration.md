# Configuration

Call once, at import time, before anything renders:

```js
import { configureMarkdown } from '@bettercommunity/bmd';

configureMarkdown({
  appIcons: { acme: '/logo.png' },               // :icon[app:acme]
  cdn: {                                          // null = family off, nothing fetched
    lucide: (name) => `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`,
    phosphor: (path) => `https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/${path}.svg`,
    brand: (slug) => `https://cdn.simpleicons.org/${slug}`,
    iso: (name) => `/icons/iso/${name}.svg`,     // :icon[iso:server], your copy of assets/iso
  },
  policy: {                                       // where authored URLs may point
    allowHosts: ['example.com'],
    allowDownloadHosts: ['files.example.com'],
    rewrite: (url) => `/away?to=${encodeURIComponent(url)}`,
  },
  allowIframes: /^https:\/\/(www\.)?youtube(-nocookie)?\.com\//i,
});
```

`<Markdown lang="fr" className="…" pageMap={…} roadmap={Component} replay={Component}>` — see
`src/README.md` for `pageMap` (hover-preview cards), replacing the two component blocks, and
`plugins.js` for adding a block of your own without editing the kit.
