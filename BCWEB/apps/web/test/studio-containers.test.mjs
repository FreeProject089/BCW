// Studio containers (PLAN-STUDIO-2026 2.2, tests 3.3.6, phase 7a): group, tab card, dialog.
//
// The tree rules live in the studio package (packages/studio/src/tree.js) and are read by the
// validator (validateDoc: refused at save, with the field path) and the normaliser (normalizeDoc:
// a broken chain is flagged and never drawn for a reader). Each hostile tree is asserted on
// both. Then the editor's arithmetic: board coordinates and back, a drop into and out of a
// container, group and ungroup, a tab removed; and the `modal` and `tab` steps, live now.
//
// MUTATION CHECK (by hand, studio phase 7a): with `for (const p of treeProblems(blocks))` taken
// out of validate.js, the "refused at save" tests go red (10 of 30); with `isPageRoot` accepting a flagged
// block, the "never drawn" tests go red; with the cycle branches of directProblems removed,
// "a cycle" still refuses (as too_deep, the walk is bounded) but the reason assertion goes red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDoc, normalizeDoc, serializeDoc, frameBlocks, boardBlocks, planAction, commitGeometry,
  treeProblems, annotateTree, absoluteBlocks, toStored, dropTarget, reparentBlocks, groupBlocks, ungroupBlocks,
  pullChildrenInside, reorderSiblings, removeTab, descendantIds, subtreeHeight, containerInfo, tabLabels, innerBox,
  duplicateOnBoard, CONTAINER_KINDS, MAX_DEPTH, MAX_CHILDREN, TAB_STRIP_H, BLOCK_KINDS, LIMITS,
} from '../src/lib/canvas.js';

const FR = { desktop: { w: 1200, h: 900, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'stack' } };
const page = (blocks) => ({ v: 2, id: 'p1', frames: FR, blocks });
const box = (id, kind = 'group', extra = {}) => ({ id, kind, x: 0, y: 0, w: 400, h: 400, ...extra });
const leaf = (id, parent, extra = {}) => ({ id, kind: 'text', x: 8, y: 8, w: 100, h: 40, props: { md: id }, ...(parent ? { parent } : {}), ...extra });
const why = (doc) => validateDoc(doc).map((p) => `${p.path}:${p.reason}`);
/** Refused at save with this path AND never drawn for a reader, in every layout. */
function hostile(blocks, path, reason, unseen) {
  const got = why(page(blocks));
  assert.ok(got.includes(`${path}:${reason}`), `expected ${path}:${reason}, got ${JSON.stringify(got.slice(0, 8))}`);
  const n = normalizeDoc(page(blocks));
  for (const mode of ['scale', 'stack', 'phone']) {
    const drawn = new Set(frameBlocks(n, mode).map((b) => b.id));
    for (const id of unseen) assert.ok(!drawn.has(id), `${id} is drawn (${mode})`);
  }
  for (const id of unseen) assert.ok(n.blocks.find((b) => b.id === id)?.treeError, `${id} is not flagged`);
}

describe('the vocabulary', () => {
  test('three container kinds, three levels, a hundred children', () => {
    assert.deepEqual(CONTAINER_KINDS, ['group', 'tabs', 'modal']);
    for (const k of CONTAINER_KINDS) assert.ok(BLOCK_KINDS.includes(k));
    assert.equal(MAX_DEPTH, 3);
    assert.equal(MAX_CHILDREN, 100);
  });
  test('a sound tree is accepted and survives a normalise/serialise round trip', () => {
    const doc = page([
      box('g'), leaf('a', 'g'),
      box('t', 'tabs', { x: 500, props: { tabs: ['One', 'Two'] } }), leaf('b', 't', { slot: 1 }),
      box('m', 'modal', { x: 1400, props: { title: 'Hi' } }), leaf('c', 'm'),
    ]);
    assert.deepEqual(why(doc), []);
    const out = serializeDoc(normalizeDoc(doc));
    assert.deepEqual(why(out), []);
    assert.equal(out.blocks.find((b) => b.id === 'a').parent, 'g');
    assert.equal(out.blocks.find((b) => b.id === 'b').slot, 1);
    assert.equal(out.blocks.find((b) => b.id === 'g').parent, undefined);
  });
});

