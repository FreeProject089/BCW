import { useMemo, useState } from 'react';

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

/** Folders as columns, deepest paths grouped under their own box. */
function layout(nodes, folders) {
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

    for (const key of keys) {
        const files = byFolder.get(key);
        const h = HEADER + PAD + files.length * (FILE_H + FILE_GAP) + PAD;
        // Start a new column when this one is full, rather than one enormous strip.
        if (colTop > 0 && colTop + h > MAX_COL_H) { colIndex += 1; colTop = 0; }
        x = colIndex * (COL_W + COL_GAP);
        const box = { key, x, y: colTop, w: COL_W, h, files };
        boxes.push(box);
        files.forEach((f, i) => {
            pos.set(f.id, {
                x: x + PAD,
                y: colTop + HEADER + PAD + i * (FILE_H + FILE_GAP),
                w: COL_W - PAD * 2,
                h: FILE_H,
            });
        });
        colTop += h + 18;
    }
    const width = (colIndex + 1) * (COL_W + COL_GAP);
    const height = Math.max(...boxes.map((b) => b.y + b.h), 0) + 20;
    return { boxes, pos, width, height };
}

export default function CodeMap({ graph, t = (k, d) => d }) {
    const [picked, setPicked] = useState(null);
    const nodes = graph?.nodes || [];
    const edges = graph?.edges || [];
    const { boxes, pos, width, height } = useMemo(() => layout(nodes, graph?.folders || []), [nodes, graph]);

    if (!nodes.length) return null;

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const needs = picked ? edges.filter((e) => e.to === picked).map((e) => e.from) : [];
    const usedBy = picked ? edges.filter((e) => e.from === picked).map((e) => e.to) : [];
    const lit = new Set(picked ? [picked, ...needs, ...usedBy] : []);
    // The busiest file, so the scale means something rather than being arbitrary.
    const maxDeps = Math.max(1, ...nodes.map((n) => n.dependents));

    return (
        <div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-sm text-[var(--muted)]">
                <span><b className="text-[var(--text)] tabular-nums">{graph.stats?.drawn ?? nodes.length}</b> {t('cm.files', 'files')}</span>
                <span><b className="text-[var(--text)] tabular-nums">{boxes.length}</b> {t('cm.folders', 'folders')}</span>
                <span><b className="text-[var(--text)] tabular-nums">{edges.length}</b> {t('cm.imports', 'imports')}</span>
            </div>

            {/* Said before the picture, not after: a truncated graph is not this repo. */}
            {graph.stats?.truncated && (
                <p className="text-[12px] text-[var(--warning)] mb-2">
                    {t('cm.truncated', 'Showing {n} of {m} files — the rest are not drawn.')
                        .replace('{n}', graph.stats.drawn).replace('{m}', graph.stats.jsFiles)}
                </p>
            )}
            {graph.unsupported?.length > 0 && (
                <p className="text-[12px] text-[var(--faint)] mb-2">
                    {t('cm.unsupported', 'Only JavaScript and TypeScript are read. Skipped: {x}.').replace('{x}', graph.unsupported.join(', '))}
                </p>
            )}

            <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
                <div className="overflow-auto max-h-[70vh] rounded-xl border border-[var(--line)] p-2">
                    <svg width={width} height={height} style={{ minWidth: width }} role="img"
                        aria-label={t('cm.a11y', '{n} files in {f} folders, {e} imports')
                            .replace('{n}', nodes.length).replace('{f}', boxes.length).replace('{e}', edges.length)}>
                        {/* Edges under everything. Only the selected file's lines are drawn: all of
                            them at once on a real repo is 168 crossing curves and no information. */}
                        {picked && edges.filter((e) => e.from === picked || e.to === picked).map((e, i) => {
                            const a = pos.get(e.from); const b = pos.get(e.to);
                            if (!a || !b) return null;
                            const x1 = a.x + a.w; const y1 = a.y + a.h / 2;
                            const x2 = b.x; const y2 = b.y + b.h / 2;
                            const mid = (x1 + x2) / 2;
                            return <path key={i} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                                fill="none" stroke="var(--primary-2)" strokeWidth="1.5" opacity="0.75" />;
                        })}

                        {boxes.map((b) => (
                            <g key={b.key}>
                                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="8"
                                    fill="color-mix(in srgb, var(--surface-2) 60%, transparent)"
                                    stroke="var(--line)" strokeWidth="1" />
                                <text x={b.x + PAD} y={b.y + 13} fontSize="10.5" fill="var(--muted)">{b.key}</text>
                                {b.files.map((f) => {
                                    const p = pos.get(f.id);
                                    const on = !picked || lit.has(f.id);
                                    // Weight by how much leans on it, so the hub is visible before
                                    // anything is clicked.
                                    const strength = f.dependents / maxDeps;
                                    return (
                                        <g key={f.id} transform={`translate(${p.x},${p.y})`}
                                            tabIndex={0} role="button" aria-pressed={picked === f.id}
                                            onClick={() => setPicked(picked === f.id ? null : f.id)}
                                            onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setPicked(picked === f.id ? null : f.id); } }}
                                            opacity={on ? 1 : 0.25} style={{ cursor: 'pointer' }}>
                                            <title>{`${f.id} — ${f.dependents} dependent(s)`}</title>
                                            <rect width={p.w} height={p.h} rx="5"
                                                fill={`color-mix(in srgb, var(--primary) ${Math.round(strength * 30)}%, var(--surface-1))`}
                                                stroke={picked === f.id ? 'var(--primary-2)' : 'var(--line)'}
                                                strokeWidth={picked === f.id ? 2 : 1} />
                                            <text x="7" y="15" fontSize="11" fill="var(--text)">
                                                {f.label.length > 26 ? `${f.label.slice(0, 25)}…` : f.label}
                                            </text>
                                            {f.dependents > 0 && (
                                                <text x={p.w - 7} y="15" fontSize="10" textAnchor="end" fill="var(--faint)">{f.dependents}</text>
                                            )}
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
