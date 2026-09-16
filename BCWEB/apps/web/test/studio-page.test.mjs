// The studio route: its URL, its parameters, its draft keys, the config write and zoom steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  studioPath, parseStudioParams, handoffKey, draftKey, withCanvasAt, stepZoom, ZOOM_STEPS, saveState,
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
