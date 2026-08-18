// Reading a repository's SOURCE and drawing what actually connects to what.
//
// This is the layer under the architecture view, and it is held to the same rule as the stack
// detector: an edge exists only if a file really imports another file. Nothing is inferred from
// a name, a folder, or a convention — those produce diagrams that look expert and are fiction,
// and this one is published.
//
// Deliberately JS/TS only for now. Resolving an import is language-specific, and a half-written
// resolver for a language returns wrong edges rather than no edges. `unsupported` names what was
// skipped so the caller can say so out loud instead of showing an empty graph for a Rust repo.

const JS_EXT = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
const INDEXES = JS_EXT.map((e) => `index${e}`);

const isJs = (p) => JS_EXT.some((e) => p.endsWith(e));
const dirOf = (p) => { const a = p.split('/'); a.pop(); return a.join('/'); };

/**
 * Every import/require/dynamic-import specifier in a file.
 *
 * Comments and strings are stripped first. Without that, an example inside a block comment —
 * which documentation files are full of — becomes a real edge, and the diagram gains a
 * dependency that exists only in prose.
 */
export function importsIn(source) {
    // Comments are BLANKED, not deleted, so every character keeps its offset and a match can
    // still be turned into the line it came from. Deleting them shifts everything after the
    // first comment, and then every citation points at the wrong line — worse than no citation,
    // because it looks authoritative.
    const raw = String(source);
    const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

    const srcLines = raw.split('\n');
    const lineAt = (idx) => raw.slice(0, idx).split('\n').length;

    const out = [];
    const push = (spec, idx) => {
        if (!spec || out.some((o) => o.spec === spec)) return;
        const line = lineAt(idx);
        out.push({ spec, line, text: (srcLines[line - 1] || '').trim().slice(0, 200) });
    };
    for (const m of src.matchAll(/\bimport\s+[^'"()]*?from\s*['"]([^'"]+)['"]/g)) push(m[1], m.index);
    for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) push(m[1], m.index);
    for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1], m.index);
    for (const m of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1], m.index);
    for (const m of src.matchAll(/\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g)) push(m[1], m.index);
    return out;
}

/**
 * Turn a relative specifier into a path that EXISTS in the given set, or null.
 *
 * Null rather than a guess: an unresolved import is usually a package, sometimes an alias, and
 * inventing a target for it would connect two files that never meet. The extension dance is
 * what a bundler does — `./foo` may be foo.ts, foo/index.ts, or already exact.
 */
export function resolveImport(fromPath, spec, files) {
    if (!spec.startsWith('.')) return null;   // a package, not a file in this repo
    const base = dirOf(fromPath);
    const parts = `${base}/${spec}`.split('/');
    const stack = [];
    for (const seg of parts) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { stack.pop(); continue; }
        stack.push(seg);
    }
    const target = stack.join('/');
    if (files.has(target)) return target;

    // TypeScript ESM writes the specifier with the extension the OUTPUT will have: `./x.js`
    // pointing at `x.ts`. It is the normal way to write a modern TS package, and without this
    // the whole graph comes back empty — which is exactly what a real repository showed:
    // 80 files, 0 edges, 50 unresolved.
    const TS_FOR_JS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
    for (const [out, ins] of Object.entries(TS_FOR_JS)) {
        if (!target.endsWith(out)) continue;
        const stem = target.slice(0, -out.length);
        for (const i of ins) if (files.has(stem + i)) return stem + i;
        // `./dir/index.js` where the folder holds index.ts
        for (const i of INDEXES) if (files.has(`${stem}/${i}`)) return `${stem}/${i}`;
    }

    for (const e of JS_EXT) if (files.has(target + e)) return target + e;
    for (const i of INDEXES) if (files.has(`${target}/${i}`)) return `${target}/${i}`;
    return null;
}


// ── Rust ──────────────────────────────────────────────────────────────────────
//
// A Rust repository used to draw NOTHING. The graph read JS and TS, listed `rs` under
// "languages this cannot read", and stopped — so BetterInstaller, three crates and 28 source
// files, had an architecture tab with an empty diagram in it.
//
// Rust says what it includes with two statements, and both are exact:
//
//   `mod foo;`            — this file's parent declares foo, which is `foo.rs` or `foo/mod.rs`
//                           in the same directory. This is what actually builds the tree.
//   `use crate::a::b::C;` — a path from the crate root, so it resolves against `src/`.
//
// Neither is guessed at. `use` of an external crate (`use serde::…`) resolves to nothing here
// and is dropped, exactly as a bare `import 'react'` is on the JS side.

