// Studio phase 7b (PLAN-STUDIO-2026 2.6, 3.2, 3.3.6): components, instances, overrides.
//
// A component definition is imported data (a library shared by a page's studio holders, the
// site's library, soon a file), and an instance's overrides are written by whoever places the
// copy. Both land on public pages, so both go through the ONE validator (validateDoc in
// packages/studio, via lib/studio-doc.mjs and lib/studio-library.mjs), and these are the refusals
// that matter, each with the path of the field:
//   · a component that contains itself, directly or through another one (`component_cycle`);
//   · an override of a field the component does not expose (`not_exposed`), whatever the key;
//   · an exposed field's value that its own rule refuses (a `javascript:` step, a CSS value that
//     fetches), reported under the override's path;
//   · instances nested past MAX_INSTANCE_DEPTH, a page that expands past MAX_EXPANDED_BLOCKS;
//   · a container component whose tree is broken, a dialog component placed inside a box.
// And the component save's concurrency: a stale revision is a 409 with the stored entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configStudioProblems, studioDocProblems } from '../src/lib/studio-doc.mjs';
import { parseLibrary, parseComponentSave, replaceComponentEntry, entryRev } from '../src/lib/studio-library.mjs';
import { MAX_INSTANCE_DEPTH, MAX_EXPANDED_BLOCKS } from '../../../packages/studio/src/index.js';

const F = { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } };
const def = (blocks) => ({ v: 2, frames: F, blocks });
const txt = (id, extra = {}) => ({ id, kind: 'text', x: 0, y: 0, w: 200, h: 80, props: { md: 'Hello' }, ...extra });
const btn = (id, extra = {}) => ({ id, kind: 'button', x: 0, y: 100, w: 160, h: 48, props: { label: 'Go' }, action: [{ type: 'navigate', to: '/' }], ...extra });
const inst = (id, cid, overrides) => ({ id, kind: 'instance', x: 40, y: 40, w: 8, h: 8, component: overrides ? { id: cid, overrides } : { id: cid } });
const snap = (name, blocks, exposed = []) => ({ name, scope: 'project', ref: 'bmm', doc: def(blocks), exposed });
const CARD = snap('Card', [txt('t'), btn('b')], [{ key: 'title', block: 't', field: 'props.md' }, { key: 'go', block: 'b', field: 'action' }, { key: 'lbl', block: 'b', field: 'props.label' }]);
const page = (blocks, components) => ({ v: 2, id: 'p1', title: 'P', frames: F, blocks, components });
const cfg = (doc) => ({ canvases: [doc] });
const problems = (doc) => configStudioProblems(cfg(doc), {});
const reasons = (ps) => ps.map((p) => `${p.path}:${p.reason}`);

test('a page with two copies, one overriding an exposed text, is accepted', () => {
  assert.deepEqual(problems(page([inst('i1', 'card'), inst('i2', 'card', { title: 'Mine' })], { card: CARD })), []);
});

test('an override of a field the component does not expose is refused, whatever it names', () => {
  for (const [key, value] of [['style', 'position:fixed'], ['props.style', 'x'], ['svg', '<svg onload=alert(1)>'], ['t', 'x'], ['__proto__x', 'x']]) {
    const ps = problems(page([inst('i1', 'card', { [key]: value })], { card: CARD }));
    assert.ok(ps.some((p) => p.path === `canvases[0].blocks[0].component.overrides.${key}` && p.reason === 'not_exposed'), `${key}: ${JSON.stringify(ps)}`);
  }
  // An exposed field of a component that is not on the page: not exposed either.
  const ps = problems(page([inst('i1', 'ghost', { title: 'x' })], { card: CARD }));
  assert.deepEqual(reasons(ps).sort(), ['canvases[0].blocks[0].component.id:unknown_component', 'canvases[0].blocks[0].component.overrides.title:not_exposed'].sort());
});

