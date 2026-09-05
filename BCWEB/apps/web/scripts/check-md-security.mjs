#!/usr/bin/env node
// Hostile documents, through the real renderer.
//
// B.MD renders text that authors write, and on this site some of those authors are the
// public. Every other check here asks whether a directive DRAWS; this one asks what happens
// when somebody writes one to attack the reader.
//
// It is the same harness check-md-renders.mjs uses — esbuild the real index.jsx for node,
// render with `renderToStaticMarkup` — because a security check against a re-implementation
// of the pipeline is a check against something nobody ships.
//
// The assertions are on the OUTPUT, not on the schema. A schema is a claim about the output;
// this reads the output. That distinction is not academic: `rehype-sanitize` refuses
// `javascript:` on `href`, and it does nothing about `//evil.com`, which is not a protocol at
// all — so a reviewer reading the schema concludes the site is covered and it is not.
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = '../../packages/bmd/src/index.jsx';
if (!existsSync(SRC)) { console.error(`✗ ${SRC} is missing — refusing to report success`); process.exit(2); }

/**
 * Each case: what an author writes, and what must NOT come out.
 *
 * `forbid` is a list of regexes that must not match the rendered HTML. `require` is for the
 * cases where removing something is not enough — an external link has to GAIN a `rel`, and a
 * missing one is as much a defect as a surviving `onerror`.
 */
/**
 * An event handler ON A TAG, which is the only form that runs.
 *
 * Not the bare word: a directive label is escaped, so `&lt;img src=x onerror=…&gt;` holds
 * the word while being text. The first draft of this file reported that case as a failure
 * against a renderer that was doing exactly the right thing.
 */
const ON_ATTR = /<[a-z][^>]*\son[a-z]+\s*=/i;

