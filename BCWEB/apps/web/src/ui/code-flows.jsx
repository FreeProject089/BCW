// What happens, in order, when one part of the code calls another.
//
// This is the panel a code map is missing: the boxes say what exists, and this says what
// runs. Each flow starts at a proven call — a `fetch` that lands on a route, an `invoke` that
// lands on a Rust command — then follows what the receiving function reaches for next,
// through its own import statements.
//
// **Nothing here is executed and nothing is narrated.** A step saying "the handler validates
// the payload and returns the item" would be a sentence about somebody's code that nobody
// checked; it would read as analysis and age into a lie. So every step carries three facts and
// no opinion: the function's name, the file and line it is on, and the source itself. A reader
// who wants to know what it does reads it — the panel's job is to say WHERE to read.
//
// The word "simulation" is avoided for the same reason.
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ChevronRight, FileCode2, Play, Pause, SkipBack, SkipForward, Search, X, ExternalLink } from 'lucide-react';
import { highlightCode } from '../pages/pages.jsx';

/** A file's language, from its extension. Prism needs telling; the snapshot does not carry it.
 *  An unknown extension falls through to plain text rather than to a guess — mis-highlighted
 *  code reads as broken code. */
function langOf(file) {
    const ext = String(file || '').split('.').pop().toLowerCase();
    return { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
        ts: 'typescript', tsx: 'typescript', rs: 'rust', py: 'python', json: 'json',
        toml: 'toml', sh: 'bash', yml: 'yaml', yaml: 'yaml', css: 'css', html: 'markup' }[ext] || '';
}

/** github.com/owner/repo + a path + a line → the file, at that line, on GitHub.
 *
 *  `HEAD` rather than a branch name: the snapshot does not record which branch it read, and a
 *  link to `main` on a repository whose default is `master` is a 404 that looks like our bug.
 *  HEAD always resolves to whatever the default is.
 *
 *  Returns null for anything that is not a github.com URL, so a project hosted elsewhere shows
 *  no link instead of a broken one. */
function githubLink(repoUrl, file, line) {
    if (!repoUrl || !file) return null;
    const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(repoUrl).trim());
    if (!m) return null;
    const path = String(file).split('/').map(encodeURIComponent).join('/');
    return `https://github.com/${m[1]}/${m[2]}/blob/HEAD/${path}${line ? `#L${line}` : ''}`;
}

const KIND_LABEL = {
    http: 'over HTTP',
    tauri: 'through the app bridge',
    // Electron. Named after what it is rather than after "IPC", which tells a reader who is
    // not an Electron developer nothing at all.
    ipc: 'across the window boundary',
};

/** file/path/thing.js → thing.js, with the folder kept as a title. Long paths in a step
 *  header push the useful half off the edge on a laptop. */
const short = (p) => String(p || '').split('/').pop();

