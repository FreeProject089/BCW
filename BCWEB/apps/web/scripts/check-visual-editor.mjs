// Every markdown field in the visual editor carries the formatting toolbar.
//
// SelectionToolbar — bold, italic, strike, code, a colour span, a link, an anchor, an inline
// comment — existed for a long time and was mounted on exactly ONE textarea: the raw Markdown
// tab. So the tab labelled "Visual" was the one where you had to type `**bold**` and
// `[text](url)` by hand. That is the wrong way round, and it is why the mode reads as
// half-finished rather than as a different way of working.
//
// Nothing could see it. Both files are valid, both render, and a textarea without a toolbar
// looks exactly like a textarea with one until you select something.
//
// So: no bare <textarea> in visual-editor.jsx. Markdown fields go through MdField, which owns
// the ref the toolbar positions against — one component, so the next block type gets it by
// construction instead of by somebody remembering.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VE = join(dirname(fileURLToPath(import.meta.url)), '../src/editor/visual-editor.jsx');
if (!existsSync(VE)) { console.error(`✗ ${VE} is missing — refusing to report success`); process.exit(2); }
const src = readFileSync(VE, 'utf8');

const problems = [];

// MdField is the only thing allowed to render a raw textarea here.
const bodyAfterMdField = src.slice(src.indexOf('function MdField'));
const inMdField = bodyAfterMdField.slice(0, bodyAfterMdField.indexOf('\n}\n'));
// Two fields are deliberately NOT markdown and must NOT get a markdown toolbar: a code
// block's contents, and the roadmap's JSON. Offering **bold** inside either is offering to
// corrupt it. Exempted by what they bind to, so the exemption is narrow and visible.
const EXEMPT = /value=\{b\.(code|json)\}/;
const all = [...src.matchAll(/<textarea\b[^>]*/g)].map((m) => m[0]);
const bare = all.length;
const inside = [...inMdField.matchAll(/<textarea\b/g)].length + all.filter((x) => EXEMPT.test(x)).length;
if (bare === 0) {
  console.error('✗ no <textarea> found at all — the editor moved and this check cannot be trusted');
  process.exit(2);
}
if (bare - inside > 0) {
  problems.push(`${bare - inside} markdown textarea(s) outside MdField — those fields have no formatting toolbar, in the tab called "Visual"`);
}
if (!/SelectionToolbar/.test(src)) {
  problems.push('SelectionToolbar is not mounted in the visual editor at all');
}
// The preview must come from the same serialiser that writes the document.
if (/peek\[b\.id\]/.test(src) && !/<Markdown>\{blockMd\(b\)/.test(src)) {
  problems.push('the block preview is not rendered from blockMd() — a second renderer will disagree with the saved document');
}

if (problems.length) {
  console.error('✗ visual editor:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ visual editor OK — every markdown field goes through MdField (${inside} textarea in the wrapper, ${bare - inside} outside)`);
