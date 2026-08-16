// Which function a line belongs to, and the path a request takes through them.
//
// The map draws files. A file is the wrong unit for the question people actually ask —
// "what happens when I click that tab" — because the answer is a sequence of FUNCTIONS,
// each in a file, each calling the next. `routes.mjs` calling `service.mjs` says almost
// nothing; `listItems() → getItemsByCategory()` says what happened.
//
// Everything here is derived. No prose is generated about what a function "does": the step
// carries the function's name, the line it starts on and the source of the call itself, and
// a reader who wants to know what it does reads it. A sentence invented about somebody's
// code is a sentence that will eventually be wrong and will look authoritative while it is.
//
// Deliberately regex-based, like the rest of this pipeline: the alternative is a parser per
// language, and the input is four languages already. The rule that keeps it honest is that
// anything it cannot place is left unplaced rather than guessed at — a step attributed to the
// wrong function is worse than a step that says "top level".

/** Languages whose declarations we can find. Anything else yields no functions, and the file
 *  still appears as a box — a file with no functions is a smaller answer, not a wrong one. */
const DECL = {
    js: [
        // function foo(…)  /  export default function foo(…)  /  async function foo(…)
        /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
        // const foo = (…) =>   /  export const foo = async (…) =>   /  let foo = function(
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/,
        // class Foo {  — a class is a container people navigate by, like a function
        /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/,
        // A method in a class or an object literal: `  handleChange(e) {`
        /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,
    ],
    rs: [
        /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*[(<]/,
        /^\s*impl\s+(?:[\w:<>, ]+\s+for\s+)?([A-Za-z_][\w]*)/,
    ],
    py: [
        /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/,
        /^\s*class\s+([A-Za-z_][\w]*)/,
    ],
    go: [
        /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/,
    ],
};

const EXT_LANG = {
    js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js',
    rs: 'rs', py: 'py', go: 'go',
};

export const langOf = (path) => EXT_LANG[String(path).split('.').pop()?.toLowerCase()] || null;

/**
 * Every declaration in a file, in source order: `{ name, line, indent }`.
 *
 * `indent` is kept because it is the only cheap signal of nesting that works across four
 * languages, and it is what lets a line be attributed to the innermost declaration that
 * could contain it.
 */
export function declarations(path, source) {
    const lang = langOf(path);
    const pats = DECL[lang];
    if (!pats || !source) return [];
    const out = [];
    const lines = String(source).split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // A line inside a block comment or a string can look like a declaration. Cheap guard:
        // skip lines whose first non-space characters are a comment opener.
        if (/^\s*(\/\/|\/\*|\*|#(?!\!)|--)/.test(line)) continue;
        for (const re of pats) {
            const m = re.exec(line);
            if (m && m[1]) {
                out.push({
                    name: m[1], line: i + 1, indent: line.match(/^\s*/)[0].length,
                    // The parameters as WRITTEN. This is the honest version of the "input
                    // example" a generated diagram shows: `(req, reply)` is a fact about the
                    // function, and `{ "newValue": "topRated" }` invented for it is not.
                    params: paramsOf(line),
                    // A one-liner closes where it opens. Without this, `const locOf = (h) => …;`
                    // declared inside a handler owned every line below it until the next
                    // declaration at its indent — a hundred lines away — and a route at the end
                    // of the file was credited to a two-line helper. Seen on a real module.
                    oneLine: closesOnItsOwnLine(line),
                });
                break;
            }
        }
    }
    return out;
}

/**
 * The declaration a line sits in, or null for top-level code.
 *
 * The nearest declaration ABOVE the line wins, which is right far more often than it is
 * wrong and is wrong in a visible way (a call attributed to the function above the one it is
 * in) rather than a silent one. A declaration at the same or greater indent than a later one
 * cannot contain it, so the search stops at the first shallower candidate.
 */
/** The parameter list on a declaration line, `(a, b)` → 'a, b'. Empty when there is none or
 *  when the line does not close its own parenthesis — a signature spanning three lines is
 *  better shown as nothing than as its first third. */
function paramsOf(line) {
    const i = String(line).indexOf('(');
    if (i < 0) return '';
    let depth = 0;
    for (let j = i; j < line.length; j++) {
        if (line[j] === '(') depth++;
        else if (line[j] === ')') { depth--; if (!depth) return line.slice(i + 1, j).trim().slice(0, 120); }
    }
    return '';
}

/** Does this declaration begin and end on the same line? True when its brackets balance and
 *  the line ends like a statement — which is what an arrow one-liner or a `fn x() {}` looks
 *  like, and never what an opening block looks like. */
function closesOnItsOwnLine(line) {
    const s = String(line);
    const bal = (a, b) => (s.split(a).length - s.split(b).length) === 0;
    return bal('{', '}') && bal('(', ')') && /[;,}]\s*$/.test(s.trim());
}

export function enclosing(decls, line) {
    // Each declaration owns the lines from itself down to the next declaration at the SAME or
    // shallower indent. Without that end, a helper declared later at top level captured every
    // line of the function above it — which is exactly the wrong-attribution failure this file
    // says it refuses to make, and it took a real repository to show it: a route on line 542
    // of a 900-line module was credited to a two-line helper declared at 540.
    let best = null;
    for (let i = 0; i < decls.length; i++) {
        const d = decls[i];
        if (d.line > line) break;
        const closer = decls.slice(i + 1).find((x) => x.indent <= d.indent);
        const end = d.oneLine ? d.line : (closer ? closer.line - 1 : Infinity);
        // The end is the NEXT declaration, not the closing brace: tracking braces across four
        // languages is a parser, and this is not one. The cost is that a blank line between two
        // functions is credited to the first — calls do not live there, so it is a stated
        // imprecision rather than a wrong answer about code that runs.
        if (line > end) continue;
        if (!best || d.indent >= best.indent) best = d; // innermost wins: a method over its class
    }
    return best;
}

/**
 * Turn the endpoint graph's links into FUNCTION-to-function edges.
 *
 * Same links, one level finer: each end is resolved to the declaration containing its line,
 * so the map can draw `handleChange → listItems` instead of `ShoppingList.jsx → items.js`.
 */
export function functionEdges(links = [], sources = {}) {
    const declCache = new Map();
    const declsFor = (file) => {
        if (!declCache.has(file)) declCache.set(file, declarations(file, sources[file] || ''));
        return declCache.get(file);
    };
    const side = (end) => {
        if (!end?.file) return null;
        const d = enclosing(declsFor(end.file), end.line || 1);
        return {
            file: end.file,
            line: end.line || null,
            fn: d?.name || null,          // null = top level, and it says so rather than guessing
            fnLine: d?.line || null,
            id: `${end.file}#${d?.name || '(top level)'}`,
        };
    };
    const out = [];
    for (const l of links) {
        const from = side(l.from); const to = side(l.to);
        if (!from || !to) continue;
        out.push({
            kind: l.kind,                                     // http | tauri
            label: l.kind === 'http' ? `${l.method || 'GET'} ${l.route || ''}`.trim() : (l.name || 'invoke'),
            from, to,
            text: l.from?.text || '',                          // the calling line, verbatim
        });
    }
    return out;
}

/**
 * One flow: what happens, in order, when this call is made.
 *
 * Step 1 is the caller. Step 2 is the function that serves it. Steps 3+ are what that
 * function calls NEXT, found by matching its body against the declarations exported by the
 * files it imports — bounded by `depth`, because a chain that follows every call ends up
 * being the whole program and answers nothing.
 *
 * A flow is not a trace: nothing here was executed. The steps are what the code says will be
 * reached, which is why each one carries its file and line — so the reader checks rather than
 * believes.
 */
export function buildFlow(edge, sources = {}, { depth = 3 } = {}) {
    if (!edge?.from || !edge?.to) return null;
    const steps = [{
        kind: 'call', file: edge.from.file, line: edge.from.line, fn: edge.from.fn,
        label: edge.from.fn ? `${edge.from.fn} calls ${edge.label}` : `calls ${edge.label}`,
        code: excerpt(sources[edge.from.file], edge.from.line),
    }, {
        kind: edge.kind === 'http' ? 'route' : 'command',
        file: edge.to.file, line: edge.to.line, fn: edge.to.fn,
        label: edge.to.fn ? `${edge.to.fn} handles it` : 'handled here',
        code: excerpt(sources[edge.to.file], edge.to.line),
    }];

    // What the handler reaches for next, one hop at a time.
    let cur = { file: edge.to.file, fn: edge.to.fn, line: edge.to.line };
    const seen = new Set([`${cur.file}#${cur.fn}`]);
    for (let i = 0; i < depth; i++) {
        const next = nextCall(cur, sources, seen);
        if (!next) break;
        seen.add(`${next.file}#${next.fn}`);
        steps.push({
            kind: 'step', file: next.file, line: next.line, fn: next.fn,
            label: `${next.fn} runs`, code: excerpt(sources[next.file], next.line),
        });
        cur = next;
    }
    return { label: edge.label, kind: edge.kind, steps };
}

/** The first call inside `cur`'s body that lands on a function declared in another file we
 *  hold. Imports are read from the file's own import lines, so a name that merely happens to
 *  match something elsewhere is not followed. */
function nextCall(cur, sources, seen) {
    const src = sources[cur.file];
    if (!src) return null;
    const lines = src.split('\n');
    const decls = declarations(cur.file, src);
    const me = decls.find((d) => d.name === cur.fn);
    const start = me ? me.line : 1;
    const after = decls.filter((d) => d.line > start && d.indent <= (me?.indent ?? 0));
    const end = after.length ? after[0].line - 1 : lines.length;

    const imported = importedNames(src);
    for (let i = start; i < end; i++) {
        for (const [name, from] of imported) {
            if (!new RegExp(`\\b${name}\\s*\\(`).test(lines[i])) continue;
            const target = resolveFile(cur.file, from, sources);
            if (!target) continue;
            const d = declarations(target, sources[target]).find((x) => x.name === name);
            if (!d || seen.has(`${target}#${name}`)) continue;
            return { file: target, fn: name, line: d.line };
        }
    }
    return null;
}

/** `import { a, b } from './x.js'` → [['a','./x.js'], ['b','./x.js']]. Default and namespace
 *  imports are skipped: the name is the importer's choice, so it says nothing about what is
 *  declared on the other side. */
export function importedNames(src) {
    const out = [];
    for (const m of String(src).matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        for (const raw of m[1].split(',')) {
            const name = raw.split(/\s+as\s+/).pop().trim();
            if (name) out.push([name, m[2]]);
        }
    }
    return out;
}

/** A relative specifier against the file set we hold. TypeScript writes `./x.js` meaning
 *  `x.ts`, so the extension is tried both ways — the same trap the import graph hit. */
export function resolveFile(from, spec, sources) {
    if (!spec.startsWith('.')) return null;
    const dir = from.split('/').slice(0, -1);
    const parts = spec.split('/');
    for (const p of parts) {
        if (p === '.') continue;
        else if (p === '..') dir.pop();
        else dir.push(p);
    }
    const base = dir.join('/');
    const tries = [base];
    const noExt = base.replace(/\.[cm]?jsx?$/, '');
    for (const e of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts']) tries.push(noExt + e, `${base}${e}`, `${base}/index${e}`);
    return tries.find((t) => sources[t]) || null;
}

/** A few lines around `line`, so a step can be read without opening the file. */
export function excerpt(src, line, span = 3) {
    if (!src || !line) return null;
    const lines = String(src).split('\n');
    const from = Math.max(1, line - 1);
    const to = Math.min(lines.length, line + span);
    return { from, to, text: lines.slice(from - 1, to).join('\n') };
}

/**
 * The functions worth DRAWING, per file.
 *
 * Not every declaration: a 900-line module has forty, and forty chips in a box is a wall of
 * text rather than a map. Only the ones an edge actually touches — the caller, the handler,
 * the next hop — because those are the ones a reader is following.
 *
 * A file whose functions are all untouched simply keeps its own box, which is the honest
 * outcome: nothing proven passes through it.
 */
export function drawableFunctions(edges = [], sources = {}, flows = []) {
    const wanted = new Map();   // file -> Set(fn)
    const want = (file, fn) => {
        if (!file || !fn) return;
        if (!wanted.has(file)) wanted.set(file, new Set());
        wanted.get(file).add(fn);
    };
    for (const e of edges) { want(e.from?.file, e.from?.fn); want(e.to?.file, e.to?.fn); }
    for (const f of flows) for (const s of f.steps || []) want(s.file, s.fn);

    const out = {};
    for (const [file, names] of wanted) {
        const decls = declarations(file, sources[file] || '');
        const rows = [...names]
            .map((n) => decls.find((d) => d.name === n) || { name: n, line: null, params: '' })
            .sort((a, b) => (a.line || 0) - (b.line || 0))
            .map((d) => ({ name: d.name, line: d.line, params: d.params || '' }));
        if (rows.length) out[file] = rows;
    }
    return out;
}
