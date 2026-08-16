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
//   · colour is never the only encoding: every series is labelled in text.
import { useState, useRef } from 'react';

/** A path through the points, in the chart's own coordinate space. */
function pathOf(values, w, h, max) {
    if (values.length < 2) return '';
    const step = w / (values.length - 1);
    return values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(2)},${(h - (v / max) * h).toFixed(2)}`).join(' ');
}

/**
 * @param points {Array<{ label: string, value: number|null }>} oldest first
 * @param unit   what one value IS ('%', ' ms') — appended to every number shown
 * @param title  the measure's name, always rendered as text
 */
export default function MetricChart({ points = [], unit = '', title, height = 64, warnAt = null }) {
    const [hover, setHover] = useState(null);
    const ref = useRef(null);
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
    const peak = Math.max(...values);
    // Zero-based, always. A percentage cropped to its own range turns 71→73% into a cliff.
    const max = Math.max(peak * 1.15, unit === '%' ? 10 : 1);
    const W = 300, H = height;

    const onMove = (e) => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const x = ((e.clientX - box.left) / box.width) * W;
        const i = Math.max(0, Math.min(clean.length - 1, Math.round((x / W) * (clean.length - 1))));
        setHover(i);
    };

    const h = hover != null ? clean[hover] : null;
    const step = W / (clean.length - 1);
    const tone = warnAt != null && last >= warnAt ? 'var(--warning)' : 'var(--primary)';

    return (
        <div>
            <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[12px] font-medium">{title}</span>
                <span className="text-[12px] tabular-nums" style={{ color: tone }}>
                    {h ? `${h.value}${unit}` : `${last}${unit}`}
                    <span className="text-[var(--faint)]"> · {h ? h.label : `peak ${peak}${unit}`}</span>
                </span>
            </div>
            <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
                onMouseMove={onMove} onMouseLeave={() => setHover(null)}
                role="img" aria-label={`${title}: ${last}${unit} now, ${peak}${unit} at its highest over ${clean.length} days`}>
                {/* Two guides, no more. A grid dense enough to read values from is a table. */}
                {[0.5, 1].map((f) => (
                    <line key={f} x1="0" x2={W} y1={H - f * H} y2={H - f * H}
                        stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                ))}
                <path d={`${pathOf(values, W, H, max)} L${W},${H} L0,${H} Z`} fill={tone} opacity="0.10" />
                <path d={pathOf(values, W, H, max)} fill="none" stroke={tone} strokeWidth="2"
                    vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                {hover != null && (
                    <line x1={hover * step} x2={hover * step} y1="0" y2={H}
                        stroke={tone} strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.6" />
                )}
            </svg>
        </div>
    );
}
