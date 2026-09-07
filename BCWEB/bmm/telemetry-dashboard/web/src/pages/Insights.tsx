import { useStats } from "../lib/store";
import { buildInsights } from "../lib/insights";
import { InsightsStrip } from "../components/Insights";
import { Card } from "../components/ui";

// Auto-insights: a plain-language read of what the current data says, refreshed live.
export default function Insights() {
  const s = useStats()!;
  const insights = buildInsights(s);
  const counts = {
    bad: insights.filter((i) => i.tone === "bad").length,
    warn: insights.filter((i) => i.tone === "warn").length,
    good: insights.filter((i) => i.tone === "good").length,
  };
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-semibold">Insights automatiques</h2>
            <p className="text-xs text-sub mt-0.5">Ce que disent les données en ce moment — recalculé en direct, sans requête supplémentaire.</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-bad" /> {counts.bad} à corriger</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-warn" /> {counts.warn} à surveiller</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-good" /> {counts.good} au vert</span>
          </div>
        </div>
      </Card>
      <InsightsStrip insights={insights} />
    </div>
  );
}
