// Auto-insights: turn the live stats payload into a handful of plain-language findings,
// so the dashboard says what changed without the reader having to diff every chart.
// Purely client-side — derived from data already loaded, no extra request.
import type { Stats } from "./types";
import { trend, fmtVital, vitalThresholds } from "./format";

export type InsightTone = "good" | "warn" | "bad" | "info";
export interface Insight { tone: InsightTone; title: string; detail: string; }

const PRIORITY: Record<InsightTone, number> = { bad: 0, warn: 1, good: 2, info: 3 };

// Worst web-vital across the tracked pages: the one furthest into "poor".
function worstVital(s: Stats): Insight | null {
  const pages = (s.pages || []).filter((p: any) => p && typeof p.lcp === "number" && p.lcp > 0);
  if (!pages.length) return null;
  const [good, poor] = vitalThresholds.lcp;
  const worst = pages.reduce((a: any, b: any) => ((b.lcp as number) > (a.lcp as number) ? b : a));
  const lcp = worst.lcp as number;
  if (lcp <= good) return { tone: "good", title: "Vitesse au vert", detail: `Le pire écran (${worst.view}) charge en ${fmtVital("lcp", lcp)} — sous le seuil de bon.` };
  const tone: InsightTone = lcp > poor ? "bad" : "warn";
  return { tone, title: "Écran le plus lent", detail: `${worst.view} affiche un LCP de ${fmtVital("lcp", lcp)} (${tone === "bad" ? "à améliorer" : "à surveiller"}).` };
}

// Average week-1 retention across cohorts that are old enough to have a week-1 cell.
function retentionInsight(s: Stats): Insight | null {
  const cohorts = (s.retention || []).filter((c: any) => c?.cells?.length > 1);
  if (cohorts.length < 2) return null;
  const w1 = cohorts.map((c: any) => c.cells[1]?.pct).filter((x: any) => typeof x === "number");
  if (!w1.length) return null;
  const avg = w1.reduce((a: number, b: number) => a + b, 0) / w1.length;
  const tone: InsightTone = avg >= 40 ? "good" : avg >= 20 ? "info" : "warn";
  return { tone, title: "Rétention semaine 1", detail: `${avg.toFixed(0)} % des nouveaux reviennent la semaine suivante (moyenne sur ${w1.length} cohortes).` };
}

export function buildInsights(s: Stats): Insight[] {
  const out: Insight[] = [];
  const series = s.series || [];

  const uT = trend(series.map((r: any) => r.users));
  if (uT != null && Math.abs(uT) >= 10) out.push({ tone: uT > 0 ? "good" : "warn", title: uT > 0 ? "Utilisateurs en hausse" : "Utilisateurs en baisse", detail: `Le nombre d'utilisateurs actifs a ${uT > 0 ? "augmenté" : "baissé"} de ${Math.abs(uT).toFixed(0)} % sur la période récente.` });

  const sT = trend(series.map((r: any) => r.sessions));
  if (sT != null && Math.abs(sT) >= 15) out.push({ tone: sT > 0 ? "good" : "warn", title: sT > 0 ? "Plus de sessions" : "Moins de sessions", detail: `Les sessions ont ${sT > 0 ? "progressé" : "reculé"} de ${Math.abs(sT).toFixed(0)} %.` });

  const crashed = (s.live || []).filter((l: any) => l.status === "crashed").length;
  if (crashed > 0) out.push({ tone: "bad", title: "Crash en cours", detail: `${crashed} instance${crashed > 1 ? "s" : ""} signale${crashed > 1 ? "nt" : ""} un plantage en direct.` });

  const wv = worstVital(s);
  if (wv) out.push(wv);

  const ret = retentionInsight(s);
  if (ret) out.push(ret);

  const peak = (s as any).peak_hour;
  if (peak != null) out.push({ tone: "info", title: "Heure de pointe", detail: `L'activité culmine vers ${String(peak).padStart(2, "0")}h UTC.` });

  const top = (s.pages || [])[0];
  if (top?.view) out.push({ tone: "info", title: "Écran le plus vu", detail: `${top.view} concentre le plus d'entrées (${(top.enters || 0).toLocaleString()}).` });

  const users = s.totals?.users || 0;
  if (users > 0 && s.vm_count > 0) {
    const pct = (s.vm_count / users) * 100;
    if (pct >= 10) out.push({ tone: "info", title: "Machines virtuelles", detail: `${pct.toFixed(0)} % des utilisateurs tournent dans une VM.` });
  }

  const pend = s.privacy?.pending_deletions || 0;
  if (pend > 0) out.push({ tone: "info", title: "Suppressions en attente", detail: `${pend} demande${pend > 1 ? "s" : ""} de suppression de données à traiter.` });

  return out.sort((a, b) => PRIORITY[a.tone] - PRIORITY[b.tone]);
}
