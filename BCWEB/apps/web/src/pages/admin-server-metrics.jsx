// The machine's daily figures — CPU, memory, disk, latency — with the period before them.
//
// This is the "System metrics" block the public status page used to carry, moved to the
// admin's Performance tab: a visitor wants to know whether the site is up, and these charts
// say more about the box than about the service. Here they gain the one thing the public
// block never had — the same-length window immediately before, and the change per metric.
//
// Reads GET /admin/server/metrics/daily (server-perf.mjs), whose arithmetic lives in
// lib/metrics-compare.mjs and is unit-tested there: a change against an EMPTY previous window
// is null, never zero, and the panel says so rather than painting "+0 %".
import { useState } from 'react';
import { Activity } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Card, Spinner } from '../ui/ui.jsx';
import MetricChart from '../ui/metric-chart.jsx';

const RANGES = [7, 30, 90, 365];

/** Relative change, coloured. For all four metrics UP is worse — more CPU, fuller disk, slower. */
function Delta({ pct, t }) {
  if (pct == null) return <span className="text-[var(--faint)]">{t('perf.d.nochange', 'no period before')}</span>;
  const worse = pct > 0.5, better = pct < -0.5;
  return (
    <span className={`tabular-nums font-medium ${worse ? 'text-[var(--warning)]' : better ? 'text-[var(--success)]' : 'text-[var(--faint)]'}`}
      title={t('perf.d.vs', 'vs the period before')}>
      {pct > 0 ? '+' : ''}{pct.toFixed(1)}% <span className="font-normal text-[var(--faint)]">{t('perf.d.vs', 'vs the period before')}</span>
    </span>
  );
}

