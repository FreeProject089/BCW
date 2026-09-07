// The custom-markdown reference is only useful if it still describes the renderer.
//
// It had stopped: fourteen directives existed with no mention anywhere in the file, and the
// Steps and Columns examples taught `::step` — two colons, a LEAF directive, which cannot
// hold a body. Anyone following the documentation got bullets instead of numbers and a
// literal `::` in their page. Nothing failed; the doc simply aged out from under the code.
//
// So the pairing is checked instead of trusted. Adding a directive now means adding a line
// to the reference, in the same commit, or this goes red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The PARSER, not the assembly. index.jsx was split; it names no directives now, and this
// test said so on the first run — "only found 0 directives, the extractor is stale" — which
// is the guard below doing exactly its job.
const SRC = path.join(here, '../../../packages/bmd/src/directives.js');
// The kit README is the canonical, MAINTAINED directive reference (check-md-kit enforces that
// it names every directive). `guides/reference/CUSTOM_MARKDOWN.md` is a secondary prose doc that
// fell out of date across B.MD 2.0/3.0, so this test now validates against the README — one
// living source of truth rather than a duplicate that silently rots.
const DOC = path.join(here, '../../../packages/bmd/src/README.md');

const src = fs.readFileSync(SRC, 'utf8');
const doc = fs.readFileSync(DOC, 'utf8');

/** Every name the renderer answers to: the `name === '…'` branches plus the callout table. */
function directivesInCode() {
    const names = new Set();
    for (const m of src.matchAll(/name === '([a-z0-9-]+)'/g)) names.add(m[1]);
    const callouts = src.match(/^const CALLOUTS = \{([\s\S]*?)^\};/m);
    if (callouts) for (const m of callouts[1].matchAll(/([a-z0-9-]+)\s*:/g)) names.add(m[1]);
    return names;
}

/** Every name the reference mentions — as a `:::fence` or in `backticks`. */
function namesInDoc() {
    const names = new Set();
    for (const m of doc.matchAll(/:{1,4}([a-z0-9-]+)/g)) names.add(m[1]);
    for (const m of doc.matchAll(/`:{0,3}([a-z0-9-]+)`/g)) names.add(m[1]);
    return names;
}

describe('the custom-markdown reference', () => {
    test('describes every directive the renderer answers to', () => {
        const code = directivesInCode();
        const documented = namesInDoc();
        const missing = [...code].filter((n) => !documented.has(n)).sort();
        assert.deepEqual(missing, [],
            `undocumented directives — add them to guides/reference/CUSTOM_MARKDOWN.md: ${missing.join(', ')}`);
    });

    test('finds a real set of directives, so passing means something', () => {
        // Without this, a rename of the branch style ("name ===" → a lookup table) would empty
        // the left-hand side and the check above would pass by finding nothing at all.
        const code = directivesInCode();
        assert.ok(code.size >= 30, `only found ${code.size} directives in directives.js — the extractor is stale`);
        for (const must of ['steps', 'step', 'roadmap', 'stage', 'card', 'note', 'columns']) {
            assert.ok(code.has(must), `expected to find "${must}" among the renderer's directives`);
        }
    });

    test('never teaches the two-colon container form', () => {
        // `::step` / `::column` / `::card` parse as leaf directives: the body falls outside the
        // block and the closing `::` renders as text. This is the exact bug the file shipped
        // with, and it reads as perfectly reasonable syntax.
        const bad = [...doc.matchAll(/^[ \t]*::(step|stage|column|col|card|cards|note|tip|warning|danger|details|roadmap)\b/gm)]
            .map((m) => m[0].trim());
        assert.deepEqual(bad, [], `two-colon container directives cannot hold a body: ${bad.join(', ')}`);
    });
});
