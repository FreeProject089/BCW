#!/usr/bin/env node
// Build the isometric icon family (`iso:<name>`) from the three upstream sets it is made of.
//
// G5 (agent-icons-G5, Sept 2026). The owner's rule for third-party icons: embed ONLY a set whose
// licence allows redistribution inside software, with the attribution it requires written next
// to it; drop everything else. So this script is also the record of where every file came from:
// it refuses to run unless each source checkout is at the exact commit whose licence was read,
// and it writes LICENSES.txt beside the icons from the same table.
//
//   Isoflow isopack  github.com/markmanx/isopacks, collections/isoflow   MIT, (c) 2023 Mark Mankarious
//   MI2              github.com/richbl/isometric-icons                    MIT, (c) 2018 Rich; glyphs are
//                    Google Material Design Icons, Apache-2.0
//   Jolloficons      github.com/gbmillz/jolloficons (the "Isometric" page) MIT per its README
//
// What was looked at and refused is in packages/bmd/docs/icons.md (Nucleo, the Noun Project,
// SVG Repo, the cloud-vendor and Kubernetes isopacks, and a few more).
//
// Every file goes through the studio's allow-list sanitiser (packages/studio/src/svg-safe.js),
// and what is written is that sanitiser's OUTPUT, so "passes the sanitiser" is true by
// construction; test/iso-icons.test.mjs checks it again on what is committed.
//
// Usage (from apps/web):
//   node scripts/build-iso-icons.mjs --src <dir holding the three clones> [--bmm <BMM frontend/assets/icons/iso>]
// The clones are expected as <src>/isopacks-git, <src>/richbl, <src>/jollof.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sanitizeSvg, svgRefusals } from '../../../packages/studio/src/svg-safe.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SRC = arg('--src');
if (!SRC) { console.error('build-iso-icons: --src <dir> is required (the three upstream clones)'); process.exit(2); }

const OUTS = [
  resolve(HERE, '../../../packages/bmd/assets/iso'),
  resolve(HERE, '../public/icons/iso'),
  ...(arg('--bmm') ? [resolve(arg('--bmm'))] : []),
];

const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// The Jolloficons names shown on its "Isometric" page (src/components/Isometric.vue at the
// pinned commit). Five of the 36 it lists have no file in the repository (chat, copy, send,
// star, user); they are simply absent here.
const JOLLOF_ISO = ['play', 'pause', 'stop', 'previous', 'next', 'fast-forward', 'rewind', 'minus', 'plus',
  'message', 'flash', 'eyes', 'arrow-down', 'arrow-up', 'arrow-left', 'arrow-right', 'badge', 'caution', 'camera',
  'dot-vertical', 'boxes', 'file', 'notepad', 'send-one', 'file-add', 'user-add', 'user-settings', 'guard',
  'app-menu', 'chart', 'chart-two'];

const SETS = [
  {
    id: 'isoflow',
    title: 'Isoflow isopack',
    prefix: '',
    repo: 'isopacks-git',
    url: 'https://github.com/markmanx/isopacks',
    path: 'collections/isoflow/icons',
    commit: 'ab717516031a384d478f456e2a95fd276aa56353',
    licence: 'MIT',
    holder: '2023 Mark Mankarious',
    licenceFile: 'collections/isoflow/LICENSE',
    files: () => readdirSync(join(SRC, 'isopacks-git/collections/isoflow/icons')).filter((f) => f.endsWith('.svg')),
    rename: { cardterminal: 'card-terminal', loadbalancer: 'load-balancer', mailmultiple: 'mail-multiple',
      mobiledevice: 'mobile-device', paymentcard: 'payment-card' },
  },
  {
    id: 'mi2',
    title: 'MI2 (My Isometric Icons)',
    prefix: 'cube-',
    repo: 'richbl',
    url: 'https://github.com/richbl/isometric-icons',
    path: '.',
    commit: '47c24ed4f7f5f80f3771a65e39bfd2c9409e1082',
    licence: 'MIT, with glyphs from Google Material Design Icons (Apache-2.0)',
    holder: '2018 Rich (richbl; the README names Business Learning Incorporated)',
    licenceFile: 'LICENSE',
    // icon_*.svg only: grid_*.svg are background grids and workspace.svg duplicates provider.
    files: () => readdirSync(join(SRC, 'richbl')).filter((f) => /^icon_.*\.svg$/.test(f)),
    rename: {},
    strip: /^icon_/,
  },
  {
    id: 'jolloficons',
    title: 'Jolloficons (isometric)',
    prefix: 'solid-',
    repo: 'jollof',
    url: 'https://github.com/gbmillz/jolloficons',
    path: 'public/icons',
    commit: 'decd4915bc22bb3fdd88b97ad042953fb3a4911d',
    licence: 'MIT (granted in the README; the LICENSE.md it points to is not in the repository)',
    holder: '2018 Gbolahan Fawale (Jolloficons)',
    licenceFile: null,
    files: () => JOLLOF_ISO.map((n) => `${n}.svg`).filter((f) => existsSync(join(SRC, 'jollof/public/icons', f))),
    rename: { 'send-one': 'send', 'chart-two': 'chart-2' },
  },
];