describe('hostile trees (3.3.6): refused at save with the path, never drawn', () => {
  test('a cycle', () => hostile([box('c1', 'group', { parent: 'c2' }), box('c2', 'group', { parent: 'c1' }), leaf('k', 'c1')], 'blocks[0].parent', 'cycle', ['c1', 'c2', 'k']));
  test('a longer cycle', () => hostile([box('a', 'group', { parent: 'c' }), box('b', 'group', { parent: 'a' }), box('c', 'group', { parent: 'b' })], 'blocks[1].parent', 'cycle', ['a', 'b', 'c']));
  test('a self-parent', () => hostile([box('s', 'group', { parent: 's' }), leaf('k', 's')], 'blocks[0].parent', 'self_parent', ['s', 'k']));
  test('an unknown parent', () => hostile([leaf('o', 'nowhere')], 'blocks[0].parent', 'unknown_parent', ['o']));
  test('depth 4', () => hostile([box('d1'), box('d2', 'group', { parent: 'd1' }), box('d3', 'group', { parent: 'd2' }), box('d4', 'group', { parent: 'd3' }), leaf('d5', 'd4')],
    // d5 has four containers above it (d4 is the third level of containers, which is allowed).
    'blocks[4].parent', 'too_deep', ['d5']));
  test('depth 3 is allowed', () => {
    const blocks = [box('d1'), box('d2', 'group', { parent: 'd1' }), box('d3', 'group', { parent: 'd2' }), leaf('d4', 'd3')];
    assert.deepEqual(why(page(blocks)), []);
    assert.ok(!normalizeDoc(page(blocks)).blocks.some((b) => b.treeError));
  });
  test('a parent that cannot hold blocks', () => hostile([leaf('x'), leaf('k', 'x')], 'blocks[1].parent', 'not_container', ['k']));
  test('a dialog inside something', () => hostile([box('g'), box('m', 'modal', { parent: 'g' })], 'blocks[1].parent', 'modal_nested', ['m']));
  test('ten thousand children: refused by size and count, a hundred at most drawn, bounded', () => {
    const blocks = [box('fan'), ...Array.from({ length: 10_000 }, (_v, i) => leaf(`k${i}`, 'fan'))];
    const t0 = Date.now();
    const got = why(page(blocks));
    assert.ok(got.includes(':too_large') || got.includes('blocks:too_many'), got.slice(0, 3).join(' '));
    assert.ok(got.includes('blocks:too_many'));
    assert.ok(got.includes('blocks[101].parent:too_many'), 'the 101st child is refused by the per-container limit');
    const n = normalizeDoc(page(blocks));
    assert.equal(n.blocks.length, LIMITS.blocks);
    assert.equal(n.blocks.filter((b) => b.parent === 'fan' && !b.treeError).length, MAX_CHILDREN);
    assert.ok(Date.now() - t0 < 5000, 'the tree rules stay cheap on a hostile document');
  });
  test('a child entirely outside its container: refused (decision: refuse, not clamp), not mounted', () => {
    const got = why(page([box('g', 'group', { w: 300, h: 200 }), leaf('far', 'g', { x: 5000 })]));
    assert.ok(got.includes('blocks[1]:outside_parent'), JSON.stringify(got));
    // Crossing the edge is allowed (clipped, like the page frame).
    assert.deepEqual(why(page([box('g', 'group', { w: 300, h: 200 }), leaf('edge', 'g', { x: 250 })])), []);
  });
  test('bad parent and slot values', () => {
    assert.ok(why(page([leaf('a', undefined, { parent: 7 })])).includes('blocks[0].parent:bad_type'));
    assert.ok(why(page([leaf('a', undefined, { parent: 'x"]{}' })])).includes('blocks[0].parent:bad_id'));
    assert.ok(why(page([box('g'), leaf('a', 'g', { slot: 1 })])).includes('blocks[1].slot:bad_value'), 'a slot outside a tab card');
    assert.ok(why(page([box('t', 'tabs', { props: { tabs: ['A'] } }), leaf('a', 't', { slot: 3 })])).includes('blocks[1].slot:bad_value'));
    assert.ok(why(page([box('t', 'tabs', { props: { tabs: [] } })])).includes('blocks[0].props.tabs:bad_value'));
    assert.ok(why(page([box('t', 'tabs', { props: { tabs: Array(13).fill('x') } })])).includes('blocks[0].props.tabs:too_many'));
    assert.ok(why(page([box('t', 'tabs', { props: { tabs: ['x'.repeat(81)] } })])).includes('blocks[0].props.tabs[0]:too_long'));
  });
  test('treeProblems never throws on junk', () => {
    for (const junk of [null, 1, 'x', [null, 1, 'x', [], {}], [{ id: 'a', parent: {} }]]) assert.ok(Array.isArray(treeProblems(junk)));
    assert.ok(Array.isArray(annotateTree([])));
  });
  test('a broken chain is written back at the top level (the studio repairs on save)', () => {
    const out = serializeDoc(normalizeDoc(page([leaf('o', 'nowhere')])));
    assert.equal(out.blocks[0].parent, undefined);
    assert.deepEqual(why(out), []);
  });
});

