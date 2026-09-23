// The OS mode's window manager (src/ui/os/wm.js): a pure reducer, tested from plain node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reduce, initialState, mountedIds, serialize, sanitise, clampRect, snapZoneAt, rectForZone,
  topId, resizeRect, MIN_W, MIN_H, TITLE_H, MAX_MOUNTED,
} from '../src/ui/os/wm.js';

const VP = { w: 1280, h: 700 };
const run = (actions, s = initialState(VP)) => actions.reduce(reduce, s);
const win = (s, id) => s.wins.find((w) => w.id === id);

test('open creates one window per section, focused and on top', () => {
  const s = run([{ type: 'open', id: 'users' }, { type: 'open', id: 'repos' }]);
  assert.equal(s.wins.length, 2);
  assert.equal(s.active, 'repos');
  assert.ok(win(s, 'repos').z > win(s, 'users').z);
  assert.equal(win(s, 'users').leaf, 'users');
});

test('opening an open section focuses it instead of duplicating it', () => {
  const s = run([{ type: 'open', id: 'users' }, { type: 'open', id: 'repos' }, { type: 'open', id: 'users' }]);
  assert.equal(s.wins.length, 2);
  assert.equal(s.active, 'users');
  assert.ok(win(s, 'users').z > win(s, 'repos').z);
});

test('opening a sub-tab switches the leaf of the section window', () => {
  const s = run([{ type: 'open', id: 'moderation' }, { type: 'open', id: 'moderation', leaf: 'reports' }]);
  assert.equal(s.wins.length, 1);
  assert.equal(win(s, 'moderation').leaf, 'reports');
});

test('opening a minimised section restores it', () => {
  const s = run([{ type: 'open', id: 'a' }, { type: 'minimize', id: 'a' }, { type: 'open', id: 'a' }]);
  assert.equal(win(s, 'a').mode, 'normal');
  assert.equal(s.active, 'a');
});

test('minimise hands focus to the next visible window', () => {
  const s = run([{ type: 'open', id: 'a' }, { type: 'open', id: 'b' }, { type: 'minimize', id: 'b' }]);
  assert.equal(win(s, 'b').mode, 'min');
  assert.equal(s.active, 'a');
  const s2 = reduce(s, { type: 'minimize', id: 'a' });
  assert.equal(s2.active, null);
});

test('close removes the window and focuses the one below', () => {
  const s = run([{ type: 'open', id: 'a' }, { type: 'open', id: 'b' }, { type: 'open', id: 'c' }, { type: 'focus', id: 'a' }, { type: 'close', id: 'a' }]);
  assert.deepEqual(s.wins.map((w) => w.id).sort(), ['b', 'c']);
  assert.equal(s.active, 'c');
});

test('z stays compact 1..n', () => {
  let s = run([{ type: 'open', id: 'a' }, { type: 'open', id: 'b' }, { type: 'open', id: 'c' }]);
  for (let i = 0; i < 20; i++) s = reduce(s, { type: 'focus', id: ['a', 'b', 'c'][i % 3] });
  assert.deepEqual(s.wins.map((w) => w.z).sort(), [1, 2, 3]);
});

test('focus on the active top window returns the same state', () => {
  const s = run([{ type: 'open', id: 'a' }]);
  assert.equal(reduce(s, { type: 'focus', id: 'a' }), s);
  assert.equal(reduce(s, { type: 'focus', id: 'nope' }), s);
  assert.equal(reduce(s, { type: 'bogus' }), s);
});

test('maximise and restore keep the previous geometry', () => {
  let s = run([{ type: 'open', id: 'a' }, { type: 'rect', id: 'a', rect: { x: 50, y: 40, w: 600, h: 400 } }]);
  s = reduce(s, { type: 'toggleMax', id: 'a' });
  assert.equal(win(s, 'a').mode, 'max');
  assert.deepEqual({ x: win(s, 'a').x, y: win(s, 'a').y, w: win(s, 'a').w, h: win(s, 'a').h }, { x: 0, y: 0, w: VP.w, h: VP.h });
  s = reduce(s, { type: 'toggleMax', id: 'a' });
  const a = win(s, 'a');
  assert.deepEqual({ x: a.x, y: a.y, w: a.w, h: a.h, mode: a.mode }, { x: 50, y: 40, w: 600, h: 400, mode: 'normal' });
});

test('snap to a half, then unsnap back', () => {
  let s = run([{ type: 'open', id: 'a' }, { type: 'rect', id: 'a', rect: { x: 100, y: 80, w: 700, h: 500 } }, { type: 'snap', id: 'a', zone: 'right' }]);
  assert.deepEqual({ x: win(s, 'a').x, w: win(s, 'a').w, snap: win(s, 'a').snap }, { x: 640, w: 640, snap: 'right' });
  s = reduce(s, { type: 'unsnap', id: 'a' });
  assert.deepEqual({ x: win(s, 'a').x, y: win(s, 'a').y, w: win(s, 'a').w }, { x: 100, y: 80, w: 700 });
  assert.equal(reduce(s, { type: 'snap', id: 'a', zone: 'diagonal' }), s);
});

