// Studio phase 7c (PLAN-STUDIO-2026 2.6, 3.2, tests 3.3.6): the .bcwstudio.json files.
//
// The format and its reader live in the package (packages/studio/src/io.js), read here through
// lib/canvas.js like the app reads them. Three things are proved:
//   · the ROUND TRIP: a page, a component and each sort of preset, exported then imported,
//     give the same document apart from ids. The inverse of the id map is applied by an oracle
//     written here, by hand, not by the package's own remapping;
//   · the HOSTILE CORPUS is refused, each file with the field it is in; where the save path
//     has the same rule (validateDoc), the same content saved is refused too (3.3.6: "the same
//     result as saving the same content");
//   · the PASTE of blocks is read by the same function, and the size cap holds every file an
//     export of a valid page can produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportStudioFile, studioFileText, parseStudioFile, freshStudioFile, parseBlocksPaste, studioFileName,
  parseGuardedJson, studioFileProblems, libraryEntryProblems, assetRefs, validateDoc, normalizeDoc, serializeDoc,
  MAX_FILE_BYTES, MAX_JSON_DEPTH, LIMITS, STUDIO_FILE_KINDS, utf8Bytes,
} from '../src/lib/canvas.js';
import { reasonWords } from '../src/editor/studio-io-words.js';

const F = { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } };
const txt = (id, md, extra = {}) => ({ id, kind: 'text', x: 0, y: 0, w: 300, h: 80, props: { md }, ...extra });

// ── The fixture: everything that carries an id or an address ─────────────────────────────
const BADGE = { name: 'Badge', scope: 'site', doc: { v: 2, frames: F, blocks: [txt('bt', 'NEW', { w: 80, h: 30 })] }, exposed: [{ key: 'label', block: 'bt', field: 'props.md' }] };
const CARD = {
  name: 'Card', scope: 'project', ref: 'bmm',
  doc: { v: 2, frames: F, blocks: [
    txt('title', 'Title'), txt('body', 'Body', { y: 100 }),
    { id: 'pic', kind: 'image', x: 320, y: 0, w: 120, h: 120, props: { src: '/api/media/card.png', alt: '' } },
    { id: 'go', kind: 'button', x: 0, y: 200, w: 160, h: 48, props: { label: 'Go' }, action: [{ type: 'scroll', target: 'body' }] },
    { id: 'nb', kind: 'instance', x: 0, y: 260, w: 8, h: 8, component: { id: 'badge' } },
  ] },
  exposed: [{ key: 'title', block: 'title', field: 'props.md' }, { key: 'go', block: 'go', field: 'action' }, { key: 'pic', block: 'pic', field: 'props.src' }],
};
const RAW_PAGE = {
  v: 2, id: 'home1', title: 'Launch', hidden: true, frames: { desktop: { w: 1200, h: 1600, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'stack' } },
  background: { type: 'image', src: '/api/media/bg.jpg', fit: 'cover', position: 'center' },
  css: '.x { color: red; }', grid: 16,
  blocks: [
    { id: 'g', kind: 'group', x: 40, y: 40, w: 600, h: 300, z: 0 },
    txt('t1', 'In the group', { parent: 'g', x: 16, y: 16, z: 1 }),
    { id: 'tb', kind: 'tabs', x: 40, y: 400, w: 600, h: 300, z: 2, props: { tabs: ['One', 'Two'] } },
    txt('t2', 'Tab two', { parent: 'tb', slot: 1, x: 16, y: 16, z: 3 }),
    { id: 'm', kind: 'modal', x: 1400, y: 40, w: 400, h: 240, z: 4, props: { title: 'Dialog' } },
    txt('t3', 'In the dialog', { parent: 'm', x: 16, y: 16, z: 5 }),
    { id: 'img', kind: 'image', x: 700, y: 40, w: 300, h: 200, z: 6, props: { src: '/uploads/hero.png', alt: 'Hero' }, themes: { dark: { props: { src: '/uploads/hero-dark.png' } } } },
    { id: 'b1', kind: 'button', x: 700, y: 300, w: 200, h: 56, z: 7, props: { label: 'Open' }, action: [{ type: 'reveal', target: 'g', mode: 'toggle' }, { type: 'tab', target: 'tb', index: 1 }, { type: 'modal', target: 'm' }] },
    { id: 'b2', kind: 'button', x: 700, y: 400, w: 200, h: 56, z: 8, props: { label: 'Get it' }, action: [{ type: 'scroll', target: '#top' }, { type: 'download', file: '/uploads/pack.zip' }] },
    { id: 'c1', kind: 'instance', x: 40, y: 800, w: 8, h: 8, z: 9, component: { id: 'card', overrides: { title: 'Mine', go: [{ type: 'scroll', target: 'title' }], pic: '/uploads/mine.png' } } },
    { id: 'c2', kind: 'instance', x: 500, y: 800, w: 8, h: 8, z: 10, component: { id: 'card' } },
  ],
  components: { card: CARD, badge: BADGE },
};
/** What the studio exports: the draft as it is STORED. */
const STORED = serializeDoc(normalizeDoc(RAW_PAGE));

