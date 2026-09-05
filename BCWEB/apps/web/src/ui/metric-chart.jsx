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
import { useState, useRef, useId } from 'react';

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
 * @param points {Array<{ label: string, value: number|null }>} oldest first
 * @param unit   what one value IS ('%', ' ms') — appended to every number shown
 * @param title  the measure's name, always rendered as text
 * @param warnAt a threshold worth drawing (85 for CPU%); null for none
 */
export default function MetricChart({ points = [], unit = '', title, height = 96, warnAt = null, labels = {} }) {
    const L = { avg: 'avg', min: 'min', peak: 'peak', warn: 'warn at', ...labels };
    const [hover, setHover] = useState(null);
    const ref = useRef(null);
    const gid = useId();
    const clean = points.filter((p) => p && p.value != null && Number.isFinite(Number(p.value)));
    if (clean.length < 2) {
        return (
            <div className="text-[12px] text-[var(--muted)]">
                {title} — {clean.length ? `${clean[0].value}${unit}` : '—'}
            </div>
        );
    }

    const values = clean.map((p) => Number(p.value));
    const last = values[values.length - 1];
    const prev = values[values.length - 2];
    const peak = Math.max(...values);
    const low = Math.min(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    // Zero-based, always. A percentage cropped to its own range turns 71→73% into a cliff.
    // The threshold stays inside the frame so "how far from the line" can be read.
    const max = Math.max(peak * 1.15, warnAt != null ? warnAt * 1.08 : 0, unit === '%' ? 10 : 1);
    const W = 300, H = height, PAD_T = 6;
    const plotH = H - PAD_T;
    const xs = values.map((_, i) => (i / (values.length - 1)) * W);
    const ys = values.map((v) => PAD_T + plotH - (v / max) * plotH);
    const line = pathOf(xs, ys);
    const over = warnAt != null && last >= warnAt;
    const tone = over ? 'var(--warning)' : 'var(--primary)';
    const trend = last - prev;

    const onMove = (e) => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const x = ((e.clientX - box.left) / box.width) * W;
        const i = Math.max(0, Math.min(clean.length - 1, Math.round((x / W) * (clean.length - 1))));
        setHover(i);
    };
    const h = hover != null ? clean[hover] : null;
    // Three date labels are enough to place a shape in time; more become a table again.
    const ticks = [0, Math.floor((clean.length - 1) / 2), clean.length - 1];
    const dayLabel = (s) => String(s || '').slice(5);

    return (
        <div>
            <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[12px] font-medium flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: tone }} aria-hidden />
                    {title}
                </span>
                <span className="text-[12px] tabular-nums" style={{ color: tone }}>
                    <b>{h ? fmt(h.value, unit) : fmt(last, unit)}</b>
                    <span className="text-[var(--faint)] font-normal"> · {h ? h.label : (trend === 0 ? '→' : trend > 0 ? `▲ ${fmt(Math.abs(trend), unit)}` : `▼ ${fmt(Math.abs(trend), unit)}`)}</span>
                </span>
            </div>
            <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
                onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchMove={(e) => e.touches[0] && onMove(e.touches[0])}
                role="img" aria-label={`${title}: ${fmt(last, unit)} now, ${fmt(peak, unit)} at its highest, ${fmt(avg, unit)} on average over ${clean.length} days`}
                style={{ display: 'block', overflow: 'visible' }}>
                <defs>
                    <linearGradient id={`g-${gid}`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
                        <stop offset="100%" stopColor={tone} stopOpacity="0.02" />
                    </linearGradient>
                </defs>
                {/* Two guides, no more. A grid dense enough to read values from is a table. */}
                {[0.5, 1].map((f) => (
                    <line key={f} x1="0" x2={W} y1={PAD_T + plotH - f * plotH} y2={PAD_T + plotH - f * plotH}
                        stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                ))}
                {/* The threshold, dashed and labelled: where "fine" stops. */}
                {warnAt != null && warnAt <= max && (
                    <line x1="0" x2={W} y1={PAD_T + plotH - (warnAt / max) * plotH} y2={PAD_T + plotH - (warnAt / max) * plotH}
                        stroke="var(--warning)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity="0.7" />
                )}
                <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#g-${gid})`} />
                <path d={line} fill="none" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                {/* The last point is the one people came to read: a dot, always. */}
                <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3.5" fill="var(--bg-solid)" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                {hover != null && (<>
                    <line x1={xs[hover]} x2={xs[hover]} y1={PAD_T} y2={H} stroke={tone} strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.5" />
                    <circle cx={xs[hover]} cy={ys[hover]} r="4" fill={tone} stroke="var(--bg-solid)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </>)}
            </svg>
            <div className="flex items-center justify-between text-[10px] text-[var(--faint)] tabular-nums mt-1">
                {ticks.map((i, k) => <span key={k}>{dayLabel(clean[i]?.label)}</span>)}
            </div>
            <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-[var(--faint)] tabular-nums mt-1">
                <span>{L.avg} <b className="text-[var(--muted)] font-medium">{fmt(avg, unit)}</b></span>
                <span>{L.min} <b className="text-[var(--muted)] font-medium">{fmt(low, unit)}</b></span>
                <span>{L.peak} <b className="text-[var(--muted)] font-medium">{fmt(peak, unit)}</b></span>
                {warnAt != null && <span>{L.warn} <b className="font-medium" style={{ color: 'var(--warning)' }}>{fmt(warnAt, unit)}</b></span>}
            </div>
        </div>
    );
}
