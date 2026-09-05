# Integration

## In this monorepo (in place, no publish)

`apps/web/vite.config.js` maps the package name onto this folder and tells Vite to resolve the
kit's bare imports from the app's own `node_modules`:

```js
resolve: {
  alias: [{ find: /^@bettercommunity\/bmd$/, replacement: `${BMD}/index.jsx` }, /* …subpaths… */],
  dedupe: ['react', 'react-dom', 'react-markdown', /* … */],
}
```

There is no root workspace (each app installs on its own), which is why a `file:` link would not
work: the kit's `import 'react'` would have no `node_modules` above it. The alias + dedupe pair
gives one React and one renderer. The web Docker image is built from the BCWEB root so the
folder is in the context. `npm run lint` in `apps/web` runs the kit's own checks (self-contained,
types in step, every directive named in the README, every directive renders, hostile input).

## Elsewhere

`npm pack` here, then `npm i ./bettercommunity-bmd-2.0.0.tgz` — or copy `src/`. Peer
dependencies are listed in `package.json`; the three optional ones (highlight, math) load only
when a document needs them.

## The same vocabulary in BMM and in MkDocs

- **BMM** (the desktop app) renders B.MD without React: `frontend/src/ui/rich-markdown.ts`
  (blog / update notes) and `frontend/src/docs/md-lite.ts` (bundled docs) down-convert each
  directive to HTML. Every block in `docs/blocks.md` has a branch there.
- **BMM Docs** (MkDocs) accepts the syntax through `tools/md_directives.py`: callouts become
  admonitions, `:::details` a collapsible, and the 2.0 blocks are rewritten to `md_in_html`
  markup styled by the site's stylesheet.

Adding a block means three renderers, on purpose: a document written once must read the same
in the browser, in the app and on the docs site.