// ── The oracle: the imported document with every id put back, written here by hand ──────────
const inverse = (m) => new Map([...m].map(([a, b]) => [b, a]));
function back(doc, idMap) {
  const pageIds = inverse(idMap.blocks);
  const comps = inverse(idMap.components);
  const defIds = new Map(Object.entries(idMap.defs).map(([cid, m]) => [cid, inverse(m)]));
  const steps = (list, ids) => (Array.isArray(list) ? list.map((s) => (s && ['scroll', 'reveal', 'modal', 'tab'].includes(s.type) && ids.has(s.target) ? { ...s, target: ids.get(s.target) } : s)) : list);
  const blocks = (list, ids, defsOf) => list.map((b) => {
    const o = { ...b, id: ids.get(b.id) };
    assert.ok(o.id, `an imported block id (${b.id}) is not in the id map`);
    if (b.parent) o.parent = ids.get(b.parent);
    if (b.action) o.action = steps(b.action, ids);
    if (b.kind === 'instance') {
      const cid = b.component.id;
      o.component = { ...b.component, id: comps.get(cid) };
      if (b.component.overrides) {
        const def = defsOf[cid];
        const ov = { ...b.component.overrides };
        for (const e of def.exposed) if (e.field === 'action' && e.key in ov) ov[e.key] = steps(ov[e.key], defIds.get(cid));
        o.component.overrides = ov;
      }
    }
    return o;
  });
  const defs = doc.components || {};
  const out = { ...doc, blocks: blocks(doc.blocks, pageIds, defs) };
  if (doc.components) {
    out.components = {};
    for (const [cid, s] of Object.entries(doc.components)) {
      const ids = defIds.get(cid);
      out.components[comps.get(cid)] = { ...s, doc: { ...s.doc, blocks: blocks(s.doc.blocks, ids, defs) }, exposed: s.exposed.map((e) => ({ ...e, block: ids.get(e.block) })) };
    }
  }
  return out;
}
const allIds = (doc) => [...(doc.blocks || []).map((b) => b.id), ...Object.values(doc.components || {}).flatMap((s) => s.doc.blocks.map((b) => b.id))];
const trip = (input, opts = {}) => {
  const { file, problems } = exportStudioFile(input);
  assert.deepEqual(problems, [], 'the export refused a valid document');
  const text = studioFileText(file);
  const r = parseStudioFile(text);
  assert.equal(r.ok, true, `the import refused its own export: ${JSON.stringify(r.problems)}`);
  let k = 0;
  const f = freshStudioFile(r.file, { uid: () => `n${k++}`, componentUid: () => `k${k++}`, ...opts });
  return { file, text, fresh: f };
};

test('round trip: a page exported then imported is the same document, apart from ids', () => {
  const { file, fresh } = trip({ kind: 'page', doc: STORED, id: 'home1', origin: 'https://bettercommunity.test' });
  // The file: no page id, no visibility flag, the definitions beside the document, the assets.
  assert.equal(file.doc.id, undefined);
  assert.equal(file.doc.hidden, undefined);
  assert.equal(file.doc.components, undefined);
  assert.deepEqual(Object.keys(file.components).sort(), ['badge', 'card']);
  assert.deepEqual(file.assets.sort(), ['/api/media/bg.jpg', '/api/media/card.png', '/uploads/hero-dark.png', '/uploads/hero.png', '/uploads/mine.png', '/uploads/pack.zip']);
  // Fresh: not one block or component id survives.
  const before = new Set([...allIds(STORED), ...Object.keys(STORED.components)]);
  for (const id of [...allIds(fresh.doc), ...Object.keys(fresh.doc.components)]) assert.ok(!before.has(id), `id ${id} was reused`);
  // Identity: the imported doc with its ids put back is the exported one.
  const { id: _i, hidden: _h, ...expected } = STORED;
  assert.deepEqual(back(fresh.doc, fresh.idMap), expected);
  // And it is a page the save route takes (validateDoc), with its new ids.
  assert.deepEqual(validateDoc({ ...fresh.doc, id: 'p9' }), []);
});

test('round trip: a component and every sort of preset', () => {
  const entryDoc = { v: 2, frames: F, blocks: CARD.doc.blocks, components: { badge: BADGE } };
  const c = trip({ kind: 'component', doc: entryDoc, id: 'card', name: 'Card', exposed: CARD.exposed });
  assert.deepEqual(back(c.fresh.doc, c.fresh.idMap), entryDoc);
  assert.deepEqual(c.fresh.exposed.map((e) => ({ ...e, block: inverse(c.fresh.idMap.blocks).get(e.block) })), CARD.exposed);
  for (const sort of ['page', 'section', 'background', 'component']) {
    const doc = sort === 'background' ? { v: 2, frames: F, background: { type: 'gradient', angle: 90, stops: [{ color: '#112233', at: 0 }, { color: '#445566', at: 100 }] }, blocks: [] }
      : sort === 'page' ? (({ id: _i, hidden: _h, ...d }) => d)(STORED) : entryDoc;
    const r = trip({ kind: `preset:${sort}`, doc, id: 'pr1', name: `A ${sort}`, exposed: sort === 'component' ? CARD.exposed : null });
    assert.deepEqual(back(r.fresh.doc, r.fresh.idMap), doc, `preset:${sort}`);
    assert.equal(r.file.kind, `preset:${sort}`);
  }
});

