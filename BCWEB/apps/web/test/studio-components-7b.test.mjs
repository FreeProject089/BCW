// Studio phase 7b (PLAN-STUDIO-2026 2.6): linked copies of components, their overrides, and
// "update the copies". The arithmetic the studio and the renderer share, in the package
// (packages/studio/src/components.js), read through lib/canvas.js like the app reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDoc, serializeDoc, expandInstances, expandInstance, updateCopies, setOverride, detachInstance,
  definitionFromBlocks, replaceWithInstance, snapshotOf, snapshotDiffers, divergence, validateDoc,
  frameBlocks, MAX_INSTANCE_DEPTH,
} from '../src/lib/canvas.js';
import { componentFromBlocks, instantiateComponent, instanceFromEntry, presetEntry } from '../src/lib/studio-components.js';
import { componentPath, parseComponentParams, componentBack } from '../src/lib/studio-page.js';

let n = 0;
const uid = () => `u${String(++n).padStart(4, '0')}`;
const F = { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } };
const txt = (id, md, extra = {}) => ({ id, kind: 'text', x: 0, y: 0, w: 300, h: 80, props: { md }, ...extra });
const CARD = {
  name: 'Card', scope: 'project', ref: 'bmm',
  doc: { v: 2, frames: F, blocks: [txt('title', 'Title'), txt('body', 'Body', { y: 100 })] },
  exposed: [{ key: 'title', block: 'title', field: 'props.md' }],
};
const inst = (id, x, overrides) => ({ id, kind: 'instance', x, y: 40, w: 8, h: 8, z: 1, component: overrides ? { id: 'card', overrides } : { id: 'card' } });
const page = (blocks, components = { card: CARD }) => ({ v: 2, id: 'p', frames: F, blocks, components });
const texts = (doc) => normalizeDoc(doc).blocks.length && expandInstances(normalizeDoc(doc)).blocks.filter((b) => b.kind === 'text').map((b) => [b.parent, b.props.md]);

test('an instance is drawn as its component, sized as it, with its own overrides', () => {
  const norm = normalizeDoc(page([inst('a', 0), inst('b', 400, { title: 'Mine' })]));
  assert.deepEqual([norm.blocks[0].w, norm.blocks[0].h], [300, 180], 'the copy takes its component\'s box');
  const exp = expandInstances(norm);
  assert.ok(!exp.blocks.some((b) => b.kind === 'instance'), 'a reader never meets an instance block');
  assert.deepEqual(texts(page([inst('a', 0), inst('b', 400, { title: 'Mine' })])),
    [['a', 'Title'], ['a', 'Body'], ['b', 'Mine'], ['b', 'Body']]);
  assert.equal(new Set(exp.blocks.map((b) => b.id)).size, exp.blocks.length, 'derived ids are unique');
  assert.ok(exp.blocks.every((b) => /^[A-Za-z0-9_-]{1,60}$/.test(b.id)), 'derived ids are names (S3)');
  // Stored: the instance holds its overrides and nothing of the definition.
  const stored = serializeDoc(norm);
  assert.deepEqual(stored.blocks[1].component, { id: 'card', overrides: { title: 'Mine' } });
  assert.ok(!('blocks' in stored.blocks[1]) && !stored.blocks[1].props, 'no definition content in the instance');
  assert.deepEqual(Object.keys(stored.components), ['card']);
  assert.deepEqual(validateDoc(stored), []);
});

test('editing the definition changes every copy except the fields a copy overrode', () => {
  const doc = page([inst('a', 0), inst('b', 400, { title: 'Mine' })]);
  const edited = { ...CARD, doc: { ...CARD.doc, blocks: [txt('title', 'New title'), txt('body', 'New body', { y: 100 })] } };
  assert.deepEqual(texts({ ...doc, components: { card: edited } }),
    [['a', 'New title'], ['a', 'New body'], ['b', 'Mine'], ['b', 'New body']]);
});