const isRust = (p) => p.endsWith('.rs');

/** Every `mod x;` and `use crate::x::y;` in a Rust file, with the line it came from. */
export function rustImportsIn(source) {
    const raw = String(source);
    const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
    const srcLines = raw.split('\n');
    const lineAt = (idx) => raw.slice(0, idx).split('\n').length;

    const out = [];
    const push = (spec, idx, kind) => {
        if (!spec || out.some((o) => o.spec === spec && o.kind === kind)) return;
        const line = lineAt(idx);
        out.push({ spec, kind, line, text: (srcLines[line - 1] || '').trim().slice(0, 200) });
    };
    // `pub mod x;` / `mod x;` — but NOT `mod x { … }`, which declares the module inline and
    // therefore points at no file at all.
    for (const m of src.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/gm)) {
        push(m[1], m.index, 'mod');
    }
    // `use crate::a::b;` and `use self::a::b;` — the first segment after the root is what
    // names a file; the rest are items inside it.
    for (const m of src.matchAll(/\buse\s+(?:crate|self)::([A-Za-z_][\w:]*)/g)) {
        push(m[1].split('::')[0], m.index, 'use');
    }
    return out;
}

/**
 * Resolve a Rust `mod`/`use` to a file that exists.
 *
 * `mod` is relative to the declaring file's own module directory; `use crate::` is relative to
 * the crate root, which is the `src/` folder holding the nearest `main.rs`/`lib.rs` above.
 * Both forms accept `x.rs` and `x/mod.rs`, which is the whole of Rust's file layout.
 */
export function resolveRust(fromPath, spec, kind, files) {
    const dir = dirOf(fromPath);
    const stem = fromPath.replace(/\.rs$/, '');
    const bases = [];
    if (kind === 'mod') {
        // `mod x` inside `a/mod.rs` or `a/lib.rs` looks in `a/`; inside `a/b.rs` it looks in
        // `a/b/` — the directory that file's own module owns.
        bases.push(/\/(mod|lib|main)\.rs$/.test(fromPath) ? dir : stem);
        bases.push(dir);
    } else {
        // Crate root: the nearest ancestor directory that holds a lib.rs or main.rs.
        const parts = dir.split('/');
        while (parts.length) {
            const at = parts.join('/');
            if (files.has(`${at}/lib.rs`) || files.has(`${at}/main.rs`)) { bases.push(at); break; }
            parts.pop();
        }
        bases.push(dir);
    }
    for (const base of bases) {
        if (!base) continue;
        for (const cand of [`${base}/${spec}.rs`, `${base}/${spec}/mod.rs`]) {
            if (files.has(cand)) return cand;
        }
    }
    return null;
}

/**
 * The architecture graph: files, the folders that contain them, and the imports between them.
 *
 * @param sources {path: contents}
 * @param opts.maxNodes cap, so one enormous repo cannot produce a diagram nobody can read
 * @returns { nodes, edges, folders, unresolved, unsupported, stats }
 */
