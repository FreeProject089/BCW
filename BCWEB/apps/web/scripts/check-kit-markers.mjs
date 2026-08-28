// The kit's optional regions, and the download that is packed from them.
//
// /dev/markdown builds the zip out of the real sources and removes the `kit:NAME:start …
// kit:NAME:end` regions for whatever you switched off. That is what makes the download honest
// — it is this code, not a copy of it — and it is also what makes it fragile: a marker that
// somebody moves, renames or half-deletes produces a folder with a dangling import, and the
// person who finds out is in a different project with no way to tell whose fault it is.
//
// So, for every combination of switches: the regions pair up, they strip cleanly, and nothing
// that was removed is still referenced by what is left.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '../src/markdown');
const PACK = join(HERE, '../src/pages/kit-pack.js');
for (const f of [KIT, PACK]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}

const FILES = ['index.jsx', 'nesting.js', 'shorthand.js', 'emoji.js', 'brands.jsx', 'markdown.css'];
const src = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(KIT, f), 'utf8')]));
const pack = readFileSync(PACK, 'utf8');

const problems = [];

// ── 1. Every marker pairs up ──
const found = new Map();
for (const [file, text] of Object.entries(src)) {
  const starts = [...text.matchAll(/kit:([a-z]+):start/g)].map((m) => m[1]);
  const ends = [...text.matchAll(/kit:([a-z]+):end/g)].map((m) => m[1]);
  for (const n of new Set([...starts, ...ends])) {
    const a = starts.filter((x) => x === n).length;
    const b = ends.filter((x) => x === n).length;
    if (a !== b) problems.push(`${file}: kit:${n} has ${a} start(s) and ${b} end(s)`);
    found.set(n, (found.get(n) || 0) + a);
  }
}
if (!found.size) {
  console.error('✗ no kit: markers found at all — they moved, and this check cannot be trusted');
  process.exit(2);
}

// ── 2. The packer offers exactly the regions that exist ──
const offered = [...pack.matchAll(/region:\s*'([a-z]+)'/g)].map((m) => m[1]);
// Which FILE each region also drops from the zip.
const dropsFile = Object.fromEntries(
  [...pack.matchAll(/id:\s*'([a-z]+)',[\s\S]{0,80}?file:\s*(?:'([^']+)'|null)/g)].map((m) => [m[1], m[2] || null]),
);
for (const n of found.keys()) {
  if (!offered.includes(n)) problems.push(`the source marks kit:${n} and the packer never offers it — that region can never be removed`);
}
for (const n of offered) {
  if (!found.has(n)) problems.push(`the packer offers "${n}" and no source marks kit:${n} — switching it off removes nothing`);
}

// ── 3. Every combination strips cleanly, and leaves nothing dangling ──
// The identifiers each region brings in. If a region is stripped and one of these still
// appears in the remaining code, the download does not compile.
const BROUGHT_IN = {
  emoji: ['replaceEmoji'],
  brands: ['GithubIcon', 'KofiIcon', 'DiscordIcon', 'TiktokIcon'],
  injected: ['DocRoadmap', 'DocReplay'],
};
const strip = (text, names) => {
  let out = text;
  for (const n of names) {
    out = out.replace(new RegExp(`[ \\t]*/\\* kit:${n}:start \\*/[\\s\\S]*?/\\* kit:${n}:end \\*/\\n?`, 'g'), '');
  }
  return out;
};
const names = [...found.keys()];
for (let mask = 0; mask < (1 << names.length); mask++) {
  const off = names.filter((_, i) => mask & (1 << i));
  if (!off.length) continue;
  for (const [file, text] of Object.entries(src)) {
    const out = strip(text, off);
    if (/kit:[a-z]+:(start|end)/.test(out)) {
      for (const n of off) {
        if (out.includes(`kit:${n}:`)) problems.push(`${file}: a kit:${n} marker survives when it is switched off`);
      }
    }
    // Comments are stripped by the packer too, so ignore them when looking for references.
    const code = out.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    for (const region of off) {
      // The file this region also removes is not in the download, so what it says about
      // itself cannot break anything. `emoji.js` defines `replaceEmoji`; checking its own
      // definition against its own removal reported four failures on code that never ships.
      if (dropsFile[region] === file) continue;
      for (const id of BROUGHT_IN[region] || []) {
        if (code.includes(id)) {
          problems.push(`${file}: "${id}" is still used after kit:${region} is removed — that download will not compile`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error('✗ kit markers:');
  for (const p of [...new Set(problems)]) console.error(`    ${p}`);
  console.error('\n  The /dev/markdown download is packed from these files. A region that does not');
  console.error('  strip cleanly ships somebody a folder that does not build.');
  process.exit(1);
}
console.log(`✓ kit markers OK — ${found.size} optional region(s), every combination strips clean`);
