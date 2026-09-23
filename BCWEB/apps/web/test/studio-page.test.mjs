// The studio route: its URL, its parameters, its draft keys, the config write and zoom steps.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  studioPath, parseStudioParams, handoffKey, draftKey, canvasAt, blankCanvasAt, withCanvasAt, stepZoom, ZOOM_STEPS, saveState, STUDIO_KINDS,
} from '../src/lib/studio-page.js';

test('the path and the parser agree', () => {
  assert.equal(studioPath('project', 'bmm', 2), '/studio/project/bmm/2');
  assert.equal(studioPath('showcase', 'my slug'), '/studio/showcase/my%20slug');
  assert.equal(studioPath('bogus', 'x', 0), '/studio/project/x/0', 'an unknown kind falls back rather than building a dead URL');
  assert.deepEqual(parseStudioParams({ kind: 'project', id: 'bmm', index: '2' }), { kind: 'project', id: 'bmm', index: 2 });
  assert.deepEqual(parseStudioParams({ kind: 'showcase', id: 'abc' }), { kind: 'showcase', id: 'abc', index: null });
  assert.equal(parseStudioParams({ kind: 'nope', id: 'x' }).kind, null);
  assert.equal(parseStudioParams({ kind: 'project', id: '  ' }).id, null);
  assert.ok(Number.isNaN(parseStudioParams({ kind: 'project', id: 'x', index: '-1' }).index), 'a negative index is refused, not clamped');
  assert.ok(Number.isNaN(parseStudioParams({ kind: 'project', id: 'x', index: 'abc' }).index));
});

test('draft and handoff keys are per target, and the draft is per canvas', () => {
  assert.notEqual(draftKey('project', 'bmm', 0), draftKey('project', 'bmm', 1));
  assert.notEqual(handoffKey('project', 'bmm'), handoffKey('showcase', 'bmm'));
  assert.ok(draftKey('project', 'bmm', 0).startsWith('bcw_studio_draft:'));
});

test('writing one canvas leaves the rest of the config alone', () => {
  const cfg = { studioEnabled: true, links: { github: 'x' }, canvases: [{ id: 'a', title: 'A', blocks: [] }, { id: 'b', title: 'B', blocks: [] }] };
  const out = withCanvasAt(cfg, 1, { id: 'b', title: 'B', blocks: [{ id: 'k', kind: 'box', x: 0, y: 0, w: 10, h: 10 }] });
  assert.equal(out.links, cfg.links, 'untouched keys are the same objects');
  assert.equal(out.canvases[0], cfg.canvases[0]);
  assert.equal(out.canvases[1].blocks.length, 1);
  assert.notEqual(out, cfg, 'a new object, not a mutation');
  assert.equal(withCanvasAt(cfg, 5, { id: 'z' }), cfg, 'an index past the end writes nothing');
  assert.equal(withCanvasAt(cfg, -1, { id: 'z' }), cfg);
});

test('zoom walks the steps in both directions and stops at the ends', () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom('fit', 1, 0.6), 0.67, 'from fit, the next step above the fit scale');
  assert.equal(stepZoom('fit', -1, 0.6), 0.5);
  assert.equal(stepZoom(2, 1), 2);
  assert.equal(stepZoom(0.25, -1), 0.25);
  assert.equal(stepZoom(0.67, 1), 0.75, 'a step exactly on a level goes to the next one, not itself');
  assert.ok(ZOOM_STEPS.includes(1), 'there is a 100%');
});

test('the save state has one word per situation', () => {
  assert.equal(saveState({ dirty: false }), 'saved');
  assert.equal(saveState({ dirty: true }), 'dirty');
  assert.equal(saveState({ dirty: true, saving: true }), 'saving');
  assert.equal(saveState({ dirty: true, error: true }), 'error');
});

