#!/usr/bin/env node
// Regenerate the parts of README.md that must not be typed by hand.
//
//   node packages/bmd/scripts/gen-readme.mjs          rewrite the generated sections
//   node packages/bmd/scripts/gen-readme.mjs --check  exit 1 when the directive table is stale
//
// Two sections, each between markers:
//   <!-- directives:start --> … <!-- directives:end -->  the directive table, from src/registry.js
//   <!-- size:start --> … <!-- size:end -->              bundle size, measured from dist/
//
// The size section needs a build (`node scripts/build.mjs`), and measures two things: B.MD's
// own code per entry (minified, gzipped, its chunks included), and what a browser downloads
// for `import Markdown from '@bettercommunity/bmd'` once the Markdown pipeline is bundled in
// (react and react-dom excluded: the page has them already). It also writes docs/size.json,
// which bettercommunity.ch/dev/bmd shows. `--check` only checks the table: sizes move with the
// toolchain, and a check that fails on an esbuild upgrade is a check people learn to ignore.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { DIRECTIVES, DIRECTIVE_GROUPS } from '../src/registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const README = join(PKG, 'README.md');
const WEB = join(PKG, '..', '..', 'apps', 'web');

const esc = (s) => String(s).replace(/\|/g, '\\|');
const syntax = (d, f) => `${f === 'container' ? ':::' : f === 'leaf' ? '::' : ':'}${d.name}`;

/** The directive table, grouped, one row per block. */
export function directiveTable() {
  const out = [];
  const names = DIRECTIVES.reduce((n, d) => n + 1 + d.aliases.length, 0);
  out.push(`${DIRECTIVES.length} blocks, ${names} names with the aliases. Generated from \`src/registry.js\` (also exported as \`DIRECTIVES\`), which a test holds to the parser.`);
  for (const g of DIRECTIVE_GROUPS) {
    const rows = DIRECTIVES.filter((d) => d.group === g.id);
    if (!rows.length) continue;
    out.push('', `#### ${g.label.en}`, '', '| Directive | Aliases | What it does | Attributes |', '|---|---|---|---|');
    for (const d of rows) {
      const forms = d.forms.map((f) => `\`${syntax(d, f)}\``).join(' ');
      const aliases = d.aliases.length ? d.aliases.map((a) => `\`${a}\``).join(' ') : '';
      const inside = d.parent ? ` Inside \`${d.parent}\`.` : '';
      const fetches = d.fetches ? ' Fetches.' : '';
      const attrs = d.attrs.length ? d.attrs.map((a) => `\`${a}\``).join(' ') : '';
      out.push(`| ${forms} | ${aliases} | ${esc(d.summary.en)}${inside}${fetches} | ${attrs} |`);
    }
  }
  return out.join('\n');
}

function replaceBetween(text, name, body) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`README.md has no ${start} … ${end} section`);
  return `${text.slice(0, a + start.length)}\n${body}\n${text.slice(b)}`;
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

/** Every file an entry pulls in statically (its chunks), itself included. */
function closure(dist, file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(join(dist, file), 'utf8');
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*["'](\.\/[^"']+)["']/g)) closure(dist, m[1].slice(2), seen);
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*["'](\.\/[^"']+)["']/g)) closure(dist, m[1].slice(2), seen);
  return seen;
}

async function measure() {
  const dist = join(PKG, 'dist');
  if (!existsSync(join(dist, 'index.js'))) return null;
  let esbuild;
  try { esbuild = await import('esbuild'); } catch {
    esbuild = await import(pathToFileURL(createRequire(join(WEB, 'package.json')).resolve('esbuild')).href);
  }
  const entries = readdirSync(dist).filter((f) => /\.js$/.test(f) && !f.startsWith('chunk-'));
  const own = {};
  for (const e of entries) {
    // Minify each file of the closure on its own and gzip them together: the size a CDN serves.
    let min = '';
    for (const f of closure(dist, e)) min += (await esbuild.transform(readFileSync(join(dist, f), 'utf8'), { minify: true, loader: 'js' })).code;
    own[e.replace(/\.js$/, '')] = { min: Buffer.byteLength(min), gzip: gzipSync(min, { level: 9 }).length };
  }
  // The whole client cost of the component, the pipeline bundled in.
  const r = await esbuild.build({
    entryPoints: [join(dist, 'index.js')], bundle: true, minify: true, write: false, format: 'esm', platform: 'browser',
    nodePaths: [join(WEB, 'node_modules')],
    external: ['react', 'react-dom', 'react/*', 'react-dom/*', 'mermaid', 'rehype-highlight', 'remark-math', 'rehype-katex', 'katex', 'katex/*'],
    logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const all = r.outputFiles.map((f) => f.contents).reduce((a, b) => Buffer.concat([a, Buffer.from(b)]), Buffer.alloc(0));
  const css = readFileSync(join(dist, 'markdown.css'));
  const version = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;
  return {
    version,
    own,
    component: { min: all.length, gzip: gzipSync(all, { level: 9 }).length },
    css: { raw: css.length, gzip: gzipSync(css, { level: 9 }).length },
  };
}

function sizeSection(s) {
  const pick = ['index', 'export', 'config', 'registry', 'ast', 'links', 'openapi'];
  const rows = pick.filter((k) => s.own[k]).map((k) => `| \`@bettercommunity/bmd${k === 'index' ? '' : `/${k}`}\` | ${kb(s.own[k].min)} | ${kb(s.own[k].gzip)} |`);
  return [
    `Measured for ${s.version} by \`scripts/gen-readme.mjs\` (minified, gzip -9).`,
    '',
    `- **In the browser**, \`import Markdown from '@bettercommunity/bmd'\` with the Markdown pipeline bundled in (react-markdown, remark, rehype, lucide icons): **${kb(s.component.gzip)} gzipped** (${kb(s.component.min)} minified). React and React DOM are not counted: the page has them already.`,
    `- **The stylesheet**: ${kb(s.css.gzip)} gzipped.`,
    '- **Loaded only when a document needs them**, never at startup: Mermaid (a diagram), KaTeX (maths), highlight.js (a fenced code block).',
    '',
    'B.MD\'s own code per entry, its shared chunks included:',
    '',
    '| Import | Minified | Gzipped |',
    '|---|---|---|',
    ...rows,
  ].join('\n');
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const check = process.argv.includes('--check');
  const readme = readFileSync(README, 'utf8');
  const table = directiveTable();
  if (check) {
    const want = replaceBetween(readme, 'directives', table);
    if (want !== readme) { console.error('✗ README.md directive table is stale: run node packages/bmd/scripts/gen-readme.mjs'); process.exit(1); }
    console.log(`✓ README.md directive table matches the registry (${DIRECTIVES.length} blocks)`);
    process.exit(0);
  }
  let next = replaceBetween(readme, 'directives', table);
  const s = await measure();
  if (s) {
    next = replaceBetween(next, 'size', sizeSection(s));
    writeFileSync(join(PKG, 'docs', 'size.json'), `${JSON.stringify(s, null, 2)}\n`);
    console.log(`✓ size: component ${kb(s.component.gzip)} gz, own index ${kb(s.own.index.gzip)} gz, css ${kb(s.css.gzip)} gz`);
  } else {
    console.log('· no dist/ (run scripts/build.mjs): size section left as it was');
  }
  writeFileSync(README, next);
  console.log(`✓ README.md regenerated: ${DIRECTIVES.length} blocks`);
}
