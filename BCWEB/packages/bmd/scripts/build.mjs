#!/usr/bin/env node
// Build the publishable form of @bettercommunity/bmd and @bettercommunity/bmd-editor.
//
//   node packages/bmd/scripts/build.mjs            both packages
//   node packages/bmd/scripts/build.mjs bmd        one of them (bmd | bmd-editor)
//
// Why a build at all, when apps/web reads src/ in place: src/ is JSX. A bundler that compiles
// node_modules (Vite) swallows that; Node does not (`import '@bettercommunity/bmd/export'` in a
// script is a SyntaxError on the first `<`), and neither does Next.js without
// `transpilePackages`. So the tarball carries dist/: plain ES modules, one file per public
// entry, shared code in chunks beside them, every dependency left as a bare import.
//
// Three things the build does on purpose:
//   · The kit's `import './markdown.css'` is dropped from dist. Node cannot import CSS, and a
//     library that forces a stylesheet through the consumer's bundler is one that breaks SSR.
//     The CSS ships as `@bettercommunity/bmd/markdown.css` and the README says to import it.
//   · Chunks sit in dist/ itself, not dist/chunks/: export.jsx computes `cssUrl` from
//     `import.meta.url`, which must resolve next to markdown.css whichever file the code
//     ends up in.
//   · Types are generated per entry from the hand-written declaration file (markdown.d.ts,
//     editor.d.ts), keeping only what that entry really exports (read from esbuild's metafile).
//     A subpath typed with the whole package would type-check imports that fail at runtime.
//
// esbuild comes from apps/web's node_modules (the package has no install of its own); CI runs
// `npm ci` there first. Nothing here touches the network.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..', '..');
const WEB = join(PACKAGES, '..', 'apps', 'web');

async function loadEsbuild() {
  try { return await import('esbuild'); } catch { /* not beside the package: use the app's */ }
  try {
    const req = createRequire(join(WEB, 'package.json'));
    return await import(pathToFileURL(req.resolve('esbuild')).href);
  } catch {
    console.error('✗ esbuild not found. Run `npm ci` in BCWEB/apps/web first (the build borrows its esbuild).');
    process.exit(2);
  }
}

const PKGS = {
  bmd: {
    dir: join(PACKAGES, 'bmd'),
    entries: ['index.jsx', 'config.js', 'icons.jsx', 'brands.jsx', 'plugins.js', 'openapi.js', 'export.jsx', 'ast.js', 'editor-blocks.js', 'links.js', 'registry.js'],
    css: ['markdown.css'],
    dts: 'markdown.d.ts',
  },
  'bmd-editor': {
    dir: join(PACKAGES, 'bmd-editor'),
    entries: ['index.jsx', 'snippets.js', 'block-canvas.jsx', 'live-preview.jsx'],
    css: ['editor.css'],
    dts: 'editor.d.ts',
    // Two entries default-export a component the declaration file names as a const.
    defaults: { 'block-canvas': 'BmdBlockCanvas', 'live-preview': 'BmdLivePreview' },
  },
};

/** A relative `./x.css` import becomes nothing; a bare one (`katex/dist/katex.min.css`) stays. */
const dropLocalCss = {
  name: 'drop-local-css',
  setup(b) {
    b.onResolve({ filter: /^\.{1,2}\/.*\.css$/ }, (a) => ({ path: a.path, namespace: 'bmd-css' }));
    b.onLoad({ filter: /.*/, namespace: 'bmd-css' }, () => ({ contents: '', loader: 'js' }));
  },
};

// ── declarations ──────────────────────────────────────────────────────────────

const STMT = /^export\s+(?:default\s+)?(?:declare\s+)?(function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/;
const DECL_DEFAULT = /^declare\s+const\s+([A-Za-z_$][\w$]*)/;

/** Split a flat .d.ts into declaration chunks: { kind, name, section, text }. */
function parseDts(text) {
  const lines = text.split(/\r?\n/);
  const header = [];      // import lines
  const chunks = [];
  let section = '';
  let cur = null;
  let pending = [];       // comment lines waiting for the declaration they document
  const flush = () => { if (cur) { chunks.push(cur); cur = null; } };
  for (const line of lines) {
    const sec = line.match(/^\/\* ── (.+?) ─/);
    if (sec) { flush(); pending = []; section = sec[1]; continue; }
    if (/^import\s/.test(line)) { header.push(line); continue; }
    const m = line.match(STMT);
    const d = !m && line.match(DECL_DEFAULT);
    if (m || d) {
      flush();
      const isDefault = /^export\s+default\s/.test(line);
      const kind = m ? m[1] : 'const';
      cur = {
        kind: kind === 'interface' || kind === 'type' ? 'type' : 'value',
        name: isDefault ? 'default' : (m ? m[2] : d[1]),
        section,
        lines: [...pending, line],
      };
      pending = [];
      continue;
    }
    // `export default X;` closes a `declare const X` chunk and makes it the default.
    const ed = line.match(/^export\s+default\s+([A-Za-z_$][\w$]*)\s*;/);
    if (ed && cur && cur.name === ed[1]) { cur.lines.push(line); cur.name = 'default'; cur.alias = ed[1]; flush(); continue; }
    const isComment = /^\s*(\/\/|\/\*\*?|\*)/.test(line);
    if (cur) {
      // A comment at column 0 after a finished statement belongs to the NEXT declaration.
      if (/^(\/\/|\/\*\*)/.test(line) && /[;}]\s*$/.test(cur.lines[cur.lines.length - 1])) { flush(); pending = [line]; continue; }
      cur.lines.push(line);
    } else if (isComment) {
      pending.push(line);
    } else if (!line.trim()) {
      pending = [];
    }
  }
  flush();
  for (const c of chunks) c.text = c.lines.join('\n').replace(/\s+$/, '');
  return { header, chunks };
}

