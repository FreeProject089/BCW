import { useState } from 'react';
import { BarChart3, Plus, Trash2, PenSquare, Users, Globe, Pin, Eye } from 'lucide-react';
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
                <Button size="sm" variant="ghost" onClick={() => setEditor(toEditor(poll))} title={t('common.edit', 'Edit')}><PenSquare size={14} /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(poll)} title={t('common.delete', 'Delete')}><Trash2 size={14} className="text-[var(--error)]" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editor && <PollEditor open initial={editor.id ? editor : null} onClose={() => setEditor(null)} onSaved={reload} />}
      {stats && <PollStats pollId={stats} onClose={() => setStats(null)} />}
    </div>
  );
}
