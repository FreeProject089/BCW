// The B.MD directive registry (packages/bmd/src/registry.js) is the list every reference page
// reads: /dev/bmd, the npm README table, the tarball smoke test. The parser does not read it;
// it dispatches on `name === '…'`. So the two can disagree, and this is what stops them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIRECTIVES, DIRECTIVE_GROUPS, directiveNames, findDirective, directiveSyntax } from '../../../packages/bmd/src/registry.js';

const PARSER = new URL('../../../packages/bmd/src/directives.js', import.meta.url);

/** The names the parser dispatches on: every `name === 'x'` plus the CALLOUTS keys. */
function parserNames() {
  const src = readFileSync(PARSER, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/name === '([a-z0-9-]+)'/g)) out.add(m[1]);
  const callouts = src.match(/^const CALLOUTS = \{([\s\S]*?)^\};/m);
  assert.ok(callouts, 'CALLOUTS table not found in directives.js: the extractor is stale');
  for (const m of callouts[1].matchAll(/([a-z0-9-]+):/g)) out.add(m[1]);
  return out;
}

test('the extractor still reads the parser (too few names means it is broken, not that the parser shrank)', () => {
  assert.ok(parserNames().size >= 60, `read ${parserNames().size} names`);
});

test('every name the parser draws is in the registry', () => {
  const known = new Set(directiveNames());
  const missing = [...parserNames()].filter((n) => !known.has(n)).sort();
  assert.deepEqual(missing, [], `add these to packages/bmd/src/registry.js: ${missing.join(', ')}`);
});

test('every registry name is one the parser draws', () => {
  const parser = parserNames();
  const phantom = directiveNames().filter((n) => !parser.has(n)).sort();
  assert.deepEqual(phantom, [], `the registry documents names the parser ignores: ${phantom.join(', ')}`);
});

test('no name or alias is listed twice', () => {
  const all = directiveNames();
  const dup = all.filter((n, i) => all.indexOf(n) !== i);
  assert.deepEqual(dup, []);
});

test('each entry is complete: a known group, a form, both summaries, an example that uses it', () => {
  const groups = new Set(DIRECTIVE_GROUPS.map((g) => g.id));
  for (const d of DIRECTIVES) {
    assert.ok(groups.has(d.group), `${d.name}: unknown group ${d.group}`);
    assert.ok(Array.isArray(d.forms) && d.forms.length, `${d.name}: no forms`);
    for (const f of d.forms) assert.ok(['container', 'leaf', 'text'].includes(f), `${d.name}: bad form ${f}`);
    assert.ok(d.summary?.en && d.summary?.fr, `${d.name}: needs an English and a French summary`);
    assert.ok(Array.isArray(d.attrs), `${d.name}: attrs must be an array`);
    // The example must actually exercise the directive, or the "Try it" button shows something else.
    const names = [d.name, ...(d.aliases || [])];
    assert.ok(names.some((n) => new RegExp(`:${n}(?![a-z0-9-])`).test(d.example)), `${d.name}: its example never writes :${d.name}`);
    if (d.parent) assert.ok(findDirective(d.parent), `${d.name}: parent ${d.parent} is not a directive`);
  }
});

test('lookups resolve aliases and the syntax helper spells the form', () => {
  assert.equal(findDirective('kpi')?.name, 'stat');
  assert.equal(findDirective('NOTE')?.name, 'note');
  assert.equal(findDirective('nope'), undefined);
  assert.equal(directiveSyntax(findDirective('badge')), ':badge');
  assert.equal(directiveSyntax(findDirective('toc')), '::toc');
  assert.equal(directiveSyntax(findDirective('tabs')), ':::tabs');
});

test('the npm README directive table is the registry (run packages/bmd/scripts/gen-readme.mjs)', async () => {
  const { directiveTable } = await import('../../../packages/bmd/scripts/gen-readme.mjs');
  const readme = readFileSync(new URL('../../../packages/bmd/README.md', import.meta.url), 'utf8');
  const a = readme.indexOf('<!-- directives:start -->');
  const b = readme.indexOf('<!-- directives:end -->');
  assert.ok(a >= 0 && b > a, 'README.md lost its directives markers');
  assert.equal(readme.slice(a + '<!-- directives:start -->'.length, b).trim(), directiveTable().trim(), 'README table is stale');
});
