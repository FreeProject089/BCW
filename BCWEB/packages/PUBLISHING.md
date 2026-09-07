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

## Publishing with pnpm instead of npm

Same registry, same tarball, three differences worth knowing.

`pnpm publish` runs from the package directory exactly like npm:

```bash
cd packages/bmd && pnpm publish --access public
```

- **It refuses a dirty git tree** by default, where npm does not care. That is a feature here —
  it stops a publish of files that are not in a commit — but it will stop you mid-release if
  you have edited anything. Commit first; `--no-git-checks` exists and is the wrong answer
  unless you know exactly why you are reaching for it.
- **`--access public` on the command line** is worth passing even though `publishConfig` already
  says it. Nothing breaks if both agree, and the flag is what the error message tells you to
  add when they do not.
- **It packs the same `files` list**, so `pnpm pack --dry-run` and `npm pack --dry-run` show the
  same tarball. Either is a valid check.

**You do not "publish to pnpm".** There is one registry (npmjs.com); pnpm, npm, yarn and bun are
clients that install from it. What makes a package pnpm-*safe* is not how it was published — it
is that every import it makes is declared, which is what `check-bmd-publish.mjs` enforces and
what the table above explains.

## Logging in

```bash
npm login          # or: pnpm login
npm whoami         # the account has to own the @bettercommunity scope
```

The scope must exist and the account must be able to write to it. A first publish under a scope
nobody owns fails with a 404 that reads like the package is missing, not like a permissions
problem.

## Unpublishing, and why to think first

npm allows unpublish for 72 hours, and only when nothing depends on the version. After that the
answer is `npm deprecate` plus a new version. A version number is cheap; a version that briefly
existed and vanished breaks lockfiles for anyone who installed it in between.

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