describe('what a reader gets', () => {
  const doc = normalizeDoc(page([
    box('g', 'group', { x: 100, y: 100 }), leaf('a', 'g'),
    box('m', 'modal', { x: 1400 }), leaf('c', 'm'),
    leaf('top', undefined, { y: 600 }),
  ]));
  test('the page flow is the top-level blocks, never a dialog, never a child', () => {
    for (const mode of ['scale', 'stack', 'phone']) assert.deepEqual(frameBlocks(doc, mode).map((b) => b.id).sort(), ['g', 'top'], mode);
  });
  test('the frame height counts the page flow only', () => {
    assert.equal(normalizeDoc({ ...page([box('m', 'modal', { y: 5000 })]), frames: { desktop: { w: 1200, fit: 'content' }, phone: FR.phone } }).frames.desktop.h, 240);
  });
});

describe('the editor: board coordinates and back', () => {
  const blocks = normalizeDoc(page([
    box('t', 'tabs', { x: 100, y: 50, w: 600, h: 400, props: { tabs: ['A', 'B'] } }),
    box('g', 'group', { x: 10, y: 20, w: 300, h: 200, parent: 't' }),
    leaf('a', 'g', { x: 5, y: 6 }),
  ])).blocks;
  const view = absoluteBlocks(blocks);
  const by = new Map(view.map((b) => [b.id, b]));
  test('a child is drawn at its container place plus the inner offset plus its own', () => {
    assert.deepEqual([by.get('g').x, by.get('g').y], [110, 50 + TAB_STRIP_H + 20]);
    assert.deepEqual([by.get('a').x, by.get('a').y], [115, 50 + TAB_STRIP_H + 26]);
    assert.equal(by.get('a').depth, 2);
  });
  test('board geometry goes back relative to the container', () => {
    assert.deepEqual(toStored(by, 'a', { x: 200, y: 200, w: 10 }), { x: 90, y: 200 - 50 - TAB_STRIP_H - 20, w: 10 });
    assert.deepEqual(toStored(by, 't', { x: 3 }), { x: 3 });
  });
  test('boardBlocks and commitGeometry agree (an align moves a child where it is drawn)', () => {
    const c = normalizeDoc(page([box('g', 'group', { x: 100, y: 100, w: 400, h: 300 }), leaf('a', 'g', { x: 0, y: 0 }), leaf('b', 'g', { x: 200, y: 50 })]));
    const before = boardBlocks(c, 'light');
    const after = before.map((b) => (b.id === 'b' ? { ...b, y: before.find((x) => x.id === 'a').y } : b));
    const out = commitGeometry(c.blocks, before, after, 'light').blocks;
    assert.equal(out.find((b) => b.id === 'b').y, 0, 'stored relative, not the board value');
  });
  test('the drop target is the deepest container under the point that can take the block', () => {
    assert.equal(dropTarget(view, { x: 120, y: 130 }, {}), 'g');
    assert.equal(dropTarget(view, { x: 650, y: 400 }, {}), 't');
    assert.equal(dropTarget(view, { x: 5, y: 5 }, {}), '');
    assert.equal(dropTarget(view, { x: 120, y: 130 }, { extra: 2 }), 't', 'two more levels do not fit in g');
    assert.equal(dropTarget(view, { x: 120, y: 130 }, { exclude: new Set(['g']) }), 't');
    assert.equal(dropTarget(view, { x: 120, y: 130 }, { movingModal: true }), '');
  });
  test('reparent: into a container where it is drawn (pulled inside), and back onto the page', () => {
    const c = normalizeDoc(page([box('g', 'group', { x: 100, y: 100, w: 300, h: 200 }), leaf('a', undefined, { x: 150, y: 120 })]));
    const v = absoluteBlocks(c.blocks);
    const inG = reparentBlocks(c.blocks, v, ['a'], 'g');
    const a = inG.find((b) => b.id === 'a');
    assert.deepEqual([a.parent, a.x, a.y], ['g', 50, 20]);
    assert.deepEqual(validateDoc(page(inG)), []);
    const back = reparentBlocks(inG, absoluteBlocks(normalizeDoc(page(inG)).blocks), ['a'], '');
    const b = back.find((x) => x.id === 'a');
    assert.deepEqual([b.parent, b.x, b.y], [undefined, 150, 120]);
    const far = reparentBlocks(c.blocks, [...v.filter((x) => x.id !== 'a'), { ...v.find((x) => x.id === 'a'), x: 900 }], ['a'], 'g').find((x) => x.id === 'a');
    assert.equal(far.x, 300 - 100, 'a drop that would stick out is pulled inside');
    const tab = reparentBlocks(normalizeDoc(page([box('t', 'tabs', { props: { tabs: ['A', 'B'] } }), leaf('a')])).blocks,
      absoluteBlocks(normalizeDoc(page([box('t', 'tabs', { props: { tabs: ['A', 'B'] } }), leaf('a')])).blocks), ['a'], 't', 1).find((x) => x.id === 'a');
    assert.equal(tab.slot, 1);
  });
  test('group and ungroup are inverse, and keep every block where it was drawn', () => {
    const c = page([leaf('a', undefined, { x: 100, y: 100 }), leaf('b', undefined, { x: 300, y: 200 }), leaf('z', undefined, { x: 0, y: 0 })]);
    const g = groupBlocks(c.blocks, ['a', 'b'], 'grp');
    const grp = g.find((b) => b.id === 'grp');
    assert.deepEqual([grp.x, grp.y, grp.w, grp.h], [100, 100, 300, 140]);
    assert.deepEqual(g.filter((b) => b.parent === 'grp').map((b) => [b.id, b.x, b.y]), [['a', 0, 0], ['b', 200, 100]]);
    assert.deepEqual(validateDoc(page(g)), []);
    const abs = absoluteBlocks(normalizeDoc(page(g)).blocks);
    assert.deepEqual(abs.filter((b) => b.id === 'a' || b.id === 'b').map((b) => [b.x, b.y]), [[100, 100], [300, 200]]);
    const u = ungroupBlocks(g, 'grp');
    assert.deepEqual(u.filter((b) => b.id !== 'z').map((b) => [b.id, b.x, b.y, b.parent]), [['a', 100, 100, undefined], ['b', 300, 200, undefined]]);
    assert.equal(groupBlocks([box('g'), leaf('a', 'g'), leaf('b')], ['a', 'b'], 'x'), null, 'not siblings');
    assert.equal(groupBlocks([box('d1'), box('d2', 'group', { parent: 'd1' }), box('d3', 'group', { parent: 'd2' }), leaf('a', 'd3')], ['a'], 'x'), null, 'too deep');
    assert.equal(ungroupBlocks([box('t', 'tabs')], 't'), null, 'only a group ungroups');
  });
  test('a container shrunk over its blocks pulls them back in', () => {
    const out = pullChildrenInside([box('g', 'group', { w: 100, h: 100 }), leaf('a', 'g', { x: 500, y: 10 })], 'g');
    assert.deepEqual(validateDoc(page(out)), []);
  });
  test('siblings reorder among themselves only', () => {
    const list = [box('g', 'group', { z: 0 }), leaf('a', 'g', { z: 0 }), leaf('b', 'g', { z: 1 }), leaf('top', undefined, { z: 5 })];
    const out = reorderSiblings(list, 'a', 'up');
    assert.deepEqual(out.map((b) => [b.id, b.z]), [['g', 0], ['a', 1], ['b', 0], ['top', 5]]);
  });
  test('removing a tab removes its blocks and moves the later ones down', () => {
    const list = [box('t', 'tabs', { props: { tabs: ['A', 'B', 'C'] } }), leaf('a', 't'), leaf('b', 't', { slot: 1 }), leaf('c', 't', { slot: 2 })];
    const out = removeTab(list, 't', 1);
    assert.deepEqual(tabLabels(out[0].props), ['A', 'C']);
    assert.deepEqual(out.slice(1).map((b) => [b.id, b.slot]), [['a', undefined], ['c', 1]]);
  });
  test('duplicate copies a container with everything in it', () => {
    const c = normalizeDoc(page([box('g'), leaf('a', 'g'), box('h', 'group', { parent: 'g', w: 100, h: 100 }), leaf('b', 'h')]));
    let n = 0;
    const out = duplicateOnBoard(c, ['g'], 'light', () => `n${n++}`);
    assert.equal(out.blocks.length, 8);
    assert.deepEqual(validateDoc(page(serializeDoc(c, { blocks: out.blocks }).blocks)), []);
    assert.equal(descendantIds(out.blocks, out.ids[0]).length, 3);
    assert.equal(subtreeHeight(out.blocks, out.ids[0]), 2);
  });
  test('the inner area of a tab card starts under its strip', () => {
    assert.deepEqual(innerBox({ kind: 'tabs', w: 300, h: 200 }), { x: 0, y: TAB_STRIP_H, w: 300, h: 200 - TAB_STRIP_H });
  });
});

