// Attributing a line to a function, and following what happens next.
//
// The failure mode that matters is not a crash: it is a step attributed to the WRONG
// function. That reads as a fact about somebody's code, on a public project page, and is
// wrong in a way nobody checks. So the rule everywhere below is that anything unplaceable
// stays unplaced — `fn: null`, "top level" — rather than being guessed at.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { declarations, enclosing, functionEdges, buildFlow, importedNames, resolveFile, excerpt, langOf, drawableFunctions } from '../src/lib/code-flow.mjs';

const JS = [
    "import { getItems } from './service.js';",          // 1
    '',                                                  // 2
    'const CATEGORIES = ["all", "topRated"];',           // 3
    '',                                                  // 4
    'export function handleChange(event, value) {',      // 5
    '  setValue(value);',                                // 6
    '}',                                                 // 7
    '',                                                  // 8
    'export const load = async () => {',                 // 9
    "  const r = await fetch('/api/items');",            // 10
    '  return getItems(r);',                             // 11
    '};',                                                // 12
    '',                                                  // 13
    'class Panel {',                                     // 14
    '  render() {',                                      // 15
    '    return null;',                                  // 16
    '  }',                                               // 17
    '}',                                                 // 18
].join('\n');

const SERVICE = [
    'export function getItems(res) {',                   // 1
    '  return res.json();',                              // 2
    '}',                                                 // 3
].join('\n');

describe('declarations', () => {
    test('finds every shape JavaScript uses to name a function', () => {
        const d = declarations('a.jsx', JS).map((x) => x.name);
        assert.deepEqual(d, ['handleChange', 'load', 'Panel', 'render']);
    });

    test('a const that is not a function is not one', () => {
        // `const CATEGORIES = [...]` is data. Drawing it as a node would fill the map with
        // every constant in the codebase and bury the functions among them.
        assert.deepEqual(declarations('a.js', 'const CATEGORIES = ["all"];').map((x) => x.name), []);
    });

    test('a Rust command and a Python def are found too', () => {
        assert.deepEqual(declarations('m.rs', 'pub async fn scan_mods(app: AppHandle) {}').map((x) => x.name), ['scan_mods']);
        assert.deepEqual(declarations('m.py', 'async def read_items(q):').map((x) => x.name), ['read_items']);
        assert.deepEqual(declarations('m.go', 'func ListItems(w http.ResponseWriter) {').map((x) => x.name), ['ListItems']);
    });

    test('a comment that looks like a declaration is not one', () => {
        const src = ['// function ghost() {', ' * function alsoGhost() {', 'function real() {'].join('\n');
        assert.deepEqual(declarations('a.js', src).map((x) => x.name), ['real']);
    });

    test('the parameters come along, as written', () => {
        // The honest version of an "input example": `(event, value)` is a fact about the
        // function. A JSON payload invented for it is not.
        const d = declarations('a.jsx', JS);
        assert.equal(d.find((x) => x.name === 'handleChange').params, 'event, value');
        assert.equal(declarations('m.rs', 'pub async fn scan_mods(app: AppHandle) {}')[0].params, 'app: AppHandle');
    });

    test('a signature spanning several lines shows nothing rather than its first third', () => {
        assert.equal(declarations('a.js', 'function big(').length ? declarations('a.js', 'function big(')[0].params : '', '');
    });

    test('a language we cannot read yields nothing, not nonsense', () => {
        assert.deepEqual(declarations('a.css', 'body { color: red }'), []);
        assert.equal(langOf('a.css'), null);
    });
});

