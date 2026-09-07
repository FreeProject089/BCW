#!/usr/bin/env node
// Can @bettercommunity/bmd and @bettercommunity/bmd-editor actually be published and installed?
//
// They are consumed here through a workspace path, which hides every packaging mistake there
// is: a bare import that is never declared resolves anyway (it is in the app's node_modules),
// an `exports` entry pointing at a file that `files` excludes still works (nothing was packed),
// and a missing `types` costs nothing until someone outside the repo tries it.
//
// Two of those break differently depending on the client, which is the reason this exists:
//
//   npm  installs a FLAT node_modules, so an undeclared dependency resolves by accident — the
//        package works for us and for anyone using npm, and nobody learns otherwise.
//   pnpm installs an ISOLATED tree: a package only sees what it declared. The same undeclared
//        import is a hard "Cannot find package" at the consumer's first import.
//
// So the phantom-dependency scan below is not tidiness. It is the difference between the
// package working for half the people who install it and all of them.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const ROOT = '../../packages';
const PKGS = ['bmd', 'bmd-editor'];

const problems = [];
const must = (cond, why) => { if (!cond) problems.push(why); };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every bare specifier a file imports — `react`, `@scope/name`, `remark-gfm`. Relative and
 *  absolute paths are not dependencies; `node:` builtins are always available. */
function bareImports(src) {
  const out = new Set();
  const add = (spec) => {
    if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return;
    // `@scope/name/sub` and `name/sub` both belong to the package before the subpath.
    const parts = spec.split('/');
    out.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
  };
  for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) add(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*(?:\/\*[^*]*\*\/\s*)?['"]([^'"]+)['"]/g)) add(m[1]);
  for (const m of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g)) add(m[1]);
  return out;
}

let checkedFiles = 0;
const versions = {};

for (const name of PKGS) {
  const dir = join(ROOT, name);
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) { problems.push(`${name}: no package.json`); continue; }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  versions[pkg.name] = pkg.version;

  // ── what npm needs to accept the publish at all ──────────────────────────────────
  // A scoped package is PRIVATE by default: `npm publish` fails with a 402 that reads like a
  // billing problem rather than a missing line.
  must(pkg.publishConfig?.access === 'public', `${name}: no "publishConfig": { "access": "public" } — npm refuses to publish a scoped package without it`);
  must(pkg.license, `${name}: no license field`);
  must(existsSync(join(dir, 'LICENSE')), `${name}: declares "${pkg.license}" but ships no LICENSE file`);
  must(pkg.types, `${name}: no "types" — every TypeScript consumer imports it as \`any\``);
  if (pkg.types) must(existsSync(join(dir, pkg.types)), `${name}: "types" points at ${pkg.types}, which does not exist`);
  must(/^git\+https:\/\/.+\.git$/.test(pkg.repository?.url || ''), `${name}: repository.url should be "git+https://….git" or npm will not link the source`);

  // ── every exported path exists AND is packed ─────────────────────────────────────
  const files = pkg.files || [];
  for (const [sub, target] of Object.entries(pkg.exports || {})) {
    if (typeof target !== 'string' || target.includes('*')) continue;
    const rel = target.replace(/^\.\//, '');
    must(existsSync(join(dir, rel)), `${name}: exports "${sub}" → ${target}, which does not exist`);
    // `files` is what `npm pack` puts in the tarball. An export outside it resolves here and
    // 404s for everyone who installs it, which is the failure with the longest feedback loop.
    const packed = rel === 'package.json' || files.some((f) => rel === f || rel.startsWith(`${f.replace(/\/$/, '')}/`));
    must(packed, `${name}: exports "${sub}" → ${target} but "files" does not include it — it would not be in the tarball`);
  }

  // ── phantom dependencies: the pnpm-only failure ──────────────────────────────────
  const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ]);
  for (const file of walk(join(dir, 'src'))) {
    checkedFiles += 1;
    for (const spec of bareImports(readFileSync(file, 'utf8'))) {
      must(declared.has(spec),
        `${name}: ${relative(dir, file).replace(/\\/g, '/')} imports "${spec}", which the package never declares — this resolves under npm's flat tree and fails under pnpm`);
    }
  }
}

// ── the two packages have to agree about each other ──────────────────────────────────
const editor = JSON.parse(readFileSync(join(ROOT, 'bmd-editor/package.json'), 'utf8'));
const range = editor.peerDependencies?.['@bettercommunity/bmd'];
must(range, 'bmd-editor does not declare @bettercommunity/bmd as a peer, but imports it');
if (range && versions['@bettercommunity/bmd']) {
  const major = versions['@bettercommunity/bmd'].split('.')[0];
  must(range.includes(major), `bmd-editor asks for @bettercommunity/bmd "${range}" but the package is at ${versions['@bettercommunity/bmd']}`);
}

if (problems.length) {
  console.error('✗ the B.MD packages are not publishable as they stand:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  These all work in this repo, which is the point: the workspace resolves what a');
  console.error('  published tarball would not.');
  process.exit(1);
}
console.log(`✓ B.MD packages publishable — ${PKGS.length} package(s), ${checkedFiles} source file(s), every import declared, every export packed`);
