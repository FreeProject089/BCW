// The code graph. Every edge it draws is published as a claim about somebody's repository, so
// the tests care most about the edges it must NOT draw.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { importsIn, resolveImport, buildCodeGraph, sourcePathsToFetch, tracePath, entryPoints } from '../src/lib/code-graph.mjs';

describe('importsIn', () => {
    test('reads every form an import takes', () => {
        const src = `
      import a from './a.js';
      import { b } from "../b";
      import './side-effect.css';
      const c = require('./c');
      const d = await import('./d.js');
      export { e } from './e.js';
    `;
        assert.deepEqual(importsIn(src).map((i) => i.spec).sort(), ['../b', './a.js', './c', './d.js', './e.js', './side-effect.css']);
    });

    test('THE ONE: an import inside a comment is not an import', () => {
        // Documentation files are full of examples. Counted, they add dependencies that exist
        // only in prose — and the diagram looks expert while being fiction.
        const src = `
      // import ghost from './ghost.js';
      /* import spectre from './spectre.js'; */
      import real from './real.js';
    `;
        assert.deepEqual(importsIn(src).map((i) => i.spec), ['./real.js']);
    });

    test('a url is not mistaken for a comment', () => {
        const src = `const u = 'https://x/y'; import real from './real.js';`;
        assert.deepEqual(importsIn(src).map((i) => i.spec), ['./real.js']);
    });

    test('the same target twice is one specifier', () => {
        assert.deepEqual(importsIn(`import a from './a'; import b from './a';`).map((i) => i.spec), ['./a']);
    });
});

describe('resolveImport', () => {
    const files = new Set(['src/a.js', 'src/lib/b.ts', 'src/lib/index.js', 'src/deep/c.jsx']);

    test('resolves an extensionless import the way a bundler does', () => {
        assert.equal(resolveImport('src/a.js', './lib/b', files), 'src/lib/b.ts');
    });
    test('resolves a folder to its index', () => {
        assert.equal(resolveImport('src/a.js', './lib', files), 'src/lib/index.js');
    });
    test('walks up through ..', () => {
        assert.equal(resolveImport('src/deep/c.jsx', '../a.js', files), 'src/a.js');
    });
    test('a package is NOT a file — null, never a guess', () => {
        // Inventing a target here would connect two files that never meet.
        assert.equal(resolveImport('src/a.js', 'react', files), null);
        assert.equal(resolveImport('src/a.js', '@scope/pkg', files), null);
    });
    test('a relative import of something absent stays null', () => {
        assert.equal(resolveImport('src/a.js', './nope', files), null);
    });
});

describe('buildCodeGraph', () => {
    const REPO = {
        'src/index.js': `import { render } from './ui/render.js'; import { load } from './data/load.js'; render(load());`,
        'src/ui/render.js': `import { fmt } from '../util/fmt.js'; export const render = () => fmt();`,
        'src/data/load.js': `import { fmt } from '../util/fmt.js'; import fetchLib from 'node-fetch'; export const load = () => fmt();`,
        'src/util/fmt.js': `export const fmt = () => 1;`,
        'README.md': '# hello',
    };

    test('draws the files and the imports between them', () => {
        const g = buildCodeGraph(REPO);
        assert.deepEqual(g.nodes.map((n) => n.id).sort(), ['src/data/load.js', 'src/index.js', 'src/ui/render.js', 'src/util/fmt.js']);
        // Direction matches the stack map: what is needed points at what needs it.
        assert.ok(g.edges.some((e) => e.from === 'src/util/fmt.js' && e.to === 'src/ui/render.js'));
        assert.ok(g.edges.some((e) => e.from === 'src/ui/render.js' && e.to === 'src/index.js'));
        assert.equal(g.edges.length, 4);
    });

    test('a package import is not an edge', () => {
        const g = buildCodeGraph(REPO);
        assert.ok(!g.edges.some((e) => String(e.from).includes('node-fetch')));
    });

    test('the hub is identifiable without counting arrows', () => {
        const g = buildCodeGraph(REPO);
        const fmt = g.nodes.find((n) => n.id === 'src/util/fmt.js');
        assert.equal(fmt.dependents, 2);
    });

    test('folders come from the files that survived, never empty ones', () => {
        const g = buildCodeGraph(REPO);
        assert.deepEqual(g.folders, ['src', 'src/data', 'src/ui', 'src/util']);
    });

    test('a language it cannot read is NAMED, not silently dropped', () => {
        // A mostly-Go repo must not be shown three stray JS files as though that were its
        // architecture.
        const g = buildCodeGraph({ 'main.go': 'package main', 'lib.rs': 'fn main(){}', 'a.js': '' });
        assert.deepEqual(g.unsupported, ['go', 'rs']);
    });

    test('a relative import that resolves to nothing is reported', () => {
        const g = buildCodeGraph({ 'a.js': `import x from './missing.js';` });
        assert.equal(g.unresolved.length, 1);
        assert.equal(g.unresolved[0].spec, './missing.js');
    });

    test('the cap truncates and SAYS it truncated', () => {
        const big = {};
        for (let i = 0; i < 60; i++) big[`f${i}.js`] = '';
        const g = buildCodeGraph(big, { maxNodes: 10 });
        assert.equal(g.nodes.length, 10);
        assert.equal(g.stats.truncated, true);
    });

    test('an edge to a file beyond the cap is dropped, not half-drawn', () => {
        const g = buildCodeGraph({ 'a.js': `import b from './b.js';`, 'b.js': '' }, { maxNodes: 1 });
        assert.deepEqual(g.edges, []);
    });

    test('an empty repo is an empty graph, not a crash', () => {
        const g = buildCodeGraph({});
        assert.deepEqual(g.nodes, []);
        assert.deepEqual(g.edges, []);
    });
});