describe('enclosing', () => {
    const decls = declarations('a.jsx', JS);
    test('a line inside a function belongs to it', () => {
        assert.equal(enclosing(decls, 6).name, 'handleChange');
        assert.equal(enclosing(decls, 10).name, 'load');
    });

    test('a method beats the class that contains it', () => {
        // The innermost thing that could contain the line is the useful answer: "render",
        // not "Panel".
        assert.equal(enclosing(decls, 16).name, 'render');
    });

    test('a line above everything is top level, and says so', () => {
        assert.equal(enclosing(decls, 1), null);
    });

    test('THE OTHER ONE: a one-line arrow owns one line, not the rest of the file', () => {
        // Found on a real module: `const locOf = (h) => …;` declared inside a handler was
        // credited with a route ninety lines below it, because its "end" was the next
        // declaration at its indent. A one-liner closes where it opens.
        const src = [
            'export default async function routes(app) {',              // 1
            '  const locOf = (h) => (h ? "local" : "remote");',          // 2
            '  app.get("/x", () => {});',                                // 3
            '}',                                                        // 4
        ].join('\n');
        const d = declarations('r.mjs', src);
        assert.equal(enclosing(d, 3).name, 'routes', 'the route belongs to the module, not to a one-line helper above it');
        assert.equal(enclosing(d, 2).name, 'locOf', 'its own line is still its own');
    });

    test('THE ONE: a helper declared LATER does not capture the function above it', () => {
        // Found on a real repository: a route registered on line 542 of a 900-line module was
        // credited to a two-line helper declared at 540. The nearest declaration above a line
        // is not the one that contains it — the one whose BODY contains it is.
        const src = [
            'export default async function routes(app) {',   // 1
            '  app.get("/a", () => {});',                     // 2
            '  app.get("/b", () => {});',                     // 3
            '}',                                              // 4
            '',                                               // 5
            'function helper() {',                            // 6
            '  return 1;',                                    // 7
            '}',                                              // 8
        ].join('\n');
        const d = declarations('r.mjs', src);
        assert.equal(enclosing(d, 3).name, 'routes', 'line 3 is inside routes');
        assert.equal(enclosing(d, 7).name, 'helper');
        // Line 5 — blank, between the two bodies — comes back as `routes`. A declaration's
        // end is the next declaration, not its closing brace, so the gap belongs to whatever
        // came before. Left as it is rather than tracking braces across four languages: calls
        // do not live in the gap between two functions, and the imprecision is stated here
        // instead of being discovered later.
        assert.equal(enclosing(d, 5).name, 'routes');
    });
});

describe('functionEdges', () => {
    const sources = { 'client/a.jsx': JS, 'server/items.js': SERVICE };
    const links = [{
        kind: 'http', method: 'GET', route: '/items',
        from: { file: 'client/a.jsx', line: 10, text: "  const r = await fetch('/api/items');" },
        to: { file: 'server/items.js', line: 1 },
    }];

    test('both ends land on a function, not just a file', () => {
        const [e] = functionEdges(links, sources);
        assert.equal(e.from.fn, 'load');
        assert.equal(e.to.fn, 'getItems');
        assert.equal(e.label, 'GET /items');
        assert.equal(e.from.id, 'client/a.jsx#load');
    });

    test('the calling line travels with the edge', () => {
        // So the panel can quote it rather than describing it.
        assert.match(functionEdges(links, sources)[0].text, /fetch\('\/api\/items'\)/);
    });

    test('a file we do not hold leaves the end unplaced rather than inventing one', () => {
        const [e] = functionEdges([{ kind: 'tauri', name: 'scan', from: { file: 'nope.ts', line: 4 }, to: { file: 'server/items.js', line: 2 } }], sources);
        assert.equal(e.from.fn, null, 'no source, no function — and the id says (top level)');
        assert.equal(e.from.id, 'nope.ts#(top level)');
    });
});

