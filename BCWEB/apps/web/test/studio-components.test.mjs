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
  // CHANGED in studio phase 3 (PLAN-STUDIO-2026): this asserted the v1 clamp that pulled a
  // copy back inside the 1200px page (x = 1200 - w). On the v2 board a copy lands where it is
  // asked, off the page included; only the ±20 000 guard rail still holds it.
  assert.equal(instantiateComponent(c, { x: 5000, y: -300 }, 0, uid)[0].x, 5000);
  assert.equal(instantiateComponent(c, { x: 5000, y: -300 }, 0, uid)[0].y, -300);
  assert.equal(instantiateComponent(c, { x: 1e9, y: 0 }, 0, uid)[0].x, 20000 - c.w, 'the guard rail, not the page');
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

// ── Preset libraries (studio phase 6) ───────────────────────────────────────────────────
// Every preset is a stored StudioDoc, so what the gallery shows, what the API validates and what
// a page made from it holds are one document. Each is checked by the package's validateDoc, the
// function the API refuses a hostile preset with.
test('presets: every coded preset is a valid stored document, and a page made from it too', async () => {
  const lib = await import('../src/lib/studio-components.js');
  const { validateDoc } = await import('../src/lib/canvas.js');
  const coded = lib.codedPresets();
  assert.ok(coded.filter((e) => e.sort === 'page').length >= 7, 'the seven coded page presets');
  assert.ok(coded.some((e) => e.sort === 'background'));
  for (const e of coded) {
    assert.equal(e.scope, 'coded');
    assert.deepEqual(validateDoc(e.doc), [], `${e.id}: ${JSON.stringify(validateDoc(e.doc))}`);
  }
  const hero = coded.find((e) => e.coded === 'hero');
  const pg = lib.pageFromPreset(hero, 'cnew1', 'Welcome');
  assert.equal(pg.id, 'cnew1');
  assert.equal(pg.title, 'Welcome');
  assert.ok(pg.blocks.length >= 5);
  assert.deepEqual(validateDoc(pg), []);
  // Built afresh each time: two pages from one coded preset share no block id.
  const again = lib.pageFromPreset(hero, 'cnew2', '');
  assert.ok(!again.blocks.some((x) => pg.blocks.some((y) => y.id === x.id)));
});

test('presets: saving a section, a component, a background and a page', async () => {
  const lib = await import('../src/lib/studio-components.js');
  const { validateDoc } = await import('../src/lib/canvas.js');
  let k = 0;
  const pid = () => `pr${++k}`;
  const sel = [b('a', 200, 100), b('c', 320, 180, 80, 40, { component: { id: 'cmpX', inst: 'i1' } })];
  const sec = lib.presetEntry({ name: ' Hero ', sort: 'section', blocks: sel }, pid);
  assert.equal(sec.name, 'Hero');
  assert.deepEqual(sec.doc.blocks.map((x) => [x.x, x.y]), [[0, 0], [120, 80]], 'the group starts at 0,0');
  assert.ok(!sec.doc.blocks.some((x) => x.component), 'a preset does not carry another component link');
  assert.deepEqual(validateDoc(sec.doc), []);
  const bg = lib.presetEntry({ name: 'Night', sort: 'background', background: { type: 'color', color: '#101010' } }, pid);
  assert.equal(bg.doc.background.color, '#101010');
  assert.equal(bg.doc.blocks.length, 0);
  const page = lib.presetEntry({ name: 'Whole', sort: 'page', canvas: { id: 'p9', title: 'T', blocks: sel } }, pid);
  assert.equal(page.doc.blocks.length, 2);
  assert.equal(lib.presetEntry({ name: '', sort: 'page', canvas: {} }, pid), null, 'no name, no preset');
  assert.equal(lib.presetEntry({ name: 'x', sort: 'section', blocks: [] }, pid), null, 'nothing selected, no section');
  assert.equal(lib.presetEntry({ name: 'x', sort: 'macro' }, pid), null);
  // Dropped on a page: fresh ids, at the place asked, above what is there; a component is linked.
  const dropped = lib.blocksFromPreset(sec, { x: 64, y: 400 }, 10, uid);
  assert.deepEqual(dropped.map((x) => [x.x, x.y, x.z >= 10]), [[64, 400, true], [184, 480, true]]);
  assert.ok(dropped.every((x) => !['a', 'c', 'b0', 'b1'].includes(x.id)));
  const comp = lib.blocksFromPreset({ ...sec, sort: 'component' }, { x: 0, y: 0 }, 0, uid);
  assert.ok(comp.every((x) => x.component?.id === sec.id && x.component.inst === comp[0].component.inst));
});