// ── The landing page is a third kind, and it is shaped differently ─────────────────────
//
// A project keeps its drawn pages in `config.canvases`; the home page keeps a list of
// sections an admin wrote, of which any one can be drawn instead of written. So `index`
// means "the nth custom section" there, and the canvas hangs off that section. One route,
// two shapes, and this is where the difference is allowed to live.
describe('the home page in the studio', () => {
  const home = () => ({
    text: { 'home.hero.t': { en: 'Hi' } },
    customSections: [
      { id: 'a', mode: 'md', title: { en: 'Written' }, body: { en: 'the words' } },
      { id: 'b', mode: 'canvas', title: { en: 'Drawn' }, body: { en: 'the words too' }, canvas: { id: 'cv', blocks: [{ id: 'x' }] } },
    ],
  });

  test('home is a studio kind, and an unknown one still falls back to project', () => {
    assert.ok(STUDIO_KINDS.includes('home'));
    assert.equal(studioPath('home', 'home', 1), '/studio/home/home/1');
    assert.equal(studioPath('nonsense', 'x', 0), '/studio/project/x/0');
  });

  test('the index names a section, not an entry in a canvases list', () => {
    assert.equal(canvasAt(home(), 1, 'home').id, 'cv');
    // The written one has no canvas yet: that is null, not an empty canvas, so the studio
    // knows to start a new one rather than believing it opened an existing empty page.
    assert.equal(canvasAt(home(), 0, 'home'), null);
    assert.equal(canvasAt(home(), 5, 'home'), null);
    assert.equal(canvasAt(home(), -1, 'home'), null);
  });

  test('saving a drawing keeps everything else the section carries', () => {
    const next = withCanvasAt(home(), 1, { id: 'cv', blocks: [{ id: 'x' }, { id: 'y' }] }, 'home');
    const sec = next.customSections[1];
    assert.equal(sec.canvas.blocks.length, 2);
    // The words survive. Switching a section to drawn and back must not be how an afternoon
    // of writing disappears.
    assert.equal(sec.body.en, 'the words too');
    assert.equal(sec.title.en, 'Drawn');
    assert.equal(sec.mode, 'canvas');
    // And nothing else on the page moved.
    assert.equal(next.customSections[0].body.en, 'the words');
    assert.deepEqual(next.text, home().text);
  });

  test('a section never drawn opens on a blank page instead of on the chooser', () => {
    // canvasAt stays null for it (nothing is drawn yet); blankCanvasAt is what the studio
    // starts from, with an id stable across opens so the tab's draft still matches it.
    const blank = blankCanvasAt(home(), 0, 'home');
    assert.deepEqual(blank.blocks, []);
    assert.equal(blank.id, 'cv-a');
    assert.equal(blank.title, 'Written');
    assert.deepEqual(blankCanvasAt(home(), 0, 'home'), blank);
    assert.equal(blankCanvasAt(home(), 7, 'home'), null);
    assert.equal(blankCanvasAt({ canvases: [] }, 0, 'project'), null);
  });

  test('saving a drawing on a written section makes it a drawn one', () => {
    const next = withCanvasAt(home(), 0, { id: 'cv-a', blocks: [{ id: 'q' }] }, 'home');
    assert.equal(next.customSections[0].mode, 'canvas');
    assert.equal(next.customSections[0].canvas.blocks.length, 1);
    assert.equal(next.customSections[0].body.en, 'the words');
  });

  test('an index that names nothing writes nothing', () => {
    // A stale bookmark must not append a section to the front page.
    const cfg = home();
    assert.equal(withCanvasAt(cfg, 9, { blocks: [] }, 'home').customSections.length, 2);
    assert.equal(withCanvasAt(cfg, -1, { blocks: [] }, 'home').customSections.length, 2);
  });

  test('the project shape is untouched by all of this', () => {
    const cfg = { canvases: [{ id: 'p1', blocks: [] }] };
    assert.equal(canvasAt(cfg, 0).id, 'p1');
    assert.equal(withCanvasAt(cfg, 0, { blocks: [{ id: 'z' }] }).canvases[0].blocks.length, 1);
    // …and asking for the home shape of a project config finds nothing rather than throwing.
    assert.equal(canvasAt(cfg, 0, 'home'), null);
  });
});

// ── Loading for editing, and saving ONE page (PLAN-STUDIO-2026 phase 0) ─────────────────
// The studio read a project through the PUBLIC `GET /projects/:key`, so a grantee of project
// A opened B's studio; it now loads through the route that asks what saving asks. And it saves
// one page, by id, from the revision it opened, instead of the whole config at an index.
describe('where the studio loads and saves', async () => {
  const lib = await import('../src/lib/studio-page.js');
  test('loading goes through the guarded admin route, never the public GET', () => {
    assert.equal(typeof lib.studioLoadPath, 'function', 'studioLoadPath is not exported');
    assert.equal(lib.studioLoadPath('project', 'bmm'), '/admin/projects/bmm/studio');
    assert.equal(lib.studioLoadPath('showcase', 'my slug'), '/admin/showcase/my%20slug/studio');
    assert.equal(lib.studioLoadPath('home', 'home'), '/admin/studio/home');
    for (const k of ['project', 'showcase', 'home']) assert.ok(!lib.studioLoadPath(k, 'x').startsWith('/projects/'), `${k} loads through the public route`);
  });
  test('a page is saved by id, alone', () => {
    assert.equal(typeof lib.studioSaveRequest, 'function', 'studioSaveRequest is not exported');
    const cv = { id: 'c1', blocks: [] };
    assert.deepEqual(lib.studioSaveRequest('project', 'bmm', 'c1', cv, 'r1'), { path: '/admin/projects/bmm/studio/pages/c1', body: { canvas: cv, base: 'r1' } });
    assert.equal(lib.studioSaveRequest('showcase', 'ck123', 'c 2', cv, '').path, '/admin/showcase/ck123/studio/pages/c%202');
    assert.deepEqual(lib.studioSaveRequest('home', 'home', 'sec-1', cv, 'r2'), { path: '/admin/studio/home/sections/sec-1', body: { canvas: cv, base: 'r2' } });
    // Never the whole config: a save carries one page and the revision it started from.
    for (const k of ['project', 'showcase', 'home']) assert.ok(!('config' in lib.studioSaveRequest(k, 'x', 'p', cv, '').body), `${k} still sends a whole config`);
  });
  test('the page id at an index: the canvas id, or the home section id', () => {
    assert.equal(typeof lib.pageIdAt, 'function', 'pageIdAt is not exported');
    assert.equal(lib.pageIdAt({ canvases: [{ id: 'a' }, { id: 'b' }] }, 1, 'project'), 'b');
    assert.equal(lib.pageIdAt({ customSections: [{ id: 's1', canvas: { id: 'cv-s1' } }] }, 0, 'home'), 's1');
    assert.equal(lib.pageIdAt({ canvases: [] }, 3, 'project'), null);
  });
});