// ── minify ────────────────────────────────────────────────────────────────────────────────
// Editor output (Illustrator, Inkscape, Figma) carries a lot that draws nothing. Removing it is
// most of the size; rounding coordinates is the rest. Nothing here changes what is drawn at an
// icon's size, and the sanitiser runs afterwards on whatever this leaves.
const round = (v, dp) => v.replace(/-?\d*\.\d+(?:e-?\d+)?/gi, (n) => {
  const r = Number(Number(n).toFixed(dp));
  // A negative that rounds to zero keeps its minus: in path data the sign IS the separator,
  // and `4.58301-0.00101` written as `4.580` is one number where there were two (it turned
  // the storage icon into a black silhouette).
  return Object.is(r, -0) || (r === 0 && n.startsWith('-')) ? '-0' : String(r);
});
const COORD = new Set(['d', 'points']);
const NUM = new Set(['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'fx', 'fy',
  'stroke-width', 'stddeviation', 'dx', 'dy', 'offset', 'viewbox', 'font-size', 'opacity', 'stop-opacity', 'fill-opacity']);
const TRANSFORM = new Set(['transform', 'gradienttransform', 'patterntransform']);

function minify(svg) {
  let s = svg.replace(/^﻿/, '');
  s = s.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  s = s.replace(/<metadata\b[\s\S]*?<\/metadata>/gi, '').replace(/<sodipodi:namedview\b[\s\S]*?<\/sodipodi:namedview>/gi, '')
    .replace(/<sodipodi:namedview\b[^>]*\/>/gi, '');
  // Class rules → inline style. The sanitiser drops <style> blocks (their CSS could fetch), so
  // a file drawn with classes would lose its colours. Only `.name{…}` rules exist in these files.
  const rules = {};
  s = s.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    for (const m of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      rules[m[1]] = m[2].split(';').map((d) => d.trim()).filter((d) => d && !/^enable-background/i.test(d)).join(';');
    }
    return '';
  });
  s = s.replace(/\sclass="([^"]*)"/g, (_, cls) => {
    const css = cls.split(/\s+/).map((c) => rules[c]).filter(Boolean).join(';');
    return css ? ` style="${css}"` : '';
  });
  // Attributes: editor namespaces, and the Illustrator boilerplate on the root.
  s = s.replace(/\s(?:inkscape|sodipodi):[\w-]+\s*=\s*"[^"]*"/g, '')
    .replace(/\sxmlns:(?:inkscape|sodipodi|dc|cc|rdf|svg|xlink)\s*=\s*"[^"]*"/g, '')
    .replace(/\s(?:version|xml:space|enable-background|data-name)\s*=\s*"[^"]*"/g, '')
    .replace(/\s[xy]="0px"/g, '');
  // Unreferenced ids, then the definitions nobody can reference any more (Inkscape keeps every
  // filter it ever made; one file had fourteen and used three).
  const used = new Set([...s.matchAll(/url\(#([\w.:-]+)\)|href="#([\w.:-]+)"/g)].map((m) => m[1] || m[2]));
  s = s.replace(/\sid="([^"]*)"/g, (all, id) => (used.has(id) ? all : ''));
  for (const tag of ['filter', 'linearGradient', 'radialGradient', 'clipPath', 'mask', 'pattern']) {
    s = s.replace(new RegExp(`<${tag}\\b(?![^>]*\\sid=)[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g'), '');
  }
  s = s.replace(/<defs\b[^>]*>\s*<\/defs>|<defs\b[^>]*\/>/g, '');
  // Inkscape style noise: its own properties, and every declaration that restates the initial
  // value. An INHERITED property is only dropped when no group sets it to something else, or
  // a shape that restated the default would start inheriting the group's value.
  const INITIAL = { 'stroke-linejoin': 'miter', 'stroke-linecap': 'butt', 'stroke-opacity': '1', 'fill-opacity': '1',
    'stroke-dasharray': 'none', 'stroke-miterlimit': '4', 'stroke-dashoffset': '0', 'vector-effect': 'none',
    'fill-rule': 'nonzero', opacity: '1', 'paint-order': 'normal' };
  const groupSets = new Set();
  for (const m of s.matchAll(/<(?:g|svg|a|symbol)\b([^>]*)>/g)) {
    const style = /\sstyle="([^"]*)"/.exec(m[1]);
    for (const d of (style ? style[1] : '').split(';')) { const [p, v] = d.split(':').map((x) => (x || '').trim()); if (p in INITIAL && v !== INITIAL[p]) groupSets.add(p); }
    for (const a of m[1].matchAll(/\s([\w-]+)="([^"]*)"/g)) if (a[1] in INITIAL && a[2].trim() !== INITIAL[a[1]]) groupSets.add(a[1]);
  }
  s = s.replace(/<(\w+)\b([^>]*?)\sstyle="([^"]*)"/g, (_, tag, before, css) => {
    const leaf = /^(?:path|rect|circle|ellipse|polygon|polyline|line)$/.test(tag);
    const decls = css.split(';').map((d) => d.trim()).filter(Boolean)
      .map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), round(d.slice(i + 1).trim().replace(/(\d)px\b/g, '$1'), 3)]; });
    const noStroke = leaf && decls.some(([p, v]) => p === 'stroke' && v === 'none');
    const kept = decls.filter(([p, v]) => {
      if (/^(?:-inkscape-|font-variation-settings|enable-background)/i.test(p)) return false;
      if (leaf && INITIAL[p] === v && (p === 'opacity' || !groupSets.has(p))) return false;
      if (noStroke && /^stroke-|^paint-order$/.test(p)) return false;
      return true;
    });
    return `<${tag}${before}${kept.length ? ` style="${kept.map(([p, v]) => `${p}:${v}`).join(';')}"` : ''}`;
  });
  // Numbers.
  s = s.replace(/\s([\w:-]+)="([^"]*)"/g, (all, name, val) => {
    const n = name.toLowerCase();
    let v = val.replace(/\s+/g, ' ').trim();
    if (COORD.has(n)) v = round(v, 2).replace(/ ?([a-zA-Z]) ?/g, '$1').replace(/,? -/g, '-');
    else if (NUM.has(n)) v = round(v.replace(/px\b/g, ''), 3);
    else if (TRANSFORM.has(n)) v = round(v, 4);
    return ` ${name}="${v}"`;
  });
  // Root: a viewBox, no fixed size (the <img> that draws it sets one).
  s = s.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
    let a = attrs;
    if (!/\sviewBox=/i.test(a)) {
      const w = /\swidth="([\d.]+)/.exec(a), h = /\sheight="([\d.]+)/.exec(a);
      if (w && h) a += ` viewBox="0 0 ${w[1]} ${h[1]}"`;
    }
    a = a.replace(/\s(?:width|height)="[^"]*"/g, '');
    if (!/\sxmlns="/.test(a)) a = ` xmlns="http://www.w3.org/2000/svg"${a}`;
    return `<svg${a}>`;
  });
  return s.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
}

// ── build ─────────────────────────────────────────────────────────────────────────────────
const icons = [];
const problems = [];
const bodies = new Map();
for (const set of SETS) {
  const repo = join(SRC, set.repo);
  let head = '';
  try { head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* reported below */ }
  if (head !== set.commit) { problems.push(`${set.id}: ${repo} is at ${head || '(not a git checkout)'}, expected ${set.commit}. The licence was read at that commit.`); continue; }
  set.count = 0;
  for (const file of set.files().sort()) {
    const base = file.replace(/\.svg$/, '').replace(set.strip || /^$/, '');
    const name = set.prefix + (set.rename[base] || base).toLowerCase().replace(/_/g, '-').replace(/([a-z])(\d)$/, '$1-$2');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) { problems.push(`${set.id}/${file}: "${name}" is not a kebab-case name`); continue; }
    if (bodies.has(name)) { problems.push(`${set.id}/${file}: name "${name}" is taken`); continue; }
    const raw = readFileSync(join(repo, set.path, file), 'utf8');
    const out = sanitizeSvg(minify(raw));
    if (!out) { problems.push(`${set.id}/${file}: nothing survived the sanitiser`); continue; }
    if (sanitizeSvg(out) !== out) problems.push(`${set.id}/${file}: the sanitiser changes its own output`);
    // Rounding must never merge or split a number: every output path keeps the exact command
    // letters and number count of an input path (the storage icon went black when it did).
    const sig = (d) => { const t = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || []; return t.filter((x) => /[a-z]/i.test(x) && !/e/i.test(x)).join('') + '#' + t.length; };
    const pool = new Map();
    for (const m of raw.matchAll(/\s(?:d|points)="([^"]*)"/g)) { const k = sig(m[1]); pool.set(k, (pool.get(k) || 0) + 1); }
    for (const m of out.matchAll(/\s(?:d|points)="([^"]*)"/g)) {
      const k = sig(m[1]);
      if (!pool.get(k)) { problems.push(`${set.id}/${file}: a path lost or gained a number while being rounded (${m[1].slice(0, 60)}…)`); break; }
      pool.set(k, pool.get(k) - 1);
    }
    if (svgRefusals(out).length) problems.push(`${set.id}/${file}: still holds ${svgRefusals(out).join(', ')}`);
    bodies.set(name, out);
    icons.push({ n: name, s: set.id, from: file, raw: raw.length, out: out.length });
    set.count++;
  }
}
if (problems.length) { console.error(problems.map((p) => '  ✗ ' + p).join('\n')); process.exit(1); }

const manifest = {
  // The picker reads this; the renderer needs nothing but the name (see ISO_NAMES in icons.jsx).
  version: 1,
  sets: SETS.map(({ id, title, url, commit, licence, holder }) => ({ id, title, url, commit, licence, holder })),
  icons: icons.map(({ n, s }) => ({ n, s })),
};

const licences = [
  'Isometric icons (`iso:<name>`): third-party notices',
  '==========================================================',
  '',
  'Every SVG in this folder comes from one of the three sets below. Each was chosen because',
  'its licence allows redistribution inside software; each licence is reproduced in full.',
  '',
  'Changes made to every file (build-iso-icons.mjs in the BetterCommunity web repository):',
  'editor metadata removed, CSS classes inlined as style attributes, coordinates rounded,',
  'unreferenced ids and the fixed width/height removed, then passed through an allow-list SVG',
  'sanitiser (no script, no event attributes, no external references). Files were renamed as',
  'listed. Nothing was redrawn.',
  '',
];
for (const set of SETS) {
  const mine = icons.filter((i) => i.s === set.id);
  licences.push('----------------------------------------------------------', `${set.title}  (prefix "iso:${set.prefix}")`,
    '----------------------------------------------------------',
    `Source:   ${set.url}  (${set.path})`, `Commit:   ${set.commit}`, `Licence:  ${set.licence}`,
    `Files:    ${mine.length}`, '');
  for (const i of mine) licences.push(`  iso:${i.n}  <-  ${set.path === '.' ? '' : set.path + '/'}${i.from}`);
  licences.push('');
  if (set.licenceFile) licences.push(readFileSync(join(SRC, set.repo, set.licenceFile), 'utf8').replace(/\r\n/g, '\n').trim());
  else licences.push('The project README states: "This project is licensed under the MIT License". Its',
    'LICENSE.md is not in the repository, so the standard MIT text follows with the author named.', '', MIT(set.holder));
  if (set.id === 'mi2') {
    licences.push('', 'The glyphs on these blocks are Google Material Design Icons',
      '(https://github.com/google/material-design-icons), "available for you to incorporate into',
      'your products under the Apache License Version 2.0". The full Apache License 2.0 text is at',
      'the end of this file.');
  }
  licences.push('');
}
const apache = readFileSync(resolve(HERE, '../../../../../node_modules/typescript/LICENSE.txt'), 'utf8').replace(/\r\n/g, '\n');
if (!/Apache License[\s\S]*Version 2\.0, January 2004[\s\S]*END OF TERMS AND CONDITIONS/.test(apache)) {
  console.error('build-iso-icons: the Apache-2.0 text source is not the Apache License 2.0'); process.exit(1);
}
licences.push('----------------------------------------------------------', 'Apache License 2.0 (for the Material Design Icons glyphs in iso:cube-*)',
  '----------------------------------------------------------', '', apache.slice(0, apache.indexOf('END OF TERMS AND CONDITIONS') + 27).trim(), '');

for (const dir of OUTS) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of bodies) writeFileSync(join(dir, `${name}.svg`), body + '\n');
  writeFileSync(join(dir, 'icons.json'), JSON.stringify(manifest) + '\n');
  writeFileSync(join(dir, 'LICENSES.txt'), licences.join('\n'));
}

const raw = icons.reduce((n, i) => n + i.raw, 0), out = icons.reduce((n, i) => n + i.out, 0);
console.log(`✓ ${icons.length} isometric icons (${SETS.map((s) => `${s.id} ${s.count}`).join(', ')}), ${Math.round(raw / 1024)} KB -> ${Math.round(out / 1024)} KB`);
console.log(`  names for ISO_NAMES:\n  ${icons.map((i) => i.n).join(' ')}`);
for (const d of OUTS) console.log(`  -> ${d}`);
