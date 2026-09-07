import type { Insight, InsightTone } from "../lib/insights";
import { Empty } from "./ui";

const TONE: Record<InsightTone, { dot: string; ring: string }> = {
  good: { dot: "bg-good", ring: "border-good/30" },
  warn: { dot: "bg-warn", ring: "border-warn/30" },
  bad: { dot: "bg-bad", ring: "border-bad/30" },
  info: { dot: "bg-brand", ring: "border-line" },
};

export function InsightCard({ ins }: { ins: Insight }) {
  const t = TONE[ins.tone];
  return (
    <div className={`card p-3 border ${t.ring} flex gap-2.5`}>
      <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${t.dot}`} />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{ins.title}</div>
        <div className="text-xs text-sub mt-0.5 leading-relaxed">{ins.detail}</div>
      </div>
    </div>
  );
}

/** A responsive grid of insight cards; caps to `max` unless showing the full page. */
export function InsightsStrip({ insights, max }: { insights: Insight[]; max?: number }) {
  if (!insights.length) return <Empty>Pas encore assez de données pour des constats.</Empty>;
  const shown = max ? insights.slice(0, max) : insights;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {shown.map((ins, i) => <InsightCard key={i} ins={ins} />)}
    </div>
  );
}
