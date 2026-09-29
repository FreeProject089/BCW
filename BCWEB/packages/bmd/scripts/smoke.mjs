#!/usr/bin/env node
// Does the TARBALL work — installed the way a stranger installs it, with npm and with pnpm?
//
//   node packages/bmd/scripts/smoke.mjs [--clients npm,pnpm] [--react 18|19] [--tmp DIR] [--types] [--audit] [--keep]
//
// Everything in this repo resolves B.MD through a Vite alias onto src/, which hides every
// packaging mistake there is. This packs both packages exactly as `npm publish` would (prepack
// builds dist/), installs the two .tgz files into an empty project, and then:
//
//   1. imports every subpath in `exports` (a missing file or a wrong condition fails here);
//   2. server-renders a sample document with react-dom/server, and every example in the
//      directive registry, failing when a directive leaks its own syntax into the output;
//   3. reads the stylesheet through `cssUrl`, the way the Node recipe in the README does;
//   4. with --types, compiles a TypeScript consumer against the shipped .d.ts files
//      (moduleResolution node16 and bundler, strict, no skipLibCheck);
//   5. with --audit, runs `npm audit --omit=dev --audit-level=high` on the installed tree.
//
// pnpm matters on its own: its node_modules is strict, so a dependency the package uses and
// never declared resolves under npm (hoisted) and fails under pnpm. Needs the network (the
// registry) for react and the declared dependencies.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const CLIENTS = opt('--clients', 'npm,pnpm').split(',').filter(Boolean);
const TYPES = args.includes('--types');
const AUDIT = args.includes('--audit');
const KEEP = args.includes('--keep');
const base = opt('--tmp', null);
if (base) mkdirSync(base, { recursive: true });
const TMP = mkdtempSync(join(base || tmpdir(), 'bmd-smoke-'));
const WIN = process.platform === 'win32';