test('fresh ids never collide with the ids already on the page', () => {
  const taken = ['n0', 'n1', 'n2', 'n3'];
  let k = 0;
  const r = parseStudioFile(studioFileText(exportStudioFile({ kind: 'preset:section', doc: { v: 2, frames: F, blocks: [txt('a', 'A'), txt('b', 'B')] }, name: 'S' }).file));
  const f = freshStudioFile(r.file, { uid: () => `n${k++}`, taken });
  for (const b of f.doc.blocks) assert.ok(!taken.includes(b.id), `${b.id} collides`);
  assert.equal(new Set(f.doc.blocks.map((b) => b.id)).size, 2);
});

test('a file name is readable and carries the extension', () => {
  assert.equal(studioFileName('Page d’accueil — été'), 'page-d-accueil-ete.bcwstudio.json');
  assert.equal(studioFileName(''), 'studio.bcwstudio.json');
});

// ── The hostile corpus (3.3.6) ───────────────────────────────────────────────────────────────
const envelope = (doc, extra = {}) => ({ format: 'bcw-studio', version: 1, kind: 'page', doc: { v: 2, frames: F, ...doc }, assets: [], ...extra });
const refusal = (fileOrText) => {
  const r = parseStudioFile(typeof fileOrText === 'string' ? fileOrText : JSON.stringify(fileOrText));
  assert.equal(r.ok, false, 'a hostile file was accepted');
  return r.problems;
};
const has = (problems, path, reason) => assert.ok(problems.some((p) => p.path === path && p.reason === reason), `expected ${path}: ${reason}, got ${JSON.stringify(problems)}`);
/** The same content SAVED (validateDoc, the API's function): refused at the same field. */
const saveRefuses = (doc, path, reason) => {
  const ps = validateDoc({ id: 'p', ...doc });
  assert.ok(ps.some((p) => p.path === path && p.reason === reason), `the save path does not refuse ${path}: ${reason} (${JSON.stringify(ps.map((p) => `${p.path}:${p.reason}`))})`);
};

test('hostile: javascript: in a step is refused, as a save refuses it', () => {
  const blocks = [{ id: 'a', kind: 'button', x: 0, y: 0, w: 100, h: 40, props: { label: 'x' }, action: [{ type: 'navigate', to: 'javascript:alert(1)' }] },
    { id: 'b', kind: 'button', x: 0, y: 60, w: 100, h: 40, props: { label: 'y' }, action: [{ type: 'external', url: 'JaVaScRiPt:alert(1)' }] },
    { id: 'c', kind: 'text', x: 0, y: 120, w: 100, h: 40, props: { md: 'z' }, action: [{ type: 'navigate', to: '\x01javascript:alert(1)' }] }];
  const ps = refusal(envelope({ blocks }));
  has(ps, 'doc.blocks[0].action[0].to', 'unsafe_url');
  has(ps, 'doc.blocks[1].action[0].url', 'unsafe_url');
  has(refusal(envelope({ blocks: [{ ...blocks[1], action: [{ type: 'external', url: 'http://plain.example/' }] }] })), 'doc.blocks[0].action[0].url', 'https_only');
  has(ps, 'doc.blocks[2].action[0].to', 'unsafe_url');
  saveRefuses({ v: 2, frames: F, blocks }, 'blocks[0].action[0].to', 'unsafe_url');
  // The legacy fields an export never writes are not a way round it.
  has(refusal(envelope({ blocks: [{ ...txt('l', 'x'), link: 'javascript:alert(1)' }] })), 'doc.blocks[0].link', 'unknown_field');
  has(refusal(envelope({ blocks: [{ id: 'p', kind: 'button', x: 0, y: 0, w: 10, h: 10, props: { label: 'x', action: { type: 'download', href: 'https://evil.example/x.exe' } } }] })), 'doc.blocks[0].props.action', 'unknown_field');
});

