// Switching to Visual mode must not lose anything.
//
// The visual editor parses a document into blocks and serialises them back. Both directions
// are lossy by construction — `parse` understands a fixed set of containers, and everything
// else has to survive anyway, because a doc page is not written by the person who opens the
// editor next.
//
// The failure is silent and total: you toggle to Visual, glance at it, save, and the block
// you never touched is gone. There is no error, and the diff looks like something you did.
//
// So: every block the palette can create, and every container the RENDERER understands,
// through parse → serialize, twice. Twice matters — a transform that is wrong once is a
// transform that keeps eating a little more on every save.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '../src/editor/md-blocks.js');
if (!existsSync(FILE)) {
  console.error(`✗ ${FILE} is missing — refusing to report success`);
  process.exit(2);
}
const { parse, serialize, blank } = await import(`file://${FILE.replace(/\\/g, '/')}`);
for (const [n, f] of [['parse', parse], ['serialize', serialize], ['blank', blank]]) {
  if (typeof f !== 'function') { console.error(`✗ ${n} is not exported — this check cannot be trusted`); process.exit(2); }
}

const problems = [];
const trip = (md) => serialize(parse(md));

/**
 * A document must survive the round trip, and the SECOND trip must equal the first.
 *
 * Exact equality on the first pass would fail on harmless normalisation (a missing trailing
 * newline, `***` becoming `---`). What must not change is meaning, so the test is: pass 2 ==
 * pass 1, and every marker that carried meaning is still present.
 */
const survives = (label, md, ...markers) => {
  const once = trip(md);
  const twice = trip(once);
  if (once !== twice) {
    problems.push(`${label}: not stable — a second visit changes it again\n      ${JSON.stringify(once)}\n   →  ${JSON.stringify(twice)}`);
    return;
  }
  const lost = markers.filter((m) => !once.includes(m));
  if (lost.length) problems.push(`${label}: lost ${lost.map((x) => JSON.stringify(x)).join(', ')}\n      out: ${JSON.stringify(once)}`);
};

// ── Containers the palette knows ──
survives('a callout', ':::tip[Careful]\nBody.\n:::', ':::tip', 'Careful', 'Body.');
survives('a card', ':::card{title="T" icon=book href="/x"}\nBody.\n:::', ':::card', 'title="T"', 'icon=book', '/x');
survives('a collapsible', ':::details[More]\nHidden.\n:::', ':::details', 'More', 'Hidden.');
survives('a file row', ':::file[a.zip]{href="/x.zip" size="2 MB"}\n:::', ':::file', 'a.zip', '/x.zip', '2 MB');
survives('steps', '::::steps[How]\n:::step[One]\nDo it.\n:::\n::::', 'steps', 'One', 'Do it.');
survives('columns', '::::columns\n:::column\nL\n:::\n:::column\nR\n:::\n::::', 'columns', 'L', 'R');
survives('a roadmap', ':::roadmap[Plan]\n```json\n{"categories":[]}\n```\n:::', ':::roadmap', 'categories');

// ── Containers the RENDERER knows and the palette does not ──
// These are the dangerous ones: anything parse() cannot name falls to its default branch, and
// the default branch is where a wrapper gets dropped and the content walks out of its block.
survives('tabs', '::::tabs\n:::tab{title="Windows"}\nRun it.\n:::\n:::tab{title="Linux"}\nRun that.\n:::\n::::',
  'tabs', 'Windows', 'Linux', 'Run it.', 'Run that.');
survives('a cards grid', '::::cards\n:::card{title="A"}\nOne.\n:::\n:::card{title="B"}\nTwo.\n:::\n::::',
  'cards', '"A"', '"B"', 'One.', 'Two.');
survives('a replay', ':::replay{src="/x.bmmreplay" title="Demo"}\n:::', 'replay', '/x.bmmreplay', 'Demo');
survives('a custom callout', ':::callout[Mine]{icon=rocket color="#7c3aed"}\nBody.\n:::', 'callout', 'Mine', 'rocket', '#7c3aed');

// ── Inline things that live inside a text block ──
survives('a button', ':button[Watch]{brand=youtube href=https://x.test}', ':button[Watch]', 'brand=youtube');
survives('a coloured link', ':link[read]{color=#e11 href=/docs}', ':link[read]', 'color=#e11');
survives('an inline icon and keys', 'Press :kbd[Ctrl+K] then :icon[rocket].', ':kbd[Ctrl+K]', ':icon[rocket]');
survives('maths', 'Before.\n\n$$E = mc^2$$\n\nAfter.', '$$E = mc^2$$');
survives('an emoji shortcode', 'Shipped :rocket: today.', ':rocket:');
survives('a table', '| A | B |\n|---|---|\n| 1 | 2 |', '| A | B |', '| 1 | 2 |');
survives('a fenced block', '```js\nconst x = 1;\n```', '```js', 'const x = 1;');
survives('a fence holding directive syntax', '```\n:::tip[not a real one]\n```', ':::tip[not a real one]');

// ── Every block the palette can create must serialise to something ──
// `text` is exempt: a fresh text block is legitimately empty, and it is the one type whose
// blank state is "waiting for you to type". Every other block ships with example content, so
// an empty result means the serialiser has no case for it.
for (const type of ['heading', 'callout', 'card', 'image', 'code', 'quote', 'collapsible',
  'table', 'tags', 'file', 'steps', 'roadmap', 'columns', 'align', 'divider']) {
  const out = serialize([blank(type)]);
  if (!out || !out.trim()) problems.push(`the "${type}" block serialises to nothing`);
}

if (problems.length) {
  console.error('✗ visual-editor round trip:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  Toggling to Visual and saving must not change a document nobody edited.');
  console.error('  Anything parse() cannot name still has to come back out of serialize().');
  process.exit(1);
}
console.log('✓ round trip OK — every block and every renderer container survives Visual mode');