describe('buildFlow', () => {
    const sources = { 'client/a.jsx': JS, 'client/service.js': SERVICE };
    const [edge] = functionEdges([{
        kind: 'http', method: 'GET', route: '/items',
        from: { file: 'client/a.jsx', line: 10 }, to: { file: 'client/service.js', line: 1 },
    }], sources);

    test('the caller comes first, then what serves it', () => {
        const flow = buildFlow(edge, sources);
        assert.equal(flow.steps[0].fn, 'load');
        assert.equal(flow.steps[1].fn, 'getItems');
        assert.match(flow.steps[0].label, /load calls GET \/items/);
    });

    test('every step carries the line it is on, so it can be checked', () => {
        for (const s of buildFlow(edge, sources).steps) {
            assert.ok(s.file && s.line, 'a step without a location is an assertion nobody can verify');
            assert.ok(s.code?.text, 'and it quotes the source rather than describing it');
        }
    });

    test('it follows the next call, but only through a real import', () => {
        // `load` imports getItems from ./service.js and calls it — that hop is followed.
        const flow = buildFlow(functionEdges([{
            kind: 'tauri', name: 'x',
            from: { file: 'client/a.jsx', line: 6 }, to: { file: 'client/a.jsx', line: 9 },
        }], sources)[0], sources);
        assert.ok(flow.steps.some((s) => s.fn === 'getItems'), flow.steps.map((s) => s.fn).join(' → '));
    });

    test('a name that merely matches something elsewhere is not followed', () => {
        // No import line, so nothing links the two files: guessing by name is how a flow ends
        // up describing a path the program never takes.
        const noImport = { 'a.js': 'export function go() {\n  getItems();\n}', 'b.js': SERVICE };
        const flow = buildFlow(functionEdges([{ kind: 'tauri', name: 'x', from: { file: 'a.js', line: 2 }, to: { file: 'a.js', line: 1 } }], noImport)[0], noImport);
        assert.ok(!flow.steps.some((s) => s.file === 'b.js'));
    });

    test('a cycle does not loop for ever', () => {
        const cyc = {
            'x.js': "import { b } from './y.js';\nexport function a() {\n  b();\n}",
            'y.js': "import { a } from './x.js';\nexport function b() {\n  a();\n}",
        };
        const flow = buildFlow(functionEdges([{ kind: 'tauri', name: 'x', from: { file: 'x.js', line: 3 }, to: { file: 'x.js', line: 2 } }], cyc)[0], cyc);
        assert.ok(flow.steps.length <= 5, `${flow.steps.length} steps — a cycle must stop`);
    });
});

describe('the small pieces', () => {
    test('named imports are read; a default import is not', () => {
        assert.deepEqual(importedNames("import { a, b as c } from './x.js';"), [['a', './x.js'], ['c', './x.js']]);
        assert.deepEqual(importedNames("import def from './x.js';"), [],
            'the name is the importer\'s choice and says nothing about the other side');
    });

    test('TypeScript writes .js and means .ts', () => {
        const sources = { 'src/core/api.ts': 'x', 'src/ui/app.ts': 'y' };
        assert.equal(resolveFile('src/ui/app.ts', '../core/api.js', sources), 'src/core/api.ts');
    });

    test('a package import resolves to nothing', () => {
        assert.equal(resolveFile('a.js', 'react', { 'react.js': 'x' }), null);
    });

    test('an excerpt is bounded by the file', () => {
        const e = excerpt('one\ntwo\nthree', 3);
        assert.equal(e.to, 3);
        assert.match(e.text, /two\nthree/);
    });
});

describe('drawableFunctions', () => {
    const sources = {
        'a.js': 'export function one() {}\nexport function two() {}\nexport function three() {}',
    };
    test('only the functions an edge touches are drawn', () => {
        // A 900-line module has forty declarations. Forty chips in a box is a wall of text,
        // not a map — and the reader is following the ones on a path, not the rest.
        const d = drawableFunctions([{ from: { file: 'a.js', fn: 'one' }, to: { file: 'a.js', fn: 'three' } }], sources);
        assert.deepEqual(d['a.js'].map((x) => x.name), ['one', 'three']);
    });

    test('they come back in source order, with their line and signature', () => {
        const d = drawableFunctions([{ from: { file: 'a.js', fn: 'three' }, to: { file: 'a.js', fn: 'one' } }], sources);
        assert.deepEqual(d['a.js'].map((x) => x.line), [1, 3], 'source order, not the order the edges happened to name them');
    });

    test('a file nothing touches gets no chips at all', () => {
        assert.deepEqual(drawableFunctions([], sources), {});
    });

    test('a function we cannot find still appears, without a line', () => {
        // It was named by an edge, so hiding it would leave an edge pointing at nothing.
        const d = drawableFunctions([{ from: { file: 'a.js', fn: 'ghost' }, to: { file: 'a.js', fn: 'one' } }], sources);
        assert.ok(d['a.js'].some((x) => x.name === 'ghost' && x.line === null));
    });
});