const CASES = [
  // ── raw HTML an author can type ──
  { name: 'script tag', md: 'a\n\n<script>alert(1)</script>\n', forbid: [/<script/i] },
  { name: 'img onerror', md: '<img src=x onerror="alert(1)">', forbid: [ON_ATTR] },
  { name: 'svg onload', md: '<svg onload="alert(1)"></svg>', forbid: [ON_ATTR] },
  { name: 'body onload via tag', md: '<body onload="alert(1)">x</body>', forbid: [ON_ATTR] },
  { name: 'iframe off the allowlist', md: '<iframe src="https://evil.example/x"></iframe>', forbid: [/evil\.example/] },
  { name: 'object/embed', md: '<object data="x.swf"></object><embed src="x.swf">', forbid: [/<object/i, /<embed/i] },
  { name: 'form and inputs', md: '<form action="https://evil.example"><input name="p"></form>', forbid: [/<form/i, /evil\.example/] },
  { name: 'meta refresh', md: '<meta http-equiv="refresh" content="0;url=https://evil.example">', forbid: [/http-equiv/i, /evil\.example/] },
  { name: 'base tag', md: '<base href="https://evil.example/">', forbid: [/<base/i, /evil\.example/] },

  // ── URLs, written as markdown ──
  { name: 'javascript: link', md: '[go](javascript:alert(1))', forbid: [/javascript:/i] },
  { name: 'JaVaScRiPt: link', md: '[go](JaVaScRiPt:alert(1))', forbid: [/javascript:/i] },
  { name: 'data: link', md: '[go](data:text/html;base64,PHNjcmlwdD4=)', forbid: [/data:text\/html/i] },
  { name: 'vbscript: link', md: '[go](vbscript:msgbox(1))', forbid: [/vbscript:/i] },
  { name: 'protocol-relative link', md: '[go](//evil.example/x)', forbid: [/href="\/\/evil\.example/] },
  { name: 'data: image', md: '![x](data:text/html,<script>alert(1)</script>)', forbid: [/<script/i, /data:text\/html/i] },
  // A browser strips control characters before reading the scheme, which is what makes this
  // work at all. A sanitiser matching the raw string does not.
  { name: 'javascript: with a tab in it', md: '<a href="java\tscript:alert(1)">go</a>', forbid: [/javascript:/i] },
  { name: 'javascript: with a newline in it', md: '<a href="java\nscript:alert(1)">go</a>', forbid: [/javascript:/i] },

  // ── URLs, written as directives — these never touch the markdown link rule ──
  { name: ':button href', md: 'x :button[Go]{href=javascript:alert(1)}', forbid: [/javascript:/i] },
  { name: ':link href', md: 'x :link[Go]{href=javascript:alert(1)}', forbid: [/javascript:/i] },
  { name: ':::file href', md: ':::file[r.pdf]{href=javascript:alert(1)}\n:::', forbid: [/javascript:/i] },
  { name: ':::card href', md: ':::card[C]{href=javascript:alert(1)}\nx\n:::', forbid: [/javascript:/i] },
  { name: ':::card image', md: ':::card[C]{image=javascript:alert(1)}\nx\n:::', forbid: [/javascript:/i] },
  { name: ':::card video', md: ':::card[C]{video=javascript:alert(1)}\nx\n:::', forbid: [/javascript:/i] },
  { name: ':::replay src', md: ':::replay[T]{src=javascript:alert(1)}\n:::', forbid: [/javascript:/i] },
  { name: ':::roadmap src', md: ':::roadmap[R]{src=javascript:alert(1)}\n:::', forbid: [/javascript:/i] },
  { name: ':button protocol-relative', md: 'x :button[Go]{href=//evil.example}', forbid: [/href="\/\/evil\.example/] },

  // ── content that is text and must stay text ──
  { name: 'markup in a directive label', md: ':::note[<img src=x onerror=alert(1)>]\nbody\n:::', forbid: [ON_ATTR] },
  { name: 'markup in an icon name', md: 'x :icon[<script>alert(1)</script>]', forbid: [/<script/i] },
  { name: 'markup in a kbd', md: 'x :kbd[<script>alert(1)</script>]', forbid: [/<script/i] },
  { name: 'markup in a code fence', md: '```\n<script>alert(1)</script>\n```', forbid: [/<script>alert/i] },
  { name: 'markup in an inline comment', md: '<doc-comment data-comment="<script>alert(1)</script>">x</doc-comment>', forbid: [/<script/i] },
  { name: 'roadmap json closing the tag', md: ':::roadmap[R]{json="</script><script>alert(1)"}\n:::', forbid: [/<script/i] },

  // ── style, which the schema does allow ──
  { name: 'expression() in style', md: '<div style="width:expression(alert(1))">x</div>', forbid: [/expression\s*\(/i] },
  { name: 'javascript: in a style url', md: '<div style="background:url(javascript:alert(1))">x</div>', forbid: [/javascript:/i] },

  // ── what must be PRESENT ──
  {
    name: 'external link gets rel',
    md: '<a href="https://example.com/x" target="_blank">go</a>',
    forbid: [],
    require: [/rel="noopener noreferrer"/],
  },
  {
    name: 'external :button gets rel',
    md: 'x :button[Go]{href=https://example.com/x}',
    forbid: [],
    require: [/rel="noopener noreferrer"/],
  },
  {
    name: 'an ordinary internal link still works',
    md: '[go](/hosting)',
    forbid: [/target="_blank"/],
    require: [/href="\/hosting"/],
  },
  {
    name: 'an ordinary https image still renders',
    md: '![alt](https://example.com/a.png)',
    forbid: [],
    require: [/src="https:\/\/example\.com\/a\.png"/],
  },
];

// ── build the renderer for node ──
const entry = join(process.cwd(), 'node_modules', '.md-sec-entry.jsx');
const bundle = join(process.cwd(), 'node_modules', '.md-sec-bundle.mjs');
const cleanup = () => { for (const f of [entry, bundle]) { try { rmSync(f, { force: true }); } catch { /* gone */ } } };
try {
  const esbuild = await import('esbuild');
  writeFileSync(entry, [
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import Markdown from '../../../packages/bmd/src/index.jsx';",
    'export const render = (md) => renderToStaticMarkup(<Markdown>{md}</Markdown>);',
  ].join('\n'));
  await esbuild.build({
    // The kit sits in packages/bmd, outside this app: its bare imports resolve from here.
    nodePaths: [join(process.cwd(), 'node_modules')],
    entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node',
    jsx: 'automatic', logLevel: 'silent', packages: 'external', loader: { '.css': 'empty' },
  });
} catch (e) {
  console.error(`✗ could not build the renderer for node: ${e?.message || e}`);
  console.error('  A security check that skips itself when the build fails is a security check');
  console.error('  that reports success on a renderer nobody compiled.');
  cleanup();
  process.exit(2);
}
const { render } = await import(pathToFileURL(bundle).href);

const problems = [];
let checked = 0;
for (const c of CASES) {
  let html;
  try { html = render(c.md); } catch (e) { problems.push(`${c.name}: threw while rendering — ${e?.message || e}`); continue; }
  checked++;
  for (const re of c.forbid) {
    if (re.test(html)) problems.push(`${c.name}: ${re} survived — ${html.slice(0, 160).replace(/\s+/g, ' ')}`);
  }
  for (const re of c.require || []) {
    if (!re.test(html)) problems.push(`${c.name}: ${re} is missing — ${html.slice(0, 160).replace(/\s+/g, ' ')}`);
  }
}

cleanup();

if (problems.length) {
  console.error('✗ markdown security:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  These are documents an author can write. Every one of them reaches a reader.');
  process.exit(1);
}
console.log(`✓ markdown security OK — ${checked} hostile document(s) rendered, nothing executable survived`);