function run(cmd, argv, cwd, { quiet = false } = {}) {
  // Windows ships npm/pnpm as .cmd shims, which only a shell starts; node itself is started
  // directly (its path has a space in it, which a shell would split).
  const shell = WIN && cmd !== process.execPath;
  if (shell) argv = argv.map((a) => (/\s/.test(a) ? `"${a}"` : a));
  const out = execFileSync(cmd, argv, { cwd, encoding: 'utf8', shell, stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'], env: { ...process.env, npm_config_fund: 'false', npm_config_update_notifier: 'false' } });
  return out;
}
const fail = (msg) => { console.error(`✗ ${msg}`); if (!KEEP) rmSync(TMP, { recursive: true, force: true }); process.exit(1); };

// ── 1. pack ─────────────────────────────────────────────────────────────────────
const FORBIDDEN = [/(^|\/)test(s)?\//, /\.test\.[cm]?[jt]sx?$/, /(^|\/)fixtures?\//, /(^|\/)\.env/, /(^|\/)scripts\//, /(^|\/)src\//, /\.map$/, /(^|\/)node_modules\//, /\.(pem|key|p12)$/];
const tarballs = {};
for (const pkg of ['bmd', 'bmd-editor']) {
  const dir = join(PACKAGES, pkg);
  const json = run('npm', ['pack', '--json', '--pack-destination', TMP], dir, { quiet: true });
  const info = JSON.parse(json.slice(json.indexOf('[')))[0];
  tarballs[pkg] = join(TMP, info.filename);
  const bad = info.files.map((f) => f.path).filter((p) => FORBIDDEN.some((re) => re.test(p)));
  console.log(`\n▸ ${info.name}@${info.version}: ${info.files.length} files, ${(info.size / 1024).toFixed(1)} kB packed, ${(info.unpackedSize / 1024).toFixed(1)} kB unpacked`);
  for (const f of info.files) console.log(`    ${String(f.size).padStart(8)}  ${f.path}`);
  if (bad.length) fail(`${info.name}: the tarball carries files it must not: ${bad.join(', ')}`);
  // Nothing that looks like a credential, whatever the file is called.
  const secretish = /(?:npm_[A-Za-z0-9]{36}|ghp_[A-Za-z0-9]{36}|sk_live_[A-Za-z0-9]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  for (const f of info.files) {
    const p = join(dir, f.path);
    if (existsSync(p) && f.size < 2_000_000 && secretish.test(readFileSync(p, 'utf8'))) fail(`${info.name}: ${f.path} contains something shaped like a secret`);
  }
}

// ── 2. the consumer ─────────────────────────────────────────────────────────────
const SMOKE = `
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import Markdown, { DIRECTIVES, directiveNames, validateLinks, parseMarkdown, safeUrl } from '@bettercommunity/bmd';
import { renderHtml, documentHtml, cssUrl } from '@bettercommunity/bmd/export';
import { configureMarkdown } from '@bettercommunity/bmd/config';
import pkg from '@bettercommunity/bmd/package.json' with { type: 'json' };
import edPkg from '@bettercommunity/bmd-editor/package.json' with { type: 'json' };

const problems = [];
// Every subpath the two packages export, imported for real.
for (const [name, p] of [['@bettercommunity/bmd', pkg], ['@bettercommunity/bmd-editor', edPkg]]) {
  for (const sub of Object.keys(p.exports)) {
    if (sub.includes('*') || sub.endsWith('.json') || sub.endsWith('.css')) continue;
    const spec = sub === '.' ? name : name + sub.slice(1);
    try { await import(spec); } catch (e) { problems.push('import ' + spec + ': ' + (e && e.message)); }
  }
}

configureMarkdown({ policy: { allowApiHosts: [] } });
const doc = [
  '# Release notes', '', ':::tip[Installed from the tarball]', 'Rendered by **react-dom/server**. :badge[3.x]', ':::', '',
  ':::tabs', ':::tab{title="npm"}', '\`npm i @bettercommunity/bmd\`', ':::', ':::tab{title="pnpm"}', '\`pnpm add @bettercommunity/bmd\`', ':::', ':::', '',
  '| a | b |', '|---|---|', '| 1 | 2 |', '', '[bad](javascript:alert(1)) <script>alert(1)</script>',
].join('\\n');
const html = renderToString(createElement(Markdown, { lang: 'en' }, doc));
if (!html.includes('doc-callout')) problems.push('the callout did not render');
if (!html.includes('doc-tabs')) problems.push('the tabs did not render');
if (/<script/i.test(html)) problems.push('a <script> survived the sanitiser');
if (/javascript:/i.test(html)) problems.push('a javascript: URL survived the URL policy');

let rendered = 0;
for (const d of DIRECTIVES) {
  let out;
  try { out = renderHtml(d.example, { lang: 'en' }); } catch (e) { problems.push(':' + d.name + ' threw: ' + (e && e.message)); continue; }
  rendered++;
  const text = out.replace(/<[^>]*>/g, ' ');
  for (const n of [d.name, ...d.aliases]) {
    if (new RegExp('(^|[^\\\\w-]):{1,3}' + n + '(?![\\\\w-])').test(text)) { problems.push(':' + n + ' leaked into the output of its own example'); break; }
  }
}

const css = readFileSync(new URL(cssUrl), 'utf8');
if (css.length < 10000) problems.push('markdown.css through cssUrl is ' + css.length + ' bytes');
const page = documentHtml('# Hi', { title: 't', css });
if (!page.startsWith('<!doctype html>') && !page.toLowerCase().startsWith('<!doctype html>')) problems.push('documentHtml did not return a page');
if (!validateLinks('[x](#nowhere)').issues.length) problems.push('validateLinks found nothing wrong with a dead anchor');
if (!parseMarkdown('# a').children.length) problems.push('parseMarkdown returned an empty tree');
if (safeUrl('javascript:alert(1)').ok) problems.push('safeUrl accepted javascript:');

// The editor renders on the server too (a Next.js page imports it).
const { default: BmdEditor } = await import('@bettercommunity/bmd-editor');
try { renderToString(createElement(BmdEditor, { value: '# x', onChange() {} })); }
catch (e) { problems.push('BmdEditor threw during a server render: ' + (e && e.message)); }

if (problems.length) { console.error(problems.map((p) => '  ✗ ' + p).join('\\n')); process.exit(1); }
console.log('  ✓ ' + rendered + '/' + DIRECTIVES.length + ' registry examples (' + directiveNames().length + ' names) rendered without leaking; every export imported; CSS, export, AST, links, URL policy OK; ' + pkg.name + '@' + pkg.version);
`;

const TS = `
import Markdown, { configureMarkdown, DIRECTIVES, type MarkdownOptions } from '@bettercommunity/bmd';
import { findDirective } from '@bettercommunity/bmd/registry';
import { renderHtml } from '@bettercommunity/bmd/export';
import { safeUrl } from '@bettercommunity/bmd';
import BmdEditor from '@bettercommunity/bmd-editor';
import BmdBlockCanvas from '@bettercommunity/bmd-editor/block-canvas';
import { SNIPPETS } from '@bettercommunity/bmd-editor/snippets';
const o: MarkdownOptions = { policy: { allowApiHosts: ['api.example.com'] } };
configureMarkdown(o);
const html: string = renderHtml('# hi', { lang: 'en' });
const n: number = DIRECTIVES.length + SNIPPETS.length;
const ok: boolean = safeUrl('https://x.test').ok;
const d = findDirective('kpi');
const s: string | undefined = d?.summary.en;
export const el = [Markdown, BmdEditor, BmdBlockCanvas, html, n, ok, s];
`;

// React 19 by default; `--react 18` proves the lower end of the peer range (what apps/web runs).
const REACT = opt('--react', '19');
const deps = [`react@^${REACT}`, `react-dom@^${REACT}`];
let failed = false;
for (const client of CLIENTS) {
  const dir = join(TMP, `consumer-${client}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `bmd-smoke-${client}`, private: true, type: 'module' }, null, 2));
  console.log(`\n▸ ${client}: installing the two tarballs + ${deps.join(' ')} into ${dir}`);
  try {
    if (client === 'npm') run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', tarballs.bmd, tarballs['bmd-editor'], ...deps], dir);
    else if (client === 'pnpm') run('pnpm', ['add', '--config.strict-peer-dependencies=false', tarballs.bmd, tarballs['bmd-editor'], ...deps], dir);
    else fail(`unknown client ${client}`);
  } catch (e) { console.error(`  ✗ ${client} install failed`); failed = true; continue; }
  writeFileSync(join(dir, 'smoke.mjs'), SMOKE);
  try { process.stdout.write(run(process.execPath, ['smoke.mjs'], dir)); } catch (e) { process.stdout.write(String(e.stdout || '')); console.error(`  ✗ ${client}: the smoke render failed`); failed = true; }

  if (TYPES && client === 'npm') {
    try {
      run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', 'typescript@^5', `@types/react@^${REACT}`, `@types/react-dom@^${REACT}`], dir);
      writeFileSync(join(dir, 'consumer.ts'), TS);
      for (const mr of [['node16', 'node16'], ['esnext', 'bundler']]) {
        run(process.execPath, [join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'es2022', '--module', mr[0], '--moduleResolution', mr[1], '--jsx', 'react-jsx', 'consumer.ts'], dir);
        console.log(`  ✓ TypeScript (module ${mr[0]}, moduleResolution ${mr[1]}, strict, no skipLibCheck): the shipped .d.ts files compile`);
      }
    } catch { console.error('  ✗ the TypeScript consumer did not compile'); failed = true; }
  }
  if (AUDIT && client === 'npm') {
    try { run('npm', ['audit', '--omit=dev', '--audit-level=high'], dir); console.log('  ✓ npm audit --omit=dev: nothing high or critical in what a consumer installs'); }
    catch { console.error('  ✗ npm audit found high/critical advisories in the installed tree'); failed = true; }
  }
}

if (!KEEP) rmSync(TMP, { recursive: true, force: true });
else console.log(`\n(kept ${TMP})`);
if (failed) process.exit(1);
console.log(`\n✓ smoke OK with ${CLIENTS.join(' and ')}`);
