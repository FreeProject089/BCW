import { useState } from 'react';
import { BarChart3, Plus, Trash2, PenSquare, Users, Globe, Pin, Eye, ListTree, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Select, Badge, Modal, Field, EmptyState, Spinner, useToast, useDialog } from '../ui/ui.jsx';
import { useAsync, Loading } from './pages.jsx';

// Admin tab for polls. Gated by `manage_polls`.
//
// The screen's job is not to show a winner, it is to show what the number is made of. Every
// tally is split signed-in / anonymous, and an open poll says on its face that its anonymous
// half is an estimate — because that is the number that ends up in a decision.

const emptyDraft = () => ({
  question: '', description: '', audience: 'users', multiple: false, maxChoices: 0,
  status: 'draft', results: 'after_vote', pinned: false, closesAt: '', options: ['', ''],
});

function PollEditor({ open, initial, onClose, onSaved }) {
  const { t } = useI18n(); const toast = useToast();
  const [d, setD] = useState(initial || emptyDraft());
  const [busy, setBusy] = useState(false);
  const editing = !!initial?.id;
  const locked = editing && (initial.total || 0) > 0;

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const setOpt = (i, v) => setD((x) => ({ ...x, options: x.options.map((o, j) => (j === i ? v : o)) }));

  const save = async () => {
    const options = d.options.map((o) => o.trim()).filter(Boolean);
    if (d.question.trim().length < 3) return toast.error(t('apoll.needq', 'The question is too short.'));
    if (!editing && options.length < 2) return toast.error(t('apoll.need2', 'Two options at least.'));
    setBusy(true);
    try {
      const body = {
        question: d.question.trim(), description: d.description.trim(),
        audience: d.audience, multiple: d.multiple, maxChoices: Number(d.maxChoices) || 0,
        status: d.status, results: d.results, pinned: d.pinned,
        closesAt: d.closesAt ? new Date(d.closesAt).toISOString() : null,
        // Never sent once somebody has answered — the API refuses it anyway, and sending it
        // would turn a saved title edit into a 409 the admin cannot explain.
        ...(locked ? {} : { options }),
      };
      if (editing) await api.put(`/admin/polls/${initial.id}`, body);
      else await api.post('/admin/polls', body);
      toast.success(t('common.saved', 'Saved.')); onSaved(); onClose();
    } catch (x) {
      toast.error(x?.data?.error === 'has_votes' ? t('apoll.locked', 'People have already answered — the options can no longer be changed.') : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? t('apoll.edit', 'Edit poll') : t('apoll.new', 'New poll')}>
      <div className="space-y-3">
        <Field label={t('apoll.q', 'Question')}>
          <Input value={d.question} onChange={(e) => set('question', e.target.value)} placeholder={t('apoll.qph', 'What should we build next?')} />
        </Field>
        <Field label={t('apoll.desc', 'Context (optional)')}>
          <Textarea rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <Field label={t('apoll.options', 'Options')} hint={locked ? t('apoll.locked', 'People have already answered — the options can no longer be changed.') : undefined}>
          <div className="space-y-1.5">
            {d.options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input value={o} disabled={locked} onChange={(e) => setOpt(i, e.target.value)} placeholder={`${t('apoll.option', 'Option')} ${i + 1}`} />
                {d.options.length > 2 && !locked && (
                  <Button variant="ghost" onClick={() => setD((x) => ({ ...x, options: x.options.filter((_, j) => j !== i) }))}><Trash2 size={14} /></Button>
                )}
              </div>
            ))}
            {!locked && d.options.length < 20 && (
              <Button size="sm" variant="ghost" onClick={() => setD((x) => ({ ...x, options: [...x.options, ''] }))}><Plus size={13} /> {t('apoll.addopt', 'Add an option')}</Button>
            )}
          </div>
        </Field>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('apoll.audience', 'Who can answer')}
            hint={d.audience === 'all' ? t('apoll.audience.all.h', 'Anyone. Anonymous answers are counted per device, so they are an estimate — reported separately, never merged into one figure.') : t('apoll.audience.users.h', 'Signed-in members only. One answer each, exactly.')}>
            <Select value={d.audience} onChange={(e) => set('audience', e.target.value)}>
              <option value="users">{t('apoll.aud.users', 'Members only')}</option>
              <option value="all">{t('apoll.aud.all', 'Everyone')}</option>
            </Select>
          </Field>
          <Field label={t('apoll.results', 'Show the tally')}>
            <Select value={d.results} onChange={(e) => set('results', e.target.value)}>
              <option value="after_vote">{t('apoll.res.after', 'After answering')}</option>
              <option value="always">{t('apoll.res.always', 'Always')}</option>
              <option value="staff">{t('apoll.res.staff', 'Staff only')}</option>
            </Select>
          </Field>
          <Field label={t('apoll.status', 'Status')}>
            <Select value={d.status} onChange={(e) => set('status', e.target.value)}>
              <option value="draft">{t('apoll.st.draft', 'Draft (hidden)')}</option>
              <option value="open">{t('apoll.st.open', 'Open')}</option>
              <option value="closed">{t('apoll.st.closed', 'Closed')}</option>
            </Select>
          </Field>
          <Field label={t('apoll.closes', 'Closes on (optional)')}>
            <Input type="datetime-local" value={d.closesAt ? String(d.closesAt).slice(0, 16) : ''} onChange={(e) => set('closesAt', e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.multiple} onChange={(e) => set('multiple', e.target.checked)} /> {t('apoll.multi', 'Several answers allowed')}
          </label>
          {d.multiple && (
            <label className="flex items-center gap-2 text-sm">
              {t('apoll.max', 'at most')}
              <Input className="w-16" type="number" min="0" value={d.maxChoices} onChange={(e) => set('maxChoices', e.target.value)} />
              <span className="text-[11px] text-[var(--faint)]">{t('apoll.max0', '0 = no limit')}</span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.pinned} onChange={(e) => set('pinned', e.target.checked)} /> {t('apoll.pin', 'Pin to the top')}
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button>
          <Button onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        </div>
      </div>
    </Modal>
  );
}

