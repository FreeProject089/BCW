// The editor's block model must be LOSSLESS: splitting a B.MD document into blocks and joining
// them back has to reproduce the source exactly, or the visual editor would corrupt documents
// on every save. This is the invariant the whole drag-drop editor rests on, so it is tested
// against the awkward cases — nested directives, fenced code holding `:::`, tables, blank runs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks, joinBlocks, parseBmdFile, serializeBmdFile } from '../../../packages/bmd/src/editor-blocks.js';

const SAMPLES = [
  '',
  '# Title\n\nA paragraph.\n',
  '# H1\nno blank between\n## H2\n',
  '::::steps[How]\n:::step\nFirst\n:::\n:::step\nSecond\n:::\n::::\n\nAfter.\n',
  ':::note[Heads up]\nBody with a `:::` in inline code.\n:::\n',
  '```js\nconst a = 1;\n// ::: not a directive inside code\n```\n\ntext\n',
  '| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n',
  'Para one.\n\n\n\nPara two after several blanks.\n',
  '---\n\nAfter an hr.\n',
  'No trailing newline',
  'trailing spaces   \nand a line\n',
];

describe('B.MD editor block model', () => {
  test('splitBlocks → joinBlocks is byte-for-byte lossless', () => {
    for (const md of SAMPLES) {
      assert.equal(joinBlocks(splitBlocks(md)), md, `round-trip drift for: ${JSON.stringify(md)}`);
    }
  });

  test('never splits inside a fenced code block or a directive fence', () => {
    const blocks = splitBlocks('```\n:::a\n:::\n```\n');
    assert.equal(blocks.filter((b) => b.kind === 'code').length, 1);
    const dir = splitBlocks('::::steps\n:::step\nx\n:::\n::::\n');
    // The whole nested directive is ONE block, not four.
    assert.equal(dir.filter((b) => b.kind.startsWith('directive')).length, 1);
  });

  test('infers a useful kind per block', () => {
    const b = splitBlocks('# H\n\ntext\n\n:::note\nn\n:::\n');
    const kinds = b.map((x) => x.kind);
    assert.ok(kinds.includes('heading'));
    assert.ok(kinds.includes('paragraph'));
    assert.ok(kinds.some((k) => k.startsWith('directive')));
  });

  test('.bmd file frontmatter round-trips and defaults to a body-only file', () => {
    const parsed = parseBmdFile('---\nbmd: 1\ntitle: Hi\n---\n# Body\n');
    assert.equal(parsed.meta.title, 'Hi');
    assert.equal(parsed.body, '# Body\n');
    assert.equal(parseBmdFile('# just body\n').body, '# just body\n');
    const round = parseBmdFile(serializeBmdFile({ meta: { title: 'X' }, body: '# B\n' }));
    assert.equal(round.meta.title, 'X');
    assert.equal(round.body, '# B\n');
    assert.equal(round.meta.bmd, '1'); // version stamped by default
  });
});