test('a moved window keeps its title bar on the desktop', () => {
  const s = run([{ type: 'open', id: 'a' }, { type: 'rect', id: 'a', rect: { x: -5000, y: -300, w: 50, h: 5000 } }]);
  const a = win(s, 'a');
  assert.equal(a.w, MIN_W);
  assert.equal(a.h, VP.h);
  assert.equal(a.y, 0);
  assert.ok(a.x + a.w >= 120, 'part of the window stays reachable');
  const r = clampRect({ x: 99999, y: 99999, w: 800, h: 600 }, VP);
  assert.ok(r.x <= VP.w - 120);
  assert.ok(r.y <= VP.h - TITLE_H);
});

test('clampRect survives garbage', () => {
  const r = clampRect({ x: NaN, y: 'x', w: undefined, h: null }, VP);
  assert.deepEqual(r, { x: 0, y: 0, w: MIN_W, h: MIN_H });
});

test('taskbar click: active minimises, otherwise it comes forward', () => {
  let s = run([{ type: 'open', id: 'a' }, { type: 'open', id: 'b' }]);
  s = reduce(s, { type: 'taskbar', id: 'b' });
  assert.equal(win(s, 'b').mode, 'min');
  s = reduce(s, { type: 'taskbar', id: 'b' });
  assert.equal(win(s, 'b').mode, 'normal');
  assert.equal(s.active, 'b');
  s = reduce(s, { type: 'taskbar', id: 'a' });
  assert.equal(s.active, 'a');
});

test('cycle walks the taskbar order and wraps', () => {
  let s = run([{ type: 'open', id: 'a' }, { type: 'open', id: 'b' }, { type: 'open', id: 'c' }]);
  s = reduce(s, { type: 'cycle', dir: 1 });
  assert.equal(s.active, 'a');
  s = reduce(s, { type: 'cycle', dir: -1 });
  assert.equal(s.active, 'c');
  s = reduce(s, { type: 'minimize', id: 'b' });
  s = reduce(s, { type: 'cycle', dir: -1, order: ['a', 'b', 'c'] });
  assert.equal(s.active, 'b');
  assert.equal(win(s, 'b').mode, 'normal');
});

test('show desktop is a toggle that brings back only what it hid', () => {
  let s = run([{ type: 'open', id: 'a' }, { type: 'open', id: 'b' }, { type: 'open', id: 'c' }, { type: 'minimize', id: 'a' }]);
  s = reduce(s, { type: 'showDesktop' });
  assert.ok(s.wins.every((w) => w.mode === 'min'));
  assert.equal(s.active, null);
  s = reduce(s, { type: 'showDesktop' });
  assert.equal(win(s, 'a').mode, 'min');
  assert.equal(win(s, 'b').mode, 'normal');
  assert.equal(win(s, 'c').mode, 'normal');
});

test('a maximised window stays maximised when minimised and restored', () => {
  let s = run([{ type: 'open', id: 'a' }, { type: 'toggleMax', id: 'a' }, { type: 'minimize', id: 'a' }, { type: 'taskbar', id: 'a' }]);
  assert.equal(win(s, 'a').mode, 'max');
  s = reduce(s, { type: 'toggleMax', id: 'a' });
  assert.equal(win(s, 'a').mode, 'normal');
});

test('viewport change refits maximised, snapped and floating windows', () => {
  let s = run([{ type: 'open', id: 'a' }, { type: 'toggleMax', id: 'a' }, { type: 'open', id: 'b' }, { type: 'snap', id: 'b', zone: 'left' },
    { type: 'open', id: 'c' }, { type: 'rect', id: 'c', rect: { x: 1100, y: 600, w: 500, h: 400 } }]);
  s = reduce(s, { type: 'viewport', w: 900, h: 500 });
  assert.deepEqual([win(s, 'a').w, win(s, 'a').h], [900, 500]);
  assert.deepEqual([win(s, 'b').w, win(s, 'b').h], [450, 500]);
  assert.ok(win(s, 'c').x <= 900 - 120 && win(s, 'c').y <= 500 - TITLE_H);
  assert.equal(reduce(s, { type: 'viewport', w: 900, h: 500 }), s);
});

