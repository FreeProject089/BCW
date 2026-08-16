// The stack graph's layout. Lives in apps/web, tested here because this is where the runner
// is and the file is plain JS with no JSX — a pure function with no test is the same as no
// function, and the part that can go wrong is the walk, not the SVG.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stackLayers, stackTabEnabled, stackSwitchOn } from '../../web/src/lib/stack-layout.js';

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

    test('an edge may name what it carries, and still lays out the same', () => {
        // `{from,to,label}` beside `['a','b']`: the analysis panel shows the label, the layout
        // never sees it. Both normalise to [from, to, label] so `[from, to]` destructuring in
        // the renderer keeps working.
        const r = stackLayers(n('db', 'api'), [{ from: 'db', to: 'api', label: 'SQL' }]);
        assert.deepEqual(r.columns.map((c) => c.map((x) => x.id)), [['db'], ['api']]);
        assert.deepEqual(r.edges[0], ['db', 'api', 'SQL']);
    });

    test('mixed edge shapes coexist, and a malformed one is dropped', () => {
        const r = stackLayers(n('a', 'b', 'c'), [['a', 'b'], { from: 'b', to: 'c' }, null, {}, ['a']]);
        assert.equal(r.edges.length, 2);
        assert.equal(r.droppedEdges, 3);
        assert.deepEqual(r.edges.map((e) => e[2]), ['', ''], 'a label-less edge carries an empty one, never undefined');
    });

    test('a long chain keeps its order', () => {
        const r = stackLayers(n('a', 'b', 'c', 'd'), [['a', 'b'], ['b', 'c'], ['c', 'd']]);
        assert.deepEqual(r.columns.map((c) => c.map((x) => x.id)), [['a'], ['b'], ['c'], ['d']]);
    });
});

describe('stackTabEnabled', () => {
    const withNodes = (extra = {}) => ({ nodes: [{ id: 'a' }], ...extra });

    test('a stack written before the switch existed keeps its tab', () => {
        // THE BACK-COMPAT ONE. Adding a flag must not silently un-publish a page that was
        // already showing its diagram.
        assert.equal(stackTabEnabled(withNodes()), true);
    });

    test('the built-in switch turns it off', () => {
        assert.equal(stackTabEnabled(withNodes({ enabled: false })), false);
    });

    test("a showcase's sub-tab checkbox wins over the stack's own flag", () => {
        // The two kinds of page store the switch differently; the RULE must not fork. A
        // showcase admin unticking the box is the decision, whatever the stack object says.
        assert.equal(stackTabEnabled(withNodes({ enabled: true }), { stack: false }), false);
        assert.equal(stackTabEnabled(withNodes({ enabled: false }), { stack: true }), true);
    });

    test('a tabs object that says nothing about the stack does not decide', () => {
        assert.equal(stackTabEnabled(withNodes(), { legal: true }), true);
    });

    test('on, but nothing described → off', () => {
        // A switch left on with no components would publish an empty tab, which reads as a
        // broken page rather than an unfinished config.
        assert.equal(stackTabEnabled({ enabled: true, nodes: [] }, { stack: true }), false);
        assert.equal(stackTabEnabled(undefined), false);
        assert.equal(stackTabEnabled(null, { stack: true }), false);
    });

    test('the admin checkbox shows the SWITCH, not what the page does with it', () => {
        // Deleting the last component must not untick the box under the admin's cursor — they
        // would tick it again instead of adding a component. The editor warns instead.
        assert.equal(stackSwitchOn({ nodes: [] }), true, 'still on, just with nothing to draw');
        assert.equal(stackTabEnabled({ nodes: [] }), false, 'and the tab is still hidden');
        assert.equal(stackSwitchOn({ nodes: [], enabled: false }), false);
        assert.equal(stackSwitchOn({ nodes: [] }, { stack: false }), false);
    });
});
