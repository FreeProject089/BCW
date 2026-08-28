// Pack the markdown kit into a zip, minus the parts you switched off.
//
// The sources come in through Vite's `?raw`, so what you download is THE code this site runs,
// not a copy of it kept up to date by hand. That is the whole reason this exists: a "download
// the kit" button whose payload drifts from the renderer is worse than a link to the repo.
//
// This module is imported only by /dev/markdown, which is a lazy route, so the ~100 KB of
// inlined source lands in that chunk and nowhere near the entry.
import indexSrc from '../markdown/index.jsx?raw';
import nestingSrc from '../markdown/nesting.js?raw';
import shorthandSrc from '../markdown/shorthand.js?raw';
import emojiSrc from '../markdown/emoji.js?raw';
import brandsSrc from '../markdown/brands.jsx?raw';
import cssSrc from '../markdown/markdown.css?raw';
import readmeSrc from '../markdown/README.md?raw';

/**
 * What can be left out, and what leaving it out costs.
 *
 * `file` is dropped from the zip; `region` is the `kit:NAME:` marker stripped out of the
 * remaining sources. Maths and syntax highlighting are deliberately not on this list: both
 * already load only when a document needs them, so a switch would remove a dependency line
 * and save nothing at runtime.
 */
export const KIT_PARTS = [
  {
    id: 'emoji',
    file: 'emoji.js',
    region: 'emoji',
    label: 'Emoji shortcodes',
    detail: '384 names, GitHub\u2019s. Without it, `:rocket:` stays as typed.',
    bytes: emojiSrc.length,
  },
  {
    id: 'brands',
    file: 'brands.jsx',
    region: 'brands',
    label: 'Brand logos',
    detail: 'Discord, Ko-fi, YouTube and the rest, inline. Without it, a `brand=` button keeps its colour and falls back to a lucide glyph.',
    bytes: brandsSrc.length,
  },
  {
    id: 'injected',
    file: null,
    region: 'injected',
    label: '`:::roadmap` and `:::replay`',
    detail: 'The two blocks you supply a component for. Without them \u2014 measured, not assumed \u2014 the directive renders its content in a plain div: unstyled, nothing lost, nothing to wire up.',
    bytes: 0,
  },
];

const CORE = 'index.jsx nesting.js shorthand.js markdown.css'.split(' ');

/**
 * Remove every `kit:NAME:start … kit:NAME:end` region for the parts that are off.
 *
 * Throws rather than guessing. A marker that has moved would otherwise ship a file with a
 * dangling import, and the person who downloaded it would find out at build time in a project
 * that is not ours — with no way to tell whether they broke it or we did.
 */
export function strip(src, offRegions) {
  let out = src;
  for (const name of offRegions) {
    const re = new RegExp(`[ \\t]*/\\* kit:${name}:start \\*/[\\s\\S]*?/\\* kit:${name}:end \\*/\\n?`, 'g');
    const before = out;
    out = out.replace(re, '');
    if (out === before && src.includes(`kit:${name}:start`)) {
      throw new Error(`the ${name} region is in the source but did not strip cleanly`);
    }
  }
  // A region left half-removed is worse than one left in: it compiles here and not there.
  if (/kit:[a-z]+:(start|end)/.test(out) && offRegions.length) {
    const leftovers = [...out.matchAll(/kit:([a-z]+):start/g)].map((m) => m[1]);
    for (const name of offRegions) {
      if (leftovers.includes(name)) throw new Error(`a ${name} marker survived the strip`);
    }
  }
  return out;
}

/** Comments are for the reader of the kit, not for the packer. */
const clean = (src) => src.replace(/^\/\* kit:[a-z]+:(start|end) \*\/\n/gm, '').replace(/[ \t]*\/\* kit:[a-z]+:(start|end) \*\/\n?/g, '');

/**
 * The files of a kit, as `{ name, text }`.
 *
 * `on` is the set of part ids to KEEP. Exported separately from the zipping so the page can
 * show the file list and the size before anybody downloads anything.
 */
export function buildKit(on) {
  const off = KIT_PARTS.filter((p) => !on.has(p.id));
  const offRegions = off.map((p) => p.region);
  const sources = {
    'index.jsx': indexSrc,
    'nesting.js': nestingSrc,
    'shorthand.js': shorthandSrc,
    'emoji.js': emojiSrc,
    'brands.jsx': brandsSrc,
    'markdown.css': cssSrc,
  };
  const dropped = new Set(off.map((p) => p.file).filter(Boolean));
  const files = [];
  for (const [name, src] of Object.entries(sources)) {
    if (dropped.has(name)) continue;
    if (!CORE.includes(name) && !on.has(KIT_PARTS.find((p) => p.file === name)?.id)) continue;
    files.push({ name, text: clean(strip(src, offRegions)) });
  }
  files.push({ name: 'README.md', text: kitReadme(on) });
  return files;
}

/** The README, with a line saying what this particular download is. */
function kitReadme(on) {
  const off = KIT_PARTS.filter((p) => !on.has(p.id));
  if (!off.length) return readmeSrc;
  const note = [
    '',
    '## What this copy leaves out',
    '',
    'You packed this from `/dev/markdown` without:',
    '',
    ...off.map((p) => `- **${p.label}** \u2014 ${p.detail}`),
    '',
    'Nothing above is referenced by the files in this folder: the imports and the code that',
    'used them were removed when it was packed, not commented out.',
    '',
  ].join('\n');
  // After the file table, so the first thing read is still what the kit IS.
  const at = readmeSrc.indexOf('\n## Dependencies');
  return at < 0 ? readmeSrc + note : readmeSrc.slice(0, at) + '\n' + note + readmeSrc.slice(at);
}

/** The zip, as a Blob. jszip is already a dependency of this app. */
export async function zipKit(on) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folder = zip.folder('markdown');
  for (const f of buildKit(on)) folder.file(f.name, f.text);
  return zip.generateAsync({ type: 'blob' });
}