test('mountedIds: visible windows always, minimised ones up to the cap, newest first', () => {
  let s = initialState(VP);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (const id of ids) s = reduce(s, { type: 'open', id });
  for (const id of ids.slice(0, 7)) s = reduce(s, { type: 'minimize', id });
  // h visible; a..g minimised with g the most recently used.
  const m = mountedIds(s, MAX_MOUNTED);
  assert.equal(m.size, MAX_MOUNTED);
  assert.ok(m.has('h'));
  assert.ok(m.has('g') && m.has('c'));
  assert.ok(!m.has('a') && !m.has('b'), 'the oldest minimised are unmounted');
  // Eight visible windows: all stay mounted even past the cap.
  let v = initialState(VP);
  for (const id of ids) v = reduce(v, { type: 'open', id });
  assert.equal(mountedIds(v, MAX_MOUNTED).size, 8);
});

test('serialize → sanitise round-trips geometry, modes and focus', () => {
  let s = run([{ type: 'open', id: 'a' }, { type: 'rect', id: 'a', rect: { x: 10, y: 20, w: 500, h: 300 } },
    { type: 'open', id: 'b', leaf: 'b2' }, { type: 'toggleMax', id: 'b' }, { type: 'open', id: 'c' }, { type: 'minimize', id: 'c' }, { type: 'focus', id: 'a' }]);
  const saved = JSON.parse(JSON.stringify(serialize(s)));
  const t = reduce(initialState(VP), { type: 'hydrate', saved });
  assert.equal(t.active, 'a');
  assert.deepEqual({ x: win(t, 'a').x, y: win(t, 'a').y, w: win(t, 'a').w, h: win(t, 'a').h }, { x: 10, y: 20, w: 500, h: 300 });
  assert.equal(win(t, 'b').mode, 'max');
  assert.equal(win(t, 'b').leaf, 'b2');
  assert.equal(win(t, 'c').mode, 'min');
  assert.deepEqual(t.wins.map((w) => w.z).sort(), [1, 2, 3]);
  // Restoring b after the round-trip goes back to its free geometry, not to the full desktop.
  const u = reduce(t, { type: 'toggleMax', id: 'b' });
  assert.ok(win(u, 'b').w < VP.w);
});

test('sanitise drops malformed and hostile entries', () => {
  const wins = sanitise({ wins: [null, 5, { id: '<script>' }, { id: 'ok', leaf: '../x', mode: 'evil', x: 1e9 }, { id: 'ok' }] }, VP);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].id, 'ok');
  assert.equal(wins[0].leaf, 'ok');
  assert.equal(wins[0].mode, 'normal');
  assert.deepEqual(sanitise('garbage', VP), []);
  assert.deepEqual(sanitise({ wins: Array.from({ length: 500 }, (_, i) => ({ id: `w${i}` })) }, VP).length, 40);
});

test('snapZoneAt and rectForZone', () => {
  assert.equal(snapZoneAt(640, 2, VP), 'max');
  assert.equal(snapZoneAt(3, 300, VP), 'left');
  assert.equal(snapZoneAt(1278, 300, VP), 'right');
  assert.equal(snapZoneAt(640, 300, VP), null);
  assert.deepEqual(rectForZone('left', { w: 1001, h: 500 }), { x: 0, y: 0, w: 500, h: 500 });
  assert.deepEqual(rectForZone('right', { w: 1001, h: 500 }), { x: 500, y: 0, w: 501, h: 500 });
});

test('topId skips minimised windows', () => {
  assert.equal(topId([{ id: 'a', z: 3, mode: 'min' }, { id: 'b', z: 1, mode: 'normal' }]), 'b');
  assert.equal(topId([]), null);
});

test('reset and closeAll empty the desktop', () => {
  const s = run([{ type: 'open', id: 'a' }, { type: 'open', id: 'b' }]);
  assert.equal(reduce(s, { type: 'closeAll' }).wins.length, 0);
  const r = reduce(s, { type: 'reset' });
  assert.equal(r.wins.length, 0);
  assert.deepEqual(r.vp, s.vp);
});

test('resizeRect keeps the opposite edge, the minimum size and the desktop edges', () => {
  const start = { x: 100, y: 100, w: 600, h: 400 };
  assert.deepEqual(resizeRect(start, 'se', 50, 30, VP), { x: 100, y: 100, w: 650, h: 430 });
  assert.deepEqual(resizeRect(start, 'nw', 20, 10, VP), { x: 120, y: 110, w: 580, h: 390 });
  const tiny = resizeRect(start, 'w', 1000, 0, VP);
  assert.equal(tiny.w, MIN_W);
  assert.equal(tiny.x + tiny.w, 700, 'the right edge did not move');
  const up = resizeRect(start, 'n', 0, -500, VP);
  assert.equal(up.y, 0);
  assert.equal(up.y + up.h, 500);
  assert.equal(resizeRect(start, 'e', 5000, 0, VP).w, VP.w - 100);
});
