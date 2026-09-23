// The page preview: the real route in a frame, fed the draft by postMessage (PLAN-STUDIO-2026
// bug B). What can be pinned without a browser is pinned here: the URL, who a draft is taken
// from, which tab a page offers, and that the pages ask these functions instead of keeping a
// second copy of the rule.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  framedPreviewUrl, draftMessage, acceptDraft, isReady, canvasTabsFor, previewReasons, PREVIEW_PARAM, PAGE_DEVICES,
} from '../src/lib/studio-preview.js';

describe('the framed route', () => {
  test('each kind frames its REAL route, on the canvas tab, with the preview flag', () => {
    assert.equal(framedPreviewUrl('project', 'bmm', 'c1'), `/p/bmm?tab=c-c1&${PREVIEW_PARAM}=1`);
    assert.equal(framedPreviewUrl('showcase', 'my-app', 'x y'), `/project/my-app?tab=c-x%20y&${PREVIEW_PARAM}=1`);
    assert.equal(framedPreviewUrl('home', 'home', 'cv-s1'), `/?${PREVIEW_PARAM}=1`);
    assert.deepEqual(PAGE_DEVICES, { desktop: 1280, tablet: 820, phone: 390 });
  });
});

describe('who a draft is taken from', () => {
  const parent = { name: 'studio' };
  const ctx = { origin: 'https://bettercommunity.test', parent };
  const ok = { origin: ctx.origin, source: parent, data: draftMessage('project', { key: 'bmm', config: {}, tab: 'c-1' }) };
  test('the studio that framed the page, same origin, right kind', () => {
    assert.deepEqual(acceptDraft(ok, 'project', ctx), { key: 'bmm', config: {}, tab: 'c-1' });
  });
  test('anything else is ignored', () => {
    assert.equal(acceptDraft({ ...ok, origin: 'https://evil.example' }, 'project', ctx), null, 'a draft from another origin was taken');
    assert.equal(acceptDraft({ ...ok, source: {} }, 'project', ctx), null, 'a draft from a window other than the parent was taken');
    assert.equal(acceptDraft(ok, 'home', ctx), null, 'a project draft was taken by the home page');
    assert.equal(acceptDraft({ ...ok, data: { type: 'other', kind: 'project', payload: {} } }, 'project', ctx), null);
    assert.equal(acceptDraft({ ...ok, data: 'x' }, 'project', ctx), null);
    assert.equal(acceptDraft(null, 'project', ctx), null);
  });
  test('the studio only answers its own frame', () => {
    const frame = {};
    assert.equal(isReady({ origin: ctx.origin, source: frame, data: { type: 'bcw-studio-ready' } }, { origin: ctx.origin, frame }), true);
    assert.equal(isReady({ origin: 'https://evil.example', source: frame, data: { type: 'bcw-studio-ready' } }, { origin: ctx.origin, frame }), false);
    assert.equal(isReady({ origin: ctx.origin, source: {}, data: { type: 'bcw-studio-ready' } }, { origin: ctx.origin, frame }), false);
  });
});

describe('which canvas tabs a page offers', () => {
  const cfg = (extra = {}) => ({ studioEnabled: true, canvases: [
    { id: 'done', title: 'Done', blocks: [{ id: 'b' }] },
    { id: 'fresh', title: '', blocks: [] },
  ], ...extra });
  test('visitors: studio on, a title, a block', () => {
    assert.deepEqual(canvasTabsFor(cfg()).map((c) => c.id), ['done']);
    assert.deepEqual(canvasTabsFor(cfg({ studioEnabled: false })), []);
  });
  test('the preview offers the page being previewed whatever its state (it used to fall back to Overview)', () => {
    const tabs = canvasTabsFor(cfg(), 'c-fresh', 'Untitled page');
    assert.deepEqual(tabs.map((c) => c.id), ['done', 'fresh']);
    assert.equal(tabs[1].title, 'Untitled page', 'an untitled page has an empty tab label');
    assert.deepEqual(canvasTabsFor(cfg({ studioEnabled: false }), 'c-done').map((c) => c.id), ['done'], 'studio off: the previewed page is still offered');
    assert.deepEqual(canvasTabsFor(cfg(), 'c-nope').map((c) => c.id), ['done']);
  });
  test('and the studio says why visitors do not see it yet', () => {
    assert.deepEqual(previewReasons('project', { studioEnabled: false }, { title: '', blocks: [] }), ['studio_off', 'untitled', 'empty']);
    assert.deepEqual(previewReasons('project', { studioEnabled: true }, { title: 'T', blocks: [{}] }), []);
    assert.deepEqual(previewReasons('home', {}, { blocks: [] }, { enabled: false }), ['section_off', 'empty']);
  });
});

test('the pages ask these functions rather than keeping their own copy of the rule', () => {
  const project = readFileSync(new URL('../src/pages/project.jsx', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../src/pages/home.jsx', import.meta.url), 'utf8');
  assert.match(project, /useFramedDraft\('project'\)/, 'ProjectPage does not listen for a framed draft');
  assert.match(project, /useFramedDraft\('showcase'\)/, 'ShowcaseProjectPage does not listen for a framed draft');
  assert.equal((project.match(/canvasTabsFor\(/g) || []).length, 2, 'both project pages must build their canvas tabs with canvasTabsFor');
  assert.ok(!/cv\.blocks\.length\)/.test(project), 'a project page still filters its canvas tabs by hand');
  assert.match(home, /useFramedDraft\('home'\)/, 'Home does not listen for a framed draft');
});
