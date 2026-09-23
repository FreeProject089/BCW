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
//
// It used to be a full-height panel in the middle of the landing page: every service, thirty
// day-bars each, an entire section spent saying — almost always — that nothing was wrong. That
// answers "which one, and when", and the answer to that is the status page, one click away.
// What belongs at the bottom of every page is the one line.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';

/** How many days of the window the site was fully up, as the status page counts them. */
function pct(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  // Two decimals, because 99.9 and 99.99 are a very different promise and rounding to one
  // silently makes the weaker of them look like the stronger.
  return `${Math.round(n * 100) / 100}%`;
}

/**
 * The same answer, in one line, for the footer.
 *
 * Not a second reader of `/status`: it is this file, so the states, the tone table and the
 * rounding are the ones the full panel uses. Two components describing uptime with two
 * roundings is how 99.9 and 99.99 end up looking like the same promise.
 *
 * Deliberately without the per-service rows and the day bars. Those answer "which one, and
 * when" — a question whose answer is the status page, one click away. What belongs beside a
 * newsletter box is whether the site stays up.
 */
export function FooterStatus({ only = [], style = 'line' }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);

  useEffect(() => {
    let on = true;
    api.get('/status').then((d) => { if (on) setData(d); }).catch(() => {});
    return () => { on = false; };
  }, []);

  if (!data) return null;
  const picked = Array.isArray(only) && only.length ? new Set(only) : null;
  const services = (data.services || []).filter((s) => s.state !== 'not_configured' && (!picked || picked.has(s.key)));
  if (!services.length) return null;

  const down = services.filter((s) => s.state === 'down');
  const degraded = services.filter((s) => s.state === 'degraded');
  const allUp = !down.length && !degraded.length;
  // The site's uptime is the WORST of its parts, not their average: a service that has been
  // down for a day does not become fine because four others were not.
  const worst = services.reduce((a, s) => (typeof s.uptimePct === 'number' && (a === null || s.uptimePct < a) ? s.uptimePct : a), null);

  return (
    <div className="mt-6">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('sw.foot', 'Service status')}</div>
      {/* One row that wraps rather than a grid: on a phone the sentence and the figure fall
          onto two lines by themselves, and there is no width at which this needs a rule. */}
      {style === 'dots' && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-xs">
          {services.map((s) => <Link key={s.key} to="/status" className="inline-flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--text)]"><span className={`h-1.5 w-1.5 rounded-full ${s.state === 'up' ? 'bg-success' : s.state === 'down' ? 'bg-error' : 'bg-warning'}`} />{s.label}</Link>)}
        </div>
      )}
      {/* Two fixed lines, not one that wraps. As a single flex-wrap row the uptime broke off
          wherever the width ran out: at 375 it became a second line opening on its own
          separator ("· 99.5% over 90 days") with the arrow trailing after it. Now the sentence
          owns line one (dot, words, arrow) and the figure sits under the words, at every width. */}
      <Link to="/status" className="group inline-grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 text-sm max-w-full">
        <span className={`h-2 w-2 rounded-full shrink-0 ${allUp ? 'bg-success' : down.length ? 'bg-error' : 'bg-warning'}`} />
        <span className={allUp ? 'text-success' : down.length ? 'text-error' : 'text-warning'}>
          {allUp
            ? t('sw.allup', 'All services are operational')
            : down.length === 1
              ? t('sw.one', 'One service is down')
              : down.length
                ? t('sw.many', 'Several services are down')
                : t('sw.deg', 'Degraded performance')}
        </span>
        <ArrowRight size={12} className="text-[var(--faint)] transition-transform group-hover:translate-x-0.5" />
        {worst !== null && (
          <span className="col-start-2 col-span-2 text-xs text-[var(--muted)] tabular-nums">
            {pct(worst)} {t('sw.90d', 'over 90 days')}
          </span>
        )}
      </Link>
    </div>
  );
}
