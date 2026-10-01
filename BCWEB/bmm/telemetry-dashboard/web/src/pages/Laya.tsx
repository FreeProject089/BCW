import { useEffect, useState } from "react";
import { apiGet } from "../lib/store";
import { Card, Metric, Bar, Empty, CsvButton, Segmented } from "../components/ui";
import { Chart, axisX, axisY } from "../components/Chart";
import { nf } from "../lib/format";
import { downloadCsv } from "../lib/csv";

// Laya = BMM's assistant. Every figure comes from content-free events
// (laya_use / laya_feedback / laya_ask_click / laya_model): codes and counts, never text.

interface Feature { feature: string; uses: number; users: number; ok: number; errors: number; abstained: number; p50_ms: number | null; p90_ms: number | null; }
interface Field { field: string; accepted: number; rejected: number; rate: number; }
interface Day { day: string; uses: number; users: number; errors: number; accepted: number; rejected: number; }
export interface LayaStats {
  days: number; users_active: number; users_laya: number; adoption_pct: number;
  uses: number; errors: number; error_pct?: number; abstained: number;
  accepted?: number; rejected?: number; acceptance_pct?: number; truncated?: boolean;
  by_feature: Feature[];
  by_provider: { provider: string; uses: number; users: number }[];
  fields: Field[];
  latency_buckets: { bucket: string; n: number }[];
  errors_by_code: { code: string; n: number }[];
  ask: { queries: number; clicked: number; click_rate: number; low_confidence: number; kinds?: { kind: string; n: number }[] };
  model: { install: number; install_failed: number; uninstall: number; cancel: number; test?: number };
  daily: Day[];
}

type Range = "7" | "30" | "90";

