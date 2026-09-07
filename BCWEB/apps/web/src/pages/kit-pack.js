// Pack the markdown kit into a zip, minus the parts you switched off.
//
// The sources come in through Vite's `?raw`, so what you download is THE code this site runs,
// not a copy of it kept up to date by hand. That is the whole reason this exists: a "download
// the kit" button whose payload drifts from the renderer is worse than a link to the repo.
//
// This module is imported only by /dev/markdown, which is a lazy route, so the ~100 KB of
// inlined source lands in that chunk and nowhere near the entry.
import indexSrc from '../../../../packages/bmd/src/index.jsx?raw';
import configSrc from '../../../../packages/bmd/src/config.js?raw';
import urlSrc from '../../../../packages/bmd/src/url.js?raw';
import pluginsSrc from '../../../../packages/bmd/src/plugins.js?raw';
import sanitizeSrc from '../../../../packages/bmd/src/sanitize.js?raw';
import directivesSrc from '../../../../packages/bmd/src/directives.js?raw';
import blocksSrc from '../../../../packages/bmd/src/blocks.jsx?raw';
import iconsSrc from '../../../../packages/bmd/src/icons.jsx?raw';
import roadmapSrc from '../../../../packages/bmd/src/roadmap.jsx?raw';
import replaySrc from '../../../../packages/bmd/src/replay.jsx?raw';
import nestingSrc from '../../../../packages/bmd/src/nesting.js?raw';
import shorthandSrc from '../../../../packages/bmd/src/shorthand.js?raw';
import emojiSrc from '../../../../packages/bmd/src/emoji.js?raw';
import brandsSrc from '../../../../packages/bmd/src/brands.jsx?raw';
import openapiSrc from '../../../../packages/bmd/src/openapi.js?raw';
import exportSrc from '../../../../packages/bmd/src/export.jsx?raw';
import astSrc from '../../../../packages/bmd/src/ast.js?raw';
import linksSrc from '../../../../packages/bmd/src/links.js?raw';
// The editor's lossless block model. In the kit since it was written, and never in this list —
// so the /dev/markdown download shipped a folder whose editor imports a file that is not there.
import editorBlocksSrc from '../../../../packages/bmd/src/editor-blocks.js?raw';
import cssSrc from '../../../../packages/bmd/src/markdown.css?raw';
// The TypeScript half. Not an optional part: types cost nothing at runtime, and a kit packed
// without them is a kit that silently stops type-checking on the receiving end.
import dtsSrc from '../../../../packages/bmd/src/markdown.d.ts?raw';
import readmeSrc from '../../../../packages/bmd/src/README.md?raw';

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
    // Two files, so `file` cannot say it. `files` is read by the packer alongside it.
    file: null,
    files: ['roadmap.jsx', 'replay.jsx'],
    region: 'injected',
    label: '`:::roadmap` and `:::replay`',
    detail: 'A progress tracker and a media/recording embed, both drawn by the kit \u2014 you no longer supply a component for either. Without them the two directives render their content in a plain div: unstyled, nothing lost.',
    bytes: roadmapSrc.length + replaySrc.length,
  },
];

// Always in the zip, whichever flavour. Everything that is not an optional PART: a file
// missing from this list is silently left out of the download, which is how a kit that
// builds here ships as a folder with nine missing imports.
const CORE = ('index.jsx config.js url.js plugins.js sanitize.js directives.js blocks.jsx '
  + 'icons.jsx nesting.js shorthand.js markdown.css openapi.js export.jsx ast.js links.js '
  + 'editor-blocks.js').split(' ');

/**
 * The two flavours, and what actually differs.
 *
 * NOT a ported `.tsx` copy of the renderer. That would be a second renderer, and the one that
 * is wrong is whichever nobody looked at last — the argument index.jsx already makes about
 * the preview canvas. It is also unverifiable here: `apps/web` has no TypeScript and no
 * `@types/react`, so a port would ship having never been compiled.
 *
 * What differs is what the CONSUMER needs. One renderer either way.
 */
