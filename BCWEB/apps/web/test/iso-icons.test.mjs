// G5 (agent-icons-G5): the isometric icon family, `iso:<name>`.
//
// 83 third-party SVGs are served to every visitor who opens an icon picker or reads a document
// that names one. They were run through the studio's allow-list sanitiser when they were built
// (scripts/build-iso-icons.mjs); this checks what is COMMITTED, so a hand edit, a re-export
// from an editor or a sanitiser that got stricter shows up here and not on somebody's page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSvg, svgRefusals } from '../../../packages/studio/src/svg-safe.js';
import { glyphSource } from '../src/lib/glyph-svg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '../public/icons/iso');
const KIT = join(HERE, '../../../packages/bmd/assets/iso');
const ICONS_JSX = join(HERE, '../../../packages/bmd/src/icons.jsx');

const svgs = readdirSync(PUB).filter((f) => f.endsWith('.svg')).sort();
const manifest = JSON.parse(readFileSync(join(PUB, 'icons.json'), 'utf8'));
const licences = readFileSync(join(PUB, 'LICENSES.txt'), 'utf8');

// ISO_NAMES is written in icons.jsx (JSX, which node cannot import), as string pieces joined
// and split on spaces. Read the pieces back out of the source.
const src = readFileSync(ICONS_JSX, 'utf8');
const block = /export const ISO_NAMES = \(([\s\S]*?)\)\.split\(' '\);/.exec(src);
const isoNames = block ? [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).join('').split(' ') : [];

test('the family is there at all (a check over zero files passes)', () => {
  assert.ok(svgs.length >= 80, `only ${svgs.length} svg files in public/icons/iso`);
  assert.ok(isoNames.length >= 80, 'ISO_NAMES could not be read out of packages/bmd/src/icons.jsx');
});

test('every embedded SVG passes the sanitiser unchanged and refuses nothing', () => {
  for (const f of svgs) {
    const body = readFileSync(join(PUB, f), 'utf8').trim();
    assert.equal(sanitizeSvg(body), body, `${f}: the sanitiser would change it`);
    assert.deepEqual(svgRefusals(body), [], `${f}: holds something the sanitiser refuses`);
    assert.match(body, /^<svg\b[^>]*\sviewBox="/, `${f}: not an <svg> root with a viewBox`);
  }
});

test('no SVG points outside itself: no external href, no url() but #fragment, no script, no handler', () => {
  for (const f of svgs) {
    const body = readFileSync(join(PUB, f), 'utf8');
    for (const m of body.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) assert.match(m[1], /^#[\w:.-]+$/, `${f}: href="${m[1]}"`);
    for (const m of body.matchAll(/url\(\s*['"]?([^)'"]*)/gi)) assert.match(m[1], /^#/, `${f}: url(${m[1]})`);
    // The only http(s) text allowed is the SVG namespace itself.
    const urls = [...body.matchAll(/https?:\/\/[^\s"'<>)]+/gi)].map((m) => m[0]).filter((u) => u !== 'http://www.w3.org/2000/svg');
    assert.deepEqual(urls, [], `${f}: mentions ${urls.join(', ')}`);
    assert.doesNotMatch(body, /<script|<foreignObject|<image\b|<iframe|<style\b|javascript:|\son[a-z]+\s*=/i, `${f}: active content`);
  }
});

test('the names agree: files, icons.json and ISO_NAMES in the renderer', () => {
  const files = svgs.map((f) => f.replace(/\.svg$/, '')).sort();
  assert.deepEqual([...isoNames].sort(), files, 'ISO_NAMES in icons.jsx and the files on disk differ; rerun build-iso-icons.mjs and paste its name list');
  assert.deepEqual(manifest.icons.map((i) => i.n).sort(), files);
  for (const n of files) assert.match(n, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${n}: not kebab-case (the name becomes a URL path)`);
});

test('the kit copy and the site copy are the same files', () => {
  const kit = readdirSync(KIT).sort();
  assert.deepEqual(readdirSync(PUB).sort(), kit);
  for (const f of kit) assert.equal(readFileSync(join(PUB, f), 'utf8'), readFileSync(join(KIT, f), 'utf8'), `${f} differs between public/icons/iso and packages/bmd/assets/iso`);
});

test('every icon is credited, and every licence the sets need is reproduced', () => {
  for (const { n, s } of manifest.icons) {
    assert.ok(licences.includes(`iso:${n}  <-  `), `${n} has no line in LICENSES.txt`);
    assert.ok(manifest.sets.some((x) => x.id === s), `${n}: set ${s} is not described`);
  }
  for (const set of manifest.sets) {
    assert.match(set.commit, /^[0-9a-f]{40}$/, `${set.id}: no pinned commit`);
    assert.ok(licences.includes(set.commit), `${set.id}: its commit is not in LICENSES.txt`);
    assert.ok(licences.includes(set.url), `${set.id}: its source URL is not in LICENSES.txt`);
  }
  assert.ok(licences.includes('Copyright 2023 Mark Mankarious'), 'Isoflow MIT notice missing');
  assert.ok(licences.includes('Copyright (c) 2018 Rich'), 'MI2 MIT notice missing');
  assert.ok(licences.includes('Copyright (c) 2018 Gbolahan Fawale'), 'Jolloficons MIT notice missing');
  assert.match(licences, /Apache License[\s\S]*Version 2\.0, January 2004[\s\S]*END OF TERMS AND CONDITIONS/, 'Apache-2.0 text (Material glyphs in MI2) missing');
});

test('a picked iso: name is stored as the hosted image URL, and a crafted one is refused', () => {
  const cfg = { cdn: { iso: (n) => `/icons/iso/${n}.svg` } };
  assert.deepEqual(glyphSource('iso:server', cfg), { kind: 'url', url: '/icons/iso/server.svg' });
  assert.deepEqual(glyphSource('isometric:cube-cloud', cfg), { kind: 'url', url: '/icons/iso/cube-cloud.svg' });
  assert.equal(glyphSource('iso:../../admin', cfg), null);
  assert.equal(glyphSource('iso:server', { cdn: { iso: null } }), null);
});