test('hostile: a picture or a file from another site is refused, wherever it hides', () => {
  const cases = [
    [{ blocks: [{ id: 'i', kind: 'image', x: 0, y: 0, w: 10, h: 10, props: { src: 'https://evil.example/pixel.png' } }] }, 'doc.blocks[0].props.src'],
    [{ blocks: [{ id: 'i', kind: 'image', x: 0, y: 0, w: 10, h: 10, props: { src: '//evil.example/pixel.png' } }] }, 'doc.blocks[0].props.src'],
    [{ blocks: [{ id: 'i', kind: 'image', x: 0, y: 0, w: 10, h: 10, props: { src: 'data:image/svg+xml,<svg/>' } }] }, 'doc.blocks[0].props.src'],
    [{ blocks: [{ id: 'v', kind: 'video', x: 0, y: 0, w: 10, h: 10, props: { src: '/uploads/a.mp4', poster: 'http://evil.example/p.jpg' } }] }, 'doc.blocks[0].props.poster'],
    [{ blocks: [{ id: 'i', kind: 'image', x: 0, y: 0, w: 10, h: 10, props: { src: '/uploads/a.png' }, themes: { dark: { props: { src: 'https://evil.example/d.png' } } } }] }, 'doc.blocks[0].themes.dark.props.src'],
    [{ blocks: [{ id: 'r', kind: 'replay', x: 0, y: 0, w: 10, h: 10, props: { src: '/uploads/../../etc/passwd' } }] }, 'doc.blocks[0].props.src'],
  ];
  for (const [doc, path] of cases) has(refusal(envelope(doc)), path, 'asset_off_site');
  // In a definition, and through an instance's override of an exposed picture.
  const def = { name: 'C', scope: 'site', doc: { v: 2, frames: F, blocks: [{ id: 'p', kind: 'image', x: 0, y: 0, w: 10, h: 10, props: { src: 'https://evil.example/x.png' } }] }, exposed: [{ key: 'pic', block: 'p', field: 'props.src' }] };
  has(refusal(envelope({ blocks: [{ id: 'i', kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: 'c' } }] }, { components: { c: def } })), 'components.c.doc.blocks[0].props.src', 'asset_off_site');
  const clean = { ...def, doc: { ...def.doc, blocks: [{ ...def.doc.blocks[0], props: { src: '/uploads/ok.png' } }] } };
  has(refusal(envelope({ blocks: [{ id: 'i', kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: 'c', overrides: { pic: 'https://evil.example/o.png' } } }] }, { components: { c: clean } })), 'doc.blocks[0].component.overrides.pic', 'asset_off_site');
  // A download step and a page background: refused by the save's own rules too.
  has(refusal(envelope({ blocks: [{ id: 'd', kind: 'button', x: 0, y: 0, w: 10, h: 10, props: { label: 'x' }, action: [{ type: 'download', file: 'https://evil.example/x.exe' }] }] })), 'doc.blocks[0].action[0].file', 'unsafe_url');
  const bgDoc = { background: { type: 'image', src: 'https://evil.example/bg.jpg', fit: 'cover', position: 'center' }, blocks: [] };
  has(refusal(envelope(bgDoc)), 'doc.background.src', 'asset_off_site');
  // The file's own asset list is checked too.
  has(refusal(envelope({ blocks: [] }, { assets: ['https://evil.example/a.png'] })), 'assets[0]', 'asset_off_site');
});

test('hostile: loops and depth bombs are refused (components and containers), as a save refuses them', () => {
  const inst = (id, cid, extra = {}) => ({ id, kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: cid }, ...extra });
  const def = (blocks) => ({ name: 'D', scope: 'site', doc: { v: 2, frames: F, blocks }, exposed: [] });
  // a > b > a
  const loop = { a: def([inst('x', 'b')]), b: def([inst('y', 'a')]) };
  const ps = refusal(envelope({ blocks: [inst('i', 'a')] }, { components: loop }));
  assert.ok(ps.some((p) => p.reason === 'component_cycle'), JSON.stringify(ps));
  // A component file whose definition holds itself.
  const self = { format: 'bcw-studio', version: 1, kind: 'component', id: 'card', name: 'Card', doc: { v: 2, frames: F, blocks: [txt('t', 'x'), inst('n', 'card', { y: 100 })] }, components: { card: def([txt('u', 'y')]) }, exposed: [], assets: [] };
  assert.ok(refusal(self).some((p) => p.reason === 'component_cycle'));
  // Five levels of components (at most three).
  const deep = { l1: def([inst('a', 'l2')]), l2: def([inst('b', 'l3')]), l3: def([inst('c', 'l4')]), l4: def([inst('d', 'l5')]), l5: def([txt('e', 'deep')]) };
  assert.ok(refusal(envelope({ blocks: [inst('i', 'l1')] }, { components: deep })).some((p) => p.reason === 'instance_too_deep'));
  // An expansion bomb: 40 x 40 x 40 blocks once unfolded.
  const many = (cid) => Array.from({ length: 40 }, (_, i) => inst(`k${i}`, cid, { y: i * 10 }));
  const bomb = { c0: def(Array.from({ length: 40 }, (_, i) => txt(`t${i}`, 'x', { y: i * 90 }))), c1: def(many('c0')), c2: def(many('c1')) };
  const bombDoc = { blocks: [inst('i', 'c2')] };
  has(refusal(envelope(bombDoc, { components: bomb })), 'doc.blocks', 'too_many_expanded');
  saveRefuses({ v: 2, frames: F, ...bombDoc, components: bomb }, 'blocks', 'too_many_expanded');
  // Containers four deep (at most three).
  const boxes = [{ id: 'g1', kind: 'group', x: 0, y: 0, w: 900, h: 900 }, { id: 'g2', kind: 'group', x: 0, y: 0, w: 800, h: 800, parent: 'g1' },
    { id: 'g3', kind: 'group', x: 0, y: 0, w: 700, h: 700, parent: 'g2' }, { id: 'g4', kind: 'group', x: 0, y: 0, w: 600, h: 600, parent: 'g3' },
    txt('t4', 'four deep', { parent: 'g4' })];
  assert.ok(refusal(envelope({ blocks: boxes })).some((p) => p.reason === 'too_deep' && p.path.startsWith('doc.blocks[')));
  // A container that contains itself through another.
  const cyc = [{ id: 'p', kind: 'group', x: 0, y: 0, w: 100, h: 100, parent: 'q' }, { id: 'q', kind: 'group', x: 0, y: 0, w: 100, h: 100, parent: 'p' }];
  assert.ok(refusal(envelope({ blocks: cyc })).some((p) => p.reason === 'cycle'));
  // A JSON nesting bomb: refused by the reader, before anything recursive runs.
  const nest = `{"format":"bcw-studio","version":1,"kind":"page","doc":{"v":2,"blocks":[],"x":${'['.repeat(200_000)}${']'.repeat(200_000)}}}`;
  const p = refusal(nest);
  assert.equal(p[0].reason, 'json_too_deep');
  assert.equal(parseGuardedJson(`${'['.repeat(MAX_JSON_DEPTH)}${']'.repeat(MAX_JSON_DEPTH)}`).ok, true, 'the depth limit refuses what it allows');
});