export const KIT_FLAVOURS = [
  { id: 'js', label: 'JavaScript', detail: 'The sources and the README. Nothing to configure.' },
  {
    id: 'ts',
    label: 'TypeScript',
    detail: 'The same sources, plus `markdown.d.ts` and a `tsconfig.kit.json` fragment \u2014 every export typed at the boundary, no `@types` package, no path mapping.',
  },
];

/** The tsconfig fragment the TypeScript flavour carries. */
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    // The kit is .js / .jsx and stays that way \u2014 see markdown.d.ts for why.
    allowJs: true,
    jsx: 'react-jsx',
    moduleResolution: 'bundler',
    // The declarations sit beside the sources, so nothing needs mapping.
    strict: true,
  },
}, null, 2);

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
export function buildKit(on, flavour = 'ts') {
  const off = KIT_PARTS.filter((p) => !on.has(p.id));
  const offRegions = off.map((p) => p.region);
  const sources = {
    'index.jsx': indexSrc,
    'config.js': configSrc,
    'url.js': urlSrc,
    'plugins.js': pluginsSrc,
    'sanitize.js': sanitizeSrc,
    'directives.js': directivesSrc,
    'blocks.jsx': blocksSrc,
    'icons.jsx': iconsSrc,
    'roadmap.jsx': roadmapSrc,
    'replay.jsx': replaySrc,
    'nesting.js': nestingSrc,
    'shorthand.js': shorthandSrc,
    'emoji.js': emojiSrc,
    'brands.jsx': brandsSrc,
    'openapi.js': openapiSrc,
    'export.jsx': exportSrc,
    'ast.js': astSrc,
    'links.js': linksSrc,
    'editor-blocks.js': editorBlocksSrc,
    'markdown.css': cssSrc,
  };
  const dropped = new Set(off.flatMap((p) => p.files || [p.file]).filter(Boolean));
  const files = [];
  for (const [name, src] of Object.entries(sources)) {
    if (dropped.has(name)) continue;
    if (!CORE.includes(name) && !on.has(KIT_PARTS.find((p) => (p.files || [p.file]).includes(name))?.id)) continue;
    files.push({ name, text: clean(strip(src, offRegions)) });
  }
  // The TypeScript half. Appended rather than filtered out of `sources`, because it is not
  // an optional PART — it is the whole difference between the flavours, and treating it as a
  // checkbox would let somebody pick TypeScript and then switch its types off.
  if (flavour === 'ts') {
    files.push({ name: 'markdown.d.ts', text: dtsSrc });
    files.push({ name: 'tsconfig.kit.json', text: TSCONFIG });
  }
  files.push({ name: 'README.md', text: kitReadme(on, flavour) });
  return files;
}

/** The README, with a line saying what this particular download is. */
function kitReadme(on, flavour = 'ts') {
  const off = KIT_PARTS.filter((p) => !on.has(p.id));
  // The JavaScript flavour carries no types, so the README's TypeScript section describes
  // files that are not in the folder. Cut rather than left to confuse.
  let base = readmeSrc;
  if (flavour !== 'ts') {
    const at = base.indexOf('### TypeScript');
    const next = at < 0 ? -1 : base.indexOf('\n## ', at);
    if (at >= 0) base = base.slice(0, at) + (next < 0 ? '' : base.slice(next + 1));
    base = base.replace(/^\| `markdown\.d\.ts` \|.*\n/m, '');
  }
  if (!off.length) return base;
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
  //
  // `base`, not `readmeSrc`: the JavaScript flavour has already had its TypeScript section
  // cut, and splicing into the original would hand back the copy that still describes files
  // the zip does not contain.
  const at = base.indexOf('\n## Dependencies');
  return at < 0 ? base + note : base.slice(0, at) + '\n' + note + base.slice(at);
}

/** The zip, as a Blob. jszip is already a dependency of this app. */
export async function zipKit(on, flavour = 'ts') {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folder = zip.folder('markdown');
  // The SAME call the file list above is built from. A zip assembled by a second path is a
  // zip that can differ from what the screen promised.
  for (const f of buildKit(on, flavour)) folder.file(f.name, f.text);
  return zip.generateAsync({ type: 'blob' });
}