// studiofix: a section preset that holds a container. Its blocks get fresh ids when dropped, so
// every reference to one of them (a child's `parent`, a step's target) must follow, or the child
// hangs from a container that is not on the page (or, worse, from another block that happens to
// carry the preset's old id). Born red: blocksFromPreset rewrote `id` and nothing else.
test('presets: a dropped section keeps its containers, its tabs and its step targets', async () => {
  const lib = await import('../src/lib/studio-components.js');
  const sec = {
    id: 'prS', sort: 'section', doc: { v: 2, blocks: [
      { id: 'b0', kind: 'group', x: 0, y: 0, w: 400, h: 300, z: 0, props: {} },
      { id: 'b1', kind: 'text', x: 16, y: 16, w: 200, h: 40, z: 1, parent: 'b0', props: { md: 'in' } },
      { id: 'b2', kind: 'tabs', x: 0, y: 320, w: 400, h: 200, z: 2, props: { tabs: ['A', 'B'] } },
      { id: 'b3', kind: 'text', x: 8, y: 8, w: 100, h: 40, z: 3, parent: 'b2', slot: 1, props: { md: 'tab B' } },
      { id: 'b4', kind: 'button', x: 420, y: 0, w: 120, h: 40, z: 4, props: { label: 'Go' },
        action: [{ type: 'tab', target: 'b2', index: 1 }, { type: 'scroll', target: '#top' }, { type: 'reveal', target: 'b0', mode: 'toggle' }] },
    ] },
  };
  let k = 0;
  const out = lib.blocksFromPreset(sec, { x: 100, y: 1000 }, 50, () => `nw${k++}`);
  const byOld = (i) => out[i];
  assert.equal(new Set(out.map((x) => x.id)).size, 5, 'fresh, distinct ids');
  assert.equal(byOld(1).parent, byOld(0).id, 'the child is not inside the copy of its group');
  assert.equal(byOld(3).parent, byOld(2).id, 'the tab child is not inside the copy of its tab card');
  assert.equal(byOld(3).slot, 1, 'the child lost its tab');
  assert.deepEqual(byOld(4).action.map((s) => s.target), [byOld(2).id, '#top', byOld(0).id], 'a step still names the preset\'s block');
  // Placement: the tops move to `at`, a child keeps its place relative to its container.
  assert.deepEqual([byOld(0).x, byOld(0).y], [100, 1000]);
  assert.deepEqual([byOld(1).x, byOld(1).y, byOld(1).z], [16, 16, 1], 'a child was moved as if it were on the page');
  assert.ok(byOld(0).z >= 50 && byOld(4).z >= 50, 'the tops are not above the page');
  // Nothing left pointing at a preset id that is not one of the copies.
  const ids = new Set(out.map((x) => x.id));
  for (const x of out) if (x.parent) assert.ok(ids.has(x.parent), `${x.id} hangs from ${x.parent}`);
});

test('presets: a library read back keeps its scope, and drops what it cannot show', async () => {
  const lib = await import('../src/lib/studio-components.js');
  const list = lib.normalizeLibrary([
    { id: 'a', name: 'A', sort: 'page', doc: { blocks: [] } },
    { id: 'a', name: 'dup', sort: 'page', doc: { blocks: [] } },
    { id: 'b', name: 'B', sort: 'macro', doc: {} },
    { id: 'c', name: 'C', sort: 'background' },
    null,
  ], 'site');
  assert.deepEqual(list.map((e) => [e.id, e.scope]), [['a', 'site']]);
  assert.deepEqual(Object.keys(lib.storedEntry({ ...list[0], coded: 'x' })).sort(), ['doc', 'id', 'name', 'sort'], 'the gallery scope is never written back');
  assert.equal(lib.libraryPath('site', 'x'), '/admin/studio/library/site/site');
  assert.equal(lib.libraryPath('project', 'bmm'), '/admin/studio/library/project/bmm');
  assert.equal(lib.libraryPath('showcase', 'id 1'), '/admin/studio/library/showcase/id%201');
});
