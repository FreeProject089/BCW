// "Is everything up?", answered on the page people are already on.
//
// The incident banner beside this one is deliberately silent when nothing is wrong — a strip
// that is green every day teaches a reader to stop reading it. This is the other half of the
// same question and it is a different one: not "is something broken right now" but "is this
// a site that stays up", which is what somebody deciding whether to host a repo here is
// actually asking, and which is only answerable when it IS green.
//
// So the two coexist: the banner shouts during an incident, this states the record. Both read
// the one /status endpoint, and neither invents a number the status page would not show.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';

// The four states the API publishes, and how each is drawn. `not_configured` is not in this
// table on purpose — a dependency the operator switched off is not a service with a state,
// and drawing it grey beside the real ones invites "what is wrong with that one".
const TONE = {
  operational: { dot: 'bg-success', text: 'text-success' },
  down: { dot: 'bg-error', text: 'text-error' },
  degraded: { dot: 'bg-warning', text: 'text-warning' },
};

/** How many days of the window the site was fully up, as the status page counts them. */
function pct(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  // Two decimals, because 99.9 and 99.99 are a very different promise and rounding to one
  // silently makes the weaker of them look like the stronger.
  return `${Math.round(n * 100) / 100}%`;
}

export default function StatusWidget() {
  const { t } = useI18n();
  const [data, setData] = useState(null);

  useEffect(() => {
    let on = true;
    // Silence on failure, like the banner: a panel reading "could not load the status" is a
    // second broken thing on the page, and it is the one the reader can do nothing about.
    api.get('/status').then((d) => { if (on) setData(d); }).catch(() => {});
    return () => { on = false; };
  }, []);

  if (!data) return null;
  const services = (data.services || []).filter((s) => s.state !== 'not_configured');
  if (!services.length) return null;

  const down = services.filter((s) => s.state === 'down');
  const allUp = !down.length;
  // The 30 most recent days, not the 90 the status page draws. This is a strip in a section,
  // not a page — 90 bars at this width are 2px each and read as texture rather than as days.
  const WINDOW = 30;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--line)] flex-wrap">
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${allUp ? 'bg-success' : 'bg-error'}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {allUp
              ? t('sw.allup', 'All services are operational')
              : down.length === 1
                ? t('sw.one', 'One service is down')
                : t('sw.many', 'Several services are down')}
          </div>
          <div className="text-[11px] text-[var(--muted)]">
            {t('sw.window', 'Uptime over the last 90 days, measured by the same probes as the status page.')}
          </div>
        </div>
        <Link to="/status" className="text-xs inline-flex items-center gap-1.5 text-[var(--primary)] hover:underline shrink-0">
          <Activity size={13} /> {t('sw.more', 'Status and history')} <ArrowRight size={12} />
        </Link>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {services.map((s) => {
          const tone = TONE[s.state] || TONE.degraded;
          const days = (s.days || []).slice(-WINDOW);
          return (
            <div key={s.key} className="flex items-center gap-3 px-5 py-3">
              <span className={`h-2 w-2 rounded-full shrink-0 ${tone.dot}`} />
              <span className="text-[13px] font-medium min-w-0 truncate">{s.label}</span>
              {/* The bars, on their own line below the name at narrow widths. `min-w-0` is
                  load-bearing: without it a fixed-width strip beside a flexible name blows the
                  row out on a phone rather than shrinking. */}
              <div className="hidden sm:flex items-end gap-[2px] h-4 ml-auto min-w-0" aria-hidden="true">
                {days.map((d) => (
                  <span
                    key={d.day}
                    title={`${d.day} · ${pct(d.uptimePct) ?? '—'}`}
                    className={`w-[3px] rounded-[1px] ${d.uptimePct >= 99.9 ? 'bg-success/70' : d.uptimePct >= 95 ? 'bg-warning/70' : 'bg-error/70'}`}
                    style={{ height: `${Math.max(20, Math.min(100, d.uptimePct))}%` }}
                  />
                ))}
              </div>
              <span className={`text-[11px] tabular-nums shrink-0 sm:ml-3 ml-auto ${tone.text}`}>
                {pct(s.uptimePct) ?? t('sw.nodata', 'no data')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