const FEATURE_LABEL: Record<string, string> = {
  mod_suggest: "Suggestion de mod",
  ask: "Demander à Laya",
  smart_search: "Recherche intelligente",
  report_triage: "Tri des rapports",
  report_precheck: "Pré-vérif. rapport",
  draft: "Brouillon",
  test: "Test du modèle",
};
const PROVIDER_COLOR: Record<string, string> = {
  embedded: "#5b8cff", server: "#37d399", local: "#a78bfa", external: "#f5a524", rules: "#9aa3ad", none: "#4b5563",
};
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("fr-FR")} %`;
const ms = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

export default function Laya() {
  const [range, setRange] = useState<Range>("30");
  const [data, setData] = useState<LayaStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    apiGet<LayaStats>(`/api/laya?days=${range}`)
      .then((r) => { if (alive) setData(r); })
      .catch(() => { if (alive) { setData(null); setFailed(true); } });
    return () => { alive = false; };
  }, [range]);

  const header = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="text-xs text-sub">Codes et compteurs uniquement : aucun texte, nom de fichier ni requête.</div>
      <Segmented<Range> value={range} onChange={setRange} options={[{ key: "7", label: "7 j" }, { key: "30", label: "30 j" }, { key: "90", label: "90 j" }]} />
    </div>
  );

  if (failed) return <div className="space-y-4">{header}<Empty>Impossible de charger les données Laya.</Empty></div>;
  if (!data) return <div className="space-y-4">{header}<div className="text-sub text-sm py-8 text-center">Chargement…</div></div>;
  if (!data.uses && !data.fields.length && !data.ask.clicked && !data.model.install && !data.model.install_failed) {
    return <div className="space-y-4">{header}<Empty>Aucune utilisation de Laya sur cette période.</Empty></div>;
  }

  const errorPct = data.error_pct ?? (data.uses ? (data.errors / data.uses) * 100 : 0);
  const acc = data.accepted ?? data.fields.reduce((a, f) => a + f.accepted, 0);
  const rej = data.rejected ?? data.fields.reduce((a, f) => a + f.rejected, 0);
  const accPct = data.acceptance_pct ?? (acc + rej ? (acc / (acc + rej)) * 100 : 0);
  const days = data.daily.map((d) => d.day.slice(5));

  const trendOpt = {
    legend: { top: 0, right: 0, textStyle: { color: "#9aa3ad", fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    xAxis: axisX(days),
    yAxis: axisY({ minInterval: 1 }),
    series: [
      { name: "Utilisations", type: "line", smooth: true, symbol: "none", data: data.daily.map((d) => d.uses), itemStyle: { color: "#5b8cff" }, areaStyle: { opacity: 0.12 } },
      { name: "Erreurs", type: "line", smooth: true, symbol: "none", data: data.daily.map((d) => d.errors), itemStyle: { color: "#f06363" } },
    ],
  };
  const feedbackOpt = {
    legend: { top: 0, right: 0, textStyle: { color: "#9aa3ad", fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    xAxis: axisX(days),
    yAxis: axisY({ minInterval: 1 }),
    series: [
      { name: "Acceptées", type: "bar", stack: "fb", data: data.daily.map((d) => d.accepted), itemStyle: { color: "#37d399" } },
      { name: "Refusées", type: "bar", stack: "fb", data: data.daily.map((d) => d.rejected), itemStyle: { color: "#f06363" } },
    ],
  };
  const providerOpt = {
    tooltip: { trigger: "item", formatter: (p: any) => `${p.name}<br/>${nf(p.value)} utilisations (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: "#9aa3ad", fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    series: [{
      type: "pie", radius: ["48%", "72%"], center: ["50%", "44%"], label: { show: false },
      data: data.by_provider.map((p) => ({ name: p.provider, value: p.uses, itemStyle: { color: PROVIDER_COLOR[p.provider] || "#6b7280" } })),
    }],
  };
  const latencyOpt = {
    grid: { left: 40, right: 12, top: 12, bottom: 24 },
    xAxis: { ...axisX(data.latency_buckets.map((b) => b.bucket)), axisLabel: { color: "#9aa3ad", fontSize: 11, interval: 0 } },
    yAxis: axisY({ minInterval: 1 }),
    series: [{ type: "bar", data: data.latency_buckets.map((b) => b.n), barWidth: "55%", itemStyle: { color: "#5b8cff", borderRadius: [4, 4, 0, 0] } }],
  };

  const exportFeatures = () => downloadCsv(`laya_features_${data.days}j`, data.by_feature, [
    { key: "feature", label: "Fonction" },
    { key: "uses", label: "Utilisations" },
    { key: "users", label: "Utilisateurs" },
    { key: "p50_ms", label: "p50 (ms)" },
    { key: "p90_ms", label: "p90 (ms)" },
    { key: "errors", label: "Erreurs" },
    { key: "abstained", label: "Abstentions" },
  ]);
  const exportFields = () => downloadCsv(`laya_champs_${data.days}j`, data.fields, [
    { key: "field", label: "Champ" },
    { key: "accepted", label: "Acceptées" },
    { key: "rejected", label: "Refusées" },
    { key: "rate", label: "Taux (%)" },
  ]);
  const maxCode = Math.max(1, ...data.errors_by_code.map((c) => c.n));

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Metric label="Adoption" value={pct(data.adoption_pct)} hint={`${nf(data.users_laya)} / ${nf(data.users_active)} actifs`} color="#5b8cff" />
        <Metric label="Utilisateurs" value={nf(data.users_laya)} spark={data.daily.map((d) => d.users)} />
        <Metric label="Utilisations" value={nf(data.uses)} spark={data.daily.map((d) => d.uses)} />
        <Metric label="Taux d'erreur" value={pct(errorPct)} hint={`${nf(data.errors)} erreurs`} />
        <Metric label="Acceptation" value={acc + rej ? pct(accPct) : "—"} hint={`${nf(acc)} acceptées, ${nf(rej)} refusées`} color="#37d399" />
      </div>

      {data.truncated && (
        <Card className="border-warn/30"><div className="text-sm text-warn">Trop d'événements : seuls les plus récents sont comptés. Réduisez la période.</div></Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Utilisations et erreurs"><Chart option={trendOpt} height={220} /></Card>
        <Card title="Suggestions acceptées / refusées"><Chart option={feedbackOpt} height={220} /></Card>
      </div>

      <Card title="Par fonction" right={<CsvButton onClick={exportFeatures} />}>
        {data.by_feature.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[560px]">
            <thead>
              <tr>
                <th className="th">Fonction</th>
                <th className="th text-right">Utilisations</th>
                <th className="th text-right">Utilisateurs</th>
                <th className="th text-right">p50</th>
                <th className="th text-right">p90</th>
                <th className="th text-right">Erreurs</th>
                <th className="th text-right">Abstentions</th>
              </tr>
            </thead>
            <tbody>
              {data.by_feature.map((f) => (
                <tr key={f.feature} className="hover:bg-panel2">
                  <td className="td"><span className="font-medium">{FEATURE_LABEL[f.feature] || f.feature}</span> <span className="text-sub font-mono text-[11px]">{f.feature}</span></td>
                  <td className="td text-right tabular-nums font-medium">{nf(f.uses)}</td>
                  <td className="td text-right tabular-nums text-sub">{nf(f.users)}</td>
                  <td className="td text-right tabular-nums text-sub">{ms(f.p50_ms)}</td>
                  <td className="td text-right tabular-nums text-sub">{ms(f.p90_ms)}</td>
                  <td className={`td text-right tabular-nums ${f.errors ? "text-bad" : "text-sub"}`}>{nf(f.errors)}</td>
                  <td className="td text-right tabular-nums text-sub">{nf(f.abstained)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty>Aucune utilisation.</Empty>}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Moteur utilisé">
          {data.by_provider.length ? <Chart option={providerOpt} height={220} /> : <Empty>Aucune donnée.</Empty>}
        </Card>
        <Card title="Temps de réponse"><Chart option={latencyOpt} height={220} /></Card>
      </div>

      <Card title="Acceptation par champ" right={data.fields.length ? <CsvButton onClick={exportFields} /> : undefined}>
        {data.fields.length ? (
          <div className="space-y-2">
            {data.fields.map((f) => (
              <div key={f.field} className="flex items-center gap-3 text-sm">
                <span className="w-28 truncate font-mono text-xs">{f.field}</span>
                <div className="flex-1"><Bar pct={f.rate} color="bg-good" /></div>
                <span className="w-14 text-right tabular-nums">{pct(f.rate)}</span>
                <span className="w-24 text-right text-sub text-xs tabular-nums">{nf(f.accepted)} / {nf(f.accepted + f.rejected)}</span>
              </div>
            ))}
          </div>
        ) : <Empty>Aucun retour sur les suggestions.</Empty>}
      </Card>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card title="Erreurs par code">
          {data.errors_by_code.length ? (
            <div className="space-y-2">
              {data.errors_by_code.slice(0, 8).map((c) => (
                <div key={c.code} className="flex items-center gap-2 text-sm">
                  <span className="w-32 truncate font-mono text-xs" title={c.code}>{c.code}</span>
                  <div className="flex-1"><Bar pct={(c.n / maxCode) * 100} color="bg-bad" /></div>
                  <span className="w-10 text-right tabular-nums text-sub">{nf(c.n)}</span>
                </div>
              ))}
            </div>
          ) : <Empty>Aucune erreur.</Empty>}
        </Card>

        <Card title="Demander à Laya">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className="text-xl font-semibold tabular-nums">{nf(data.ask.queries)}</div><div className="text-[11px] text-sub">questions</div></div>
            <div><div className="text-xl font-semibold tabular-nums">{pct(data.ask.click_rate)}</div><div className="text-[11px] text-sub">avec un clic</div></div>
            <div><div className="text-xl font-semibold tabular-nums">{nf(data.ask.low_confidence)}</div><div className="text-[11px] text-sub">peu sûres</div></div>
          </div>
          {!!data.ask.kinds?.length && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.ask.kinds.slice(0, 6).map((k) => (
                <span key={k.kind} className="text-[11px] px-2 py-0.5 rounded-full bg-panel2 border border-line text-sub">{k.kind} <span className="tabular-nums">{nf(k.n)}</span></span>
              ))}
            </div>
          )}
        </Card>

        <Card title="Modèle intégré">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between"><span className="text-sub">Installé</span><span className="tabular-nums font-medium">{nf(data.model.install)}</span></div>
            <div className="flex justify-between"><span className="text-sub">Échecs</span><span className={`tabular-nums font-medium ${data.model.install_failed ? "text-bad" : ""}`}>{nf(data.model.install_failed)}</span></div>
            <div className="flex justify-between"><span className="text-sub">Désinstallé</span><span className="tabular-nums font-medium">{nf(data.model.uninstall)}</span></div>
            <div className="flex justify-between"><span className="text-sub">Annulé</span><span className="tabular-nums font-medium">{nf(data.model.cancel)}</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
