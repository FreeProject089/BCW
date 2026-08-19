import { useMemo, useState } from 'react';
import CodeFlows from './code-flows.jsx';

// The trace walk lives with the graph, on the server side of the same file — but the walk is
// pure, so the same shape is recomputed here rather than making a round trip per click.

// A repository as nested folder boxes, with a line for every real import.
//
// Not a force-directed cloud: the thing a reader wants to know is "what lives where, and what
// leans on what", and a folder IS the grouping the author already chose. Laying it out any other
// way throws away information that is already in the paths.
//
// Every line is an import statement that exists in the source — see lib/code-graph.mjs. Nothing
// here is inferred from a name or a convention.

const FILE_H = 22;
const FILE_GAP = 4;
const PAD = 10;
const HEADER = 18;
const COL_W = 230;
const COL_GAP = 40;

const FN_H = 15;

/** Folders as columns, deepest paths grouped under their own box.
 *
 * `fnByFile` decides how tall a file row is: at the finest detail a file grows to fit the
 * functions an edge actually touches. Passing it in rather than reading it inside keeps this
 * a pure function of its arguments, which is why the same call lays out all three levels. */
function layout(nodes, folders, fnByFile = {}, collapse = false) {
    const byFolder = new Map();
    for (const n of nodes) {
        const f = n.folder || '(root)';
        if (!byFolder.has(f)) byFolder.set(f, []);
        byFolder.get(f).push(n);
    }
    // Depth first, then name: a reader scans left to right from the outside in, which is how the
    // paths read too.
    const keys = [...byFolder.keys()].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

    const boxes = [];
    const pos = new Map();
    let x = 0; let colTop = 0; let colIndex = 0;
    const MAX_COL_H = 900;

    const rowH = (f) => FILE_H + (fnByFile[f.id]?.length || 0) * FN_H;
    for (const key of keys) {
        const files = byFolder.get(key);
        // Collapsed, a folder is ONE box the height of a single row. Every file in it still gets
        // a position — that box — so every edge already drawn keeps working and simply lands on
        // the folder instead of the file. Lines between two files of the same folder become a
        // line from a box to itself and are dropped where they are drawn.
        const h = collapse
            ? HEADER + PAD + FILE_H + PAD
            : HEADER + PAD + files.reduce((n, f) => n + rowH(f) + FILE_GAP, 0) + PAD;
        // Start a new column when this one is full, rather than one enormous strip.
        if (colTop > 0 && colTop + h > MAX_COL_H) { colIndex += 1; colTop = 0; }
        x = colIndex * (COL_W + COL_GAP);
        const box = { key, x, y: colTop, w: COL_W, h, files };
        boxes.push(box);
        let rowY = colTop + HEADER + PAD;
        if (collapse) {
            const at = { x: x + PAD, y: rowY, w: COL_W - PAD * 2, h: FILE_H, headH: FILE_H, folder: key };
            files.forEach((f) => pos.set(f.id, at));
        } else {
            files.forEach((f) => {
                const h2 = rowH(f);
                pos.set(f.id, { x: x + PAD, y: rowY, w: COL_W - PAD * 2, h: h2, headH: FILE_H });
                rowY += h2 + FILE_GAP;
            });
        }
        colTop += h + 18;
    }
    const width = (colIndex + 1) * (COL_W + COL_GAP);
    const height = Math.max(...boxes.map((b) => b.y + b.h), 0) + 20;
    return { boxes, pos, width, height };
}

/**
 * The shortest real chain between two files, with the statement that makes each hop.
 *
 * The honest version of a "simulation": nothing is executed and no runtime behaviour is claimed.
 * A step reading "API call: fetch item details" would be invention dressed as analysis. What
 * this can prove, and all it says, is — this file imports that one, on this line, and here is
 * the line.
 */