test('hostile: an oversized file is refused before it is parsed', () => {
  const big = `{"format":"bcw-studio","x":"${'a'.repeat(MAX_FILE_BYTES)}"}`;
  assert.deepEqual(refusal(big), [{ path: '', reason: 'file_too_large' }]);
  // Not JSON at all, and too large: the size is what is said (nothing was parsed).
  assert.deepEqual(refusal('{'.repeat(MAX_FILE_BYTES + 1)), [{ path: '', reason: 'file_too_large' }]);
  // Counted in UTF-8 bytes: 700 000 three-byte characters are 2.1 MB.
  assert.equal(utf8Bytes('あ'), 3);
  assert.deepEqual(refusal(`"${'あ'.repeat(700_000)}"`), [{ path: '', reason: 'file_too_large' }]);
  // A document over the page limit inside a file under the file limit: the save's own rule.
  const heavy = envelope({ blocks: [txt('t', 'x'.repeat(LIMITS.bytes))] });
  has(refusal(heavy), 'doc', 'too_large');
});

test('the size cap holds every file an export of a valid page can produce', () => {
  // The worst shape for indentation: as many small, deep blocks as the page limit allows.
  const blocks = [];
  let doc;
  for (let i = 0; ; i++) {
    const b = { id: `b${i}`, kind: 'button', x: i, y: i, w: 10, h: 10, z: i, props: { label: 'x' }, action: [{ type: 'scroll', target: '#top' }, { type: 'theme', mode: 'toggle' }] };
    const next = { v: 2, frames: F, blocks: [...blocks, b] };
    if (JSON.stringify(next).length > LIMITS.bytes - 2000 || blocks.length >= LIMITS.blocks) break;
    blocks.push(b); doc = next;
  }
  assert.deepEqual(validateDoc({ ...doc, id: 'p' }), [], 'the worst-case page is not valid, the measure means nothing');
  const compact = JSON.stringify(doc).length;
  const text = studioFileText(exportStudioFile({ kind: 'page', doc }).file);
  const ratio = utf8Bytes(text) / compact;
  // The bound io.js states: every compact character at most 3 bytes, plus what indentation adds
  // on top of the structure, (ratio - 1) per compact character at worst.
  assert.ok(ratio < 2.5, `indenting a structure-heavy page costs ${ratio.toFixed(2)}x, more than io.js says (under 2.5x)`);
  assert.ok((3 + ratio - 1) * LIMITS.bytes < MAX_FILE_BYTES, `the worst page (${((3 + ratio - 1) * LIMITS.bytes / 1e6).toFixed(2)} MB) does not fit the cap`);
  assert.ok(utf8Bytes(text) < MAX_FILE_BYTES, `a valid page exports to ${utf8Bytes(text)} bytes, over the cap`);
  // The heaviest characters: a page of three-byte text just under the page limit.
  const cjk = { v: 2, frames: F, blocks: [txt('t', 'あ'.repeat(LIMITS.bytes - 400))] };
  assert.deepEqual(validateDoc({ ...cjk, id: 'p' }), []);
  const t2 = studioFileText(exportStudioFile({ kind: 'page', doc: cjk }).file);
  assert.ok(utf8Bytes(t2) < MAX_FILE_BYTES, `a valid text page exports to ${utf8Bytes(t2)} bytes, over the cap`);
  assert.equal(parseStudioFile(t2).ok, true, 'a valid page, exported, is refused on import');
});

test('hostile: duplicate ids are refused, as a save refuses them', () => {
  const blocks = [txt('a', 'one'), txt('a', 'two', { y: 100 })];
  has(refusal(envelope({ blocks })), 'doc.blocks[1].id', 'duplicate_id');
  saveRefuses({ v: 2, frames: F, blocks }, 'blocks[1].id', 'duplicate_id');
  // Inside a definition too.
  const def = { name: 'D', scope: 'site', doc: { v: 2, frames: F, blocks: [txt('x', '1'), txt('x', '2', { y: 90 })] }, exposed: [] };
  has(refusal(envelope({ blocks: [{ id: 'i', kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: 'd' } }] }, { components: { d: def } })), 'components.d.doc.blocks[1].id', 'duplicate_id');
});

