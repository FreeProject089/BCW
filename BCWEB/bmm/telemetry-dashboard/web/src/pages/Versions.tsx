import { useEffect, useState } from "react";
import { apiGet } from "../lib/store";
import { Card, Metric, Bar, Empty, CsvButton } from "../components/ui";
import { Chart, axisX, axisY } from "../components/Chart";
import { nf, fmtDate } from "../lib/format";
import { downloadCsv } from "../lib/csv";

interface Ver { version: string; users: number; current_users: number; crashes: number; first_ms?: number | null; last_ms?: number | null; }

export default function Versions() {
  const [rows, setRows] = useState<Ver[] | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet<{ versions: Ver[] }>("/api/versions").then((r) => { if (alive) setRows(r.versions || []); }).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, []);

  if (!rows) return <div className="text-sub text-sm py-8 text-center">Chargement des versions…</div>;
  if (!rows.length) return <Empty>Aucune donnée de version pour l'instant.</Empty>;

  const totalCurrent = rows.reduce((a, r) => a + r.current_users, 0) || 1;
  const top = rows[0];
  const topShare = Math.round((top.current_users / totalCurrent) * 100);
  const totalCrashes = rows.reduce((a, r) => a + r.crashes, 0);
  // A version is "fragmented" if no single version holds a majority of current users.
  const fragmented = topShare < 50;

  const chartRows = rows.slice(0, 10);
  const adoptionOpt = {
    grid: { left: 90, right: 40, top: 6, bottom: 6 },
    xAxis: axisY({ axisLabel: { show: false }, splitLine: { show: false } }),
    yAxis: { ...axisX(chartRows.map((r) => r.version).reverse()), axisLabel: { color: "#e8eaed", fontSize: 11 } },
    tooltip: { trigger: "item", formatter: (p: any) => `${p.name}<br/>${nf(p.value)} users actifs` },
    series: [{ type: "bar", data: chartRows.map((r) => r.current_users).reverse(), itemStyle: { color: "#5b8cff", borderRadius: [0, 4, 4, 0] }, barWidth: 16, label: { show: true, position: "right", color: "#9aa3ad", fontSize: 11, formatter: (p: any) => `${Math.round((p.value / totalCurrent) * 100)}%` } }],
  };

  const exportCsv = () => downloadCsv("bmm_versions", rows, [
    { key: "version", label: "Version" },
    { key: "current_users", label: "Utilisateurs actuels" },
    { key: "users", label: "Vus au total" },
    { key: "crashes", label: "Crashs" },
    { key: "first_ms", label: "Première apparition", get: (r) => fmtDate(r.first_ms) },
    { key: "last_ms", label: "Dernière apparition", get: (r) => fmtDate(r.last_ms) },
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Versions vues" value={nf(rows.length)} />
        <Metric label="Version dominante" value={top.version} hint={`${topShare}% des actifs`} color="#37d399" />
        <Metric label="Utilisateurs actifs" value={nf(totalCurrent)} />
        <Metric label="Crashs (toutes versions)" value={nf(totalCrashes)} color="#f06363" />
      </div>

      {fragmented && (
        <Card className="border-warn/30">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-warn" />
            Parc fragmenté — aucune version ne réunit la majorité des utilisateurs actifs. Un rappel de mise à jour aiderait.
          </div>
        </Card>
      )}

      <Card title="Adoption par version (utilisateurs actuels)">
        <Chart option={adoptionOpt} height={Math.max(160, chartRows.length * 34)} />
      </Card>

      <Card title="Détail par version" right={<CsvButton onClick={exportCsv} />}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Version</th>
              <th className="th text-right">Actifs</th>
              <th className="th w-40">Part</th>
              <th className="th text-right">Vus</th>
              <th className="th text-right">Crashs</th>
              <th className="th text-right">Vue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const share = (r.current_users / totalCurrent) * 100;
              return (
                <tr key={r.version} className="hover:bg-panel2">
                  <td className="td font-mono text-xs">{r.version}</td>
                  <td className="td text-right font-medium tabular-nums">{nf(r.current_users)}</td>
                  <td className="td"><div className="flex items-center gap-2"><div className="flex-1"><Bar pct={share} /></div><span className="w-9 text-right text-sub text-xs tabular-nums">{share.toFixed(0)}%</span></div></td>
                  <td className="td text-right text-sub tabular-nums">{nf(r.users)}</td>
                  <td className={`td text-right tabular-nums ${r.crashes > 0 ? "text-bad" : "text-sub"}`}>{nf(r.crashes)}</td>
                  <td className="td text-right text-sub text-xs">{fmtDate(r.last_ms)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