describe('sourcePathsToFetch', () => {
    test('skips dependencies, builds and tests', () => {
        const got = sourcePathsToFetch([
            'src/a.js', 'node_modules/x/i.js', 'dist/b.js', 'src/a.test.js', 'src/c.d.ts', 'src/e.min.js', 'src/f.tsx',
        ]);
        assert.deepEqual(got, ['src/a.js', 'src/f.tsx']);
    });

    test('shallowest first, so a cap keeps the files that describe the project', () => {
        const got = sourcePathsToFetch(['a/b/c/d.js', 'top.js', 'a/mid.js']);
        assert.deepEqual(got, ['top.js', 'a/mid.js', 'a/b/c/d.js']);
    });
});

describe('TypeScript ESM specifiers', () => {
    // Found on a real repository, not invented: `got` is 80 TypeScript files and produced a
    // graph with ZERO edges, because modern TS writes the specifier with the extension the
    // OUTPUT will have. An empty graph looks like "this project has no structure".
    const files = new Set(['source/index.ts', 'source/core/index.ts', 'source/types.tsx', 'source/m.mts']);

    test('a .js specifier resolves to the .ts file it means', () => {
        assert.equal(resolveImport('source/a.ts', './index.js', files), 'source/index.ts');
    });
    test('and to a .tsx one', () => {
        assert.equal(resolveImport('source/a.ts', './types.js', files), 'source/types.tsx');
    });
    test('a folder written as ./core/index.js finds core/index.ts', () => {
        assert.equal(resolveImport('source/a.ts', './core/index.js', files), 'source/core/index.ts');
    });
    test('.mjs maps to .mts', () => {
        assert.equal(resolveImport('source/a.ts', './m.mjs', files), 'source/m.mts');
    });
    test('it still refuses to invent a target', () => {
        assert.equal(resolveImport('source/a.ts', './nowhere.js', files), null);
    });
});

describe('citations', () => {
    // A trace shows the statement that creates each hop. If the line number is wrong the whole
    // thing is worse than useless: it is confidently wrong, and a reader checks it once, finds
    // the wrong line, and stops trusting any of it.
    const SRC = [
        "// a leading comment",           // 1
        "/* a block",                     // 2
        "   comment that spans lines */", // 3
        "import a from './a.js';",        // 4
        "",                               // 5
        "import b from './b.js';",        // 6
    ].join('\n');

    test('the line number survives a comment above it', () => {
        const got = importsIn(SRC);
        assert.deepEqual(got.map((i) => [i.spec, i.line]), [['./a.js', 4], ['./b.js', 6]]);
    });

    test('and the text of the line comes with it', () => {
        assert.equal(importsIn(SRC)[0].text, "import a from './a.js';");
    });

    test('an edge carries the citation of the import that made it', () => {
        const g = buildCodeGraph({
            'src/index.js': "import './x.js';\nimport y from './y.js';",
            'src/x.js': '', 'src/y.js': '',
        });
        const toY = g.edges.find((e) => e.from === 'src/y.js');
        assert.equal(toY.line, 2);
        assert.equal(toY.text, "import y from './y.js';");
    });
});

describe('tracePath', () => {
    const G = buildCodeGraph({
        'src/index.js': "import { render } from './ui/render.js';",
        'src/ui/render.js': "import { fmt } from '../util/fmt.js';",
        'src/util/fmt.js': "export const fmt = () => 1;",
        'src/orphan.js': "export const nothing = 1;",
    });

    test('walks the real chain and cites every hop', () => {
        const t = tracePath(G, 'src/index.js', 'src/util/fmt.js');
        assert.equal(t.steps.length, 2);
        assert.deepEqual(t.steps.map((s) => [s.from, s.to]), [
            ['src/index.js', 'src/ui/render.js'],
            ['src/ui/render.js', 'src/util/fmt.js'],
        ]);
        // The citation is the point of the whole feature.
        assert.equal(t.steps[0].line, 1);
        assert.ok(t.steps[0].text.includes("./ui/render.js"));
        assert.ok(t.steps[1].text.includes("../util/fmt.js"));
    });

    test('no route is null, not an empty walk', () => {
        // "There is no path between these two" is an answer. An empty list reads as "they are
        // connected by nothing in particular", which is a different and false statement.
        assert.equal(tracePath(G, 'src/index.js', 'src/orphan.js'), null);
    });

    test('a file traces to itself in no steps', () => {
        assert.deepEqual(tracePath(G, 'src/index.js', 'src/index.js'), { steps: [] });
    });

    test('entry points are what nothing imports', () => {
        const e = entryPoints(G).sort();
        assert.deepEqual(e, ['src/index.js', 'src/orphan.js']);
    });
});
