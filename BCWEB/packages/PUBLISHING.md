# Publishing `@bettercommunity/bmd` and `@bettercommunity/bmd-editor`

Two packages, published together, consumed with npm **or** pnpm.

Run the gate first. It is the whole point of this file:

```bash
cd apps/web && node scripts/check-bmd-publish.mjs
```

It is also part of `npm run lint`, so a packaging mistake fails the branch rather than the
publish.

## What the gate is actually for

Both packages are used inside this repo through a workspace path, and a workspace resolves
things a published tarball does not. Three mistakes are invisible here and only appear once
someone installs the package:

| Mistake | Where it shows |
|---|---|
| A bare import the package never declares | **pnpm only.** npm installs a flat `node_modules`, so the import resolves off a sibling package by accident and works. pnpm isolates each package: same import, hard `Cannot find package` at the consumer's first import. |
| An `exports` entry outside `files` | Resolves in the repo, 404s for everyone who installs — the longest feedback loop of the three. |
| A scoped package with no `publishConfig.access` | `npm publish` fails with a 402 that reads like a billing problem. |

The first one is why this exists. Publishing something that works on npm and breaks on pnpm
means it works for half the people who install it and nobody finds out from us.

## Release

1. **Version.** Both packages move together — `bmd-editor` peers on `@bettercommunity/bmd`
   `>=3` and the gate checks the major agrees. Bump `version` in both `package.json`s and add
   the entry to `packages/bmd/CHANGELOG.md`.
2. **Gates.** From `apps/web`: `npm run lint` (it runs the publish check, the 95-directive
   render check, the 42 hostile-document security check and the kit/type checks) and
   `npm test`.
3. **Look in the tarball**, do not assume:
   ```bash
   cd packages/bmd && npm pack --dry-run
   ```
   32 files, ~116 kB. `LICENSE`, `README.md`, `CHANGELOG.md`, `docs/`, `src/`. The editor is
   9 files including `src/editor.d.ts`.
4. **Publish**, `bmd` first — the editor peers on it:
   ```bash
   cd packages/bmd && npm publish
   cd ../bmd-editor && npm publish
   ```
   `publishConfig.access: public` is already set on both; without it a scoped package is
   private by default.
5. **Install it somewhere that is not this repo** before announcing. With **pnpm**, because
   that is the client that will catch what npm forgives:
   ```bash
   pnpm add @bettercommunity/bmd @bettercommunity/bmd-editor react react-dom
   ```

## What consumers need to know

**The packages ship source, not a build.** `main` is `./src/index.jsx`, and the tree contains
JSX. That is deliberate — it keeps the published code the code we read, and Vite, Next, Astro,
Remix, Parcel and esbuild all compile it — but it means a consumer whose bundler does not
handle JSX from `node_modules`, or one importing it in plain Node with no build step, cannot
use it. If that becomes a real report rather than a hypothetical, the fix is a build step
emitting `dist/` with `exports` pointing at it and `files` extended; nothing else here
changes.

**Peer dependencies are peers on purpose.** React, `react-markdown`, the remark/rehype chain
and `lucide-react` are the host's, so a host cannot end up with two Reacts. `mermaid`,
`rehype-highlight`, `remark-math`, `rehype-katex` and `katex` are marked optional: the
features that need them degrade rather than fail when they are absent.

**CSS is explicit.** `@bettercommunity/bmd/markdown.css` and
`@bettercommunity/bmd-editor/editor.css` are imported by the host. `sideEffects: ["*.css"]`
keeps a bundler from tree-shaking them away.