test('"update the copies" puts the library version on the page and keeps each copy\'s overrides', () => {
  const doc = normalizeDoc(page([inst('a', 0), inst('b', 400, { title: 'Mine', gone: 'x' })]));
  const lib = { id: 'card', name: 'Card', sort: 'component', doc: { ...CARD.doc, blocks: [txt('title', 'V2'), txt('body', 'V2 body', { y: 100 })] }, exposed: CARD.exposed };
  assert.equal(snapshotDiffers(doc.components.card, lib), true);
  assert.equal(snapshotDiffers(doc.components.card, { ...lib, doc: CARD.doc }), false, 'the same version is not "newer"');
  const r = updateCopies(doc.blocks, doc.components, 'card', snapshotOf(lib, 'project', 'bmm'));
  assert.equal(r.dropped, 1, 'an override of a field no longer exposed is dropped, and counted');
  assert.deepEqual(r.blocks[1].component, { id: 'card', overrides: { title: 'Mine' } });
  assert.deepEqual(texts({ ...doc, blocks: r.blocks, components: r.components }), [['a', 'V2'], ['a', 'V2 body'], ['b', 'Mine'], ['b', 'V2 body']]);
  assert.deepEqual(divergence(r.blocks[1], normalizeDoc({ ...doc, blocks: r.blocks, components: r.components }).components.card).map((e) => e.key), ['title']);
});

test('overrides are set and reset per field; detach turns a copy into plain blocks where it is', () => {
  const doc = normalizeDoc(page([inst('a', 0)]));
  const set = setOverride(doc.blocks, 'a', 'title', 'Hi');
  assert.deepEqual(set[0].component, { id: 'card', overrides: { title: 'Hi' } });
  assert.deepEqual(setOverride(set, 'a', 'title', undefined)[0].component, { id: 'card' });
  const det = detachInstance(set, doc.components, 'a', uid);
  assert.equal(det.length, 3);
  assert.equal(det[0].kind, 'group');
  assert.ok(det.slice(1).every((b) => b.parent === det[0].id && !b.component));
  assert.equal(det[1].props.md, 'Hi', 'the override is applied to the detached copy');
  assert.deepEqual(validateDoc(serializeDoc(normalizeDoc({ ...page(det), components: undefined }))), []);
});

test('a selection with containers becomes a definition, and the selection a linked copy', () => {
  const blocks = [
    { id: 'g', kind: 'group', x: 100, y: 200, w: 400, h: 200, z: 3 },
    txt('in', 'Inside', { parent: 'g', x: 10, y: 10 }),
    txt('other', 'Other', { x: 700, y: 0 }),
  ];
  const def = definitionFromBlocks(blocks, ['g'], {});
  assert.deepEqual(def.doc.blocks.map((b) => [b.id, b.x, b.y, b.parent || '']), [['g', 0, 0, ''], ['in', 10, 10, 'g']]);
  assert.deepEqual(def.exposed.map((e) => [e.block, e.field]), [['in', 'props.md']]);
  const snap = snapshotOf({ name: 'Box', doc: def.doc, exposed: def.exposed }, 'site');
  const r = replaceWithInstance(blocks, ['g'], {}, 'box', snap, def, uid);
  assert.deepEqual(r.blocks.map((b) => b.kind), ['instance', 'text']);
  assert.deepEqual([r.blocks[0].x, r.blocks[0].y], [100, 200]);
  const out = serializeDoc(normalizeDoc({ v: 2, id: 'p', frames: F, blocks: r.blocks, components: r.components }));
  assert.deepEqual(validateDoc(out), []);
  // Drawn: the container IS the copy (its id), the child inside it.
  const exp = expandInstances(normalizeDoc(out));
  const root = exp.blocks.find((b) => b.id === r.id);
  assert.equal(root.kind, 'group');
  assert.ok(exp.blocks.some((b) => b.parent === r.id && b.props?.md === 'Inside'));
  // Blocks of two different containers are not one component.
  assert.equal(definitionFromBlocks(blocks, ['in', 'other'], {}), null);
});

