import { useI18n } from '../i18n.jsx';

// One ink for every chart in this file. It stayed behind in admin-polls.jsx when these
// components moved, which the no-undef lint caught before anything rendered — the exact class
// of bug that lint exists for.
export const CHART_INK = 'var(--primary)';

// How a poll's answers are DRAWN, in one place.
//
// Extracted because the same tallies now appear twice: the admin dashboard has always shown
// them, and the public page could not show them at all — the API served per-question stats that
// no reader ever received. Rendering them twice would guarantee the two drift, and the version
// that drifts is always the one the public sees.
//
// It lives here rather than being imported from admin-polls.jsx so the public bundle does not
// drag the whole admin screen in with it.

export function Distribution({ dist, min, max }) {
  const { t } = useI18n();
  const keys = Object.keys(dist || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (keys.length < 2) return null;
  // Every step between min and max, so a value nobody chose is a visible gap rather than a
  // column that silently is not there.
  const lo = Number.isFinite(min) ? Math.min(min, keys[0]) : keys[0];
  const hi = Number.isFinite(max) ? Math.max(max, keys[keys.length - 1]) : keys[keys.length - 1];
  const span = hi - lo + 1;
  if (span > 21) return null;   // a scale that wide is not a bar chart, it is a histogram nobody asked for
  const steps = Array.from({ length: span }, (_, i) => lo + i);
  const top = Math.max(1, ...steps.map((s) => dist[s] || 0));
  return (
    <div className="mt-2">
      <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-1">{t('apoll.ch.spread', 'Spread')}</div>
      <div className="flex items-end gap-[2px] h-20">
        {steps.map((s) => {
          const n = dist[s] || 0;
          return (
            <div key={s} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${s} — ${n}`}>
              <span className="text-[10px] tabular-nums text-[var(--muted)] leading-none mb-0.5">{n || ''}</span>
              {/* Rounded at the data end only, anchored to the baseline. A zero keeps a 2px
                  stub so the step is still a place on the axis rather than a hole. */}
              <div className="w-full rounded-t-[4px]"
                style={{ height: `${Math.max(2, (n / top) * 100)}%`, background: CHART_INK, opacity: n ? 1 : 0.25 }} />
              <span className="text-[10px] tabular-nums text-[var(--faint)] leading-none mt-1">{s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function QTally({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.votes));
  return (
    <div className="mt-1 space-y-1">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-[12px]">
          <span className="flex-1 min-w-0 truncate">{r.label}</span>
          <div className="w-24 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden shrink-0">
            <div className="h-full bg-[var(--primary-2)]" style={{ width: `${(r.votes / max) * 100}%` }} />
          </div>
          <span className="tabular-nums text-[var(--muted)] w-6 text-right shrink-0">{r.votes}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * One question's results: the tally, the numbers behind a scale, and a ranking.
 *
 * `voters` is shown beside the kind on purpose — a question answered by four people and one
 * answered by four hundred look identical once they are bars.
 */
export function QuestionResults({ questions, completion }) {
  const { t } = useI18n();
  if (!questions?.length) return null;
  return (
    <div className="space-y-3">
      {completion && (
        <div className="text-[12px] text-[var(--muted)]">
          {t('apoll.completion', '{c} of {s} finished every required question ({p}%).')
            .replace('{c}', String(completion.completed)).replace('{s}', String(completion.started))
            .replace('{p}', String(Math.round((completion.rate || 0) * 100)))}
        </div>
      )}
      {questions.map((q) => (
        <div key={q.id}>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium flex-1 min-w-0 truncate">{q.label}</span>
            <span className="text-[11px] text-[var(--faint)]">{t(`apq.kind.${q.kind}`, q.kind)} · {q.voters}</span>
          </div>
          {q.tally && <QTally rows={q.tally} />}
          {q.numeric?.count > 0 && (<>
            <div className="text-[12px] text-[var(--muted)] mt-0.5 tabular-nums">
              {t('apoll.q.mean', 'mean')} {Math.round(q.numeric.mean * 100) / 100} ·{' '}
              {t('apoll.q.median', 'median')} {q.numeric.median} · {q.numeric.min}–{q.numeric.max}
            </div>
            {/* The mean hides the argument: 1s and 5s average to the same 3 as everybody
                answering 3, and those are opposite results. */}
            <Distribution dist={q.numeric.distribution} min={q.numeric.min} max={q.numeric.max} />
          </>)}
          {/* Average rank, best first — lower is better, so the number is labelled rather than
              drawn as a bar, where longer would read as better and mean the opposite. */}
          {q.ranking && (
            <ol className="mt-1 space-y-0.5">
              {q.ranking.map((r, i) => (
                <li key={r.id} className="flex items-baseline gap-2 text-[12px]">
                  <span className="w-4 text-[var(--faint)] tabular-nums">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate">{r.label}</span>
                  <span className="tabular-nums text-[var(--muted)]">{t('apoll.q.avgrank', 'avg')} {Math.round(r.avg * 100) / 100}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}