test('hostile: __proto__, constructor and prototype are refused as keys anywhere, and pollute nothing', () => {
  const texts = [
    ['{"format":"bcw-studio","version":1,"kind":"page","__proto__":{"polluted":1},"doc":{"v":2,"blocks":[]}}', '__proto__'],
    ['{"format":"bcw-studio","version":1,"kind":"page","doc":{"v":2,"blocks":[{"id":"a","kind":"text","x":0,"y":0,"w":9,"h":9,"props":{"constructor":{"prototype":{"polluted":1}}}}]}}', 'doc.blocks[0].props.constructor'],
    ['{"format":"bcw-studio","version":1,"kind":"page","doc":{"v":2,"blocks":[]},"components":{"__proto__":{"name":"x","scope":"site","doc":{"v":2,"blocks":[]},"exposed":[]}}}', 'components.__proto__'],
    ['{"format":"bcw-studio","version":1,"kind":"page","doc":{"v":2,"blocks":[{"id":"i","kind":"instance","x":0,"y":0,"w":8,"h":8,"component":{"id":"c","overrides":{"__proto__":{"polluted":1}}}}]}}', 'doc.blocks[0].component.overrides.__proto__'],
    ['{"format":"bcw-studio","version":1,"kind":"component","doc":{"v":2,"blocks":[{"id":"a","kind":"text","x":0,"y":0,"w":9,"h":9}]},"exposed":[{"key":"k","block":"a","field":"props.md","prototype":1}]}', 'exposed[0].prototype'],
  ];
  for (const [text, path] of texts) has(refusal(text), path, 'forbidden_key');
  assert.equal(({}).polluted, undefined, 'Object.prototype was polluted');
  // The save path: a reserved name as a component id, an exposed key or an override key.
  const def = { name: 'C', scope: 'site', doc: { v: 2, frames: F, blocks: [txt('t', 'x')] }, exposed: [{ key: 'constructor', block: 't', field: 'props.md' }] };
  const ps = validateDoc({ v: 2, id: 'p', frames: F, blocks: [{ id: 'i', kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: 'constructor' } }], components: { constructor: def } });
  assert.ok(ps.some((p) => p.path === 'components.constructor' && p.reason === 'bad_id'), JSON.stringify(ps));
  assert.ok(validateDoc({ v: 2, id: 'p', frames: F, blocks: [{ id: 'i', kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: '__proto__' } }] })
    .some((p) => p.reason === 'unknown_component'), 'an instance of `__proto__` found a definition on Object.prototype');
});

test('hostile: a wrong format, version or kind is refused before anything else is read', () => {
  assert.deepEqual(refusal({ format: 'bcw-studio', version: 2, kind: 'page', doc: {} }), [{ path: 'version', reason: 'unsupported_version' }]);
  assert.deepEqual(refusal({ format: 'bcw-studio', kind: 'page', doc: {} }), [{ path: 'version', reason: 'unsupported_version' }]);
  assert.deepEqual(refusal({ format: 'something-else', version: 1 }), [{ path: 'format', reason: 'bad_format' }]);
  assert.deepEqual(refusal('not json at all'), [{ path: '', reason: 'bad_json' }]);
  has(refusal({ format: 'bcw-studio', version: 1, kind: 'script', doc: {} }), 'kind', 'bad_kind');
  // The envelope is closed, and the document is a v2 document without id, visibility or map.
  has(refusal(envelope({ blocks: [] }, { extra: 1 })), 'extra', 'unknown_field');
  has(refusal({ ...envelope({ blocks: [] }), doc: { v: 1, blocks: [] } }), 'doc.v', 'bad_value');
  has(refusal(envelope({ blocks: [], components: {} })), 'doc.components', 'not_allowed');
  has(refusal(envelope({ blocks: [] }, { exposed: [] })), 'exposed', 'not_allowed');
  assert.deepEqual(STUDIO_FILE_KINDS, ['page', 'component', 'preset:page', 'preset:section', 'preset:background', 'preset:component']);
});

test('a component or preset file meets the library\'s own entry rule (the one the API runs)', () => {
  // A background preset with blocks, a section without any, a component of 41 blocks.
  has(refusal({ format: 'bcw-studio', version: 1, kind: 'preset:background', name: 'B', doc: { v: 2, frames: F, blocks: [txt('a', 'x')] }, assets: [] }), 'doc.blocks', 'not_allowed');
  has(refusal({ format: 'bcw-studio', version: 1, kind: 'preset:section', name: 'S', doc: { v: 2, frames: F, blocks: [] }, assets: [] }), 'doc.blocks', 'required');
  const many = Array.from({ length: 41 }, (_, i) => txt(`t${i}`, 'x', { y: i * 90 }));
  has(refusal({ format: 'bcw-studio', version: 1, kind: 'component', name: 'C', doc: { v: 2, frames: F, blocks: many }, exposed: [], assets: [] }), 'doc.blocks', 'too_many');
  // An exposed field on a block that is not there.
  has(refusal({ format: 'bcw-studio', version: 1, kind: 'component', name: 'C', doc: { v: 2, frames: F, blocks: [txt('a', 'x')] }, exposed: [{ key: 'k', block: 'zz', field: 'props.md' }], assets: [] }), 'exposed[0].block', 'unknown_block');
  // The rule is one function: the same entry, through it directly, says the same.
  const entry = { id: 'x', name: 'C', sort: 'component', doc: { v: 2, frames: F, blocks: many }, exposed: [] };
  assert.ok(libraryEntryProblems(entry, 'entries[0]').some((p) => p.path === 'entries[0].doc.blocks' && p.reason === 'too_many'));
});

