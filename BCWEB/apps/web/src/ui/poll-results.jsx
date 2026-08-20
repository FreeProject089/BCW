import { useI18n } from '../i18n.jsx';
import { Check } from 'lucide-react';

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

export function QTally({ rows, mine = [] }) {
  const max = Math.max(1, ...rows.map((r) => r.votes));
  // The bar is scaled to the LEADER so the shape is readable; the percentage is of the TOTAL,
  // because that is the number people quote. Showing only counts meant "3" with no idea
  // whether that was three out of four or three out of four hundred.
  const total = rows.reduce((n, r) => n + r.votes, 0);
  const top = Math.max(0, ...rows.map((r) => r.votes));
  return (
    <div className="mt-1 space-y-1">
      {rows.map((r) => {
        const isMine = mine.includes(r.id);
        const leads = total > 0 && r.votes === top;
        return (
          <div key={r.id} className="flex items-center gap-2 text-[12px]">
            <span className={`flex-1 min-w-0 truncate flex items-center gap-1 ${leads ? 'font-medium' : ''}`}>
              {isMine && <Check size={11} className="text-[var(--success)] shrink-0" />}
              {r.label}
            </span>
            <div className="w-24 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden shrink-0">
              <div className={`h-full ${isMine ? 'bg-[var(--success)]' : 'bg-[var(--primary-2)]'}`}
                style={{ width: `${(r.votes / max) * 100}%` }} />
            </div>
            <span className="tabular-nums text-[var(--muted)] w-9 text-right shrink-0">
              {total ? Math.round((r.votes / total) * 100) : 0}%
            </span>
            <span className="tabular-nums text-[var(--faint)] w-6 text-right shrink-0">{r.votes}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One question's results: the tally, the numbers behind a scale, and a ranking.
 *
 * `voters` is shown beside the kind on purpose — a question answered by four people and one
 * answered by four hundred look identical once they are bars.
 */
export function QuestionResults({ questions, completion, myChoices = {}, texts = {} }) {
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
          {q.tally && <QTally rows={q.tally} mine={myChoices[q.id] || []} />}

          {/* A GRID is a tally per row. It has always been computed and never drawn: the
              question showed its kind and its voter count and then stopped, so a five-row
              matrix looked like a question nobody had answered. */}
          {q.grid?.length > 0 && (
            <div className="mt-1 space-y-2">
              {q.grid.map((row) => (
                <div key={row.row}>
                  <div className="text-[12px] text-[var(--muted)] flex items-baseline gap-2">
                    <span className="flex-1 min-w-0 truncate">{row.label}</span>
                    <span className="text-[11px] text-[var(--faint)] tabular-nums">{row.voters}</span>
                  </div>
                  <QTally rows={row.tally} />
                </div>
              ))}
            </div>
          )}

          {/* FREE TEXT is never averaged into a "top answer" — that invents a consensus out of
              writing. But the count alone made the answers unreachable: people had typed, and
              nothing on any screen ever showed a word of it. So the words are shown when the
              caller has them, and only the count when it does not. */}
          {q.kind === 'text' && (
            texts[q.id]?.length ? (
              <ul className="mt-1 space-y-1">
                {texts[q.id].map((line, i) => (
                  <li key={i} className="text-[12px] text-[var(--muted)] border-l-2 border-[var(--line)] pl-2 whitespace-pre-wrap break-words">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[12px] text-[var(--muted)] mt-0.5">
                {t('apoll.q.written', '{n} wrote an answer.').replace('{n}', String(q.answered || 0))}
              </div>
            )
          )}

          {/* A DATE question reported nothing either. The span is the answer: "when should this
              land" is a range, not a count. */}
          {q.kind === 'date' && (
            <div className="text-[12px] text-[var(--muted)] mt-0.5 tabular-nums">
              {q.answered
                ? t('apoll.q.daterange', '{n} answers, from {a} to {b}')
                  .replace('{n}', String(q.answered))
                  .replace('{a}', q.earliest ? new Date(q.earliest).toLocaleDateString() : '—')
                  .replace('{b}', q.latest ? new Date(q.latest).toLocaleDateString() : '—')
                : t('apoll.q.nodates', 'No date given yet.')}
            </div>
          )}
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
                  {/* `averageRank`, not `avg`. The field has been called averageRank in
                      poll-stats.mjs since it was written; this component read `avg`, so every
                      public ranking question rendered "avg NaN" — undefined times 100, rounded.
                      The admin screen had its own copy of this markup with the right name, so
                      the bug was invisible to whoever was looking at the admin screen.

                      null when nobody ranked that choice: an em dash, not a zero, because
                      "ranked first by nobody" and "ranked 0th" are not the same claim. */}
                  <span className="tabular-nums text-[var(--muted)]">
                    {r.averageRank === null || r.averageRank === undefined
                      ? '—'
                      : `${t('apoll.q.avgrank', 'avg')} ${Math.round(r.averageRank * 100) / 100}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}
