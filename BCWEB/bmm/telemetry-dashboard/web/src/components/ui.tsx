import { ReactNode } from "react";

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card p-4 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="text-[11px] uppercase tracking-wide text-sub">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-sub mt-0.5">{sub}</div>}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  online: "bg-good",
  away: "bg-warn",
  crashed: "bg-bad",
  offline: "bg-sub",
};
export function StatusDot({ status }: { status: string }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLOR[status] || "bg-sub"}`} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-sub py-8 text-center">{children}</div>;
}

// Slide-over drawer. Its open state lives in the page, so live data refreshes
// never close it.
export function Drawer({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full bg-panel border-l border-line overflow-y-auto" style={{ width }}>
        <div className="sticky top-0 bg-panel/95 backdrop-blur border-b border-line px-4 py-3 flex items-center justify-between">
          <div className="font-semibold text-sm">{title}</div>
          <button onClick={onClose} className="text-sub hover:text-ink px-2" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Bar({ pct, color = "bg-brand" }: { pct: number; color?: string }) {
  return (
    <div className="h-2 rounded bg-panel2 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

// ── Metric card family (KPI with a trend delta + inline sparkline) ──────────

/** Compact inline sparkline. Area-filled by default so a KPI reads at a glance. */
export function Sparkline({ data, color = "#5b8cff", height = 32, fill = true }: { data: number[]; color?: string; height?: number; fill?: boolean }) {
  if (!data || data.length < 2) return <div style={{ height }} />;
  const w = 120, h = height;
  const max = Math.max(1, ...data), min = Math.min(...data), rng = max - min || 1;
  const xy = (v: number, i: number) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * (h - 4) - 2}`;
  const line = data.map(xy).join(" ");
  const area = `${line} ${w},${h} 0,${h}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-1 block">
      {fill && <polygon points={area} fill={color} opacity={0.12} />}
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Signed percentage chip: green up, red down, muted when flat. */
export function Delta({ pct, invert = false }: { pct: number | null | undefined; invert?: boolean }) {
  if (pct == null || !isFinite(pct)) return null;
  const flat = Math.abs(pct) < 0.5;
  const up = pct >= 0;
  const good = invert ? !up : up;
  const tone = flat ? "text-sub" : good ? "text-good" : "text-bad";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${tone}`} title="vs. période précédente">
      {!flat && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          {up ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
        </svg>
      )}
      {flat ? "±0%" : `${Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%`}
    </span>
  );
}

/** The canonical KPI: label, big value, optional trend delta, optional sparkline. */
export function Metric({ label, value, delta, spark, color = "#5b8cff", hint, invertDelta }: { label: ReactNode; value: ReactNode; delta?: number | null; spark?: number[]; color?: string; hint?: ReactNode; invertDelta?: boolean }) {
  return (
    <div className="kpi flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wide text-sub truncate">{label}</div>
        {delta != null && <Delta pct={delta} invert={invertDelta} />}
      </div>
      <div className="text-2xl font-semibold mt-0.5 tabular-nums leading-tight">{value}</div>
      {spark && spark.length > 1 ? <Sparkline data={spark} color={color} /> : hint ? <div className="text-xs text-sub mt-0.5">{hint}</div> : <div className="h-8" />}
    </div>
  );
}

/** Segmented control (Simple/Advanced, granularity, metric switch). */
export function Segmented<T extends string>({ options, value, onChange, className = "" }: { options: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void; className?: string }) {
  return (
    <div className={`inline-flex rounded-lg bg-panel2 border border-line p-0.5 gap-0.5 ${className}`}>
      {options.map((o) => (
        <button key={o.key} onClick={() => onChange(o.key)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${value === o.key ? "bg-brand text-white shadow-sm" : "text-sub hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small uppercase section divider for grouping a page into bands. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2 mt-2">
      <h2 className="text-[11px] uppercase tracking-wider text-sub font-semibold">{children}</h2>
      {right}
    </div>
  );
}

/** A tiny "Export CSV" button — wire onClick to downloadCsv from lib/csv. */
export function CsvButton({ onClick, label = "CSV" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs text-sub hover:text-ink hover:border-brand transition-colors">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
      {label}
    </button>
  );
}