test('an exposed field keeps its own rule: a hostile value is refused under the override path', () => {
  const cases = [
    [{ go: [{ type: 'navigate', to: 'javascript:alert(1)' }] }, 'canvases[0].blocks[0].component.overrides.go[0].to', 'unsafe_url'],
    [{ go: [{ type: 'external', url: 'http://plain.example' }] }, 'canvases[0].blocks[0].component.overrides.go[0].url', 'https_only'],
    [{ title: 42 }, 'canvases[0].blocks[0].component.overrides.title', 'bad_type'],
    [{ lbl: 'x'.repeat(201) }, 'canvases[0].blocks[0].component.overrides.lbl', 'too_long'],
  ];
  for (const [ov, path, reason] of cases) {
    const ps = problems(page([inst('i1', 'card', ov)], { card: CARD }));
    assert.ok(ps.some((p) => p.path === path && p.reason === reason), `${JSON.stringify(ov)}: ${JSON.stringify(ps)}`);
  }
  // A colour override goes through the CSS value rule.
  const COL = snap('Col', [txt('t')], [{ key: 'bg', block: 't', field: 'props.bg' }]);
  const ps = problems(page([inst('i1', 'col', { bg: 'url(https://evil.example/p.png)' })], { col: COL }));
  assert.ok(ps.some((p) => p.path === 'canvases[0].blocks[0].component.overrides.bg' && p.reason === 'unsafe_css'), JSON.stringify(ps));
});

test('recursion is refused with a path: directly and through another component', () => {
  // Direct: A holds a copy of A.
  const A1 = snap('A', [txt('t'), inst('n', 'a')]);
  let ps = problems(page([inst('i1', 'a')], { a: A1 }));
  assert.ok(ps.some((p) => p.path === 'canvases[0].components.a.doc.blocks[1].component.id' && p.reason === 'component_cycle'), JSON.stringify(ps));
  // Indirect: A holds B, B holds A.
  const A2 = snap('A', [inst('n', 'b')]);
  const B2 = snap('B', [inst('m', 'a')]);
  ps = problems(page([inst('i1', 'a')], { a: A2, b: B2 }));
  assert.ok(ps.some((p) => p.reason === 'component_cycle' && /components\.(a|b)\.doc\.blocks\[0\]\.component\.id$/.test(p.path)), JSON.stringify(ps));
  // A library definition that holds a copy of ITSELF (the entry is the component).
  const lib = parseLibrary({ base: '', entries: [{ id: 'cself', name: 'Self', sort: 'component', doc: { ...def([txt('t'), inst('n', 'cself')]), components: { cself: snap('Self', [txt('t')]) } }, exposed: [] }] });
  assert.equal(lib.ok, false);
  assert.ok(lib.body.problems.some((p) => p.path === 'entries[0].doc.blocks[1].component.id' && p.reason === 'component_cycle'), JSON.stringify(lib.body));
  // …and through another component of its map.
  const lib2 = parseLibrary({ base: '', entries: [{ id: 'cx', name: 'X', sort: 'component', doc: { ...def([inst('n', 'cy')]), components: { cy: snap('Y', [inst('m', 'cx')]), cx: snap('X', [txt('t')]) } }, exposed: [] }] });
  assert.equal(lib2.ok, false);
  assert.ok(lib2.body.problems.some((p) => p.reason === 'component_cycle'), JSON.stringify(lib2.body));
});

test('nesting and expansion are bounded', () => {
  // A chain one level deeper than allowed.
  const map = {};
  const depth = MAX_INSTANCE_DEPTH + 1;
  for (let i = 0; i < depth; i++) map[`c${i}`] = snap(`C${i}`, i < depth - 1 ? [inst(`n${i}`, `c${i + 1}`)] : [txt('t')]);
  const ps = problems(page([inst('i1', 'c0')], map));
  assert.ok(ps.some((p) => p.reason === 'instance_too_deep'), JSON.stringify(ps));
  // Fan-out: 40 copies of a component of 40 copies of a 40-block component, well past the cap.
  const leaf = snap('Leaf', Array.from({ length: 40 }, (_v, i) => txt(`t${i}`, { y: i * 90 })));
  const mid = snap('Mid', Array.from({ length: 40 }, (_v, i) => inst(`m${i}`, 'leaf')));
  const big = page(Array.from({ length: 40 }, (_v, i) => inst(`i${i}`, 'mid')), { leaf, mid });
  const ps2 = problems(big);
  assert.ok(ps2.some((p) => p.path === 'canvases[0].blocks' && p.reason === 'too_many_expanded'), `expanded past ${MAX_EXPANDED_BLOCKS}: ${JSON.stringify(ps2.slice(0, 3))}`);
});

