import { useState } from 'react';
import { BarChart3, Check, Lock, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, EmptyState, Spinner, Input, Textarea, useToast } from '../ui/ui.jsx';
import { useAsync, Loading } from './pages.jsx';
import { useAuth } from './auth.jsx';
import Markdown from '../ui/md.jsx';

// The public poll page, and the card the rest of the site reuses.
//
// Results are hidden until you have answered (per poll), because a running total shown
// beforehand is not information, it is a nudge — people agree with the bar that is already
// winning. Once you have answered, showing it is just the reward for taking part.

function Bar({ label, votes, total, mine }) {
  const pct = total ? Math.round((votes / total) * 100) : 0;
  return (
    <div className="mb-1.5">
      <div className="flex items-baseline gap-2 text-[13px] mb-0.5">
        <span className="flex-1 truncate flex items-center gap-1.5">
          {mine && <Check size={12} className="text-[var(--success)] shrink-0" />}{label}
        </span>
        <span className="tabular-nums text-[var(--muted)]">{pct}%</span>
        <span className="tabular-nums text-[11px] text-[var(--faint)] w-10 text-right">{votes}</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
        <div className={`h-full rounded-full ${mine ? 'bg-[var(--success)]' : 'bg-[var(--primary-2)]'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Does this poll need the form renderer, or is it the single-choice shape the page already
 *  draws? Asked of the DATA, not of a flag: a backfilled poll has one choice question and must
 *  keep rendering exactly as before. */
const needsForm = (poll) => {
  const qs = poll.questions || [];
  return qs.length > 1 || qs.some((q) => q.kind !== 'choice');
};

/** A multi-question poll, as a form. */
function PollForm({ poll, onDone, onWithdraw }) {
  const { t } = useI18n(); const toast = useToast();
  // Pre-filled with what you already answered. The endpoint REPLACES a submission rather than
  // adding one, so a blank form would quietly discard every answer you did not retype — and
  // before this the page could not tell you had answered at all, so it always was blank.
  const [vals, setVals] = useState(() => ({ ...(poll.myAnswers || {}) }));
  const [busy, setBusy] = useState(false);
  const [errAt, setErrAt] = useState(null);

  const set = (qid, v) => setVals((x) => ({ ...x, [qid]: v }));
  const toggleChoice = (q, cid) => setVals((x) => {
    if (!q.config?.multiple) return { ...x, [q.id]: cid };
    const cur = Array.isArray(x[q.id]) ? x[q.id] : [];
    return { ...x, [q.id]: cur.includes(cid) ? cur.filter((c) => c !== cid) : [...cur, cid] };
  });

  const submit = async () => {
    setBusy(true); setErrAt(null);
    // Notes are content and carry no answer. The server ignores them either way, but sending
    // an entry with an undefined value asks it to validate a placeholder.
    const answers = (poll.questions || []).filter((q) => q.kind !== 'note').map((q) => {
      const v = vals[q.id];
      // A ranking nobody reordered still HAS an order — the one on screen. Sending nothing
      // because no button was pressed would refuse a required question the person can see
      // themselves having answered, which is the worst kind of validation error.
      if (q.kind === 'ranking') {
        const order = Array.isArray(v) && v.length === (q.choices || []).length
          ? v
          : (q.choices || []).map((c) => c.id);
        return { questionId: q.id, values: order };
      }
      // A grid's state is keyed by row so a second pick on the same row replaces the first;
      // the wire shape is a list of {row, choiceId}, which is the shape that can carry — and
      // therefore be refused for — a duplicate row. Unanswered rows are absent, not null: the
      // server decides whether a partial grid is allowed, and sending nulls would ask it to
      // validate placeholders.
      if (q.kind === 'grid') {
        const picks = v && typeof v === 'object' ? v : {};
        const values = Object.keys(picks)
          .map(Number).filter(Number.isInteger).sort((a, b) => a - b)
          .filter((row) => picks[row])
          .map((row) => ({ row, choiceId: picks[row] }));
        return { questionId: q.id, values };
      }
      return Array.isArray(v) ? { questionId: q.id, values: v } : { questionId: q.id, value: v };
    });
    try {
      await api.post(`/polls/${poll.id}/answers`, { answers });
      toast.success(t('poll.thanks', 'Answer recorded.'));
      onDone?.();
    } catch (x) {
      // The server names the question it rejected. Scrolling a ten-question form looking for
      // the problem is what a generic "failed" costs, so the field is marked instead.
      if (x?.data?.questionId) {
        setErrAt(x.data.questionId);
        const label = (poll.questions || []).find((q) => q.id === x.data.questionId)?.label || '';
        toast.error(x.data.error === 'required'
          ? t('poll.f.req', 'This one is required: {q}').replace('{q}', label)
          : t('poll.f.bad', 'Check this answer: {q}').replace('{q}', label));
      } else if (x?.data?.error === 'sign_in_required') toast.error(t('poll.needlogin', 'You need an account to answer this one.'));
      else if (x?.data?.error === 'closed') toast.error(t('poll.closednow', 'This poll has closed.'));
      else toast.error(t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {poll.hasAnswered && (
        // Stated, and stated as replacement rather than as a second answer, because that is
        // what pressing the button does.
        <div className="text-[12px] text-[var(--muted)] flex items-center gap-1.5">
          <Check size={13} className="text-[var(--success)]" />
          {t('poll.f.already', 'You answered this. Your answers are below — sending again replaces them.')}
        </div>
      )}
      {(poll.questions || []).map((q) => q.kind === 'note' ? (
        /* Content, not a question: a heading, an explanation, a warning before the part that
           matters. No border and no asterisk — a box that looks like the answerable ones is a
           box people try to answer. The body goes through the site's own markdown, so a note
           can carry a link or a list like any other text on the site. */
        <div key={q.id} className="px-1">
          {q.label && <div className="text-[13px] font-semibold">{q.label}</div>}
          {q.help && <div className="text-[13px] text-[var(--muted)] mt-1"><Markdown>{q.help}</Markdown></div>}
        </div>
      ) : (
        <div key={q.id} className={`rounded-lg border p-3 ${errAt === q.id ? 'border-[var(--danger)]' : 'border-[var(--line)]'}`}>
          <div className="text-[13px] font-medium">
            {q.label}
            {q.required && <span className="text-[var(--danger)] ml-1" title={t('poll.f.required', 'Required')}>*</span>}
          </div>
          {q.help && <p className="text-[12px] text-[var(--muted)] mt-0.5">{q.help}</p>}

          <div className="mt-2 space-y-1.5">
            {q.kind === 'choice' && (q.choices || []).map((c) => {
              const cur = vals[q.id];
              const on = Array.isArray(cur) ? cur.includes(c.id) : cur === c.id;
              return (
                <button key={c.id} type="button" onClick={() => toggleChoice(q, c.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-[13px] transition-colors ${on ? 'border-[var(--primary-2)] bg-[var(--primary-2)]/10' : 'border-[var(--line)] hover:bg-[var(--surface-2)]/60'}`}>
                  {c.label}
                </button>
              );
            })}
            {/* Ranking: an ordered list moved with arrows rather than dragged. Drag needs a
                pointer, a library and a keyboard fallback anyway; two buttons need none of the
                three and work on a phone. The order shown IS the answer — it starts in the
                question's own order so the list is never empty, and the API refuses a partial
                one, which cannot happen from here by construction. */}
            {q.kind === 'ranking' && (() => {
              const order = Array.isArray(vals[q.id]) && vals[q.id].length === (q.choices || []).length
                ? vals[q.id]
                : (q.choices || []).map((c) => c.id);
              const label = (id) => (q.choices || []).find((c) => c.id === id)?.label || id;
              const move = (i, d) => {
                const j = i + d; if (j < 0 || j >= order.length) return;
                const next = [...order]; [next[i], next[j]] = [next[j], next[i]];
                set(q.id, next);
              };
              return (
                <ol className="space-y-1.5">
                  {order.map((id, i) => (
                    <li key={id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--line)] text-[13px]">
                      <span className="w-5 text-[var(--faint)] tabular-nums">{i + 1}</span>
                      <span className="flex-1 min-w-0 truncate">{label(id)}</span>
                      {/* 32×32, not `p-1`. Measured on a 375px viewport these were 14px wide —
                          under half the 24px WCAG 2.2 minimum, and the two of them sat 4px
                          apart, so reordering on a phone meant hitting the wrong arrow. */}
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                        aria-label={t('poll.f.up', 'Move up')}
                        className="grid place-items-center w-8 h-8 shrink-0 rounded text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1}
                        aria-label={t('poll.f.down', 'Move down')}
                        className="grid place-items-center w-8 h-8 shrink-0 rounded text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-30">↓</button>
                    </li>
                  ))}
                </ol>
              );
            })()}
            {/* Grid: the same columns asked of several rows. One radio group per row, named by
                the question AND the row — share a name across rows and the browser treats the
                whole grid as one choice, so answering row 2 silently clears row 1. The wrapper
                scrolls rather than the page: a five-column grid does not fit a phone, and a
                table that widens its parent breaks every layout beside it. */}
            {q.kind === 'grid' && (() => {
              const rows = Array.isArray(q.config?.rows) ? q.config.rows.map((r) => String(r ?? '')).filter((r) => r.trim() !== '') : [];
              const picks = vals[q.id] && typeof vals[q.id] === 'object' ? vals[q.id] : {};
              const pick = (row, cid) => set(q.id, { ...picks, [row]: cid });
              if (!rows.length || !(q.choices || []).length) {
                return <p className="text-[12px] text-[var(--muted)]">{t('poll.f.gridempty', 'This grid has no rows or no columns yet.')}</p>;
              }
              return (
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full min-w-[360px] text-[13px] border-collapse">
                    <thead>
                      <tr>
                        {/* The row-name column stays put while the columns scroll under it.
                            Scrolling it away meant answering row 3 while the screen only showed
                            the radios — you could not tell which row you were on. It must be
                            OPAQUE (--bg-solid, not --surface-1): with "Translucent surfaces" on,
                            the columns would read straight through it. */}
                        <th className="sticky left-0 z-10 bg-[var(--bg-solid)] text-left font-normal text-[12px] text-[var(--muted)] pb-1.5 pr-3" />
                        {(q.choices || []).map((c) => (
                          <th key={c.id} className="font-normal text-[12px] text-[var(--muted)] pb-1.5 px-2 whitespace-nowrap">{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((label, i) => (
                        <tr key={i} className="border-t border-[var(--line)]">
                          <th scope="row" className="sticky left-0 z-10 bg-[var(--bg-solid)] text-left font-normal py-2 pr-3 min-w-0">{label}</th>
                          {(q.choices || []).map((c) => (
                            // The whole cell is the target, not the 13px dot inside it. A bare
                            // radio measured 13×13 here — barely half the 24px minimum, in the
                            // one question type where you must hit several in a row.
                            <td key={c.id} className="text-center p-0">
                              <label className="grid place-items-center min-h-[44px] px-3 cursor-pointer">
                                <input type="radio" name={`grid-${q.id}-${i}`} value={c.id}
                                  checked={picks[i] === c.id} onChange={() => pick(i, c.id)}
                                  aria-label={`${label} — ${c.label}`} className="accent-[var(--primary)] w-4 h-4" />
                              </label>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            {q.kind === 'text' && (
              <Textarea rows={2} value={vals[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} />
            )}
            {/* A scale can be drawn three ways. Same question, same answer, same column — only
                the glyph changes, which is why this is a presentation switch and not a kind.
                An unknown style falls through to the plain input rather than drawing nothing. */}
            {q.kind === 'scale' && (q.config?.style === 'stars' || q.config?.style === 'buttons') && (() => {
              const min = Number.isFinite(Number(q.config?.min)) ? Number(q.config.min) : 1;
              const max = Number.isFinite(Number(q.config?.max)) ? Number(q.config.max) : 5;
              // Guard the span: a mis-typed max of 500 would render five hundred buttons and
              // freeze the page, and config comes from an editor a human types into.
              const steps = Math.min(Math.max(max - min + 1, 2), 11);
              const cur = Number(vals[q.id]);
              return (
                <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label={q.label}>
                  {Array.from({ length: steps }, (_, i) => min + i).map((n) => {
                    const on = q.config.style === 'stars' ? cur >= n : cur === n;
                    return (
                      <button key={n} type="button" role="radio" aria-checked={cur === n}
                        onClick={() => set(q.id, n)}
                        title={String(n)}
                        className={q.config.style === 'stars'
                          ? `text-xl leading-none transition-colors ${on ? 'text-[var(--primary)]' : 'text-[var(--faint)]'}`
                          : `px-2.5 py-1 rounded-lg border text-[13px] transition-colors ${on ? 'border-[var(--primary-2)] bg-[var(--primary-2)]/10' : 'border-[var(--line)] hover:bg-[var(--surface-2)]/60'}`}>
                        {q.config.style === 'stars' ? '★' : n}
                      </button>
                    );
                  })}
                  {cur ? (
                    <button type="button" onClick={() => set(q.id, '')}
                      className="text-[11px] text-[var(--faint)] hover:text-[var(--text)] ml-1">
                      {t('poll.f.clear', 'Clear')}
                    </button>
                  ) : null}
                </div>
              );
            })()}
            {((q.kind === 'scale' && q.config?.style !== 'stars' && q.config?.style !== 'buttons') || q.kind === 'number') && (
              <Input type="number" value={vals[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)}
                min={q.config?.min} max={q.config?.max} step={q.kind === 'scale' ? 1 : 'any'} style={{ maxWidth: 140 }} />
            )}
            {q.kind === 'date' && (
              <Input type="date" value={vals[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} style={{ maxWidth: 180 }} />
            )}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 items-center">
        <Button variant="primary" disabled={busy} onClick={submit}>
          {busy ? <Spinner size={14} /> : (poll.hasAnswered ? t('poll.f.update', 'Update my answers') : t('poll.send', 'Send my answers'))}
        </Button>
        {/* The complement of "you answered": a poll you cannot un-answer is a poll people
            hesitate to answer. The endpoint clears both tables, so this really removes it. */}
        {poll.hasAnswered && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onWithdraw}>
            {t('poll.withdraw', 'Withdraw my answer')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PollCard({ poll: initial, onChange }) {
  const { t } = useI18n(); const toast = useToast(); const { user } = useAuth();
  const [poll, setPoll] = useState(initial);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);

  const voted = (poll.myVotes || []).length > 0;
  const showResults = poll.options.some((o) => o.votes !== undefined);
  const needsAccount = poll.audience === 'users' && !user;
  const closed = !poll.open;

  const toggle = (id) => {
    if (poll.multiple) setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
    else setPicked([id]);
  };

  const submit = async () => {
    if (!picked.length) return;
    setBusy(true);
    try {
      const fresh = await api.post(`/polls/${poll.id}/vote`, { optionIds: picked });
      setPoll(fresh); setPicked([]); onChange?.(fresh);
      toast.success(t('poll.thanks', 'Answer recorded.'));
    } catch (x) {
      toast.error(x?.data?.error === 'sign_in_required' ? t('poll.needlogin', 'You need an account to answer this one.')
        : x?.data?.error === 'closed' ? t('poll.closednow', 'This poll has closed.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      await api.del(`/polls/${poll.id}/vote`);
      const fresh = await api.get(`/polls/${poll.id}`);
      setPoll(fresh); onChange?.(fresh);
      toast.success(t('poll.withdrawn', 'Answer withdrawn.'));
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start gap-2">
        <BarChart3 size={16} className="text-[var(--primary-2)] mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px]">{poll.question}</div>
          {poll.description && <p className="text-[13px] text-[var(--muted)] mt-1">{poll.description}</p>}
        </div>
        {closed && <Badge>{t('poll.closed', 'Closed')}</Badge>}
        {!closed && poll.audience === 'users' && <Badge tone="primary"><Users size={11} /> {t('poll.members', 'Members')}</Badge>}
      </div>

      <div className="mt-3">
        {/* The FORM comes before the results, and the order is the whole point.
            `showResults` is derived from the legacy options carrying vote counts, which is
            true for any poll whose tally is public — so a multi-question poll with
            results:'always' rendered its old single-question bars and the form was
            unreachable. Not "the wrong thing was on top": there was no way to answer it at
            all. Found by seeding one and opening the page.
            A backfilled poll has one choice question, so needsForm is false for it and this
            branch changes nothing about what everybody sees today. */}
        {needsForm(poll) && !closed && !needsAccount ? (
          <PollForm
            // Remounted when the answered state flips, so the pre-filled values are rebuilt
            // from what the server now holds rather than from a state that was seeded before
            // the answer existed.
            key={poll.hasAnswered ? 'answered' : 'blank'}
            poll={poll}
            onDone={async () => {
              const fresh = await api.get(`/polls/${poll.id}`);
              setPoll(fresh); onChange?.(fresh);
            }}
            onWithdraw={withdraw}
          />
        ) : showResults ? (
          <>
            {poll.options.map((o) => (
              <Bar key={o.id} label={o.label} votes={o.votes} total={poll.total || 0} mine={(poll.myVotes || []).includes(o.id)} />
            ))}
            <div className="text-[11px] text-[var(--faint)] mt-2">
              {/* The split is stated wherever the total is, not hidden in an admin screen:
                  on an open poll the anonymous half is an estimate and the reader deserves
                  to know which half of the number is the solid one. */}
              {poll.audience === 'all'
                ? t('poll.split', '{n} answers — {u} from members, {a} anonymous (anonymous ones are counted per device, so treat them as an estimate).')
                  .replace('{n}', String(poll.total)).replace('{u}', String(poll.userTotal)).replace('{a}', String(poll.anonTotal))
                : t('poll.count', '{n} answers, one per member.').replace('{n}', String(poll.total))}
            </div>
            {voted && !closed && (
              <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={withdraw}>{t('poll.withdraw', 'Withdraw my answer')}</Button>
            )}
          </>
        ) : needsAccount ? (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 text-[13px] text-[var(--muted)] flex items-center gap-2">
            <Lock size={14} /> {t('poll.needlogin', 'You need an account to answer this one.')}
            <Link to="/signin" className="ml-auto"><Button size="sm" variant="primary">{t('nav.signin', 'Sign in')}</Button></Link>
          </div>
        ) : closed ? (
          <div className="text-[13px] text-[var(--muted)]">{t('poll.closednoresults', 'This poll is closed.')}</div>
        ) : (
          <>
            <div className="space-y-1.5">
              {poll.options.map((o) => (
                <button key={o.id} onClick={() => toggle(o.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-[13px] transition-colors ${picked.includes(o.id) ? 'border-[var(--primary-2)] bg-[var(--primary-2)]/10' : 'border-[var(--line)] hover:bg-[var(--surface-2)]/60'}`}>
                  {o.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Button size="sm" variant="primary" disabled={busy || !picked.length} onClick={submit}>{busy ? <Spinner /> : t('poll.vote', 'Answer')}</Button>
              {poll.multiple && (
                <span className="text-[11px] text-[var(--faint)]">
                  {poll.maxChoices > 0
                    ? t('poll.multimax', 'Pick up to {n}.').replace('{n}', String(poll.maxChoices))
                    : t('poll.multi', 'Pick as many as you like.')}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export default function PollsPage() {
  const { t } = useI18n();
  const { data, loading } = useAsync(() => api.get('/polls'), []);
  if (loading) return <Loading />;
  const polls = data?.polls || [];
  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-xl font-bold mb-1">{t('poll.page.title', 'Polls')}</h1>
      <p className="text-sm text-[var(--muted)] mb-5">{t('poll.page.sub', 'Short questions about where this goes next. Answering takes a moment and genuinely decides things.')}</p>
      {!polls.length ? <EmptyState icon={BarChart3} title={t('poll.page.none', 'No poll running.')} sub={t('poll.page.none.s', 'Come back — there will be one.')} /> : (
        <div className="space-y-4">{polls.map((p) => <PollCard key={p.id} poll={p} />)}</div>
      )}
    </div>
  );
}
