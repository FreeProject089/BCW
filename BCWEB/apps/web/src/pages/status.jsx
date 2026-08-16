import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Bell, Activity } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync, Loading } from './pages.jsx';
import { Card, Button, Input, Badge, useToast } from '../ui/ui.jsx';
import MetricChart from '../ui/metric-chart.jsx';

// The public status page.
//
// It reports what already existed and was admin-only: five probed services, the outages
// recorded for each, and the machine's daily numbers. It deliberately does NOT show the infra
// map, the dependency config, thresholds, hostnames, ports, or an outage's `cause` — a status
// page says what is broken and since when, not how the machine is wired.

// The server sends an English label. On a page that is otherwise entirely French, "Object
// storage" and "Website" were the only English left — and the label is a fixed key, so it can
// be translated here without the server having to know a language.
const SERVICE_NAME = (key, fallback, t) => t(`st.svc.${key}`, fallback || key);

const STATE = {
  operational: { icon: CheckCircle2, tone: 'var(--success)', key: 'st.s.ok', en: 'Operational' },
  down: { icon: XCircle, tone: 'var(--error)', key: 'st.s.down', en: 'Down' },
  not_configured: { icon: MinusCircle, tone: 'var(--faint)', key: 'st.s.na', en: 'Not in use' },
};
const BANNER = {
  operational: { tone: 'var(--success)', key: 'st.b.ok', en: 'All systems operational' },
  partial: { tone: 'var(--warning)', key: 'st.b.partial', en: 'Some systems are down' },
  major: { tone: 'var(--error)', key: 'st.b.major', en: 'Major outage' },
  unknown: { tone: 'var(--faint)', key: 'st.b.unknown', en: 'Status unknown' },
};

/** 90 days as 90 bars. Colour AND a title, because colour alone says nothing to a screen reader. */
function UptimeBars({ days, t }) {
  return (
    <div className="flex gap-[2px] items-end h-8" role="img"
      aria-label={t('st.bars.a11y', 'Daily uptime for the last {n} days').replace('{n}', days.length)}>
      {days.map((d) => {
        const pct = d.uptimePct;
        const tone = pct >= 99.9 ? 'var(--success)' : pct >= 95 ? 'var(--warning)' : 'var(--error)';
        return (
          <span key={String(d.day)} className="flex-1 min-w-[2px] rounded-sm" style={{ height: '100%', background: tone, opacity: pct >= 99.9 ? 0.85 : 1 }}
            title={`${String(d.day).slice(0, 10)} — ${pct.toFixed(2)}%`} />
        );
      })}
    </div>
  );
}