export function buildCodeGraph(sources = {}, { maxNodes = 400 } = {}) {
    const all = Object.keys(sources);
    const js = all.filter(isJs);
    // Named, not silently dropped: a repo that is mostly Go should be told so, not shown three
    // stray JS files as though that were its architecture.
    const unsupported = [...new Set(all.filter((f) => !isJs(f) && !isRust(f)).map((f) => f.split('.').pop()))]
        .filter((e) => e && e.length <= 5).sort();

    // Rust files are NODES now, beside the JS ones. A repository is allowed to be two
    // languages, and BetterInstaller — three crates, 28 files — drew an empty diagram while
    // every `mod` and `use crate::` in it was there to be read.
    const rs = all.filter(isRust);
    const drawable = [...js, ...rs];
    const files = new Set(drawable);
    const kept = drawable.slice(0, maxNodes);
    const keptSet = new Set(kept);

    const edges = [];
    const unresolved = [];
    const seen = new Set();
    for (const f of kept) {
        const statements = isRust(f)
            ? rustImportsIn(sources[f]).map((i) => ({ ...i, rust: true }))
            : importsIn(sources[f]);
        for (const { spec, line, text, kind, rust } of statements) {
            const target = rust ? resolveRust(f, spec, kind, files) : resolveImport(f, spec, files);
            if (!target) {
                // A bare specifier is a package — expected, and not worth reporting. A relative
                // one that does not resolve is a genuine oddity worth surfacing. On the Rust
                // side the same distinction: a `mod` that resolves to no file is worth seeing,
                // a `use crate::` that does not is usually a re-export and is not.
                if (rust ? kind === 'mod' : spec.startsWith('.')) unresolved.push({ from: f, spec, line });
                continue;
            }
            if (!keptSet.has(target)) continue;      // beyond the cap; drawing half an edge is worse
            const key = `${f}|${target}`;
            if (seen.has(key)) continue;
            seen.add(key);
            // The line and its text travel WITH the edge: a trace has to show the statement
            // that creates each hop, and recomputing it later would mean parsing twice and
            // risking two different answers.
            edges.push({ from: target, to: f, line, text });
        }
    }

    // Folders, for the nested boxes. Derived from the files that survived, so an empty folder
    // never appears.
    const folders = [...new Set(kept.map(dirOf).filter(Boolean))].sort();

    const nodes = kept.map((path) => ({
        id: path,
        label: path.split('/').pop(),
        folder: dirOf(path),
        // How much of the graph leans on this file. The one number that says "this is the hub"
        // without anybody having to count arrows.
        dependents: 0,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) { const n = byId.get(e.from); if (n) n.dependents += 1; }

    return {
        nodes, edges, folders, unresolved: unresolved.slice(0, 50), unsupported,
        stats: {
            filesSeen: all.length,
            jsFiles: js.length,
            rustFiles: rs.length,
            drawn: kept.length,
            truncated: drawable.length > kept.length,
            edges: edges.length,
        },
    };
}

/** Files worth fetching for a code graph, shallowest first, bounded. */
export function sourcePathsToFetch(paths = [], { limit = 300, maxDepth = 6 } = {}) {
    return paths
        // Rust as well as JS: the graph draws both now, and fetching only one of them would
        // leave a Rust repository with an empty diagram for a different reason than before.
        .filter((p) => isJs(p) || p.endsWith('.rs'))
        .filter((p) => !/(^|\/)(node_modules|vendor|dist|build|out|coverage|\.next|\.git|__tests__|__mocks__|target)(\/|$)/.test(p))
        .filter((p) => !/\.(test|spec|min|d)\.[cm]?[jt]sx?$/.test(p))
        .filter((p) => p.split('/').length - 1 <= maxDepth)
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
        .slice(0, limit);
}

/**
 * Walk the graph from one file to another, and show the statement that makes each hop.
 *
 * This is the honest version of a "simulation". It does NOT execute anything and does not claim
 * to know what happens at runtime — a step reading "API call: fetch item details" would be
 * invention dressed as analysis. What it can prove, and all it says, is: this file imports that
 * one, on this line, and here is the line.
 *
 * Shortest path by breadth-first search, following the direction things are USED: from an entry
 * point outwards through what it pulls in.
 *
 * @returns { steps } or null when no path exists — null rather than an empty walk, because
 *          "there is no route between these two" is an answer and an empty list is not.
 */
export function tracePath(graph, fromId, toId) {
    if (fromId === toId) return { steps: [] };
    // `to` needs `from`, so walking outwards from an entry point means following the edges
    // backwards: the entry is the `to` of its own imports.
    const out = new Map();
    for (const e of graph.edges || []) {
        if (!out.has(e.to)) out.set(e.to, []);
        out.get(e.to).push(e);
    }

    const prev = new Map();
    const seen = new Set([fromId]);
    const queue = [fromId];
    while (queue.length) {
        const cur = queue.shift();
        if (cur === toId) break;
        for (const e of out.get(cur) || []) {
            if (seen.has(e.from)) continue;
            seen.add(e.from);
            prev.set(e.from, e);
            queue.push(e.from);
        }
    }
    if (!seen.has(toId)) return null;

    const steps = [];
    let cur = toId;
    while (cur !== fromId) {
        const e = prev.get(cur);
        if (!e) return null;
        steps.unshift({ from: e.to, to: e.from, line: e.line, text: e.text });
        cur = e.to;
    }
    return { steps };
}

/**
 * The files nothing else imports — where a reader should start.
 *
 * An entry point is not declared anywhere reliable (package.json `main` lies as often as not in
 * a monorepo), so it is DERIVED: a file with no dependents is either the entry or dead code, and
 * both are worth looking at first.
 */
export function entryPoints(graph) {
    const used = new Set((graph.edges || []).map((e) => e.from));
    return (graph.nodes || []).filter((n) => !used.has(n.id)).map((n) => n.id);
}
