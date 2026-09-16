// Saved components: build one from a selection, drop copies, find and rebuild them, detach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  componentFromBlocks, instantiateComponent, detachBlocks, instancesOf, componentIdsIn,
  updateInstances, thumbnailSvg, normalizeComponents, COMPONENT_LIMITS,
} from '../src/lib/studio-components.js';
import { normalizeCanvas } from '../src/lib/canvas.js';

let n = 0;
const uid = () => `b${String(++n).padStart(4, '0')}`;
const b = (id, x, y, w = 100, h = 50, extra = {}) => ({ id, x, y, w, h, z: 0, kind: 'box', props: {}, ...extra });

test('a component is the selection with its top-left at 0,0 and no ids', () => {
  const c = componentFromBlocks(' Hero ', [b('a', 200, 100), b('c', 300, 120, 50, 20, { z: 3 })], uid);
  assert.equal(c.name, 'Hero');
  assert.equal(c.w, 150); assert.equal(c.h, 50);
  assert.deepEqual(c.blocks.map((x) => [x.x, x.y, x.z]), [[0, 0, 0], [100, 20, 3]]);
  assert.ok(c.blocks.every((x) => x.id === undefined && x.component === undefined));
  assert.equal(componentFromBlocks('x', [], uid), null, 'nothing selected is not a component');
});

test('a copy lands where asked, above the page, tagged with one instance id', () => {
  const c = componentFromBlocks('Hero', [b('a', 200, 100), b('c', 300, 120, 50, 20)], uid);
  const copy = instantiateComponent(c, { x: 40, y: 800 }, 7, uid);
  assert.deepEqual(copy.map((x) => [x.x, x.y]), [[40, 800], [140, 820]]);
  assert.ok(copy.every((x) => x.z >= 7));
  assert.ok(copy.every((x) => x.component.id === c.id));
  assert.equal(new Set(copy.map((x) => x.component.inst)).size, 1, 'one inst for the whole copy');
  assert.equal(new Set(copy.map((x) => x.id)).size, 2, 'fresh ids');
  // Clamped to the board so a wide component never lands off the right edge.
  assert.equal(instantiateComponent(c, { x: 5000, y: 0 }, 0, uid)[0].x, 1200 - c.w);
});

test('the tag survives normalisation — the allow-list names it', () => {
  const c = componentFromBlocks('Hero', [b('a', 0, 0)], uid);
  const copy = instantiateComponent(c, { x: 0, y: 0 }, 0, uid);
  const out = normalizeCanvas({ id: 'x', blocks: copy });
  assert.deepEqual(out.blocks[0].component, copy[0].component);
  assert.equal(normalizeCanvas({ id: 'x', blocks: [b('a', 0, 0)] }).blocks[0].component, null);
  assert.equal(normalizeCanvas({ id: 'x', blocks: [b('a', 0, 0, 10, 10, { component: { id: 'only-id' } })] }).blocks[0].component, null, 'half a tag is no tag');
});

test('instances are found per copy, and detach forgets only the asked ones', () => {
  const c = componentFromBlocks('Card', [b('a', 0, 0), b('c', 0, 60)], uid);
  const page = [b('bg', 0, 0, 1200, 900), ...instantiateComponent(c, { x: 0, y: 0 }, 1, uid), ...instantiateComponent(c, { x: 400, y: 0 }, 3, uid)];
  const inst = instancesOf(page, c.id);
  assert.equal(inst.size, 2);
  for (const blocks of inst.values()) assert.equal(blocks.length, 2);
  assert.deepEqual(componentIdsIn(page, [page[1].id]), [c.id]);
  assert.deepEqual(componentIdsIn(page, ['bg']), []);
  const det = detachBlocks(page, [page[1].id, page[2].id]);
  assert.equal(instancesOf(det, c.id).size, 1, 'one copy detached, the other still linked');
  assert.equal(det[0], page[0], 'untouched blocks are the same objects');
});

test('updating instances rebuilds each copy in place from the new definition', () => {
  const c = componentFromBlocks('Card', [b('a', 0, 0), b('c', 0, 60)], uid);
  const page = [b('bg', 0, 0, 1200, 900), ...instantiateComponent(c, { x: 100, y: 200 }, 1, uid), ...instantiateComponent(c, { x: 600, y: 200 }, 3, uid)];
  // The definition changes: three blocks now, a different layout.
  const c2 = { ...c, blocks: [{ ...c.blocks[0] }, { ...c.blocks[1], y: 80 }, { kind: 'text', x: 0, y: 140, w: 100, h: 40, z: 2, props: { md: 'new' } }] };
  const out = updateInstances(page, c2, uid);
  assert.equal(out[0].id, 'bg', 'the background is still first');
  const inst = instancesOf(out, c.id);
  assert.equal(inst.size, 2, 'the same two copies');
  for (const blocks of inst.values()) {
    assert.equal(blocks.length, 3, 'each copy now has the new block');
    const xs = blocks.map((x) => x.x);
    assert.ok(xs.every((x) => x === xs[0]), 'each copy kept its corner');
  }
  const corners = [...inst.values()].map((bl) => Math.min(...bl.map((x) => x.y)));
  assert.deepEqual(corners, [200, 200]);
  assert.equal(new Set(out.map((x) => x.id)).size, out.length, 'no duplicate ids');
  assert.equal(updateInstances(page, { id: 'nope', blocks: [] }, uid), page, 'no instances, nothing to do');
});

test('the thumbnail is one rect per block, scaled into the box', () => {
  const svg = thumbnailSvg([b('a', 0, 0, 1200, 300), b('c', 0, 400, 400, 200, { kind: 'text' })]);
  assert.equal((svg.match(/<rect/g) || []).length, 2);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(!/<script|on\w+=/i.test(svg));
  assert.ok(/var\(--muted\)/.test(svg), 'text blocks are told apart by colour');
  assert.equal((thumbnailSvg([]).match(/<rect/g) || []).length, 0);
});

test('normalising a stored list drops what cannot be drawn and caps the count', () => {
  const good = componentFromBlocks('ok', [b('a', 0, 0)], uid);
  const list = normalizeComponents([good, { id: 'empty', name: 'x', blocks: [] }, null, { name: 'no id', blocks: [b('a', 0, 0)] }, { ...good }]);
  assert.equal(list.length, 1, 'empty, null, id-less and duplicate ids are gone');
  assert.equal(list[0].w, 100);
  const many = Array.from({ length: COMPONENT_LIMITS.count + 10 }, (_, i) => ({ ...good, id: `c${i}` }));
  assert.equal(normalizeComponents(many).length, COMPONENT_LIMITS.count);
});