export default function StatusPage() {
  const { t } = useI18n(); const toast = useToast();
  const [sp] = useSearchParams();
  const { data, loading } = useAsync(() => api.get('/status'), []);
  const [table, setTable] = useState(false);   // the figures behind the charts
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const subscribe = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await api.post('/status/subscribe', { email: email.trim() });
      // The same words whether the address was new or already on the list — anything else
      // turns this box into a way to test who is subscribed.
      toast.success(t('st.sub.sent', 'Check your inbox for a confirmation link.'));
      setEmail('');
    } catch (x) {
      toast.error(x?.data?.error === 'email_off'
        ? t('st.sub.off', 'Alerts are not available right now.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-10"><Loading /></div>;
  const d = data || {};
  const b = BANNER[d.state] || BANNER.unknown;
  const fdate = (x) => new Date(x).toLocaleString();

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {sp.get('subscribed') && <div className="mb-4 rounded-xl border border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-4 py-3 text-sm">{t('st.confirmed', 'You are subscribed. You will hear from us when something breaks, and when it is fixed.')}</div>}
      {sp.get('unsubscribed') && <div className="mb-4 rounded-xl border border-[var(--line)] px-4 py-3 text-sm">{t('st.unsubbed', 'You will not get any more status messages.')}</div>}

      <div className="rounded-xl px-5 py-4 mb-6 flex items-center gap-3"
        style={{ background: `color-mix(in srgb, ${b.tone} 12%, var(--bg-solid))`, border: `1px solid color-mix(in srgb, ${b.tone} 40%, var(--line))` }}>
        {d.state === 'operational' ? <CheckCircle2 size={22} style={{ color: b.tone }} /> : <AlertTriangle size={22} style={{ color: b.tone }} />}
        <h1 className="text-lg font-semibold">{t(b.key, b.en)}</h1>
      </div>

      <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-2">
        {t('st.window', 'Uptime over the last {n} days').replace('{n}', d.windowDays || 90)}
      </div>
      <Card className="p-4 mb-6 space-y-4">
        {(d.services || []).map((s) => {
          const st = STATE[s.state] || STATE.not_configured;
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                <span className="font-medium flex items-center gap-2"><st.icon size={15} style={{ color: st.tone }} /> {SERVICE_NAME(s.key, s.label, t)}</span>
                <span className="text-sm" style={{ color: st.tone }}>{t(st.key, st.en)}</span>
              </div>
              {s.state !== 'not_configured' && <>
                <UptimeBars days={s.days} t={t} />
                <div className="flex justify-between text-[11px] text-[var(--faint)] mt-1">
                  <span>{t('st.ago', '{n} days ago').replace('{n}', d.windowDays || 90)}</span>
                  <span className="tabular-nums">{s.uptimePct.toFixed(2)}%</span>
                  <span>{t('st.today', 'today')}</span>
                </div>
                {s.downSince && (
                  <div className="text-[12px] text-[var(--error)] mt-1">
                    {t('st.downsince', 'Down since {d}').replace('{d}', fdate(s.downSince))}
                  </div>
                )}
              </>}
            </div>
          );
        })}
      </Card>

      <h2 className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-2">{t('st.incidents', 'Past incidents')}</h2>
      <Card className="p-4 mb-6">
        {!(d.incidents || []).length ? (
          <div className="text-[13px] text-[var(--muted)]">{t('st.noincidents', 'Nothing has broken in this window.')}</div>
        ) : (
          <ul className="space-y-3">
            {d.incidents.map((i) => (
              <li key={i.id} className="border-l-2 pl-3" style={{ borderColor: i.endedAt ? 'var(--line)' : 'var(--error)' }}>
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="font-medium">{SERVICE_NAME(i.key, i.service, t)}</span>
                  {i.endedAt ? <Badge>{t('st.resolved', 'Resolved')}</Badge> : <Badge tone="red">{t('st.ongoing', 'Ongoing')}</Badge>}
                  <span className="text-[var(--faint)] text-[12px]">{fdate(i.startedAt)} · {i.minutes} min</span>
                </div>
                {/* Whatever a human wrote. An incident with no updates says so rather than
                    showing an empty space that reads as "nothing happened". */}
                {i.updates?.length ? (
                  <ul className="mt-1 space-y-0.5">
                    {i.updates.map((u, k) => (
                      <li key={k} className="text-[12px] text-[var(--muted)]">
                        <b className="text-[var(--text)]">{u.state}</b> — {u.body}
                      </li>
                    ))}
                  </ul>
                ) : <div className="text-[12px] text-[var(--faint)] mt-0.5">{t('st.noupdate', 'No write-up for this one.')}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Activity size={12} /> {t('st.metrics', 'System metrics')}</h2>
      <Card className="p-4 mb-6">
        {!(d.metrics || []).length ? (
          <div className="text-[13px] text-[var(--muted)]">{t('st.nometrics', 'No daily figures recorded yet.')}</div>
        ) : (<>
          {/* Four charts, never one with four lines: a percentage and a millisecond figure on
              one pair of axes is the most common way to make a chart say something untrue. */}
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
            {[['CPU', 'cpu', '%', 85], [t('st.m.mem', 'Memory'), 'mem', '%', 90],
              [t('st.m.disk', 'Disk'), 'disk', '%', 90], [t('st.m.lat', 'Latency'), 'latencyMs', ' ms', null]].map(([label, key, unit, warn]) => (
              <MetricChart key={key} title={label} unit={unit} warnAt={warn}
                points={d.metrics.slice(-30).map((m) => ({ label: String(m.day).slice(0, 10), value: m[key] }))} />
            ))}
          </div>
          {/* The table has not gone anywhere. A chart is the answer to "is it climbing"; the
              exact number on the 4th is a different question, and a screen reader needs the
              numbers rather than the shape. */}
          <button onClick={() => setTable((v) => !v)} className="mt-3 text-[11px] text-[var(--muted)] hover:text-[var(--text)]">
            {table ? t('st.m.hidetable', 'Hide the figures') : t('st.m.showtable', 'Show the figures')}
          </button>
          {table && (
          <div className="overflow-x-auto mt-2">
            <table className="text-[12px] w-full">
              <thead><tr className="text-[var(--faint)] text-left">
                <th className="font-normal pb-1">{t('st.m.day', 'Day')}</th>
                <th className="font-normal pb-1 text-right">CPU</th>
                <th className="font-normal pb-1 text-right">{t('st.m.mem', 'Memory')}</th>
                <th className="font-normal pb-1 text-right">{t('st.m.disk', 'Disk')}</th>
                <th className="font-normal pb-1 text-right">{t('st.m.lat', 'Latency')}</th>
              </tr></thead>
              <tbody>
                {d.metrics.slice(-30).reverse().map((m) => (
                  <tr key={String(m.day)} className="border-t border-[var(--line)]">
                    <td className="py-1">{String(m.day).slice(0, 10)}</td>
                    <td className="py-1 text-right tabular-nums">{m.cpu}%</td>
                    <td className="py-1 text-right tabular-nums">{m.mem}%</td>
                    <td className="py-1 text-right tabular-nums">{m.disk}%</td>
                    <td className="py-1 text-right tabular-nums">{m.latencyMs != null ? `${m.latencyMs} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </>)}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Bell size={15} className="text-[var(--primary-2)]" /> {t('st.sub.title', 'Get told when something breaks')}</div>
        <p className="text-[12px] text-[var(--muted)] mb-3">{t('st.sub.desc', 'One message when a service goes down, one when it comes back. Nothing else — and every message carries a link to stop them.')}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input className="flex-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && subscribe()} placeholder="you@example.com" />
          <Button variant="primary" disabled={busy || !email.trim()} onClick={subscribe}>{t('st.sub.go', 'Subscribe')}</Button>
        </div>
      </Card>

      {d.generatedAt && <div className="text-[11px] text-[var(--faint)] text-center mt-4">{t('st.updated', 'Updated {d}').replace('{d}', fdate(d.generatedAt))}</div>}
    </div>
  );
}
