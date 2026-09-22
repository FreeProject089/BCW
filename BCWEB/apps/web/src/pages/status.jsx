import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Bell, ChevronDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync, Loading } from './pages.jsx';
import { Card, Button, Input, Badge, useToast } from '../ui/ui.jsx';

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
  const { data, err, loading, reload } = useAsync(() => api.get('/status'), []);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  // How many past incidents are on screen. The list was rendered whole: every outage in the
  // 90-day window, each with its whole write-up, under a heading with no count and no end.
  // A bad month is fifty of them, and the subscribe box — the one thing on this page a
  // visitor can act on — ended up several screens below the fold.
  //
  // This pages CLIENT-SIDE, and that is a compromise worth naming: GET /status takes no
  // paging parameters and answers with the whole window in one object (capped at 50 by the
  // route itself — see apps/api/src/routes/status.mjs, which this agent must not change). So
  // the bytes all arrive either way; what this fixes is the page, not the request. If the
  // endpoint ever grows `?before=`/`?take=`, the only change here is where `more()` gets the
  // next batch from.
  const PAGE = 8;
  const [shown, setShown] = useState(PAGE);

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

  // A page that could not LOAD used to be indistinguishable from a real "unknown": `data` was
  // null, `d.state` undefined, the banner fell through to BANNER.unknown, and every section
  // below it rendered empty but plausible — 90-day heading, no bars, no services. So a request
  // that never arrived read as "we checked, and we cannot tell", which is a different and much
  // more alarming claim. It got reported as the status page not working, and it was right.
  //
  // `useAsync` returned this error all along; this page destructured `{ data, loading }` and
  // dropped it on the floor.
  if (err) return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="rounded-xl px-5 py-4 flex items-start gap-3"
        style={{ background: 'color-mix(in srgb, var(--warning) 12%, var(--bg-solid))', border: '1px solid color-mix(in srgb, var(--warning) 40%, var(--line))' }}>
        <AlertTriangle size={22} style={{ color: 'var(--warning)' }} className="shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{t('st.unreachable', 'Could not load the status page')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {t('st.unreachable.hint', 'This request did not get through. That is a fault on the way here — it is not a report about the services below, which this page could not check at all.')}
          </p>
          <Button size="sm" className="mt-3" onClick={() => reload()}>{t('st.retry', 'Try again')}</Button>
        </div>
      </div>
    </div>
  );

  const d = data || {};
  const b = BANNER[d.state] || BANNER.unknown;
  const fdate = (x) => new Date(x).toLocaleString();
  const incidents = d.incidents || [];
  // An ongoing incident is the reason somebody opened this page, so it is never paged away:
  // the open ones are pinned to the top of the first batch whatever their date. The server
  // already sorts by start date descending, which puts a three-week-old open outage below
  // yesterday's resolved one.
  const ordered = [...incidents].sort((a, x) => (a.endedAt ? 1 : 0) - (x.endedAt ? 1 : 0));
  const page = ordered.slice(0, shown);
  const rest = ordered.length - page.length;

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

      {/* `plate`: a section kicker between two cards has no card of its own, so it sat on the
          3D backdrop and measured 4.31:1 against it. See index.css. */}
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="plate w-fit text-[11px] uppercase tracking-wider text-[var(--faint)] px-1">{t('st.incidents', 'Past incidents')}</h2>
        {ordered.length > 0 && (
          <span className="plate w-fit px-1 text-[11px] text-[var(--faint)] tabular-nums">
            {t('st.inc.count', '{n} of {total}').replace('{n}', String(page.length)).replace('{total}', String(ordered.length))}
          </span>
        )}
      </div>
      <Card className="p-4 mb-6">
        {!ordered.length ? (
          <div className="text-[13px] text-[var(--muted)]">{t('st.noincidents', 'Nothing has broken in this window.')}</div>
        ) : (
          <ul className="space-y-3">
            {page.map((i) => (
              <li key={i.id} className="border-s-2 ps-3" style={{ borderColor: i.endedAt ? 'var(--line)' : 'var(--error)' }}>
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
        {rest > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--line)] flex items-center justify-center">
            <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>
              <ChevronDown size={14} />
              {t('st.inc.more', 'Show {n} more').replace('{n}', String(Math.min(PAGE, rest)))}
            </Button>
          </div>
        )}
        {/* The window and the route's own ceiling, said once, at the end of the list — the
            place where somebody who has read everything wonders whether that is everything.
            A page that just stops is a page you cannot tell apart from one that is hiding
            something. */}
        {rest === 0 && ordered.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--line)] text-[11px] text-[var(--faint)] text-center">
            {ordered.length >= 50
              ? t('st.inc.cap', 'That is the last one this page carries. Older incidents are not published.')
              : t('st.inc.end', 'That is every incident in the last {n} days.').replace('{n}', String(d.windowDays || 90))}
          </div>
        )}
      </Card>
      <Card className="p-4">
        <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Bell size={15} className="text-[var(--accent-ink)]" /> {t('st.sub.title', 'Get told when something breaks')}</div>
        <p className="text-[12px] text-[var(--muted)] mb-3">{t('st.sub.desc', 'One message when a service goes down, one when it comes back. Nothing else, and every message carries a link to stop them.')}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input className="flex-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && subscribe()} placeholder="you@example.com" />
          <Button variant="primary" disabled={busy || !email.trim()} onClick={subscribe}>{t('st.sub.go', 'Subscribe')}</Button>
        </div>
      </Card>

      {/* `plate`: the last line on the page, under the final card, so it sits on the 3D
          backdrop (measured 3.56:1 against it). See index.css. */}
      {d.generatedAt && <div className="plate w-fit mx-auto px-2 text-[11px] text-[var(--faint)] text-center mt-4">{t('st.updated', 'Updated {d}').replace('{d}', fdate(d.generatedAt))}</div>}
    </div>
  );
}