/** Which source file defines a name (for the name declared in two sections). */
function definingFile(srcDir, name) {
  const re = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|class|let)\\s+${name}\\b`, 'm');
  for (const f of readdirSync(srcDir)) {
    if (!/\.(jsx?)$/.test(f)) continue;
    if (re.test(readFileSync(join(srcDir, f), 'utf8'))) return f;
  }
  return null;
}

function entryDts({ header, chunks }, exportsList, srcDir, entryFile, defaultAlias) {
  const types = [];
  const seenTypes = new Set();
  for (const c of chunks) {
    if (c.kind !== 'type' || seenTypes.has(c.name)) continue;
    seenTypes.add(c.name);
    types.push(c.text);
  }
  const values = [];
  const missing = [];
  for (const name of exportsList) {
    if (name === 'default' && defaultAlias) {
      const c = chunks.find((x) => x.kind === 'value' && x.name === defaultAlias);
      if (!c) { missing.push(`default (as ${defaultAlias})`); continue; }
      values.push(`${c.text.replace(/^export\s+const\s+/m, 'declare const ')}\nexport default ${defaultAlias};`);
      continue;
    }
    const all = chunks.filter((x) => x.kind === 'value' && x.name === name);
    if (!all.length) { missing.push(name); continue; }
    let pick = all[0];
    if (all.length > 1) {
      const file = name === 'default' ? entryFile : definingFile(srcDir, name);
      pick = all.find((x) => file && x.section.split(/\s*\/\s*/).includes(file)) || all[all.length - 1];
    }
    values.push(pick.text);
  }
  return { missing, text: [...header, '', ...types, '', ...values, ''].join('\n') };
}

// ── build ─────────────────────────────────────────────────────────────────────

async function build(id, esbuild) {
  const p = PKGS[id];
  const src = join(p.dir, 'src');
  const out = join(p.dir, 'dist');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const result = await esbuild.build({
    entryPoints: p.entries.map((e) => join(src, e)),
    outdir: out,
    outbase: src,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    // Every package stays an import the consumer's tree resolves (react once, not twice).
    packages: 'external',
    entryNames: '[name]',
    chunkNames: '[name]-[hash]',
    plugins: [dropLocalCss],
    metafile: true,
    legalComments: 'inline',
    logLevel: 'warning',
  });

  for (const c of p.css) copyFileSync(join(src, c), join(out, c));

  // One .d.ts per entry, holding what that entry exports and nothing else.
  const parsed = parseDts(readFileSync(join(src, p.dts), 'utf8'));
  const problems = [];
  for (const e of p.entries) {
    const base = e.replace(/\.(jsx?|mjs)$/, '');
    const key = relative(process.cwd(), join(out, `${base}.js`)).replace(/\\/g, '/');
    const meta = result.metafile.outputs[key];
    if (!meta) { problems.push(`${id}: no output for ${e}`); continue; }
    const { missing, text } = entryDts(parsed, meta.exports, src, e, p.defaults?.[base]);
    for (const m of missing) problems.push(`${id}/${base}: "${m}" is exported and ${p.dts} does not declare it`);
    writeFileSync(join(out, `${base}.d.ts`), `// Generated by scripts/build.mjs from src/${p.dts}. Do not edit.\n${text}`);
  }
  if (problems.length) {
    console.error(`✗ ${id}: declarations incomplete`);
    for (const x of problems) console.error(`    ${x}`);
    process.exit(1);
  }

  const files = readdirSync(out);
  const bytes = files.reduce((n, f) => n + readFileSync(join(out, f)).length, 0);
  console.log(`✓ ${id}: dist/ ${files.length} file(s), ${(bytes / 1024).toFixed(1)} kB (${p.entries.length} entries, types per entry)`);
}

const which = process.argv[2] || 'all';
const ids = which === 'all' ? Object.keys(PKGS) : [which];
for (const id of ids) {
  if (!PKGS[id]) { console.error(`✗ unknown package "${id}" (bmd | bmd-editor | all)`); process.exit(2); }
  if (!existsSync(join(PKGS[id].dir, 'src'))) { console.error(`✗ ${id}: no src/`); process.exit(2); }
}
const esbuild = await loadEsbuild();
for (const id of ids) await build(id, esbuild);