test('recursion stops at the depth bound when rendering, whatever is stored', () => {
  const loop = { name: 'L', scope: 'site', doc: { v: 2, frames: F, blocks: [txt('t', 'x'), { id: 'n', kind: 'instance', x: 0, y: 100, w: 8, h: 8, component: { id: 'loop' } }] }, exposed: [] };
  const exp = expandInstances(normalizeDoc({ v: 2, id: 'p', frames: F, blocks: [{ id: 'i', kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: 'loop' } }], components: { loop } }));
  const texts2 = exp.blocks.filter((b) => b.kind === 'text').length;
  assert.equal(texts2, MAX_INSTANCE_DEPTH, `a loop draws ${texts2} levels, not forever`);
  assert.ok(exp.blocks.some((b) => b.instanceError === 'too_deep'));
  // And the validator refuses it with a path.
  assert.ok(validateDoc({ v: 2, id: 'p', frames: F, blocks: [{ id: 'i', kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: 'loop' } }], components: { loop } })
    .some((p) => p.reason === 'component_cycle' && p.path === 'components.loop.doc.blocks[1].component.id'));
  // An unknown component: an empty box, no throw.
  const unk = expandInstance({ id: 'i', kind: 'instance', x: 0, y: 0, w: 50, h: 50, component: { id: 'nope' } }, {});
  assert.equal(unk.root.instanceError, 'unknown_component');
  assert.equal(unk.blocks.length, 0);
});

test('on a phone the copy takes the phone column, scaled from its desktop box', () => {
  const wide = { ...CARD, doc: { ...CARD.doc, blocks: [txt('title', 'T', { w: 780, h: 200 })] } };
  const norm = normalizeDoc({ ...page([inst('a', 0)], { card: wide }), frames: { ...F, phone: { w: 390, fit: 'content', mode: 'board' } } });
  const exp = expandInstances(norm, { mode: 'phone' });
  const shown = frameBlocks(exp, 'phone').find((b) => b.id === 'a');
  assert.equal(shown.w, 358);
  assert.equal(shown.h, Math.round(200 * (358 / 780)), 'its height scaled with its width');
  assert.equal(shown.baseW, 780, 'its blocks are laid on the desktop plane and scaled');
});

test('personal components keep the containers they hold (the 7a refusal is gone)', () => {
  const sel = [{ id: 'g', kind: 'group', x: 100, y: 100, w: 300, h: 200, z: 0 }, txt('in', 'x', { parent: 'g', x: 20, y: 20 })];
  const c = componentFromBlocks('Box', sel, uid);
  assert.deepEqual(c.blocks.map((b) => [b.id, b.parent || '', b.x, b.y]), [['g', '', 0, 0], ['in', 'g', 20, 20]]);
  const copy = instantiateComponent(c, { x: 500, y: 40 }, 0, uid);
  assert.equal(copy[1].parent, copy[0].id, 'the copy\'s child is inside the copy\'s container');
  assert.deepEqual([copy[0].x, copy[1].x], [500, 20]);
  // A component preset keeps them too, with the fields its copies may change.
  const pr = presetEntry({ name: 'Box', sort: 'component', blocks: sel });
  assert.deepEqual(pr.doc.blocks.map((b) => [b.parent || '', b.x]), [['', 0], ['b0', 20]]);
  assert.deepEqual(pr.exposed.map((e) => e.field), ['props.md']);
  const placed = instanceFromEntry(pr, { x: 0, y: 0 }, 0, uid, 'site');
  assert.equal(placed.block.kind, 'instance');
  assert.equal(placed.snap.exposed.length, 1);
});

test('component mode addresses', () => {
  assert.equal(componentPath('site', '', 'c1'), '/studio/component/site/c1');
  assert.equal(componentPath('project', 'bmm', 'c1'), '/studio/component/project.bmm/c1');
  assert.deepEqual(parseComponentParams({ scope: 'project.bmm', id: 'c1' }), { scope: 'project', ref: 'bmm', cid: 'c1' });
  assert.deepEqual(parseComponentParams({ scope: 'showcase.ck9x_1', id: 'c1' }), { scope: 'showcase', ref: 'ck9x_1', cid: 'c1' });
  assert.deepEqual(parseComponentParams({ scope: 'site', id: 'c1' }), { scope: 'site', ref: '', cid: 'c1' });
  for (const bad of [{ scope: 'user', id: 'c1' }, { scope: 'project.', id: 'c1' }, { scope: 'project.BMM', id: 'c1' }, { scope: 'site', id: 'a"b' }, { scope: 'project.bmm/../x', id: 'c' }]) {
    assert.equal(parseComponentParams(bad), null, JSON.stringify(bad));
  }
  assert.equal(componentBack('/studio/project/bmm/p1'), '/studio/project/bmm/p1');
  for (const evil of ['//evil.example', 'https://evil.example', '/studio/project/bmm/p1?x=//e', '/admin', 'javascript:alert(1)']) assert.equal(componentBack(evil), '/admin', evil);
});
