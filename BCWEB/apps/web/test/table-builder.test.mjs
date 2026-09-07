// The table the editor inserts.
//
// A markdown table has three things that must stay in step — the header row, the separator row
// and every body row — and getting any of them wrong does not produce an error. It produces a
// paragraph full of pipes, which reads as the editor being broken rather than as a malformed
// table. The builder exists so nobody has to keep them in step by hand; these cases are what
// stop the builder itself drifting out of step.
//
// The last test is the one that matters most: whatever the builder emits, the structural editor
// has to be able to read it back. A table you can create and not edit is worse than no builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTable } from '../src/lib/table-md.js';
import { parseTable, tableAddColumn, tableAddRow } from '../../../packages/bmd/src/editor-blocks.js';

const lines = (md) => md.trim().split('\n');

test('the shape asked for is the shape emitted', () => {
  const t = parseTable(buildTable({ cols: 4, rows: 3 }));
  assert.equal(t.header.length, 4);
  assert.equal(t.rows.length, 3);
  for (const r of t.rows) assert.equal(r.length, 4, 'every row is as wide as the header');
});

test('there is always a separator row, because without it it is not a table', () => {
  const l = lines(buildTable({ cols: 2, rows: 1 }));
  // Dashes, colons, spaces and the column bars — and nothing else. A separator carrying a
  // stray word is the exact shape that stops being a table.
  assert.match(l[1], /^\|[\s:|-]+\|$/, `second line must be the separator, got ${l[1]}`);
  assert.equal(l.length, 3, 'header + separator + one row');
});

test('a header-less table still has its header ROW — the syntax requires one', () => {
  // "No header" means unnamed columns, not a missing row: dropping the row shifts the
  // separator up and the first body row becomes the header.
  const t = parseTable(buildTable({ cols: 3, rows: 2, header: false }));
  assert.ok(t, 'still parses as a table');
  assert.equal(t.header.length, 3);
  assert.equal(t.rows.length, 2, 'and no body row was eaten by the header');
});

test('alignment lands in the separator, where the renderer reads it', () => {
  for (const [align, want] of [['left', 'left'], ['center', 'center'], ['right', 'right']]) {
    const t = parseTable(buildTable({ cols: 2, rows: 1, align }));
    assert.deepEqual(t.align, [want, want], align);
  }
  // "Default" must not write a marker — `---` and `:---` are different documents.
  assert.ok(!/:/.test(lines(buildTable({ cols: 2, rows: 1, align: 'none' }))[1]));
});

test('zero rows is a legitimate table, not a broken one', () => {
  const t = parseTable(buildTable({ cols: 3, rows: 0 }));
  assert.ok(t);
  assert.equal(t.rows.length, 0);
  assert.equal(t.header.length, 3);
});

test('the sizes are clamped rather than trusted', () => {
  assert.equal(parseTable(buildTable({ cols: 999, rows: 999 })).header.length, 8);
  assert.equal(parseTable(buildTable({ cols: 999, rows: 999 })).rows.length, 10);
  assert.equal(parseTable(buildTable({ cols: 0, rows: -4 })).header.length, 1, 'a table has at least one column');
  assert.ok(parseTable(buildTable({ cols: NaN, rows: NaN })), 'nonsense still yields a table');
});

test('it is padded so the source is readable, and blank-line separated so it is its own block', () => {
  const md = buildTable({ cols: 2, rows: 1 });
  assert.ok(md.startsWith('\n') && md.endsWith('\n'), 'a table glued to the paragraph above it is not a table');
  for (const l of lines(md)) assert.ok(l.startsWith('| ') && l.endsWith(' |'), l);
});

test('what the builder emits, the structural editor can edit', () => {
  // The two halves have to agree: this is the contract that makes "insert a 3×2 then add a
  // column" work. If the builder ever emits a shape parseTable cannot read, the table becomes
  // uneditable the moment it is created — and nothing else would say so.
  for (const opts of [
    { cols: 1, rows: 0 }, { cols: 2, rows: 2 }, { cols: 8, rows: 10 },
    { cols: 3, rows: 1, header: false }, { cols: 3, rows: 2, align: 'center' },
    { cols: 4, rows: 2, filled: false },
  ]) {
    const md = buildTable(opts);
    const t = parseTable(md);
    assert.ok(t, `parseTable refused ${JSON.stringify(opts)}`);
    const wider = parseTable(tableAddColumn(md));
    assert.equal(wider.header.length, t.header.length + 1, `add column on ${JSON.stringify(opts)}`);
    for (const r of wider.rows) assert.equal(r.length, t.header.length + 1, 'and every row widened with it');
    const taller = parseTable(tableAddRow(md));
    assert.equal(taller.rows.length, t.rows.length + 1, `add row on ${JSON.stringify(opts)}`);
  }
});
