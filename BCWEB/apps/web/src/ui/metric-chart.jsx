// One measure over time, drawn once and reused everywhere.
//
// The status page listed thirty days of CPU, memory, disk and latency as a table of numbers.
// A table answers "what was it on the 4th"; nobody opens a status page to ask that. They ask
// "is it climbing", and that question is a shape.
//
// Deliberately NOT a chart library: four small line charts do not justify 40 KB in the entry
// bundle, and every rule that matters here is one line of code —
//
//   · ONE measure per chart. CPU% and latency in ms on two y-axes is the single most common
//     way to make a chart lie; two charts side by side say the same thing and cannot.
//   · the y-axis starts at zero for a percentage, because half a bar is half the number.
//     For an unbounded measure (latency) it starts at zero too, so a 10 ms wobble on a 200 ms
//     baseline does not look like an outage.
//   · thin marks, a recessive grid, and the value in text — a chart that cannot be read
//     precisely still has to be readable exactly somewhere, which is what the table view and
//     the hover are for.
//   · colour is never the only encoding: every series is labelled in text, and the warning
//     threshold is a dashed line with its number, not just a change of hue.
//
// Three things that made it read as "weird", all fixed below and all worth naming because
// each one is a chart lying rather than a chart being ugly:
//
//   1. A DAY WITH NO READING WAS DELETED. The nulls were filtered out and the x position was
//      the row's index in what remained, so a gap in the data closed up and the line ran
//      straight through it. Two missing days out of seven drew as a continuous week, and the
//      date labels underneath were then wrong for every point after the hole. Time is now the
//      x axis: every day holds its place, and the line BREAKS across a gap instead of
//      inventing a value.
//   2. THE SVG WAS STRETCHED. viewBox 300 wide, painted at whatever the column was, with
//      preserveAspectRatio="none". Strokes survived that (vectorEffect), but circles did not:
//      the "where we are now" dot was drawn as a horizontal oval, wider the wider the screen.
//      The viewBox now matches the painted width, so nothing is distorted.
//   3. THE Y AXIS HAD NO NUMBERS. Two unlabelled guides and a top of the frame that was
//      peak × 1.15 meant the same height meant something different in each of the four
//      charts, and there was no way to read a value off any of them. The guides carry their
//      value now, and the scale is rounded to something a person can hold in their head.
import { useState, useRef, useId, useLayoutEffect } from 'react';

