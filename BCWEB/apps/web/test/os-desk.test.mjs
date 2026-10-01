// The OS mode's desktop (src/ui/os/desk.js), its calendar (calendar.js) and what wm.js keeps of
// them (agent-bcw-os): icons on a grid, selection, the rubber band, folders, taskbar groups,
// snap layouts, the month grid and its keyboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gridDims, cellAt, cellPx, placeIcons, moveIcons, dropIcons, sanitisePos, selectClick, bandRect, idsInBand,
  uniqueName, folderOp, emptyIcons, sanitiseIcons, inFolders, folderOf, groupOp, groupOf, sanitiseGroups, newId,
  cleanName, CELLS, GRID_PAD, MAX_FOLDERS,
} from '../src/ui/os/desk.js';
import { calendarCells, shiftMonth, stepDay, sameDay } from '../src/ui/os/calendar.js';
import { reduce, initialState, serialize, SNAP_LAYOUTS, availableLayouts, assistZones, rectForFrac } from '../src/ui/os/wm.js';

const cell = CELLS.md;
const dims = { cols: 4, rows: 3 };
const at = (m, id) => m.get(id);

// ── Grid ────────────────────────────────────────────────────────────────────────

test('the grid: how many cells fit, and which one is under a point', () => {
  assert.deepEqual(gridDims({ w: GRID_PAD * 2 + cell.w * 5, h: GRID_PAD * 2 + cell.h * 3 }, cell), { cols: 5, rows: 3 });
  assert.deepEqual(gridDims({ w: 10, h: 10 }, cell), { cols: 1, rows: 1 }, 'never a zero grid');
  assert.deepEqual(cellAt(GRID_PAD + cell.w * 2 + 5, GRID_PAD + cell.h + 1, cell, dims), { c: 2, r: 1 });
  assert.deepEqual(cellAt(-50, 99999, cell, dims), { c: 0, r: 2 }, 'clamped to the grid');
  assert.deepEqual(cellPx({ c: 1, r: 2 }, cell), { x: GRID_PAD + cell.w, y: GRID_PAD + cell.h * 2 });
});

test('placeIcons keeps saved cells and fills the rest column by column', () => {
  const m = placeIcons(['a', 'b', 'c', 'd'], { c: { c: 3, r: 2 }, b: { c: 0, r: 0 } }, dims);
  assert.deepEqual(at(m, 'b'), { c: 0, r: 0 });
  assert.deepEqual(at(m, 'c'), { c: 3, r: 2 });
  assert.deepEqual(at(m, 'a'), { c: 0, r: 1 }, 'first free cell, top to bottom first');
  assert.deepEqual(at(m, 'd'), { c: 0, r: 2 });
});

test('placeIcons: two icons saved on one cell, and a cell off the grid, are placed again', () => {
  const m = placeIcons(['a', 'b', 'c'], { a: { c: 1, r: 1 }, b: { c: 1, r: 1 }, c: { c: 9, r: 9 } }, dims);
  assert.deepEqual(at(m, 'a'), { c: 1, r: 1 });
  assert.notDeepEqual(at(m, 'b'), { c: 1, r: 1 });
  assert.ok(at(m, 'c').c < dims.cols && at(m, 'c').r < dims.rows);
  const keys = new Set([...m.values()].map((p) => `${p.c},${p.r}`));
  assert.equal(keys.size, 3, 'one icon per cell');
});

test('a full grid never loses an icon: the extras go below it', () => {
  const ids = Array.from({ length: 14 }, (_, i) => `t${i}`);
  const m = placeIcons(ids, {}, dims);
  assert.equal(m.size, 14);
  assert.equal(new Set([...m.values()].map((p) => `${p.c},${p.r}`)).size, 14);
});