test('containers can be components; their tree is checked, and a dialog component stays at page level', () => {
  const GROUP = snap('Box', [{ id: 'g', kind: 'group', x: 0, y: 0, w: 400, h: 200 }, txt('in', { parent: 'g', x: 10, y: 10 })], [{ key: 'txt', block: 'in', field: 'props.md' }]);
  const TABS = snap('Tabs', [{ id: 'tc', kind: 'tabs', x: 0, y: 0, w: 500, h: 300, props: { tabs: ['One', 'Two'] } }, txt('a', { parent: 'tc', x: 8, y: 8 }), txt('b', { parent: 'tc', slot: 1, x: 8, y: 8 })]);
  const MODAL = snap('Dlg', [{ id: 'd', kind: 'modal', x: 0, y: 0, w: 400, h: 240, props: { title: 'Hi' } }, txt('body', { parent: 'd', x: 16, y: 16 })]);
  const open = btn('open', { action: [{ type: 'modal', target: 'dlg1' }] });
  assert.deepEqual(problems(page([inst('g1', 'box', { txt: 'Mine' }), inst('t1', 'tabs'), inst('dlg1', 'dlg'), open], { box: GROUP, tabs: TABS, dlg: MODAL })), []);
  // A broken tree inside a definition: refused where it is.
  const BROKEN = snap('Broken', [txt('x', { parent: 'nowhere' })]);
  const ps = problems(page([inst('i1', 'broken')], { broken: BROKEN }));
  assert.ok(ps.some((p) => p.path === 'canvases[0].components.broken.doc.blocks[0].parent' && p.reason === 'unknown_parent'), JSON.stringify(ps));
  // A dialog component inside a group: the copy is refused where it is placed.
  const ps2 = problems(page([{ id: 'grp', kind: 'group', x: 0, y: 0, w: 800, h: 600 }, { ...inst('dlg1', 'dlg'), parent: 'grp' }], { dlg: MODAL }));
  assert.ok(ps2.some((p) => p.path === 'canvases[0].blocks[1]' && p.reason === 'modal_nested'), JSON.stringify(ps2));
  // A step may open the dialog component by the copy's id, not by an id inside it.
  const ps3 = problems(page([inst('dlg1', 'dlg'), btn('o2', { action: [{ type: 'modal', target: 'd' }] })], { dlg: MODAL }));
  assert.ok(ps3.some((p) => p.reason === 'bad_target'), JSON.stringify(ps3));
});

test('a definition is checked like a page, and so is what it exposes', () => {
  const evil = snap('Evil', [btn('b', { action: [{ type: 'navigate', to: 'javascript:alert(1)' }] })]);
  let ps = problems(page([inst('i1', 'evil')], { evil }));
  assert.ok(ps.some((p) => p.path === 'canvases[0].components.evil.doc.blocks[0].action[0].to' && p.reason === 'unsafe_url'), JSON.stringify(ps));
  const badExposed = snap('X', [txt('t')], [{ key: 'a', block: 'nope', field: 'props.md' }, { key: 'b', block: 't', field: 'props.svg' }, { key: 'c', block: 't', field: 'props.label' }, { key: 'd d', block: 't', field: 'props.md' }]);
  ps = problems(page([inst('i1', 'x')], { x: badExposed }));
  const r = reasons(ps);
  for (const want of ['canvases[0].components.x.exposed[0].block:unknown_block', 'canvases[0].components.x.exposed[1].field:bad_value', 'canvases[0].components.x.exposed[2].field:not_allowed', 'canvases[0].components.x.exposed[3].key:bad_id']) {
    assert.ok(r.includes(want), `${want} missing from ${JSON.stringify(r)}`);
  }
  // Unknown fields on a definition or its document are refused (a snapshot carries no map).
  ps = problems(page([inst('i1', 'y')], { y: { ...snap('Y', [txt('t')]), script: 'x', doc: { ...def([txt('t')]), components: {} } } }));
  assert.ok(reasons(ps).includes('canvases[0].components.y.script:unknown_field'), JSON.stringify(ps));
  assert.ok(reasons(ps).includes('canvases[0].components.y.doc.components:unknown_field'), JSON.stringify(ps));
  // An override on a block that is not a copy.
  ps = problems(page([txt('t', { component: { id: 'x', inst: 'i', overrides: { a: 1 } } })], {}));
  assert.ok(reasons(ps).includes('canvases[0].blocks[0].component.overrides:not_allowed'), JSON.stringify(ps));
  // A copy with no component at all.
  ps = problems(page([{ id: 'i9', kind: 'instance', x: 0, y: 0, w: 8, h: 8 }], {}));
  assert.ok(reasons(ps).includes('canvases[0].blocks[0].component:required'), JSON.stringify(ps));
});