function Step({ s, n, last, current, repoUrl, t }) {
    const [open, setOpen] = useState(n <= 2);   // the call and what serves it, open by default
    const ref = useRef(null);
    // While a flow plays, the step being reached opens itself and scrolls into view. Reading
    // a walkthrough should not also be operating one.
    useEffect(() => {
        if (!current) return;
        setOpen(true);
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [current]);
    return (
        <li ref={ref} className={`relative pl-6 rounded-lg transition ${current ? 'ring-1 ring-[var(--primary)] px-1 py-1 -mx-1' : ''}`}>
            <span className="absolute left-0 top-1 w-4 h-4 rounded-full grid place-items-center text-[10px] font-bold"
                style={{ background: current ? 'var(--primary)' : 'var(--surface-2)', color: current ? 'var(--bg-solid)' : 'var(--muted)' }}>{n}</span>
            <button onClick={() => setOpen((v) => !v)} className="text-left w-full">
                <div className="text-[13px] font-medium flex items-center gap-1.5">
                    <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                    {s.label}
                </div>
                <div className="text-[11px] text-[var(--faint)] pl-[18px]" title={s.file}>
                    <FileCode2 size={10} className="inline mr-1" />{short(s.file)}:{s.line}
                </div>
            </button>
            {open && s.code?.text && (<>
                {/* Highlighted, and the language comes from the extension because the snapshot
                    does not record one. An excerpt is a few lines out of a file, so the line
                    that matters is the one the step points at — hence the link below rather
                    than more excerpt. */}
                <pre className="mt-1 ml-[18px] p-2 rounded-lg overflow-x-auto text-[11px] leading-relaxed"
                    style={{ background: 'var(--surface-2)' }}>
                    <code className={`language-${langOf(s.file) || 'none'}`}
                        dangerouslySetInnerHTML={{ __html: highlightCode(s.code.text, langOf(s.file)) }} />
                </pre>
                {/* The whole file, at this line. An excerpt answers "what does this call look
                    like"; the next question is always "and what is around it". */}
                {githubLink(repoUrl, s.file, s.line) && (
                    <a href={githubLink(repoUrl, s.file, s.line)} target="_blank" rel="noreferrer"
                        className="ml-[18px] mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--primary-2)] hover:underline">
                        <ExternalLink size={11} /> {t('cf.open', 'Open {f} on GitHub').replace('{f}', short(s.file))}
                    </a>
                )}
            </>)}
            {!last && <ArrowDown size={12} className="text-[var(--faint)] ml-[3px] my-1" />}
        </li>
    );
}

export default function CodeFlows({ flows = [], repoUrl = null, t = (k, d) => d }) {
    const [open, setOpen] = useState(null);
    const [q, setQ] = useState('');
    // Where the walkthrough is standing, and whether it is moving on its own. `null` means
    // nobody has started it — every step reads normally, which is the state you want when you
    // are scanning rather than following.
    const [at, setAt] = useState(null);
    const [playing, setPlaying] = useState(false);
    const steps = open != null ? (flows[open]?.steps || []) : [];

    useEffect(() => {
        if (!playing || open == null) return undefined;
        const id = setInterval(() => {
            setAt((i) => {
                const next = (i ?? -1) + 1;
                // Stops at the end rather than looping. A walkthrough that starts again from the
                // top while you are reading the last step is a walkthrough you fight.
                if (next >= steps.length) { setPlaying(false); return i; }
                return next;
            });
        }, 1600);
        return () => clearInterval(id);
    }, [playing, open, steps.length]);

    // Opening a different flow puts the walkthrough back to the start of it, stopped.
    const openFlow = (i) => { setOpen(open === i ? null : i); setAt(null); setPlaying(false); };
    const step = (d) => {
        setPlaying(false);
        setAt((i) => Math.max(0, Math.min(steps.length - 1, (i ?? (d > 0 ? -1 : 0)) + d)));
    };

    // Filtering keeps each flow's ORIGINAL index alongside it.
    //
    // `open` and the `steps` lookup are indexes into `flows`, so filtering into a fresh array
    // would renumber them: type a query with a flow open and a different one expands, with the
    // walkthrough standing on a step that belongs to neither. Carrying the index is what makes
    // the search safe to use while reading rather than only before it.
    //
    // The haystack is the flow's label, its kind, and every step's label and file. With forty
    // flows the question is almost never "which one is called X" — it is "which one touches
    // this file", and a search that only read labels could not answer it.
    const needle = q.trim().toLowerCase();
    const shown = flows
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => !needle || (
            `${f.label} ${f.kind} ${(f.steps || []).map((s) => `${s.label || ''} ${s.file || ''}`).join(' ')}`
                .toLowerCase().includes(needle)
        ));

    if (!flows.length) return null;
    return (
        <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wide text-[var(--faint)] mb-2">
                {t('cf.title', 'What runs, in order')}{' '}
                {/* The count says what you are looking at, not what exists: "7 of 40" while a
                    query is on, so a short list never reads as a scan that found little. */}
                <span className="tabular-nums">
                    ({needle ? `${shown.length}/${flows.length}` : flows.length})
                </span>
            </div>
            <p className="text-[12px] text-[var(--muted)] mb-2">
                {t('cf.sub', 'Each one starts at a call this scan proved and follows what the receiving function reaches for next. Nothing is executed and nothing is described — every step shows the file, the line and the source, so you read the code rather than a summary of it.')}
            </p>
            {/* Search appears once the list is long enough to need it. Below that it is a
                control that costs a row and saves nothing. */}
            {flows.length > 6 && (
                <div className="relative mb-2">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={t('cf.search', 'Search a flow, a function or a file…')}
                        aria-label={t('cf.search', 'Search a flow, a function or a file…')}
                        className="input w-full !pl-8 !pr-8 !py-1.5 !text-[13px]"
                    />
                    {q && (
                        <button type="button" onClick={() => setQ('')} title={t('cf.clear', 'Clear')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--text)]">
                            <X size={13} />
                        </button>
                    )}
                </div>
            )}
            {needle && !shown.length && (
                <p className="text-[12px] text-[var(--muted)] py-3">
                    {t('cf.none', 'No flow matches that — the search reads flow names, function names and file paths.')}
                </p>
            )}
            <div className="space-y-2">
                {shown.map(({ f, i }) => (
                    <div key={i} className="rounded-xl border border-[var(--line)] overflow-hidden">
                        <button onClick={() => openFlow(i)}
                            className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-[var(--surface-2)]">
                            <ChevronRight size={13} className={`transition-transform ${open === i ? 'rotate-90' : ''}`} />
                            <span className="text-[13px] font-medium truncate">{f.label}</span>
                            <span className="text-[11px] text-[var(--faint)] ml-auto shrink-0">
                                {KIND_LABEL[f.kind] || f.kind} · {f.steps.length} {t('cf.steps', 'steps')}
                            </span>
                        </button>
                        {open === i && (<>
                            {/* Walk it. The buttons move a highlight down the same list — nothing
                                is executed and nothing new is claimed; it is a reading aid for a
                                chain that is already written out. */}
                            <div className="flex items-center gap-1.5 px-3 pb-1">
                                <button type="button" onClick={() => step(-1)} title={t('cf.prev', 'Previous step')}
                                    className="w-6 h-6 rounded-md border border-[var(--line)] grid place-items-center text-[var(--muted)] hover:text-[var(--text)]">
                                    <SkipBack size={12} />
                                </button>
                                <button type="button" onClick={() => { setPlaying((v) => !v); if (at == null) setAt(0); }}
                                    title={playing ? t('cf.pause', 'Pause') : t('cf.play', 'Walk through it')}
                                    className="w-6 h-6 rounded-md border border-[var(--line)] grid place-items-center text-[var(--muted)] hover:text-[var(--text)]">
                                    {playing ? <Pause size={12} /> : <Play size={12} />}
                                </button>
                                <button type="button" onClick={() => step(1)} title={t('cf.next', 'Next step')}
                                    className="w-6 h-6 rounded-md border border-[var(--line)] grid place-items-center text-[var(--muted)] hover:text-[var(--text)]">
                                    <SkipForward size={12} />
                                </button>
                                <span className="text-[11px] text-[var(--faint)] tabular-nums ml-1">
                                    {at == null ? t('cf.notstarted', 'not started') : `${at + 1} / ${f.steps.length}`}
                                </span>
                            </div>
                            <ol className="px-3 pb-3 pt-1 space-y-0">
                                {f.steps.map((s, j) => (
                                    <Step key={j} s={s} n={j + 1} last={j === f.steps.length - 1} current={at === j} repoUrl={repoUrl} t={t} />
                                ))}
                            </ol>
                        </>)}
                    </div>
                ))}
            </div>
        </div>
    );
}
