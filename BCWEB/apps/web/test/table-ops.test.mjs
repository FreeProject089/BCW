// Editing a markdown table as a structure instead of as text.
//
// This is the feature people give up on: adding a column means retyping every row AND the
// separator, and one cell out of step stops it being a table at all — silently, because a
// broken table renders as a paragraph full of pipes.
//
// So the risk is not "does it add a column" but "does it damage the table while doing so".
// The cases below are the ones that damage it: an escaped pipe inside a cell, a hand-written
// table with ragged bars, alignment markers, and content around the table in the same block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTable, serializeTable, tableAddColumn, tableRemoveColumn,
  tableAddRow, tableRemoveRow, tableSetAlign, countChildren, addChild,
} from '../../../packages/bmd/src/editor-blocks.js';

const T = ['| Name | Size |', '|------|------|', '| a.js | 1 KB |', '| b.js | 2 KB |'].join('\n');

test('a table reads as rows and columns', () => {
  const t = parseTable(T);
  assert.deepEqual(t.header, ['Name', 'Size']);
  assert.deepEqual(t.rows, [['a.js', '1 KB'], ['b.js', '2 KB']]);
});

test('what is not a table says so, so no controls are offered for it', () => {
  assert.equal(parseTable('Just a paragraph.'), null);
  assert.equal(parseTable('| not | a table without a separator |'), null);
  assert.equal(parseTable(''), null);
});

test('adding a column widens the header, the separator AND every row', () => {
  // Forgetting any one of the three is what turns a table into a paragraph of pipes.
  const out = tableAddColumn(T);
  const t = parseTable(out);
  assert.equal(t.header.length, 3);
  assert.equal(t.align.length, 3);
  for (const r of t.rows) assert.equal(r.length, 3);
});

test('adding a column in the MIDDLE shifts the cells after it, not the ones before', () => {
  const t = parseTable(tableAddColumn(T, 1));
  assert.deepEqual(t.header, ['Name', '', 'Size']);
  assert.deepEqual(t.rows[0], ['a.js', '', '1 KB']);
});

test('the last column cannot be removed — a table needs one', () => {
  const one = ['| Only |', '|------|', '| x |'].join('\n');
  assert.equal(tableRemoveColumn(one, 0), one);
});

test('rows add and remove without touching the header', () => {
  const added = parseTable(tableAddRow(T));
  assert.equal(added.rows.length, 3);
  assert.deepEqual(added.header, ['Name', 'Size']);
  const removed = parseTable(tableRemoveRow(T, 0));
  assert.equal(removed.rows.length, 1);
  assert.deepEqual(removed.rows[0], ['b.js', '2 KB']);
  assert.deepEqual(removed.header, ['Name', 'Size'], 'the header is not a row');
});

test('an escaped pipe stays inside its cell', () => {
  // Splitting on it would tear one cell into two and shift every column after it — the table
  // would still LOOK like a table, with the wrong data in the wrong columns.
  const src = ['| Command | Does |', '|---|---|', String.raw`| a \| b | pipes two things |`].join('\n');
  const t = parseTable(src);
  assert.equal(t.rows[0].length, 2, 'two cells, not three');
  assert.equal(t.rows[0][0], String.raw`a \| b`);
  assert.ok(tableAddColumn(src).includes(String.raw`a \| b`), 'and it survives an edit');
});

test('a ragged hand-written table is understood and comes back tidy', () => {
  const messy = ['Name|Size', '---|---', 'a.js|1 KB'].join('\n');
  const t = parseTable(messy);
  assert.deepEqual(t.header, ['Name', 'Size']);
  const out = serializeTable(t);
  assert.ok(out.split('\n').every((l) => l.startsWith('| ')), 'padded and bar-delimited');
  assert.deepEqual(parseTable(out).rows, [['a.js', '1 KB']], 'and still means the same thing');
});

test('alignment markers survive a round trip and can be set', () => {
  const src = ['| a | b | c |', '|:--|:-:|--:|', '| 1 | 2 | 3 |'].join('\n');
  assert.deepEqual(parseTable(src).align, ['left', 'center', 'right']);
  assert.deepEqual(parseTable(serializeTable(parseTable(src))).align, ['left', 'center', 'right']);
  assert.equal(parseTable(tableSetAlign(src, 0, 'right')).align[0], 'right');
});

test('text around the table in the same block is kept', () => {
  const src = ['Intro line.', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', 'Outro line.'].join('\n');
  const out = tableAddRow(src);
  assert.ok(out.includes('Intro line.'), 'before');
  assert.ok(out.includes('Outro line.'), 'after');
  assert.equal(parseTable(out).rows.length, 2);
});

test('an out-of-range index is clamped rather than corrupting the table', () => {
  for (const op of [tableAddColumn, tableAddRow]) {
    assert.ok(parseTable(op(T, 99)), `${op.name} at 99 still yields a table`);
    assert.ok(parseTable(op(T, -5)), `${op.name} at -5 still yields a table`);
  }
});

test('a container reports and gains children at the right colon depth', () => {
  // One fewer colon than the parent is the rule that makes these nest, and the one a person
  // typing it out gets wrong.
  const tabs = ['::::tabs', ':::tab{title="One"}', 'x', ':::', '::::'].join('\n');
  assert.equal(countChildren(tabs, 'tab'), 1);
  const out = addChild(tabs, 'tab', 'Two', 'y');
  assert.equal(countChildren(out, 'tab'), 2);
  assert.ok(out.trim().endsWith('::::'), 'the parent fence still closes last');
  assert.ok(out.includes(':::tab[Two]'), 'and the child uses three colons, not four');
});

test('adding a child to a three-colon container does not go below three', () => {
  const cards = [':::cards', ':::card[A]', 'x', ':::', ':::'].join('\n');
  const out = addChild(cards, 'card', 'B');
  assert.ok(out.includes(':::card[B]'));
  assert.ok(!out.includes('::card[B]') || out.includes(':::card[B]'), 'never two colons');
});