const KINDS = ['choice', 'text', 'scale', 'number', 'date', 'ranking'];
// Both kinds are answered by picking from a fixed list, so both need the choices editor and
// both need at least two of them — one thing to rank is not a ranking.
const HAS_CHOICES = (k) => k === 'choice' || k === 'ranking';
const newQuestion = () => ({ kind: 'choice', label: '', help: '', required: false, config: {}, showIf: null, choices: [{ label: '' }, { label: '' }] });

/**
 * The multi-question editor.
 *
 * Separate from PollEditor because that one edits the shape every existing poll still uses and
 * it works — the API took the same additive route, and breaking the screen that people use to
 * serve one that nobody uses yet would be the wrong trade.
 *
 * The whole set is submitted at once. Order is the array's order: the server ignores any `sort`
 * sent, because two questions both claiming 3 is a state this UI could produce and the reader
 * could not resolve.
 */
function QuestionsEditor({ poll, onClose, onSaved }) {
  const { t } = useI18n(); const toast = useToast();
  const [qs, setQs] = useState(() => (poll.questions || []).map((q) => ({
    id: q.id, kind: q.kind, label: q.label, help: q.help || '', required: !!q.required,
    config: q.config || {}, showIf: q.showIf || null,
    choices: (q.choices || []).map((c) => ({ id: c.id, label: c.label })),
    answers: q.answers || 0,
  })));
  const [saving, setSaving] = useState(false);
  // What the server said an edit would destroy. Held rather than thrown away, because the
  // second attempt has to be the user CONFIRMING this exact list — not a blind retry.
  const [conflict, setConflict] = useState(null);

  const patch = (i, k, v) => setQs((x) => x.map((q, j) => (j === i ? { ...q, [k]: v } : q)));
  const move = (i, d) => setQs((x) => {
    const j = i + d; if (j < 0 || j >= x.length) return x;
    const c = [...x]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  const save = async (force) => {
    const body = {
      force: !!force,
      questions: qs.map((q) => ({
        ...(q.id ? { id: q.id } : {}), kind: q.kind, label: q.label.trim(), help: q.help,
        required: q.required, config: q.config, showIf: q.showIf,
        choices: HAS_CHOICES(q.kind) ? q.choices.filter((c) => c.label.trim()).map((c) => ({ ...(c.id ? { id: c.id } : {}), label: c.label.trim() })) : [],
      })),
    };
    if (body.questions.some((q) => !q.label)) return toast.error(t('apq.needlabel', 'Every question needs a label.'));
    if (body.questions.some((q) => HAS_CHOICES(q.kind) && q.choices.length < 2)) {
      return toast.error(t('apq.need2', 'A choice question needs at least two choices.'));
    }
    setSaving(true);
    try {
      await api.put(`/admin/polls/${poll.id}/questions`, body);
      toast.success(t('common.saved', 'Saved.'));
      onSaved?.(); onClose();
    } catch (x) {
      // 409 is not a failure to report and forget — it is the server refusing to delete answers
      // without being told to. Show WHICH questions and how many, then offer to go ahead.
      if (x?.status === 409 && x?.data?.error === 'would_lose_answers') setConflict(x.data);
      else if (x?.data?.error === 'unknown_question') toast.error(t('apq.unknown', 'A question in this form does not belong to this poll. Reload and try again.'));
      else toast.error(t('common.failed', 'Failed.'));
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('apq.title', 'Questions')} size="lg">
      <div className="space-y-3">
        <p className="text-xs text-[var(--muted)]">
          {t('apq.hint', 'A poll with one question behaves exactly as before. Add more to turn it into a form.')}
        </p>

        {conflict && (
          <div className="rounded-lg border border-[var(--danger)] p-3 space-y-2">
            <div className="text-sm font-medium">
              {t('apq.lose.t', 'This removes {n} answer(s).').replace('{n}', String(conflict.answersLost))}
            </div>
            <ul className="text-xs text-[var(--muted)] space-y-0.5">
              {(conflict.questions || []).map((c) => (
                <li key={c.id}>· {qs.find((q) => q.id === c.id)?.label || c.id} — {t('apq.lose.n', '{n} answer(s)').replace('{n}', String(c.answers))}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>{t('common.cancel', 'Cancel')}</Button>
              <Button size="sm" variant="danger" disabled={saving} onClick={() => { setConflict(null); save(true); }}>
                {t('apq.lose.ok', 'Delete them and save')}
              </Button>
            </div>
          </div>
        )}

        {qs.map((q, i) => (
          <Card key={q.id || `new-${i}`} className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted)] w-5">{i + 1}</span>
              <Input value={q.label} onChange={(e) => patch(i, 'label', e.target.value)} placeholder={t('apq.label', 'Question')} />
              <Select value={q.kind} onChange={(e) => patch(i, 'kind', e.target.value)} style={{ maxWidth: 130 }}>
                {KINDS.map((k) => <option key={k} value={k}>{t(`apq.kind.${k}`, k)}</option>)}
              </Select>
              <Button variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={14} /></Button>
              <Button variant="ghost" onClick={() => move(i, 1)} disabled={i === qs.length - 1}><ArrowDown size={14} /></Button>
              <Button variant="ghost" onClick={() => setQs((x) => x.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={q.required} onChange={(e) => patch(i, 'required', e.target.checked)} />
                {t('apq.required', 'Required')}
              </label>
              {/* Named, not just counted: knowing a question already holds 12 answers is what
                  makes changing its type a decision rather than a click. */}
              {q.answers > 0 && (
                <span className="text-[var(--muted)]">{t('apq.has', '{n} answer(s) already').replace('{n}', String(q.answers))}</span>
              )}
            </div>
            {/* A scale's bounds and how it is drawn. Without these the kind existed and could
                only ever be a bare number box — the config was reachable by the API and by
                nothing a human uses. */}
            {q.kind === 'scale' && (
              <div className="flex items-center gap-2 pl-7 text-xs">
                <span className="text-[var(--muted)]">{t('apq.scale.range', 'From')}</span>
                <Input type="number" style={{ maxWidth: 70 }} value={q.config?.min ?? 1}
                  onChange={(e) => patch(i, 'config', { ...q.config, min: Number(e.target.value) })} />
                <span className="text-[var(--muted)]">{t('apq.scale.to', 'to')}</span>
                <Input type="number" style={{ maxWidth: 70 }} value={q.config?.max ?? 5}
                  onChange={(e) => patch(i, 'config', { ...q.config, max: Number(e.target.value) })} />
                <Select style={{ maxWidth: 130 }} value={q.config?.style || 'number'}
                  onChange={(e) => patch(i, 'config', { ...q.config, style: e.target.value })}>
                  <option value="number">{t('apq.scale.number', 'Number box')}</option>
                  <option value="stars">{t('apq.scale.stars', 'Stars')}</option>
                  <option value="buttons">{t('apq.scale.buttons', 'Buttons')}</option>
                </Select>
              </div>
            )}
            {HAS_CHOICES(q.kind) && (
              <div className="space-y-1.5 pl-7">
                {q.choices.map((c, ci) => (
                  <div key={c.id || `c-${ci}`} className="flex gap-2">
                    <Input value={c.label} placeholder={`${t('apoll.option', 'Option')} ${ci + 1}`}
                      onChange={(e) => patch(i, 'choices', q.choices.map((x, j) => (j === ci ? { ...x, label: e.target.value } : x)))} />
                    {q.choices.length > 2 && (
                      <Button variant="ghost" onClick={() => patch(i, 'choices', q.choices.filter((_, j) => j !== ci))}><Trash2 size={14} /></Button>
                    )}
                  </div>
                ))}
                {q.choices.length < 20 && (
                  <Button size="sm" variant="ghost" onClick={() => patch(i, 'choices', [...q.choices, { label: '' }])}>
                    <Plus size={13} /> {t('apoll.addopt', 'Add an option')}
                  </Button>
                )}
              </div>
            )}
          </Card>
        ))}

        <Button size="sm" variant="ghost" onClick={() => setQs((x) => [...x, newQuestion()])}>
          <Plus size={13} /> {t('apq.add', 'Add a question')}
        </Button>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="primary" disabled={saving} onClick={() => save(false)}>
            {saving ? <Spinner size={14} /> : t('common.save', 'Save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PollStats({ pollId, onClose }) {
  const { t } = useI18n();
  const { data, loading } = useAsync(() => api.get(`/admin/polls/${pollId}/stats`), [pollId]);
  if (loading) return <Modal open onClose={onClose} title={t('apoll.stats', 'Results')}><Spinner /></Modal>;
  const d = data || {};
  const max = Math.max(1, ...(d.byOption || []).map((o) => o.total));
  return (
    <Modal open onClose={onClose} title={t('apoll.stats', 'Results')}>
      <div className="text-sm font-semibold mb-1">{d.poll?.question}</div>
      <div className="text-[12px] text-[var(--muted)] mb-3">
        {t('apoll.voters', '{n} people answered — {u} signed in, {a} anonymous.')
          .replace('{n}', String(d.voters || 0)).replace('{u}', String(d.userVoters || 0)).replace('{a}', String(d.anonVoters || 0))}
        {d.anonIsEstimate && ` ${t('apoll.estimate', 'The anonymous figure is deduplicated per device: two people on one connection count once, one person on two devices counts twice.')}`}
      </div>

      {(d.byOption || []).map((o) => (
        <div key={o.id} className="mb-2">
          <div className="flex items-baseline gap-2 text-[13px]">
            <span className="flex-1 truncate">{o.label}</span>
            <span className="tabular-nums text-[var(--muted)]">{o.total}</span>
          </div>
          {/* Two segments, one bar: the signed-in part is the solid number and reads first. */}
          <div className="h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden flex">
            <div className="h-full bg-[var(--primary-2)]" style={{ width: `${(o.users / max) * 100}%` }} title={t('apoll.signedin', 'signed in')} />
            <div className="h-full bg-[var(--warning)] opacity-70" style={{ width: `${(o.anon / max) * 100}%` }} title={t('apoll.anon', 'anonymous')} />
          </div>
          <div className="text-[11px] text-[var(--faint)] mt-0.5">
            {o.users} {t('apoll.signedin', 'signed in')} · {o.anon} {t('apoll.anon', 'anonymous')}
          </div>
        </div>
      ))}

      {(d.recent || []).length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--line)]">
          <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-1">{t('apoll.who', 'Who answered')}</div>
          {/* Signed-in answers only. There is no row to show for a fingerprint, and inventing
              one would imply the anonymous half is identifiable. */}
          <div className="max-h-48 overflow-y-auto divide-y divide-[var(--line)]">
            {d.recent.map((r, i) => (
              <div key={i} className="py-1 flex items-center gap-2 text-[12px]">
                <span className="truncate flex-1">{r.user.displayName}</span>
                <span className="text-[var(--muted)] truncate">{r.option}</span>
                <span className="text-[10px] text-[var(--faint)]">{new Date(r.at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function AdminPolls() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/admin/polls'), []);
  const [editor, setEditor] = useState(null); // null | {} | poll
  const [stats, setStats] = useState(null);
  const [questions, setQuestions] = useState(null);

  if (loading) return <Loading />;
  const polls = data?.polls || [];

  const remove = async (poll) => {
    if (!await dialog.confirm({
      title: t('apoll.del.t', 'Delete this poll?'),
      message: t('apoll.del.m', 'The question and every answer to it go with it. {n} answers so far.').replace('{n}', String(poll.total || 0)),
      okLabel: t('common.delete', 'Delete'), danger: true,
    })) return;
    try { await api.del(`/admin/polls/${poll.id}`); toast.success(t('common.deleted', 'Deleted.')); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const toEditor = (poll) => ({
    ...poll,
    closesAt: poll.closesAt ? new Date(poll.closesAt).toISOString().slice(0, 16) : '',
    options: poll.options.map((o) => o.label),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-semibold flex items-center gap-2"><BarChart3 size={16} className="text-[var(--primary-2)]" /> {t('apoll.title', 'Polls')}</h2>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => setEditor(emptyDraft())}><Plus size={13} /> {t('apoll.new', 'New poll')}</Button>
      </div>

      {!polls.length ? <EmptyState icon={BarChart3} title={t('apoll.none', 'No poll yet.')} sub={t('apoll.none.s', 'Ask something — a two-option question gets more answers than a survey.')} /> : (
        <div className="space-y-3">
          {polls.map((poll) => (
            <Card key={poll.id} className="p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                    {poll.pinned && <Pin size={12} className="text-[var(--primary-2)]" />}
                    <span className="truncate">{poll.question}</span>
                    <Badge tone={poll.status === 'open' ? 'green' : poll.status === 'draft' ? '' : 'amber'}>
                      {t(`apoll.st.${poll.status}`, poll.status)}
                    </Badge>
                    <Badge tone={poll.audience === 'all' ? 'amber' : 'primary'}>
                      {poll.audience === 'all' ? <><Globe size={11} /> {t('apoll.aud.all', 'Everyone')}</> : <><Users size={11} /> {t('apoll.aud.users', 'Members only')}</>}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-[var(--faint)] mt-0.5">
                    {t('apoll.summary', '{n} answers — {u} signed in, {a} anonymous')
                      .replace('{n}', String(poll.total || 0)).replace('{u}', String(poll.userTotal || 0)).replace('{a}', String(poll.anonTotal || 0))}
                    {poll.closesAt && ` · ${t('apoll.closeson', 'closes {d}').replace('{d}', new Date(poll.closesAt).toLocaleDateString())}`}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setStats(poll.id)} title={t('apoll.stats', 'Results')}><Eye size={14} /></Button>
                <Button size="sm" variant="ghost" onClick={() => setQuestions(poll)} title={t('apq.title', 'Questions')}><ListTree size={14} /></Button>
                <Button size="sm" variant="ghost" onClick={() => setEditor(toEditor(poll))} title={t('common.edit', 'Edit')}><PenSquare size={14} /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(poll)} title={t('common.delete', 'Delete')}><Trash2 size={14} className="text-[var(--error)]" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editor && <PollEditor open initial={editor.id ? editor : null} onClose={() => setEditor(null)} onSaved={reload} />}
      {stats && <PollStats pollId={stats} onClose={() => setStats(null)} />}
      {questions && <QuestionsEditor poll={questions} onClose={() => setQuestions(null)} onSaved={reload} />}
    </div>
  );
}