test('a library component carries its exposed fields; other sorts may not', () => {
  const ok = parseLibrary({ base: '', entries: [{ id: 'c1', name: 'Card', sort: 'component', doc: def([txt('t')]), exposed: [{ key: 'title', block: 't', field: 'props.md', label: 'Title' }] }] });
  assert.equal(ok.ok, true, JSON.stringify(ok.body));
  assert.deepEqual(ok.entries[0].exposed, [{ key: 'title', block: 't', field: 'props.md', label: 'Title' }]);
  const no = parseLibrary({ base: '', entries: [{ id: 's1', name: 'Sec', sort: 'section', doc: def([txt('t')]), exposed: [] }] });
  assert.equal(no.ok, false);
  assert.equal(no.body.path, 'entries[0].exposed');
});

test('a component save: one entry, from its revision; a stale one is a 409 with the stored entry', () => {
  const body = { entry: { name: 'Card', doc: def([txt('t')]), exposed: [{ key: 'title', block: 't', field: 'props.md' }] }, base: '' };
  const p1 = parseComponentSave('c1', body);
  assert.equal(p1.ok, true, JSON.stringify(p1));
  const other = { id: 'o1', name: 'Other', sort: 'page', doc: def([]) };
  const r1 = replaceComponentEntry([other], p1.entry, p1.base);
  assert.ok(r1.entries, JSON.stringify(r1));
  assert.deepEqual(r1.entries.map((e) => e.id), ['c1', 'o1'], 'a new component goes first, the rest stays');
  const rev1 = entryRev(r1.entry);
  // Two authors from rev1: the first lands, the second is a 409 carrying the stored entry.
  const a = parseComponentSave('c1', { ...body, entry: { ...body.entry, doc: def([txt('t', { props: { md: 'A' } })]) }, base: rev1 });
  const b = parseComponentSave('c1', { ...body, entry: { ...body.entry, doc: def([txt('t', { props: { md: 'B' } })]) }, base: rev1 });
  const ra = replaceComponentEntry(r1.entries, a.entry, a.base);
  assert.ok(ra.entries);
  const rb = replaceComponentEntry(ra.entries, b.entry, b.base);
  assert.equal(rb.status, 409);
  assert.equal(rb.body.error, 'conflict');
  assert.equal(rb.body.rev, entryRev(ra.entry));
  assert.equal(rb.body.entry.doc.blocks[0].props.md, 'A');
  // A base '' for an id that exists is stale too (it would erase it).
  assert.equal(replaceComponentEntry(ra.entries, p1.entry, '').status, 409);
  // The id of a non-component entry is refused.
  assert.equal(replaceComponentEntry([other], { ...p1.entry, id: 'o1' }, entryRev(other)).status, 409);
  // The body: an unknown field, a missing base, a hostile doc, all refused with a path.
  assert.equal(parseComponentSave('c1', { ...body, entry: { ...body.entry, sort: 'page' } }).body.path, 'entry.sort');
  assert.equal(parseComponentSave('c1', { entry: body.entry }).body.error, 'base_required');
  const evil = parseComponentSave('c1', { ...body, entry: { ...body.entry, doc: def([btn('b', { action: [{ type: 'navigate', to: 'javascript:x' }] })]) } });
  assert.equal(evil.ok, false);
  assert.equal(evil.body.path, 'entry.doc.blocks[0].action[0].to');
});

test('the API refuses with the package validator itself (no second copy)', async () => {
  const pkg = await import('../../../packages/studio/src/index.js');
  assert.equal(studioDocProblems, pkg.validateDoc);
});