test('moving a selection keeps its shape and snaps onto free cells', () => {
  const placed = placeIcons(['a', 'b', 'c'], { a: { c: 0, r: 0 }, b: { c: 0, r: 1 }, c: { c: 2, r: 0 } }, dims);
  const pos = moveIcons(placed, ['a', 'b'], 1, 1, dims);
  assert.deepEqual(pos.a, { c: 1, r: 1 });
  assert.deepEqual(pos.b, { c: 1, r: 2 });
  assert.deepEqual(pos.c, { c: 2, r: 0 }, 'the others stay put');
});

test('an icon dropped on another one takes the nearest free cell', () => {
  const placed = placeIcons(['a', 'b'], { a: { c: 0, r: 0 }, b: { c: 2, r: 1 } }, dims);
  const pos = dropIcons(placed, ['a'], 'a', { c: 2, r: 1 }, dims);
  assert.deepEqual(pos.b, { c: 2, r: 1 });
  assert.notDeepEqual(pos.a, { c: 2, r: 1 });
  assert.equal(Math.abs(pos.a.c - 2) + Math.abs(pos.a.r - 1), 1, 'right next to it');
});

test('dropped past the edge: clamped onto the grid', () => {
  const placed = placeIcons(['a'], { a: { c: 0, r: 0 } }, dims);
  assert.deepEqual(dropIcons(placed, ['a'], 'a', { c: 3, r: 2 }, dims).a, { c: 3, r: 2 });
  assert.deepEqual(moveIcons(placed, ['a'], 10, 10, dims).a, { c: 3, r: 2 });
});

test('saved cells from storage are checked', () => {
  assert.deepEqual(sanitisePos({ a: { c: 1, r: 2 }, 'bad id!': { c: 0, r: 0 }, b: { c: -1, r: 0 }, c: 'x', d: { c: 1.6, r: 0 } }), { a: { c: 1, r: 2 }, d: { c: 2, r: 0 } });
  assert.deepEqual(sanitisePos(null), {});
  assert.deepEqual(sanitisePos([1, 2]), {});
});

// ── Selection ───────────────────────────────────────────────────────────────────

test('selection: click, Ctrl+click, Shift+click', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  let r = selectClick([], 'b', order);
  assert.deepEqual(r, { sel: ['b'], anchor: 'b' });
  r = selectClick(r.sel, 'd', order, { ctrl: true });
  assert.deepEqual(r.sel, ['b', 'd']);
  r = selectClick(r.sel, 'b', order, { ctrl: true });
  assert.deepEqual(r.sel, ['d'], 'Ctrl toggles out');
  r = selectClick(['b'], 'e', order, { shift: true, anchor: 'b' });
  assert.deepEqual(r.sel, ['b', 'c', 'd', 'e']);
  r = selectClick(['a'], 'd', order, { shift: true, ctrl: true, anchor: 'c' });
  assert.deepEqual(r.sel, ['a', 'c', 'd'], 'Ctrl+Shift adds the range');
  assert.deepEqual(selectClick(['a'], 'c', order, { shift: true }).sel, ['c'], 'Shift without an anchor is a click');
});

test('the rubber band takes every icon it touches, whichever way it is drawn', () => {
  const boxes = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 20, y: 0, w: 10, h: 10 }, { id: 'c', x: 0, y: 40, w: 10, h: 10 }];
  assert.deepEqual(bandRect(25, 15, 5, 5), { x: 5, y: 5, w: 20, h: 10 });
  assert.deepEqual(idsInBand(boxes, bandRect(25, 15, 5, 5)), ['a', 'b']);
  assert.deepEqual(idsInBand(boxes, bandRect(11, 11, 19, 39)), [], 'the gaps select nothing');
});

// ── Folders ─────────────────────────────────────────────────────────────────────

test('names: unique, trimmed, capped, no control characters', () => {
  assert.equal(uniqueName('New folder', ['new folder', 'New folder 2']), 'New folder 3');
  assert.equal(uniqueName('Work', []), 'Work');
  assert.equal(cleanName('  a\u0000b\n  c  '), 'a b c');
  assert.equal(cleanName('x'.repeat(80)).length, 40);
});

