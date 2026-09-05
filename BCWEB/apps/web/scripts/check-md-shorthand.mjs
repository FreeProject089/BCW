// The shorthands that rewrite a document before it is parsed, and what they must not eat.
//
// `preprocessMd` runs on raw text. It turns a `> [!NOTE]` blockquote into a callout and a bare
// `[NEW]` into a coloured chip — both useful, both operating on a string where nothing has
// been parsed yet, which is the only place in this renderer where two features can collide
// without either of them being wrong.
//
// One did. `:badge[NEW]{color="#0a7"}` became `:badge<span…>NEW</span>{color="#0a7"}` before
// remark-directive ran, so the directive had no label and no attributes: it rendered an EMPTY
// badge and spat `{color="#0a7"}` into the sentence as literal text. Two upper-case words, one
// bracket, two meanings, and the explicit one lost.
//
// It shipped in the markdown guide, in the docs blocks page, and in the /dev playground's
// opening sample — where the broken example sat directly under the heading explaining badges.
// Nothing failed. The page rendered; it rendered the wrong thing.
//
// So this file asserts BEHAVIOUR, on the real function, rather than looking at the source.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/bmd/src/shorthand.js');
if (!existsSync(FILE)) {
  console.error(`✗ ${FILE} is missing — refusing to report success`);
  process.exit(2);
}
const { preprocessMd } = await import(`file://${FILE.replace(/\\/g, '/')}`);
if (typeof preprocessMd !== 'function') {
  console.error('✗ preprocessMd is not exported from the shorthand module — this check cannot be trusted');
  process.exit(2);
}

const problems = [];
const chip = /<span class="md-badge/;

/** The text must come out unchanged. */
const keep = (src, why) => {
  const out = preprocessMd(src);
  if (out !== src) problems.push(`${why}\n      ${JSON.stringify(src)}\n   →  ${JSON.stringify(out)}`);
};
/** The text must be rewritten into a chip. */
const chips = (src, why) => {
  if (!chip.test(preprocessMd(src))) problems.push(`${why} — ${JSON.stringify(src)} produced no chip`);
};

// ── A directive's label is a label ──
// Every directive that takes one, at every fence depth, with and without attributes.
keep(':badge[NEW]{color="#0a7"}', 'an inline directive label was eaten by the chip shorthand');
keep(':badge[NEW]', 'an inline directive label was eaten, even with no attributes');
keep(':tag[FIXED]{color="#e11"}', ':tag is the same block under another name');
keep(':::note[WARNING]', 'a container directive label was eaten');
// There is deliberately no case for `:::callout{attrs}[LABEL]`. Measured in the browser:
// remark-directive reads a label only immediately after the name, so that order is not a
// directive at all — the whole line renders as literal text no matter what this shorthand
// does to it. The docs documented that order and have been corrected. A case here would be
// asserting on syntax that does not exist.
keep(':button[NEW]{brand=github href=/x}', "a button's label was eaten");
keep(':link[IMPROVED]{color=#0a7 href=/x}', "a coloured link's label was eaten");
keep(':::step[VISUAL]', "a step's title was eaten");

// ── A bare word in prose is still a chip ──
chips('[NEW] shipped today', 'the chip shorthand stopped working');
chips('and a [FIXED] one', 'a chip mid-sentence stopped working');
chips('[NOUVEAU] en français', 'the French spelling stopped working');

// ── Code is still untouched ──
keep('`[NEW] inside inline code`', 'inline code was rewritten');
keep('```\n[NEW] inside a fence\n```', 'a fenced block was rewritten');

// ── The alert shorthand still works, and still only on a blockquote ──
if (!/md-alert-warning/.test(preprocessMd('> [!WARNING]\n> Careful.'))) {
  problems.push('the GitHub-style alert shorthand stopped working');
}
keep('[!WARNING] not in a blockquote', 'the alert shorthand fired outside a blockquote');

if (problems.length) {
  console.error('✗ markdown shorthands:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  These run before the parser, on raw text. A rule that eats another rule\'s');
  console.error('  syntax here produces a page that renders — and renders the wrong thing.');
  process.exit(1);
}
console.log('✓ markdown shorthands OK — directive labels kept, chips and alerts still fire, code untouched');