describe('the modal and tab steps (live since phase 7a)', () => {
  const blocks = [box('t', 'tabs', { props: { tabs: ['A', 'B'] } }), box('m', 'modal', { x: 1400 }), box('g', 'group', { x: 500 }), leaf('btn', undefined, { y: 500 })];
  const ctx = { blockIds: new Set(blocks.map((b) => b.id)), containers: containerInfo(blocks) };
  const withAction = (action) => page(blocks.map((b) => (b.id === 'btn' ? { ...b, action } : b)));
  test('valid: a button that opens the dialog, one that picks tab B, one that reveals the group', () => {
    for (const action of [[{ type: 'modal', target: 'm' }], [{ type: 'tab', target: 't', index: 1 }], [{ type: 'reveal', target: 'g' }], [{ type: 'copy', text: 'x' }, { type: 'modal', target: 'm' }]]) {
      assert.deepEqual(why(withAction(action)), [], JSON.stringify(action));
      assert.equal(planAction(action, ctx).kind, 'button');
    }
  });
  test('refused and inert: the wrong kind of target, a tab that does not exist, a dialog revealed', () => {
    for (const [action, path, reason] of [
      [[{ type: 'modal', target: 't' }], 'action[0].target', 'bad_target'],
      [[{ type: 'modal', target: 'nope' }], 'action[0].target', 'bad_target'],
      [[{ type: 'tab', target: 'm', index: 0 }], 'action[0].target', 'bad_target'],
      [[{ type: 'tab', target: 't', index: 2 }], 'action[0].index', 'bad_value'],
      [[{ type: 'tab', target: 't', index: '1' }], 'action[0].index', 'bad_value'],
      [[{ type: 'tab', target: 't' }], 'action[0].index', 'bad_value'],
      [[{ type: 'reveal', target: 'm' }], 'action[0].target', 'bad_target'],
      [[{ type: 'modal', target: 'm', url: 'https://x.example' }], 'action[0].url', 'unknown_field'],
    ]) {
      assert.ok(why(withAction(action)).includes(`blocks[3].${path}:${reason}`), `${JSON.stringify(action)} -> ${why(withAction(action))}`);
      assert.equal(planAction(action, ctx).kind, 'inert', JSON.stringify(action));
    }
  });
});