test('a folder: created with screens, which leave the desktop grid', () => {
  let icons = { pos: { users: { c: 0, r: 0 }, repos: { c: 0, r: 1 } }, folders: [] };
  icons = folderOp(icons, { op: 'new', id: 'fold.1', name: 'Work', items: ['users', 'repos', 'fold.x', 'grp.y'], at: { c: 2, r: 0 } });
  assert.deepEqual(icons.folders, [{ id: 'fold.1', name: 'Work', items: ['users', 'repos'] }], 'a folder holds screens, never a folder or a group');
  assert.deepEqual(icons.pos, { 'fold.1': { c: 2, r: 0 } });
  assert.deepEqual([...inFolders(icons)], ['users', 'repos']);
  assert.equal(folderOf(icons, 'users').id, 'fold.1');
});

test('a screen is in one folder at most: adding it to another moves it', () => {
  let icons = folderOp(emptyIcons(), { op: 'new', id: 'fold.a', name: 'A', items: ['x', 'y'] });
  icons = folderOp(icons, { op: 'new', id: 'fold.b', name: 'B' });
  icons = folderOp(icons, { op: 'add', id: 'fold.b', items: ['y', 'z'] });
  assert.deepEqual(icons.folders.map((f) => f.items), [['x'], ['y', 'z']]);
  assert.equal(folderOp(icons, { op: 'add', id: 'fold.b', items: ['y'] }), icons, 'nothing new: the same object');
  assert.equal(folderOp(icons, { op: 'add', id: 'fold.nope', items: ['q'] }), icons);
});

test('out of a folder, rename, delete: screens are never lost', () => {
  let icons = folderOp(emptyIcons(), { op: 'new', id: 'fold.a', name: 'A', items: ['x', 'y'] });
  icons = folderOp(icons, { op: 'remove', id: 'fold.a', items: ['x'], pos: { x: { c: 3, r: 1 } } });
  assert.deepEqual(icons.folders[0].items, ['y']);
  assert.deepEqual(icons.pos.x, { c: 3, r: 1 }, 'lands where it was dropped');
  icons = folderOp(icons, { op: 'rename', id: 'fold.a', name: '  Admin   tools ' });
  assert.equal(icons.folders[0].name, 'Admin tools');
  assert.equal(folderOp(icons, { op: 'rename', id: 'fold.a', name: '   ' }), icons, 'an empty name is refused');
  icons = folderOp(icons, { op: 'delete', id: 'fold.a' });
  assert.deepEqual(icons.folders, []);
  assert.equal(inFolders(icons).has('y'), false, 'y is back on the desktop');
});

test('folders are capped and their ids checked', () => {
  let icons = emptyIcons();
  for (let i = 0; i < MAX_FOLDERS + 3; i++) icons = folderOp(icons, { op: 'new', id: `fold.${i}`, name: 'F' });
  assert.equal(icons.folders.length, MAX_FOLDERS);
  assert.equal(new Set(icons.folders.map((f) => f.name)).size, MAX_FOLDERS, 'every name unique');
  assert.equal(folderOp(emptyIcons(), { op: 'new', id: 'users', name: 'F' }).folders.length, 0, 'a folder id has the fold. prefix');
});

test('folders from storage: bad ids dropped, a screen kept in its first folder only', () => {
  const icons = sanitiseIcons({
    pos: { a: { c: 0, r: 0 } },
    folders: [{ id: 'fold.1', name: 'One', items: ['a', 'b', 'b'] }, { id: 'fold.2', name: '', items: ['b', 'c'] }, { id: 'evil', items: ['d'] }, { id: 'fold.1', items: ['e'] }, null],
  });
  assert.deepEqual(icons.folders, [{ id: 'fold.1', name: 'One', items: ['a', 'b'] }, { id: 'fold.2', name: 'Folder', items: ['c'] }]);
  assert.deepEqual(sanitiseIcons('garbage'), emptyIcons());
});

// ── Taskbar groups ──────────────────────────────────────────────────────────────

