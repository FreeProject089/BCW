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
import { useState } from 'react';
import { ArrowDown, ChevronRight, FileCode2 } from 'lucide-react';

const KIND_LABEL = {
    http: 'over HTTP',
    tauri: 'through the app bridge',
};

/** file/path/thing.js → thing.js, with the folder kept as a title. Long paths in a step
 *  header push the useful half off the edge on a laptop. */
const short = (p) => String(p || '').split('/').pop();

function Step({ s, n, last }) {
    const [open, setOpen] = useState(n <= 2);   // the call and what serves it, open by default
    return (
        <li className="relative pl-6">
            <span className="absolute left-0 top-1 w-4 h-4 rounded-full grid place-items-center text-[10px] font-bold"
                style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>{n}</span>
            <button onClick={() => setOpen((v) => !v)} className="text-left w-full">
                <div className="text-[13px] font-medium flex items-center gap-1.5">
                    <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                    {s.label}
                </div>
                <div className="text-[11px] text-[var(--faint)] pl-[18px]" title={s.file}>
                    <FileCode2 size={10} className="inline mr-1" />{short(s.file)}:{s.line}
                </div>
            </button>
            {open && s.code?.text && (
                <pre className="mt-1 ml-[18px] p-2 rounded-lg overflow-x-auto text-[11px] leading-relaxed"
                    style={{ background: 'var(--surface-2)' }}>
                    <code>{s.code.text}</code>
                </pre>
            )}
            {!last && <ArrowDown size={12} className="text-[var(--faint)] ml-[3px] my-1" />}
        </li>
    );
}

export default function CodeFlows({ flows = [], t = (k, d) => d }) {
    const [open, setOpen] = useState(null);
    if (!flows.length) return null;
    return (
        <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wide text-[var(--faint)] mb-2">
                {t('cf.title', 'What runs, in order')} <span className="tabular-nums">({flows.length})</span>
            </div>
            <p className="text-[12px] text-[var(--muted)] mb-2">
                {t('cf.sub', 'Each one starts at a call this scan proved and follows what the receiving function reaches for next. Nothing is executed and nothing is described — every step shows the file, the line and the source, so you read the code rather than a summary of it.')}
            </p>
            <div className="space-y-2">
                {flows.map((f, i) => (
                    <div key={i} className="rounded-xl border border-[var(--line)] overflow-hidden">
                        <button onClick={() => setOpen(open === i ? null : i)}
                            className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-[var(--surface-2)]">
                            <ChevronRight size={13} className={`transition-transform ${open === i ? 'rotate-90' : ''}`} />
                            <span className="text-[13px] font-medium truncate">{f.label}</span>
                            <span className="text-[11px] text-[var(--faint)] ml-auto shrink-0">
                                {KIND_LABEL[f.kind] || f.kind} · {f.steps.length} {t('cf.steps', 'steps')}
                            </span>
                        </button>
                        {open === i && (
                            <ol className="px-3 pb-3 pt-1 space-y-0">
                                {f.steps.map((s, j) => <Step key={j} s={s} n={j + 1} last={j === f.steps.length - 1} />)}
                            </ol>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