export function PerfDailyMetrics() {
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  const [table, setTable] = useState(false);   // the figures behind the charts
  const { data, loading } = useAsync(() => api.get(`/admin/server/metrics/daily?days=${days}`), [days]);
  const series = data?.series || [];
  const cur = data?.current, prev = data?.previous, change = data?.change;
  const fmt = (v, unit) => (v == null ? '—' : `${Number.isInteger(v) ? v : Number(v).toFixed(1)}${unit}`);
  const day = (d) => String(d).slice(0, 10);
  // Four charts, never one with four lines: a percentage and a millisecond figure on one pair
  // of axes is the most common way to make a chart say something untrue.
  const METRICS = [
    { key: 'cpu', label: 'CPU', unit: '%', warn: 85 },
    { key: 'mem', label: t('st.m.mem', 'Memory'), unit: '%', warn: 90 },
    { key: 'disk', label: t('st.m.disk', 'Disk'), unit: '%', warn: 90 },
    { key: 'latencyMs', label: t('st.m.lat', 'Latency'), unit: ' ms', warn: null },
  ];
  const chartLabels = { avg: t('st.m.avg', 'avg'), min: t('st.m.min', 'min'), peak: t('st.m.peak', 'peak'), warn: t('st.m.warnat', 'warn at'), gaps: t('st.m.gaps', '{n} day(s) with no reading') };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Activity size={15} className="text-[var(--accent-ink)]" /> {t('st.metrics', 'System metrics')}
        </div>
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden text-[11px]">
          {RANGES.map((n) => (
            <button key={n} type="button" onClick={() => setDays(n)}
              className={`px-2.5 py-1 ${days === n ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
              {t('st.m.days', '{n} d').replace('{n}', String(n))}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-[var(--faint)] mb-3">{t('perf.d.sub', 'CPU, memory, disk and latency by day, compared with the same length of time just before. This block used to be on the public status page; it says more about the machine than about the service.')}</p>

      {loading ? <Spinner size={14} /> : !series.length ? (
        <div className="text-[13px] text-[var(--muted)]">{t('st.nometrics', 'No daily figures recorded yet.')}</div>
      ) : (<>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-6">
          {METRICS.map((m) => (
            <div key={m.key}>
              <MetricChart title={m.label} unit={m.unit} warnAt={m.warn} labels={chartLabels}
                points={series.map((r) => ({ label: day(r.day), value: r[m.key] }))} />
              {/* The comparison, per chart: this window's average, the previous one's, and
                  the relative change — coloured, up = worse for every one of these four. */}
              <div className="text-[11px] text-[var(--muted)] mt-1 flex items-center gap-2 flex-wrap">
                <span>{t('st.m.avg', 'avg')} <b className="text-[var(--text)] tabular-nums">{fmt(cur?.[m.key], m.unit)}</b></span>
                {prev && <span className="text-[var(--faint)]">{t('perf.d.prevavg', 'before: {v}').replace('{v}', fmt(prev[m.key], m.unit))}</span>}
                <Delta pct={change?.[m.key]?.pct ?? null} t={t} />
              </div>
            </div>
          ))}
        </div>

        {/* The table has not gone anywhere. A chart answers "is it climbing"; the exact number
            on the 4th is a different question, and a screen reader needs the numbers. */}
        <button type="button" onClick={() => setTable((v) => !v)} className="mt-3 text-[11px] text-[var(--muted)] hover:text-[var(--text)]">
          {table ? t('st.m.hidetable', 'Hide the figures') : t('st.m.showtable', 'Show the figures')}
        </button>
        {table && (
          <div className="overflow-x-auto mt-2">
            <table className="text-[12px] w-full">
              <thead><tr className="text-[var(--faint)] text-start">
                <th className="font-normal pb-1">{t('st.m.day', 'Day')}</th>
                {METRICS.map((m) => <th key={m.key} className="font-normal pb-1 text-end">{m.label}</th>)}
              </tr></thead>
              <tbody>
                {/* The two window rows first — the comparison in numbers — then every day. */}
                {cur && (
                  <tr className="border-t border-[var(--line)] font-medium">
                    <td className="py-1">{t('perf.d.now', 'This period')}</td>
                    {METRICS.map((m) => <td key={m.key} className="py-1 text-end tabular-nums">{fmt(cur[m.key], m.unit)}</td>)}
                  </tr>
                )}
                {prev && (
                  <tr className="border-t border-[var(--line)] text-[var(--muted)]">
                    <td className="py-1">{t('perf.d.before', 'The one before')}</td>
                    {METRICS.map((m) => <td key={m.key} className="py-1 text-end tabular-nums">{fmt(prev[m.key], m.unit)}</td>)}
                  </tr>
                )}
                {change && (
                  <tr className="border-t border-[var(--line)]">
                    <td className="py-1">{t('perf.d.change', 'Change')}</td>
                    {METRICS.map((m) => {
                      const pct = change[m.key]?.pct;
                      return <td key={m.key} className={`py-1 text-end tabular-nums ${pct == null ? 'text-[var(--faint)]' : pct > 0.5 ? 'text-[var(--warning)]' : pct < -0.5 ? 'text-[var(--success)]' : ''}`}>{pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}</td>;
                    })}
                  </tr>
                )}
                {[...series].reverse().map((r) => (
                  <tr key={day(r.day)} className="border-t border-[var(--line)]">
                    <td className="py-1">{day(r.day)}</td>
                    {METRICS.map((m) => <td key={m.key} className="py-1 text-end tabular-nums">{fmt(r[m.key], m.unit)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* What the answer rests on: a month compared from six days of history is a different
            statement from one built on sixty, and the reader cannot tell without this. */}
        {data?.coverage && !data.coverage.complete && (
          <div className="text-[11px] text-[var(--warning)] mt-2">
            {t('perf.cmp.short', 'History only goes back {h} day(s) — there is no earlier period to compare with yet. Daily summaries started when this was added; they are kept for good, so longer comparisons fill in from here.').replace('{h}', data.coverage.daysHeld)}
          </div>
        )}
      </>)}
    </Card>
  );
}
