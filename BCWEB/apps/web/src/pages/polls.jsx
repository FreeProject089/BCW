import { useState } from 'react';
import { BarChart3, Check, Lock, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, EmptyState, Spinner, Input, Textarea, useToast } from '../ui/ui.jsx';
import { useAsync, Loading } from './pages.jsx';
import { useAuth } from './auth.jsx';

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
function PollForm({ poll, onDone }) {
  const { t } = useI18n(); const toast = useToast();
  const [vals, setVals] = useState({});
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
    const answers = (poll.questions || []).map((q) => {
      const v = vals[q.id];
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
      {(poll.questions || []).map((q) => (
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
            {q.kind === 'text' && (
              <Textarea rows={2} value={vals[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} />
            )}
            {(q.kind === 'scale' || q.kind === 'number') && (
              <Input type="number" value={vals[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)}
                min={q.config?.min} max={q.config?.max} step={q.kind === 'scale' ? 1 : 'any'} style={{ maxWidth: 140 }} />
            )}
            {q.kind === 'date' && (
              <Input type="date" value={vals[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} style={{ maxWidth: 180 }} />
            )}
          </div>
        </div>
      ))}
      <Button variant="primary" disabled={busy} onClick={submit}>
        {busy ? <Spinner size={14} /> : t('poll.send', 'Send my answers')}
      </Button>
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
        {showResults ? (
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
        ) : needsForm(poll) ? (
          <PollForm poll={poll} onDone={async () => {
            const fresh = await api.get(`/polls/${poll.id}`);
            setPoll(fresh); onChange?.(fresh);
          }} />
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