test('an import is checked against the site\'s link policy, like a save', () => {
  const doc = { blocks: [{ id: 'a', kind: 'button', x: 0, y: 0, w: 10, h: 10, props: { label: 'x' }, action: [{ type: 'external', url: 'https://blocked.example/' }] }] };
  const file = envelope(doc);
  assert.deepEqual(studioFileProblems(file), [], 'the default policy lets every https host through');
  assert.ok(studioFileProblems(file, { links: { mode: 'block', hosts: ['blocked.example'] } }).some((p) => p.reason === 'host_not_allowed'));
});

// ── The paste ─────────────────────────────────────────────────────────────────────────────
test('a paste of blocks goes through the same reader: hostile blocks refused with their field', () => {
  const hostile = [{ id: 'a', kind: 'image', x: 0, y: 0, w: 10, h: 10, props: { src: 'https://evil.example/p.png' } }, { id: 'b', kind: 'button', x: 0, y: 20, w: 10, h: 10, props: { label: 'x' }, action: [{ type: 'navigate', to: 'javascript:alert(1)' }] }];
  const r = parseBlocksPaste(JSON.stringify({ bcwBlocks: hostile }));
  assert.equal(r.ok, false);
  has(r.problems, 'bcwBlocks[0].props.src', 'asset_off_site');
  has(r.problems, 'bcwBlocks[1].action[0].to', 'unsafe_url');
  // Identical to the same blocks in a file (the paths said in the clipboard's terms).
  const f = studioFileProblems({ format: 'bcw-studio', version: 1, kind: 'preset:section', name: 'S', doc: { v: 2, frames: F, blocks: hostile } });
  assert.deepEqual(r.problems, f.map((p) => ({ ...p, path: p.path.replace(/^doc\.blocks/, 'bcwBlocks') })));
  // A copy dropped before a hostile block: the path still names the block as copied.
  const shifted = parseBlocksPaste(JSON.stringify({ bcwBlocks: [{ id: 'z', kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: 'gone' } }, ...hostile] }));
  has(shifted.problems, 'bcwBlocks[1].props.src', 'asset_off_site');
  // The in-memory copy is read the same way (through its text).
  assert.deepEqual(parseBlocksPaste(hostile).problems, r.problems);
  // A reserved key in the clipboard, and a clipboard that is not ours.
  has(parseBlocksPaste('{"bcwBlocks":[{"id":"a","kind":"text","x":0,"y":0,"w":9,"h":9,"__proto__":{"x":1}}]}').problems, 'bcwBlocks[0].__proto__', 'forbidden_key');
  assert.deepEqual(parseBlocksPaste('hello').problems, [{ path: '', reason: 'bad_json' }]);
  assert.deepEqual(parseBlocksPaste('{"text":"x"}').problems, [{ path: '', reason: 'bad_format' }]);
});

test('a paste keeps a copy of this page\'s component linked, drops one it cannot resolve, and gets fresh ids', () => {
  const map = { card: CARD, badge: BADGE };
  const blocks = [
    { id: 'g', kind: 'group', x: 0, y: 0, w: 400, h: 300 }, txt('t', 'inside', { parent: 'g', x: 8, y: 8 }),
    { id: 'i1', kind: 'instance', x: 0, y: 400, w: 8, h: 8, component: { id: 'card', overrides: { title: 'Mine' } } },
    { id: 'i2', kind: 'instance', x: 0, y: 500, w: 8, h: 8, component: { id: 'elsewhere' } },
  ];
  const r = parseBlocksPaste(JSON.stringify({ bcwBlocks: blocks }), map);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.dropped, 1);
  let k = 0;
  const f = freshStudioFile(r.file, { uid: () => `p${k++}`, keepComponents: true, taken: ['g', 't', 'i1', 'p0'] });
  const out = f.doc.blocks;
  assert.equal(out.length, 3);
  assert.ok(out.every((b) => !['g', 't', 'i1', 'p0'].includes(b.id)), 'a pasted block kept or took an id already on the page');
  assert.equal(out[1].parent, out[0].id, 'the pasted block is not inside the copy of its container');
  assert.deepEqual(out[2].component, { id: 'card', overrides: { title: 'Mine' } }, 'the pasted copy is not linked to this page\'s component any more');
});