test('groups: new, add (moves between groups), remove, rename, reorder, ungroup', () => {
  let g = groupOp([], { op: 'new', id: 'grp.1', name: 'Mod', items: ['reports', 'queue'] });
  g = groupOp(g, { op: 'new', id: 'grp.2', name: 'Mod', items: ['users'] });
  assert.deepEqual(g.map((x) => x.name), ['Mod', 'Mod 2']);
  g = groupOp(g, { op: 'add', id: 'grp.2', items: ['queue'] });
  assert.deepEqual(g.map((x) => x.items), [['reports'], ['users', 'queue']]);
  assert.equal(groupOf(g, 'queue').id, 'grp.2');
  g = groupOp(g, { op: 'move', id: 'grp.2', dir: -1 });
  assert.deepEqual(g.map((x) => x.id), ['grp.2', 'grp.1']);
  g = groupOp(g, { op: 'rename', id: 'grp.1', name: 'Reports' });
  assert.equal(g[1].name, 'Reports');
  g = groupOp(g, { op: 'remove', id: 'grp.1', items: ['reports'] });
  assert.deepEqual(g.map((x) => x.id), ['grp.2'], 'a group left empty goes');
  g = groupOp(g, { op: 'delete', id: 'grp.2' });
  assert.deepEqual(g, []);
});

test('a group moved away from its last screen disappears; an empty new group is refused', () => {
  let g = groupOp([], { op: 'new', id: 'grp.1', name: 'A', items: ['x'] });
  g = groupOp(g, { op: 'new', id: 'grp.2', name: 'B', items: ['x'] });
  assert.deepEqual(g.map((x) => x.id), ['grp.2']);
  assert.equal(groupOp(g, { op: 'new', id: 'grp.3', name: 'C', items: [] }), g);
  assert.equal(groupOp(g, { op: 'new', id: 'nope', name: 'C', items: ['y'] }), g, 'a group id has the grp. prefix');
  assert.deepEqual(sanitiseGroups([{ id: 'grp.1', name: 'A', items: ['x'] }, { id: 'grp.2', items: ['x'] }, { id: 'bad', items: ['y'] }]), [{ id: 'grp.1', name: 'A', items: ['x'] }]);
});

test('newId never repeats one it was given', () => {
  const a = newId('fold.', [], 1000);
  assert.equal(a, `fold.${(1000).toString(36)}`);
  assert.notEqual(newId('fold.', [a], 1000), a);
});

// ── What the window manager keeps ───────────────────────────────────────────────

test('the layout keeps icons, folders and groups, and a deleted folder closes its window', () => {
  let s = initialState({ w: 1280, h: 700 });
  s = reduce(s, { type: 'folder', op: 'new', id: 'fold.1', name: 'Work', items: ['users'] });
  s = reduce(s, { type: 'iconsPos', pos: { repos: { c: 2, r: 1 }, 'fold.1': { c: 0, r: 0 } } });
  s = reduce(s, { type: 'group', op: 'new', id: 'grp.1', name: 'Mod', items: ['reports'] });
  s = reduce(s, { type: 'open', id: 'fold.1' });
  const back = reduce(initialState({ w: 1280, h: 700 }), { type: 'hydrate', saved: JSON.parse(JSON.stringify(serialize(s))) });
  assert.deepEqual(back.icons, s.icons);
  assert.deepEqual(back.groups, s.groups);
  const gone = reduce(s, { type: 'folder', op: 'delete', id: 'fold.1' });
  assert.equal(gone.wins.some((w) => w.id === 'fold.1'), false);
  assert.equal(gone.active, null);
  assert.equal(reduce(s, { type: 'group', op: 'delete', id: 'grp.nope' }), s, 'nothing changed: the same state');
});