function tracePath(edges, fromId, toId) {
    if (fromId === toId) return [];
    const out = new Map();
    for (const e of edges) {
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
    if (!seen.has(toId)) return null;   // no route IS an answer; an empty walk is not
    const steps = [];
    let cur = toId;
    while (cur !== fromId) {
        const e = prev.get(cur);
        if (!e) return null;
        steps.unshift({ from: e.to, to: e.from, line: e.line, text: e.text });
        cur = e.to;
    }
    return steps;
}

export default function CodeMap({ graph, t = (k, d) => d }) {
    // How close the map stands. Folders answers "what is this repository made of"; functions
    // answers "what runs". Neither is the right default for both questions, so it is a choice
    // rather than a zoom that guesses.
    const [detail, setDetail] = useState('files');
    // Zoom. A real repository lays out wider than any screen, and the answer to "where am I"
    // has been scrolling two axes. Kept as a plain scale on the SVG rather than a transform on
    // its contents: the browser then scrolls the scaled box for us, so panning stays the
    // scrollbar people already know instead of a drag gesture they have to discover.
    const [zoom, setZoom] = useState(1);
    const [picked, setPicked] = useState(null);
    // Second selection: the destination of a trace. Held apart from `picked` so a plain
    // click keeps meaning "show me this file" and never surprises somebody into a walk.
    const [traceTo, setTraceTo] = useState(null);
    // The import graph reads JS/TS only, so a Rust file serving a Tauri command is not one of
    // its nodes — and a line to a box that does not exist cannot be drawn. The files on the far
    // side of an endpoint link are added as nodes of their own, marked `served`, which is also
    // the honest description: they are part of this architecture and the imports simply cannot
    // see them.
    const { nodes, endpointLinks } = useMemo(() => {
        const base = graph?.nodes || [];
        const links = graph?.endpoints?.links || [];
        const known = new Set(base.map((n) => n.id));
        const extra = new Map();
        for (const l of links) {
            for (const side of [l.from, l.to]) {
                if (!side?.file || known.has(side.file) || extra.has(side.file)) continue;
                const parts = side.file.split('/');
                extra.set(side.file, {
                    id: side.file, label: parts[parts.length - 1],
                    folder: parts.slice(0, -1).join('/'),
                    dependents: 0, served: true,
                });
            }
        }
        // Only the links whose BOTH ends are now on the map. One end missing means the other
        // side of the repo was outside the scan, and half a line is a claim nobody can check.
        const all = [...base, ...extra.values()];
        const on = new Set(all.map((n) => n.id));
        return { nodes: all, endpointLinks: links.filter((l) => on.has(l.from?.file) && on.has(l.to?.file)) };
    }, [graph]);
    const edges = graph?.edges || [];
    const folders = useMemo(() => [...new Set(nodes.map((n) => n.folder).filter(Boolean))].sort(), [nodes]);
    // Only at the finest detail do files grow to hold their functions.
    const fnByFile = detail === 'functions' ? (graph?.fnByFile || {}) : {};
    const collapsed = detail === 'folders';
    // The layout comes FIRST: `fnPos` below reads `pos`, and a dependency array is evaluated
    // on every render — including the first, where a `const` declared further down has not
    // been initialised yet. That is a temporal-dead-zone throw during render, so the whole
    // tool rendered as "can't access lexical declaration before initialization" and nothing
    // else. Early-returning inside the callback does not save it; the array is read anyway.
    const { boxes, pos, width, height } = useMemo(() => layout(nodes, folders, fnByFile, collapsed), [nodes, folders, fnByFile, collapsed]);

    // Where each drawn function sits, so a call can land on the FUNCTION rather than on the
    // file that contains it. Same geometry the chips are drawn with — one source, so a chip and
    // the line arriving at it cannot disagree.
    const fnPos = useMemo(() => {
        const m = new Map();
        if (detail !== 'functions') return m;
        for (const [file, rows] of Object.entries(fnByFile)) {
            const p = pos.get(file);
            if (!p) continue;
            rows.forEach((fn, k) => m.set(`${file}#${fn.name}`, {
                x: p.x, w: p.w, y: p.y + FILE_H + k * FN_H, h: FN_H,
            }));
        }
        return m;
    }, [detail, fnByFile, pos]);

    if (!nodes.length) return null;

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const needs = picked ? edges.filter((e) => e.to === picked).map((e) => e.from) : [];
    const usedBy = picked ? edges.filter((e) => e.from === picked).map((e) => e.to) : [];
    const lit = new Set(picked ? [picked, ...needs, ...usedBy] : []);
    // The busiest file, so the scale means something rather than being arbitrary.
    const maxDeps = Math.max(1, ...nodes.map((n) => n.dependents));
    // Recomputed here rather than fetched: the walk is pure, and a round trip per click
    // would make exploring the graph feel like using a website instead of reading a map.
    const steps = (picked && traceTo) ? tracePath(edges, picked, traceTo) : null;
    const myCalls = picked ? endpointLinks.filter((l) => l.from.file === picked || l.to.file === picked) : [];

    return (
        <div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-sm text-[var(--muted)]">
                <span><b className="text-[var(--text)] tabular-nums">{graph.stats?.drawn ?? nodes.length}</b> {t('cm.files', 'files')}</span>
                <span><b className="text-[var(--text)] tabular-nums">{boxes.length}</b> {t('cm.folders', 'folders')}</span>
                <span><b className="text-[var(--text)] tabular-nums">{edges.length}</b> {t('cm.imports', 'imports')}</span>
                {endpointLinks.length > 0 && (
                  <span><b className="text-[var(--text)] tabular-nums">{endpointLinks.length}</b> {t('cm.calls', 'calls across languages')}</span>
                )}
            </div>

            {/* Said before the picture, not after: a truncated graph is not this repo. */}
            {graph.stats?.truncated && (
                <p className="text-[12px] text-[var(--warning)] mb-2">
                    {/* Every drawable file, not just the JS ones — the Rust half of a repo
                        counted for nothing in this total and made it read low. */}
                    {t('cm.truncated', 'Showing {n} of {m} files — the rest are not drawn.')
                        .replace('{n}', graph.stats.drawn)
                        .replace('{m}', (graph.stats.jsFiles || 0) + (graph.stats.rustFiles || 0))}
                </p>
            )}
            {graph.unsupported?.length > 0 && (
                <p className="text-[12px] text-[var(--faint)] mb-2">
                    {/* It reads Rust as well now, and a caption that says otherwise on a page
                        showing 28 Rust files is the drawing arguing with its own label. */}
                    {t('cm.unsupported', 'JavaScript, TypeScript and Rust are read. Skipped: {x}.').replace('{x}', graph.unsupported.join(', '))}
                </p>
            )}

            {/* How close to stand. A single control rather than a zoom that guesses: "what is
                this made of" and "what runs" are different questions, and the second is only
                answerable where the scan found functions to draw. */}
            <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] text-[var(--faint)] uppercase tracking-wide mr-1">{t('cm.detail', 'Detail')}</span>
                {[['folders', t('cm.d.folders', 'Folders')], ['files', t('cm.d.files', 'Files')], ['functions', t('cm.d.functions', 'Functions')]].map(([k, label]) => {
                    const off = k === 'functions' && !Object.keys(graph?.fnByFile || {}).length;
                    return (
                        <button key={k} type="button" disabled={off} onClick={() => setDetail(k)}
                            title={off ? t('cm.d.none', 'This scan found no calls between functions.') : undefined}
                            className={`text-xs px-2.5 py-1 rounded-full border transition ${detail === k
                                ? 'border-[var(--primary)] text-[var(--primary)]'
                                : `border-[var(--line)] text-[var(--muted)] ${off ? 'opacity-40' : 'hover:text-[var(--text)]'}`}`}>
                            {label}
                        </button>
                    );
                })}
            </div>

            <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
                <div className="overflow-auto max-h-[70vh] rounded-xl border border-[var(--line)] p-2 relative">
                    <div className="sticky top-0 left-0 z-10 flex items-center gap-1 w-fit">
                        {[['−', -0.2, t('cm.zoomout', 'Zoom out')], ['+', 0.2, t('cm.zoomin', 'Zoom in')]].map(([sign, d, title]) => (
                            <button key={sign} type="button" title={title}
                                onClick={() => setZoom((z) => Math.min(2, Math.max(0.4, +(z + d).toFixed(2))))}
                                className="w-6 h-6 rounded-md border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] text-sm leading-none"
                                style={{ background: 'var(--bg-solid)' }}>{sign}</button>
                        ))}
                        <button type="button" onClick={() => setZoom(1)}
                            className="h-6 px-1.5 rounded-md border border-[var(--line)] text-[10px] text-[var(--muted)] hover:text-[var(--text)] tabular-nums"
                            style={{ background: 'var(--bg-solid)' }}>{Math.round(zoom * 100)}%</button>
                    </div>
                    <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`}
                        style={{ minWidth: width * zoom }} role="img"
                        aria-label={t('cm.a11y', '{n} files in {f} folders, {e} imports')
                            .replace('{n}', nodes.length).replace('{f}', boxes.length).replace('{e}', edges.length)}>
                        {/* Edges under everything. Only the selected file's lines are drawn: all of
                            them at once on a real repo is 168 crossing curves and no information. */}
                        {picked && edges.filter((e) => e.from === picked || e.to === picked).map((e, i) => {
                            const a = pos.get(e.from); const b = pos.get(e.to);
                            // Collapsed, two files in one folder become one box: a line from it to
                            // itself is a loop that says nothing.
                            if (a === b) return null;
                            if (!a || !b) return null;
                            const x1 = a.x + a.w; const y1 = a.y + a.h / 2;
                            const x2 = b.x; const y2 = b.y + b.h / 2;
                            const mid = (x1 + x2) / 2;
                            return <path key={i} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                                fill="none" stroke="var(--primary-2)" strokeWidth="1.5" opacity="0.75" />;
                        })}

                        {/* At the finest detail the calls land on the FUNCTIONS. Drawn for the
                            selected file only, like everything else here: 387 of them at once is
                            a hatch pattern, not a map. */}
                        {picked && detail === 'functions' && (graph?.functions || [])
                            .filter((fe) => fe.from.file === picked || fe.to.file === picked)
                            .map((fe, i) => {
                                const a2 = fnPos.get(fe.from.id) || pos.get(fe.from.file);
                                const b3 = fnPos.get(fe.to.id) || pos.get(fe.to.file);
                                if (!a2 || !b3 || a2 === b3) return null;
                                const x1 = a2.x + a2.w; const y1 = a2.y + a2.h / 2;
                                const x2 = b3.x; const y2 = b3.y + b3.h / 2;
                                const mid = (x1 + x2) / 2;
                                return (
                                    <g key={`f${i}`}>
                                        <path d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                                            fill="none" stroke="var(--warning)" strokeWidth="1.5" opacity="0.8" strokeDasharray="5 3" />
                                        {/* The label is the whole point of a function-level line:
                                            "GET /admin/pending" says what the call IS. */}
                                        <text x={mid} y={(y1 + y2) / 2 - 3} fontSize="9" textAnchor="middle" fill="var(--warning)">
                                            {fe.label.length > 28 ? `${fe.label.slice(0, 27)}…` : fe.label}
                                        </text>
                                    </g>
                                );
                            })}

                        {/* Calls that cross a language boundary. Dashed and in a different ink
                            because they are not imports: nothing here `imports` a Rust file, and
                            drawing both the same way would say it does. Same rule as the imports
                            though — only shown for the selected file, or 178 + 2028 lines at once
                            is a hatch pattern. */}
                        {picked && detail !== 'functions' && endpointLinks.filter((l) => l.from.file === picked || l.to.file === picked).map((l, i) => {
                            const a = pos.get(l.from.file); const b2 = pos.get(l.to.file);
                            if (a === b2) return null;   // same folder, collapsed
                            if (!a || !b2) return null;
                            const x1 = a.x + a.w; const y1 = a.y + a.h / 2;
                            const x2 = b2.x; const y2 = b2.y + b2.h / 2;
                            const mid = (x1 + x2) / 2;
                            return <path key={`e${i}`} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                                fill="none" stroke="var(--warning)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.9" />;
                        })}

                        {boxes.map((b) => (
                            <g key={b.key}>
                                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="8"
                                    fill="color-mix(in srgb, var(--surface-2) 60%, transparent)"
                                    stroke="var(--line)" strokeWidth="1" />
                                <text x={b.x + PAD} y={b.y + 13} fontSize="10.5" fill="var(--muted)">{b.key}</text>
                                {/* Collapsed: one row saying how many files are in here, instead of the
                                    files themselves. The box is still the folder, so every line that
                                    pointed at a file now points at the folder that holds it. */}
                                {collapsed ? (
                                    <g transform={`translate(${b.x + PAD}, ${b.y + HEADER + PAD})`}>
                                        <rect width={COL_W - PAD * 2} height={FILE_H} rx="5"
                                            fill="color-mix(in srgb, var(--primary) 10%, var(--surface))" stroke="var(--line)" />
                                        <text x="7" y="15" fontSize="11" fill="var(--text)">
                                            {t('cm.nfiles', '{n} file(s)').replace('{n}', String(b.files.length))}
                                        </text>
                                    </g>
                                ) : b.files.map((f) => {
                                    const p = pos.get(f.id);
                                    const on = !picked || lit.has(f.id);
                                    // Weight by how much leans on it, so the hub is visible before
                                    // anything is clicked.
                                    const strength = f.dependents / maxDeps;
                                    return (
                                        <g key={f.id} transform={`translate(${p.x},${p.y})`}
                                            tabIndex={0} role="button" aria-pressed={picked === f.id}
                                            onClick={(ev) => {
                                              // Alt-click picks the DESTINATION of a walk. A plain
                                              // click keeps meaning "show me this file", so nobody
                                              // is surprised into a trace they did not ask for.
                                              if (ev.altKey && picked && picked !== f.id) { setTraceTo(f.id); return; }
                                              setTraceTo(null);
                                              setPicked(picked === f.id ? null : f.id);
                                            }}
                                            onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setTraceTo(null); setPicked(picked === f.id ? null : f.id); } }}
                                            opacity={on ? 1 : 0.25} style={{ cursor: 'pointer' }}>
                                            <title>{`${f.id} — ${f.dependents} dependent(s)`}</title>
                                            <rect width={p.w} height={p.h} rx="5"
                                                fill={f.served
                                                  ? 'color-mix(in srgb, var(--warning) 12%, var(--surface))'
                                                  : `color-mix(in srgb, var(--primary) ${Math.round(strength * 30)}%, var(--surface))`}
                                                stroke={picked === f.id ? 'var(--primary-2)' : f.served ? 'color-mix(in srgb, var(--warning) 45%, var(--line))' : 'var(--line)'}
                                                strokeWidth={picked === f.id ? 2 : 1}
                                                strokeDasharray={f.served ? '4 3' : undefined} />
                                            <text x="7" y="15" fontSize="11" fill="var(--text)">
                                                {f.label.length > 26 ? `${f.label.slice(0, 25)}…` : f.label}
                                            </text>
                                            {f.dependents > 0 && (
                                                <text x={p.w - 7} y="15" fontSize="10" textAnchor="end" fill="var(--faint)">{f.dependents}</text>
                                            )}
                                            {/* The functions an edge or a flow actually touches — not every declaration
                                                in the file, which in a 900-line module is forty and reads as a wall. */}
                                            {(fnByFile[f.id] || []).map((fn, k) => (
                                                <text key={fn.name} x="14" y={FILE_H + 11 + k * FN_H} fontSize="9.5"
                                                    fill="var(--muted)" style={{ fontFamily: 'ui-monospace, monospace' }}>
                                                    <title>{`${fn.name}(${fn.params})${fn.line ? ` — line ${fn.line}` : ''}`}</title>
                                                    {`${fn.name}(${fn.params.length > 14 ? '…' : fn.params})`.slice(0, 30)}
                                                </text>
                                            ))}
                                        </g>
                                    );
                                })}
                            </g>
                        ))}
                    </svg>
                </div>

                <aside className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
                    {!picked ? (
                        <div className="text-[var(--muted)]">
                            {t('cm.pick', 'Select a file to see what it imports and what imports it.')}
                            <span className="block mt-1 text-[11px] text-[var(--faint)]">
                                {t('cm.hint', 'The number on a file is how many others depend on it.')}
                            </span>
                        </div>
                    ) : (
                        <>
                            <div className="font-semibold break-all mb-1">{picked}</div>
                            <div className="text-[11px] text-[var(--faint)] mb-3">
                                {t('cm.deps', '{n} file(s) depend on this').replace('{n}', byId.get(picked)?.dependents ?? 0)}
                            </div>
                            {/* The cross-language calls this file is either end of. Both lines
                                are quoted: this is the one place in the map where the connection
                                is a string rather than an import, so the proof has to be on
                                screen or it is just an assertion. */}
                            {myCalls.length > 0 && (
                                <div className="mb-3">
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">
                                        {t('cm.crosscalls', 'Calls across languages')}
                                    </div>
                                    <ul className="space-y-1.5">
                                        {myCalls.slice(0, 12).map((l, i) => {
                                            const outgoing = l.from.file === picked;
                                            const other = outgoing ? l.to : l.from;
                                            return (
                                                <li key={i} className="text-[12px]">
                                                    <div className="flex items-baseline gap-1.5">
                                                        <span className="text-[var(--warning)]">{outgoing ? '→' : '←'}</span>
                                                        <span className="font-medium">{l.name || l.route}</span>
                                                        <span className="text-[10px] text-[var(--faint)]">{l.kind}</span>
                                                    </div>
                                                    <button type="button" onClick={() => setPicked(other.file)}
                                                        className="block text-left text-[11px] text-[var(--muted)] hover:text-[var(--primary-2)] break-all">
                                                        {other.file}:{other.line}
                                                    </button>
                                                    <code className="block mt-0.5 px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--line)] text-[10.5px] break-all">
                                                        {(outgoing ? l.from : l.to).text}
                                                    </code>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    {myCalls.length > 12 && (
                                        <div className="text-[10px] text-[var(--faint)] mt-1">
                                            {t('cm.andmore', '+{n} more').replace('{n}', myCalls.length - 12)}
                                        </div>
                                    )}
                                </div>
                            )}
                            {traceTo ? <Trace steps={steps} from={picked} to={traceTo} onClear={() => setTraceTo(null)} t={t} /> : (
                              <div className="text-[11px] text-[var(--faint)] mb-3">
                                {t('cm.tracehint', 'Alt-click another file to trace the chain of imports between them.')}
                              </div>
                            )}
                            <Side title={t('cm.imports2', 'It imports')} list={needs} onPick={setPicked}
                                empty={t('cm.noimports', 'Nothing from this repository.')} />
                            <Side title={t('cm.importedby', 'Imported by')} list={usedBy} onPick={setPicked}
                                empty={t('cm.noimportedby', 'Nothing else here imports it.')} />
                            <button type="button" onClick={() => setPicked(null)}
                                className="mt-3 text-[12px] text-[var(--primary-2)] hover:underline">{t('cm.clear', 'Clear selection')}</button>
                        </>
                    )}
                </aside>
            </div>

            {/* The boxes say what exists; this says what runs. Rendered under the map rather
                than inside it: a reader looks at the shape first, then asks what happens. */}
            <CodeFlows flows={graph.flows || []} repoUrl={graph.repoUrl || null} t={t} />

            {graph.unresolved?.length > 0 && (
                <details className="mt-3">
                    <summary className="text-[11px] text-[var(--muted)] cursor-pointer">
                        {t('cm.unres', '{n} relative import(s) that resolve to nothing').replace('{n}', graph.unresolved.length)}
                    </summary>
                    {/* Reported rather than hidden: these are usually a path alias the resolver does
                        not know, and a reader deserves to know the graph is missing those lines. */}
                    <ul className="mt-1 text-[11px] text-[var(--faint)] space-y-0.5">
                        {graph.unresolved.slice(0, 20).map((u, i) => <li key={i}>{u.from} → {u.spec}</li>)}
                    </ul>
                </details>
            )}
        </div>
    );
}

function Side({ title, list, onPick, empty }) {
    return (
        <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{title}</div>
            {!list.length ? <div className="text-[12px] text-[var(--faint)]">{empty}</div> : (
                <ul className="space-y-0.5 max-h-40 overflow-auto">
                    {list.map((id) => (
                        <li key={id}>
                            <button type="button" onClick={() => onPick(id)}
                                className="text-[12px] text-left hover:text-[var(--primary-2)] break-all">{id}</button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** The walk, step by step, each one quoting the line that makes it. */
function Trace({ steps, from, to, onClear, t }) {
    const short = (p) => p.split('/').slice(-2).join('/');
    return (
        <div className="mb-3 rounded-lg border border-[var(--primary)] p-2">
            <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--primary-2)]">
                    {t('cm.trace', 'How they connect')}
                </span>
                <button type="button" onClick={onClear} className="text-[var(--faint)] hover:text-[var(--text)] leading-none px-1">×</button>
            </div>
            {steps === null ? (
                // Said plainly. An empty step list would read as "connected by nothing in
                // particular", which is a different and false statement.
                <div className="text-[12px] text-[var(--muted)]">
                    {t('cm.notrace', 'No chain of imports leads from {a} to {b}.')
                        .replace('{a}', short(from)).replace('{b}', short(to))}
                </div>
            ) : (
                <ol className="space-y-1.5">
                    {steps.map((s, i) => (
                        <li key={i} className="text-[12px]">
                            <div className="text-[var(--muted)] break-all">
                                <b className="text-[var(--text)]">{i + 1}.</b> {short(s.from)} → {short(s.to)}
                            </div>
                            {/* The proof. Without the line and its text this is an assertion. */}
                            <code className="block mt-0.5 px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--line)] text-[11px] break-all">
                                <span className="text-[var(--faint)]">{s.from.split('/').pop()}:{s.line}</span>{'  '}{s.text}
                            </code>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