// studiofix: the LIBRARY LINK. A page's definition is keyed by its library entry's id and says
// which library (`scope`, `ref`): that pair is how "Update the copies" finds the newer version.
// Born red: an import renamed every definition, and a paste dropped every copy of a component
// the destination page did not hold yet, so an imported or pasted copy never updated again.
test('an import from this site keeps each copy linked to its library component', () => {
  const here = 'https://bettercommunity.test';
  const { file } = exportStudioFile({ kind: 'page', doc: STORED, id: 'home1', origin: here });
  const parsed = parseStudioFile(studioFileText(file));
  assert.equal(parsed.ok, true);
  let k = 0;
  const f = freshStudioFile(parsed.file, { uid: () => `n${k++}`, componentUid: () => `k${k++}`, origin: here });
  // The definitions keep the library's ids and the library they name.
  assert.deepEqual(Object.keys(f.doc.components).sort(), ['badge', 'card'], 'a linked definition was renamed: its library entry is lost');
  assert.equal(f.doc.components.card.scope, 'project');
  assert.equal(f.doc.components.card.ref, 'bmm');
  assert.equal(f.doc.components.badge.scope, 'site');
  // Every copy still names its definition (the page's and the one nested in the card).
  const inst = f.doc.blocks.filter((b) => b.kind === 'instance');
  assert.deepEqual(inst.map((b) => b.component.id), ['card', 'card']);
  assert.equal(f.doc.components.card.doc.blocks.find((b) => b.kind === 'instance').component.id, 'badge');
  // The blocks themselves are still new (nothing of the file collides with the page).
  const before = new Set(allIds(STORED));
  for (const id of allIds(f.doc)) assert.ok(!before.has(id), `block id ${id} was reused`);
  assert.deepEqual(validateDoc({ ...f.doc, id: 'p9' }), []);
  // From ANOTHER site the link names that site's library, which is not this one: fresh ids.
  const other = freshStudioFile(parsed.file, { uid: () => `n${k++}`, componentUid: () => `k${k++}`, origin: 'https://elsewhere.test' });
  assert.ok(!Object.keys(other.doc.components).some((cid) => ['badge', 'card'].includes(cid)));
  // A definition with no library behind it (a personal one) is not a link to keep either.
  const mine = { ...STORED, components: { ...STORED.components, card: { ...STORED.components.card, scope: 'user' } } };
  const g = freshStudioFile(parseStudioFile(studioFileText(exportStudioFile({ kind: 'page', doc: mine, origin: here }).file)).file, { uid: () => `n${k++}`, componentUid: () => `k${k++}`, origin: here });
  assert.ok(!('card' in g.doc.components) && 'badge' in g.doc.components);
  assert.deepEqual(validateDoc({ ...g.doc, id: 'p9' }), []);
});

test('a paste onto another page brings the copied components along, still linked', () => {
  const copied = [
    { id: 'i1', kind: 'instance', x: 0, y: 0, w: 8, h: 8, component: { id: 'card', overrides: { title: 'Mine' } } },
    { id: 'i2', kind: 'instance', x: 0, y: 400, w: 8, h: 8, component: { id: 'nowhere' } },
  ];
  // The destination page has none of these definitions; the clipboard carries them.
  const r = parseBlocksPaste(JSON.stringify({ bcwBlocks: copied, bcwComponents: { card: CARD, badge: BADGE } }), {});
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.dropped, 1, 'only the copy of a definition nobody carries is left out');
  assert.deepEqual(Object.keys(r.file.components).sort(), ['badge', 'card'], 'the definitions (and the one the card uses) came along');
  assert.deepEqual(r.added.sort(), ['badge', 'card']);
  const f = freshStudioFile(r.file, { uid: () => 'x' + Math.random().toString(36).slice(2, 8), keepComponents: true });
  assert.deepEqual(f.doc.blocks[0].component, { id: 'card', overrides: { title: 'Mine' } });
  assert.equal(f.doc.components.card.scope, 'project');
  // The page's own version of a definition wins over the clipboard's, and is not "added".
  const mine = { card: { ...CARD, name: 'Card (this page)' }, badge: BADGE };
  const r2 = parseBlocksPaste({ bcwBlocks: copied, bcwComponents: { card: CARD, badge: BADGE } }, mine);
  assert.equal(r2.file.components.card.name, 'Card (this page)');
  assert.deepEqual(r2.added, []);
  // The clipboard's definitions are untrusted input: checked by the same reader.
  const evil = { ...CARD, doc: { ...CARD.doc, blocks: [{ id: 'e', kind: 'image', x: 0, y: 0, w: 9, h: 9, props: { src: 'https://evil.example/p.png' } }] }, exposed: [] };
  const r3 = parseBlocksPaste(JSON.stringify({ bcwBlocks: copied.slice(0, 1).map((b) => ({ ...b, component: { id: 'card' } })), bcwComponents: { card: evil } }), {});
  assert.equal(r3.ok, false);
  has(r3.problems, 'components.card.doc.blocks[0].props.src', 'asset_off_site');
  assert.equal(parseBlocksPaste(JSON.stringify({ bcwBlocks: copied, bcwComponents: [1] }), {}).ok, false, 'a clipboard map that is not a map');
});

test('assetRefs finds every address the format carries', () => {
  const refs = assetRefs(STORED).map((r) => r.path).sort();
  assert.deepEqual(refs, [
    'background.src', 'blocks[9].component.overrides.pic', 'blocks[6].props.src', 'blocks[6].themes.dark.props.src', 'blocks[8].action[1].file',
    'components.card.doc.blocks[2].props.src',
  ].sort());
});

test('every reason the reader gives has words, in the studio\'s own terms', () => {
  const t = (_k, f) => f;
  for (const r of ['file_too_large', 'bad_json', 'bad_format', 'unsupported_version', 'bad_kind', 'forbidden_key', 'json_too_deep', 'asset_off_site', 'duplicate_id', 'no_library', 'not_here',
    'unsafe_url', 'https_only', 'component_cycle', 'instance_too_deep', 'too_many_expanded', 'too_deep', 'cycle', 'not_exposed', 'too_large', 'unknown_field', 'not_allowed', 'required', 'too_many', 'unknown_block']) {
    const w = reasonWords(t, r);
    assert.ok(w && w !== r && w.includes(' '), `no words for ${r}`);
  }
});
