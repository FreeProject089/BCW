// Laying a stack out left to right, the way `terraform graph` reads: what nothing depends on
// first, and everything that needs it to its right.
//
// Pure, and separate from the drawing, because the part that can go wrong is the graph walk
// and not the SVG. A cycle in a hand-written config must not hang the page — somebody WILL
// write one, since the config is a JSON blob an admin edits by hand.

/**
 * Depth of each node: the longest chain of dependencies leading to it.
 *
 * Longest rather than shortest, so a node sits to the right of EVERYTHING it needs. With the
 * shortest path, a service that depends on both the database and the API would be drawn beside
 * the API it waits for, and an edge would point backwards.
 *
 * A cycle is not an error to throw — it is a config somebody is still editing, and the page
 * has to render. Nodes in one are given the depth they had when the walk stopped, so the
 * drawing is odd rather than absent, and `cycles` says so plainly.
 */
export function stackLayers(nodes = [], edges = []) {
    const ids = new Set(nodes.map((n) => n.id));
    // Edges to nodes that do not exist are dropped rather than silently creating them: a typo
    // in a config should not invent a box nobody declared.
    const clean = edges.filter((e) => Array.isArray(e) && ids.has(e[0]) && ids.has(e[1]));
    const dropped = edges.length - clean.length;

    const needs = new Map(nodes.map((n) => [n.id, []]));
    for (const [from, to] of clean) needs.get(to).push(from);

    const depth = new Map();
    const state = new Map();   // 'walking' | 'done'
    let cycles = 0;

    const walk = (id) => {
        if (state.get(id) === 'done') return depth.get(id);
        if (state.get(id) === 'walking') { cycles += 1; return 0; }   // back edge: stop here
        state.set(id, 'walking');
        let d = 0;
        for (const dep of needs.get(id) || []) d = Math.max(d, walk(dep) + 1);
        state.set(id, 'done');
        depth.set(id, d);
        return d;
    };
    for (const n of nodes) walk(n.id);

    const max = Math.max(0, ...[...depth.values()]);
    const columns = Array.from({ length: max + 1 }, () => []);
    // Declaration order within a column, so an admin who reorders the config sees the drawing
    // reorder. Sorting by name would take that control away for no gain.
    for (const n of nodes) columns[depth.get(n.id) ?? 0].push(n);

    return { columns, depth, edges: clean, cycles, droppedEdges: dropped };
}

/** Node kinds, and what each is for. The colour and column meaning live with the renderer. */
export const STACK_KINDS = ['edge', 'app', 'worker', 'data', 'external'];
export const isStackKind = (k) => STACK_KINDS.includes(String(k));