/** A smooth path through the points (monotone cubic — never overshoots a value). */
function pathOf(xs, ys) {
    const n = xs.length;
    if (n < 2) return '';
    if (n === 2) return `M${xs[0]},${ys[0]} L${xs[1]},${ys[1]}`;
    const d = [], m = [];
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / ((xs[i + 1] - xs[i]) || 1));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    let out = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
    for (let i = 0; i < n - 1; i++) {
        const dx = (xs[i + 1] - xs[i]) / 3;
        out += ` C${(xs[i] + dx).toFixed(2)},${(ys[i] + m[i] * dx).toFixed(2)} ${(xs[i + 1] - dx).toFixed(2)},${(ys[i + 1] - m[i + 1] * dx).toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
    }
    return out;
}

const fmt = (v, unit) => `${Number.isInteger(v) ? v : Number(v).toFixed(1)}${unit}`;

/**
 * A top of frame a person can read off.
 *
 * peak × 1.15 puts the top of the chart at 83.7 or 41.4, which is a number nobody can divide
 * by two in their head — and the guide at half height then says 41.85. Rounding up to the
 * next 1 / 2 / 5 × 10ⁿ makes the half-height guide a round number too, and makes two charts
 * of the same measure comparable instead of each being scaled to its own worst day.
 */
export function niceMax(peak, { unit, warnAt }) {
    const floor = unit === '%' ? 10 : 1;
    let need = Math.max(peak * 1.08, warnAt != null ? warnAt * 1.05 : 0, floor);
    // A percentage never means more than 100, and stopping the frame there is what makes
    // "how full is the disk" legible at a glance: three quarters of the height IS three
    // quarters full. The headroom multiplier must not push a disk at 100 % into a 200 %
    // frame, which is the one case where the rounding ladder below would be actively wrong.
    if (unit === '%') {
      // No headroom multiplier here, unlike an unbounded measure: the tops are 10 / 25 / 50
      // / 100, so the next one up is always at least 25 % taller anyway, and adding 8 % on
      // top of that is what would send a peak of 24 into a frame of 50 and a disk at 100 %
      // into a frame of 200, which cannot mean anything.
      need = Math.min(Math.max(peak, warnAt != null ? warnAt : 0, floor), 100);
      return need > 50 ? 100 : need > 25 ? 50 : need > 10 ? 25 : 10;
    }
    const mag = 10 ** Math.floor(Math.log10(need));
    for (const step of [1, 2, 2.5, 5, 10]) if (need <= step * mag) return step * mag;
    return 10 * mag;
}

/**
 * @param points {Array<{ label: string, value: number|null }>} oldest first. A null value is a
 *               day with no reading and is DRAWN as a gap, never dropped.
 * @param unit   what one value IS ('%', ' ms') — appended to every number shown
 * @param title  the measure's name, always rendered as text
 * @param warnAt a threshold worth drawing (85 for CPU%); null for none
 */
export default function MetricChart({ points = [], unit = '', title, height = 96, warnAt = null, labels = {} }) {
    const L = { avg: 'avg', min: 'min', peak: 'peak', warn: 'warn at', gaps: 'no reading', ...labels };
    const [hover, setHover] = useState(null);
    const ref = useRef(null);
    const gid = useId();
    // The viewBox is the painted width, so nothing is stretched (see note 2 at the top). The
    // fallback matters: this renders once before the observer has measured anything, and in
    // a hidden tab the observer never fires at all.
    const [W, setW] = useState(300);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const read = () => { const w = el.getBoundingClientRect().width; if (w > 40) setW(Math.round(w)); };
        read();
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const at = (p) => (p && p.value != null && Number.isFinite(Number(p.value)) ? Number(p.value) : null);
    const values = points.map(at);
    const known = values.filter((v) => v != null);
    if (known.length < 2) {
        return (
            <div className="text-[12px] text-[var(--muted)]">
                {title} · {known.length ? fmt(known[0], unit) : '—'}
            </div>
        );
    }

    const lastIdx = values.reduce((acc, v, i) => (v != null ? i : acc), -1);
    const last = values[lastIdx];
    const prevIdx = values.reduce((acc, v, i) => (v != null && i < lastIdx ? i : acc), -1);
    const prev = prevIdx >= 0 ? values[prevIdx] : null;
    const peak = Math.max(...known);
    const low = Math.min(...known);
    const avg = known.reduce((a, b) => a + b, 0) / known.length;
    const gaps = values.length - known.length;
    const max = niceMax(peak, { unit, warnAt });
    const H = height, PAD_T = 6;
    const plotH = H - PAD_T;
    // Index over EVERY point, including the ones with no reading: the x axis is time.
    const xAt = (i) => (values.length === 1 ? 0 : (i / (values.length - 1)) * W);
    const yAt = (v) => PAD_T + plotH - (v / max) * plotH;
    // One path per run of consecutive readings. A gap ends the run, so the line stops at the
    // last day we measured and starts again at the next one.
    const runs = [];
    let run = null;
    values.forEach((v, i) => {
        if (v == null) { run = null; return; }
        if (!run) { run = { xs: [], ys: [] }; runs.push(run); }
        run.xs.push(xAt(i)); run.ys.push(yAt(v));
    });
    const over = warnAt != null && last >= warnAt;
    const tone = over ? 'var(--warning)' : 'var(--primary)';
    const trend = prev == null ? 0 : last - prev;

    const onMove = (e) => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const x = ((e.clientX - box.left) / box.width) * (values.length - 1);
        const i = Math.max(0, Math.min(values.length - 1, Math.round(x)));
        setHover(i);
    };
    const hv = hover != null ? values[hover] : null;
    const hl = hover != null ? points[hover]?.label : null;
    // Three date labels are enough to place a shape in time; more become a table again.
    const ticks = [0, Math.floor((values.length - 1) / 2), values.length - 1];
    const dayLabel = (s) => String(s || '').slice(5);
    const guides = [0.5, 1];

    return (
        <div>
            <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[12px] font-medium flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: tone }} aria-hidden />
                    {title}
                </span>
                <span className="text-[12px] tabular-nums" style={{ color: tone }}>
                    <b>{hover != null ? (hv == null ? '—' : fmt(hv, unit)) : fmt(last, unit)}</b>
                    <span className="text-[var(--faint)] font-normal"> · {hover != null ? hl : (trend === 0 ? '→' : trend > 0 ? `▲ ${fmt(Math.abs(trend), unit)}` : `▼ ${fmt(Math.abs(trend), unit)}`)}</span>
                </span>
            </div>
            {/* The frame is measured, and the drawing uses those pixels, so a circle is round
                at every column width. overflow visible keeps the end dot from being clipped
                by its own half-width at the right edge. */}
            <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
                onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchMove={(e) => e.touches[0] && onMove(e.touches[0])}
                role="img" aria-label={`${title}: ${fmt(last, unit)} now, ${fmt(peak, unit)} at its highest, ${fmt(avg, unit)} on average over ${values.length} days${gaps ? `, ${gaps} with no reading` : ''}`}
                style={{ display: 'block', overflow: 'visible' }}>
                <defs>
                    <linearGradient id={`g-${gid}`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
                        <stop offset="100%" stopColor={tone} stopOpacity="0.02" />
                    </linearGradient>
                </defs>
                {/* Two guides, no more. A grid dense enough to read values from is a table —
                    but a guide with no number is decoration, so each carries its value. */}
                {guides.map((f) => (
                    <g key={f}>
                        <line x1="0" x2={W} y1={PAD_T + plotH - f * plotH} y2={PAD_T + plotH - f * plotH}
                            stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        <text x="2" y={PAD_T + plotH - f * plotH - 3} fill="var(--faint)" fontSize="9" className="tabular-nums">{fmt(max * f, unit)}</text>
                    </g>
                ))}
                {/* The threshold, dashed and labelled: where "fine" stops. */}
                {warnAt != null && warnAt <= max && (
                    <line x1="0" x2={W} y1={yAt(warnAt)} y2={yAt(warnAt)}
                        stroke="var(--warning)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity="0.7" />
                )}
                {runs.map((r, i) => (
                    <g key={i}>
                        {r.xs.length > 1 && <path d={`${pathOf(r.xs, r.ys)} L${r.xs[r.xs.length - 1]},${H} L${r.xs[0]},${H} Z`} fill={`url(#g-${gid})`} />}
                        {r.xs.length > 1
                            ? <path d={pathOf(r.xs, r.ys)} fill="none" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                            /* A single reading between two gaps has no line to be part of, and
                               dropping it would hide a day we DID measure. */
                            : <circle cx={r.xs[0]} cy={r.ys[0]} r="2" fill={tone} />}
                    </g>
                ))}
                {/* The last point is the one people came to read: a dot, always. */}
                <circle cx={xAt(lastIdx)} cy={yAt(last)} r="3.5" fill="var(--bg-solid)" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                {hover != null && (<>
                    <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD_T} y2={H} stroke={tone} strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.5" />
                    {hv != null && <circle cx={xAt(hover)} cy={yAt(hv)} r="4" fill={tone} stroke="var(--bg-solid)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
                </>)}
            </svg>
            <div className="flex items-center justify-between text-[10px] text-[var(--faint)] tabular-nums mt-1">
                {ticks.map((i, k) => <span key={k}>{dayLabel(points[i]?.label)}</span>)}
            </div>
            <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-[var(--faint)] tabular-nums mt-1">
                <span>{L.avg} <b className="text-[var(--muted)] font-medium">{fmt(avg, unit)}</b></span>
                <span>{L.min} <b className="text-[var(--muted)] font-medium">{fmt(low, unit)}</b></span>
                <span>{L.peak} <b className="text-[var(--muted)] font-medium">{fmt(peak, unit)}</b></span>
                {warnAt != null && <span>{L.warn} <b className="font-medium" style={{ color: 'var(--warning)' }}>{fmt(warnAt, unit)}</b></span>}
                {/* Said out loud, because a broken line is only meaningful if you know it is
                    missing data rather than a rendering fault. */}
                {gaps > 0 && <span className="text-[var(--warning)]">{String(L.gaps).replace('{n}', String(gaps))}</span>}
            </div>
        </div>
    );
}
