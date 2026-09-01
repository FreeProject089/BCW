// "Is something going on right now?", answered on the page people are already on.
//
// The status page has always held the answer — which services are down, since when, and what
// a human last wrote about it. It answers only for somebody who thought to go and look, which
// is nobody at the moment it matters: during an incident people reload the home page, see it
// render normally, and conclude the problem is theirs.
//
// So this says it here, and ONLY when there is something to say. A permanent "all systems
// operational" strip is the fastest way to teach a reader to stop reading a strip — it is
// green every day they visit, so on the one day it is not, it is furniture.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';

/** How long an incident has been running, in the largest unit that is still honest. */
function since(t, t2) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
  if (mins < 60) return t2('sb.mins', '{n} min').replace('{n}', String(mins));
  const h = Math.floor(mins / 60);
  if (h < 48) return t2('sb.hours', '{n}h').replace('{n}', String(h));
  return t2('sb.days', '{n} days').replace('{n}', String(Math.floor(h / 24)));
}

/**
 * @param {object}  props
 * @param {boolean} props.compact  Draw the one-line form and nothing else — for a narrow column.
 */
export default function StatusBanner({ compact = false }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let on = true;
    // Failure is silence, deliberately. A status widget that renders "could not load the
    // status" during an outage is a second broken thing on the page, and it is the one the
    // reader can do nothing about.
    api.get('/status').then((d) => { if (on) setData(d); }).catch(() => {});
    return () => { on = false; };
  }, []);

  if (!data) return null;
  // Unresolved means `endedAt === null` — the same rule the status page draws its bars from,
  // rather than a second reading of "recent".
  const openIncidents = (data.incidents || []).filter((i) => !i.endedAt);
  const degraded = data.state && data.state !== 'ok' && data.state !== 'operational';
  if (!openIncidents.length && !degraded) return null;

  const worst = openIncidents[0] || null;
  // The LAST thing a human wrote about it. An incident with no note says so rather than
  // showing an empty space where the explanation goes — "we know, nothing written yet" is
  // itself information, and the absence of it reads as an unattended page.
  const lastNote = (i) => (i.updates || []).slice(-1)[0] || null;

  return (
    <div className="rounded-2xl border border-warning/40 bg-warning/[0.06] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-start"
        aria-expanded={open}
      >
        {/* A live pulse, not just a static triangle — an incident is a thing happening now,
            and a page reloaded during one should read as "active", not as a notice that has
            always been there. */}
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-warning opacity-60 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning" />
        </span>
        <AlertTriangle size={16} className="text-warning shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {openIncidents.length > 1
              ? t('sb.manyT', '{n} services are having problems').replace('{n}', String(openIncidents.length))
              : worst
                ? t('sb.oneT', '{s} is having problems').replace('{s}', worst.service)
                : t('sb.degradedT', 'Some services are degraded')}
          </div>
          {worst && (
            <div className="text-[11px] text-[var(--muted)]">
              {t('sb.for', 'for {d}').replace('{d}', since(worst.startedAt, t))}
              {lastNote(worst) ? ` · ${lastNote(worst).state}` : ` · ${t('sb.nonote', 'no update written yet')}`}
            </div>
          )}
        </div>
        {!compact && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]">
            <span className="hidden sm:inline">{open ? t('sb.hide', 'Hide') : t('sb.details', 'Details')}</span>
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        )}
      </button>

      {open && !compact && (
        <div className="px-4 pb-3 space-y-2.5 border-t border-warning/25 pt-3">
          {openIncidents.map((i) => {
            const n = lastNote(i);
            return (
              <div key={i.id} className="text-xs">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <b>{i.service}</b>
                  <span className="text-[11px] text-[var(--muted)]">{t('sb.for', 'for {d}').replace('{d}', since(i.startedAt, t))}</span>
                  {n && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--muted)]">{n.state}</span>}
                </div>
                {/* The account, not a summary of it. Somebody wrote this sentence for exactly
                    this moment; shortening it here would be answering a question they already
                    answered. */}
                <p className="mt-0.5 text-[var(--muted)] leading-snug">
                  {n ? n.body : t('sb.nonote.long', 'Nobody has written an update yet. The service is being watched automatically.')}
                </p>
              </div>
            );
          })}
          <Link to="/status" className="inline-flex items-center gap-1.5 text-xs text-[var(--primary)] hover:underline">
            <Activity size={13} /> {t('sb.more', 'Full status and history')}
          </Link>
        </div>
      )}
    </div>
  );
}
