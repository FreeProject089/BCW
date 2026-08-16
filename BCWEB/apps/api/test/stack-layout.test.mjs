// The stack graph's layout. Lives in apps/web, tested here because this is where the runner
// is and the file is plain JS with no JSX — a pure function with no test is the same as no
// function, and the part that can go wrong is the walk, not the SVG.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stackLayers } from '../../web/src/lib/stack-layout.js';

const n = (...ids) => ids.map((id) => ({ id, label: id }));

describe('stackLayers', () => {
    test('nothing depends on it → first column', () => {
        const r = stackLayers(n('db', 'api'), [['db', 'api']]);
        assert.deepEqual(r.columns.map((c) => c.map((x) => x.id)), [['db'], ['api']]);
    });

    test('a node sits right of EVERYTHING it needs, not just the nearest', () => {
        // THE ONE. With shortest-path depth, `web` needing both db and api would land in
        // column 1 beside the api it waits for, and its edge would point backwards.
        const r = stackLayers(n('db', 'api', 'web'), [['db', 'api'], ['db', 'web'], ['api', 'web']]);
        assert.equal(r.depth.get('web'), 2);
        assert.deepEqual(r.columns.map((c) => c.map((x) => x.id)), [['db'], ['api'], ['web']]);
    });

    test('a cycle renders instead of hanging, and is reported', () => {
        // The config is a JSON blob an admin edits by hand. Somebody will write one, and the
        // page still has to draw.
        const r = stackLayers(n('a', 'b'), [['a', 'b'], ['b', 'a']]);
        assert.ok(r.cycles > 0, 'it says there is one');
        assert.equal(r.columns.flat().length, 2, 'and both nodes are still drawn');
    });

    test('an edge naming a node that does not exist is dropped, not invented', () => {
        const r = stackLayers(n('a'), [['a', 'ghost'], ['nope', 'a']]);
        assert.equal(r.droppedEdges, 2);
        assert.deepEqual(r.columns.flat().map((x) => x.id), ['a']);
    });

    test('order within a column follows the config, not the alphabet', () => {
        // An admin who reorders the config expects the drawing to reorder. Sorting by name
        // would take that control away for nothing.
        const r = stackLayers(n('zeta', 'alpha'), []);
        assert.deepEqual(r.columns[0].map((x) => x.id), ['zeta', 'alpha']);
    });

    test('an empty stack is one empty column, not a crash', () => {
        const r = stackLayers([], []);
        assert.equal(r.columns.length, 1);
        assert.deepEqual(r.columns[0], []);
    });

    test('a long chain keeps its order', () => {
        const r = stackLayers(n('a', 'b', 'c', 'd'), [['a', 'b'], ['b', 'c'], ['c', 'd']]);
        assert.deepEqual(r.columns.map((c) => c.map((x) => x.id)), [['a'], ['b'], ['c'], ['d']]);
    });
});