test('snap layouts: every one tiles the desktop, with the uneven splits both ways', () => {
  const ids = SNAP_LAYOUTS.map((l) => l.id);
  for (const id of ['halves', 'two-thirds', 'one-third', 'thirds', 'main-stack', 'stack-main', 'quarters']) assert.ok(ids.includes(id), id);
  for (const l of SNAP_LAYOUTS) {
    const rects = l.zones.map((z) => rectForFrac(z, { w: 1366, h: 713 }));
    assert.equal(rects.reduce((a, r) => a + r.w * r.h, 0), 1366 * 713, `${l.id}: no gap`);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]; const b = rects[j];
        assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${l.id}: zones ${i} and ${j} overlap`);
      }
    }
  }
  assert.ok(availableLayouts({ w: 900, h: 600 }).every((l) => l.zones.every((z) => z.w * 900 >= 300)));
});

test('snap assist follows the layout the zone was picked from', () => {
  const left = { x: 0, y: 0, w: 1 / 3, h: 1 };
  assert.deepEqual(assistZones(left, 'one-third'), [{ x: 1 / 3, y: 0, w: 2 / 3, h: 1 }]);
  assert.equal(assistZones(left, 'thirds').length, 2);
  assert.equal(assistZones({ x: 0, y: 0, w: 0.5, h: 0.5 }, 'stack-main').length, 2);
  assert.equal(assistZones({ x: 0, y: 0, w: 0.5, h: 0.5 }, 'quarters').length, 3);
});

// ── The tray calendar ───────────────────────────────────────────────────────────

test('the month grid: 42 cells, Monday first, edges from the next and previous months', () => {
  const sept = calendarCells(2026, 8); // September 2026 starts on a Tuesday
  assert.equal(sept.length, 42);
  assert.deepEqual(sept[0], { y: 2026, m: 7, d: 31, out: true });
  assert.deepEqual(sept[1], { y: 2026, m: 8, d: 1, out: false });
  assert.equal(sept.filter((c) => !c.out).length, 30);
  assert.deepEqual(sept[41], { y: 2026, m: 9, d: 11, out: true });
  const feb = calendarCells(2027, 1); // February 2027 starts on a Monday
  assert.deepEqual(feb[0], { y: 2027, m: 1, d: 1, out: false });
  for (let i = 0; i < 42; i += 7) assert.equal(new Date(feb[i].y, feb[i].m, feb[i].d).getDay(), 1, 'every row starts on a Monday');
});

test('the calendar keyboard: days, weeks, week ends, months, years', () => {
  const d = { y: 2026, m: 8, d: 30 }; // Wednesday 30 Sept 2026
  assert.deepEqual(stepDay(d, 'ArrowRight'), { y: 2026, m: 9, d: 1 });
  assert.deepEqual(stepDay(d, 'ArrowLeft'), { y: 2026, m: 8, d: 29 });
  assert.deepEqual(stepDay(d, 'ArrowDown'), { y: 2026, m: 9, d: 7 });
  assert.deepEqual(stepDay(d, 'ArrowUp'), { y: 2026, m: 8, d: 23 });
  assert.deepEqual(stepDay(d, 'Home'), { y: 2026, m: 8, d: 28 }, 'Monday of that week');
  assert.deepEqual(stepDay(d, 'End'), { y: 2026, m: 9, d: 4 }, 'Sunday of that week');
  assert.deepEqual(stepDay({ y: 2026, m: 0, d: 31 }, 'PageDown'), { y: 2026, m: 1, d: 28 }, 'kept inside the shorter month');
  assert.deepEqual(stepDay(d, 'PageUp', true), { y: 2025, m: 8, d: 30 });
  assert.equal(stepDay(d, 'Enter'), null);
  assert.deepEqual(shiftMonth({ y: 2026, m: 11 }, 1), { y: 2027, m: 0 });
  assert.deepEqual(shiftMonth({ y: 2026, m: 0 }, -1), { y: 2025, m: 11 });
  assert.ok(sameDay({ y: 1, m: 2, d: 3 }, { y: 1, m: 2, d: 3 }) && !sameDay({ y: 1, m: 2, d: 3 }, null));
});
