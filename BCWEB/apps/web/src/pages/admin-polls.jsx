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

/** A new poll starts as a form with one real question, not a title plus two blank options. */
const startQuestions = () => [{
  kind: 'choice', label: '', help: '', required: false, config: {}, showIf: null,
  choices: [{ label: '' }, { label: '' }], answers: 0,
}];

function PollEditor({ open, initial, onClose, onSaved }) {
  const { t } = useI18n(); const toast = useToast();
  const [d, setD] = useState(initial || emptyDraft());
  const [busy, setBusy] = useState(false);
  // The questions being built, for a NEW poll. An existing one edits them from its own row,
  // where the answer counts and the 409-on-destruction flow live.
  const [qs, setQs] = useState(startQuestions);
  const editing = !!initial?.id;
  const locked = editing && (initial.total || 0) > 0;

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const setOpt = (i, v) => setD((x) => ({ ...x, options: x.options.map((o, j) => (j === i ? v : o)) }));

  const save = async () => {
    const options = d.options.map((o) => o.trim()).filter(Boolean);
    if (d.question.trim().length < 3) return toast.error(t('apoll.needq', 'The title is too short.'));

    // A NEW poll is built here in full: the title above, the questions below. It no longer
    // needs legacy options — the create endpoint accepts none and the poll becomes a form,
    // which is what every question kind beyond a single choice requires anyway. Inventing
    // "Option 1" and "Option 2" for a poll that would never use them, and then hiding them,
    // was the shape this replaces.
    const build = !editing ? qs.map((q) => ({
      kind: q.kind, label: (q.label || '').trim(), help: q.help || '',
      required: IS_NOTE(q.kind) ? false : !!q.required, config: q.config || {}, showIf: q.showIf || null,
      choices: HAS_CHOICES(q.kind) ? (q.choices || []).filter((c) => c.label.trim()).map((c) => ({ label: c.label.trim() })) : [],
    })) : null;
    if (build) {
      if (!build.length) return toast.error(t('apoll.needquestion', 'Add at least one question.'));
      if (build.some((q) => !q.label)) return toast.error(t('apq.needlabel', 'Every question needs a label.'));
      if (build.some((q) => HAS_CHOICES(q.kind) && q.choices.length < 2)) {
        return toast.error(t('apq.need2', 'A choice question needs at least two choices.'));
      }
      if (build.some((q) => q.kind === 'grid' && !(q.config.rows || []).filter(Boolean).length)) {
        return toast.error(t('apq.grid.needrow', 'A grid needs at least one row.'));
      }
    }
    setBusy(true);
    try {
      const body = {
        question: d.question.trim(), description: d.description.trim(),
        audience: d.audience, multiple: d.multiple, maxChoices: Number(d.maxChoices) || 0,
        status: d.status, results: d.results, pinned: d.pinned,
        closesAt: d.closesAt ? new Date(d.closesAt).toISOString() : null,
        // Never sent once somebody has answered — the API refuses it anyway, and sending it
        // would turn a saved title edit into a 409 the admin cannot explain.
        // On CREATE it is an empty list: the questions below carry the poll.
        ...(locked ? {} : { options: editing ? options : [] }),
      };
      let created = null;
      if (editing) await api.put(`/admin/polls/${initial.id}`, body);
      else created = await api.post('/admin/polls', body);
      // The questions go in the SAME breath as the poll, before anything is reported saved.
      // Two steps meant a poll could exist for a moment with none, and "New poll" produced a
      // one-question poll unless you knew to press a second button afterwards.
      const madeId = created?.poll?.id || created?.id;
      if (build && madeId) await api.put(`/admin/polls/${madeId}/questions`, { questions: build });
      toast.success(t('common.saved', 'Saved.'));
      onSaved();
      onClose();
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

        {/* The QUESTIONS, here, while the poll is being made — not behind a second button on
            a row that does not exist yet. Every kind is available from the start: a choice, a
            scale, a ranking, a grid, a date, free text, or a note that takes no answer at all.
            The old screen offered a title and two blank option boxes, which quietly decided
            the poll was a single choice before anybody had said so. */}
        {!editing ? (
          <Field label={t('apoll.questions', 'Questions')}
            hint={t('apoll.questions.h', 'Every kind is available. A note is content rather than a question — a heading or an explanation between two of them.')}>
            <QuestionList qs={qs} setQs={setQs} t={t} />
          </Field>
        ) : (
          <Field label={t('apoll.options', 'Options')} hint={locked ? t('apoll.locked', 'People have already answered — the options can no longer be changed.') : t('apoll.options.h', 'The original single-choice shape. Use the Questions button on the row to add more than one question.')}>
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
        )}

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

        <div className="flex flex-wrap gap-2 pt-1 items-center">
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button>
          <Button onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        </div>
      </div>
    </Modal>
  );
}

const KINDS = ['choice', 'text', 'scale', 'number', 'date', 'ranking', 'grid', 'note'];
// A note is CONTENT, not a question: a heading, an explanation, a warning before the part that
// matters. It takes no answer, so it can never be required and never has choices — and the
// editor has to say so, or somebody ticks Required on a note and no submission is ever
// complete again.
const IS_NOTE = (k) => k === 'note';
// All three are answered by picking from a fixed list, so all three need the choices editor and
// all three need at least two of them — one thing to rank is not a ranking, and a grid with one
// column is a list of rows nobody can disagree about. For a grid the choices are its COLUMNS;
// its rows are labels in config.rows.
const HAS_CHOICES = (k) => k === 'choice' || k === 'ranking' || k === 'grid';
// What a note's body is called on screen. It is the content, not a hint about an answer.
const HELP_LABEL = (k, t) => IS_NOTE(k) ? t('apq.note.body', 'Text (markdown)') : t('apq.help', 'Hint');
const newQuestion = () => ({ kind: 'choice', label: '', help: '', required: false, config: {}, showIf: null, choices: [{ label: '' }, { label: '' }] });

/**
 * The question list, and every control for one question.
 *
 * Extracted because it is now used TWICE — by the editor that changes an existing poll's
 * questions, and by the new-poll screen that builds them before the poll exists. It is the
 * largest piece of UI in this file, and two copies of it would be two places to add the next
 * question kind, one of which somebody would miss.
 *
 * State lives with the caller: this renders `qs` and calls `setQs`. It owns no saving, no
 * endpoint and no modal, so the two callers can each decide what saving means.
 */
function QuestionList({ qs, setQs, t }) {
  const patch = (i, k, v) => setQs((x) => x.map((q, j) => (j === i ? { ...q, [k]: v } : q)));
  const move = (i, d) => setQs((x) => {
    const j = i + d; if (j < 0 || j >= x.length) return x;
    const c = [...x]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  return (<>
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
          {/* `help` was carried by the API, sent by the editor and editable NOWHERE — so
              every question shipped with an empty hint and no way to fill one. It is also
              where a note keeps its body, which is why the label changes with the kind:
              on a question it is a hint, on a note it IS the content. */}
          <Textarea rows={IS_NOTE(q.kind) ? 4 : 2} value={q.help || ''}
            onChange={(e) => patch(i, 'help', e.target.value)}
            placeholder={HELP_LABEL(q.kind, t)} />
          {IS_NOTE(q.kind) && (
            <div className="text-[11px] text-[var(--muted)]">
              {t('apq.note.hint', 'Rendered with the site’s markdown — links, lists and emphasis all work. The title above is optional.')}
            </div>
          )}
          <div className="flex items-center gap-3 text-xs">
            {/* Not offered on a note: it takes no answer, so "required" could never be
                met and every submission would count as incomplete for ever. */}
            {!IS_NOTE(q.kind) && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={q.required} onChange={(e) => patch(i, 'required', e.target.checked)} />
                {t('apq.required', 'Required')}
              </label>
            )}
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
          {/* A grid's ROWS. Labels, not answerable things, so they live in config rather than
              a table — and they have to be editable here or the kind is reachable by the API
              and by nothing a human uses, which is how `ranking` shipped unsaveable. */}
          {q.kind === 'grid' && (() => {
            const rows = Array.isArray(q.config?.rows) ? q.config.rows : [];
            const setRows = (r) => patch(i, 'config', { ...q.config, rows: r });
            return (
              <div className="space-y-1.5 pl-7">
                <div className="text-xs text-[var(--muted)]">{t('apq.grid.rows', 'Rows (the options above are the columns)')}</div>
                {rows.map((r, ri) => (
                  <div key={ri} className="flex gap-2">
                    <Input value={r} placeholder={`${t('apq.grid.row', 'Row')} ${ri + 1}`}
                      onChange={(e) => setRows(rows.map((x, j) => (j === ri ? e.target.value : x)))} />
                    <Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== ri))}><Trash2 size={14} /></Button>
                  </div>
                ))}
                {rows.length < 20 && (
                  <Button size="sm" variant="ghost" onClick={() => setRows([...rows, ''])}>
                    <Plus size={13} /> {t('apq.grid.addrow', 'Add a row')}
                  </Button>
                )}
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox"
                    checked={q.config?.requireAllRows ?? !!q.required}
                    onChange={(e) => patch(i, 'config', { ...q.config, requireAllRows: e.target.checked })} />
                  {t('apq.grid.all', 'Every row must be answered')}
                </label>
              </div>
            );
          })()}
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
  </>);
}

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
  const [qs, setQs] = useState(() => {
    const existing = (poll.questions || []).map((q) => ({
      id: q.id, kind: q.kind, label: q.label, help: q.help || '', required: !!q.required,
      config: q.config || {}, showIf: q.showIf || null,
      choices: (q.choices || []).map((c) => ({ id: c.id, label: c.label })),
      answers: q.answers || 0,
    }));
    if (existing.length) return existing;
    // A poll that has no questions yet — a freshly created one — starts from the question it
    // was created WITH. Without this the thing you just typed is not in the form: it stays the
    // poll's title and its options belong to the legacy vote path, so adding a second question
    // would silently drop the first.
    const opts = (poll.options || []).map((o) => ({ label: o.label ?? String(o) })).filter((o) => o.label);
    if (!opts.length) return [];
    return [{
      kind: 'choice', label: poll.question || poll.title || '', help: '', required: false,
      config: { multiple: !!poll.multiple, ...(poll.maxChoices ? { maxChoices: Number(poll.maxChoices) } : {}) },
      showIf: null, choices: opts, answers: 0,
    }];
  });
  const [saving, setSaving] = useState(false);
  // What the server said an edit would destroy. Held rather than thrown away, because the
  // second attempt has to be the user CONFIRMING this exact list — not a blind retry.
  const [conflict, setConflict] = useState(null);

  // patch/move moved into QuestionList with the markup that used them.

  const save = async (force) => {
    const body = {
      force: !!force,
      questions: qs.map((q) => ({
        ...(q.id ? { id: q.id } : {}), kind: q.kind, label: q.label.trim(), help: q.help,
        // Forced false rather than trusted: switching an existing required question to a note
        // would otherwise keep the flag, and nothing on screen would still show it.
        required: IS_NOTE(q.kind) ? false : q.required, showIf: q.showIf,
        // Blank rows are dropped rather than saved: an empty row label renders an unlabelled
        // line people are asked to rate, and the row indices answers are stored against shift
        // the moment someone tidies it up later.
        config: q.kind === 'grid'
          ? { ...q.config, rows: (Array.isArray(q.config?.rows) ? q.config.rows : []).map((r) => String(r).trim()).filter(Boolean) }
          : q.config,
        choices: HAS_CHOICES(q.kind) ? q.choices.filter((c) => c.label.trim()).map((c) => ({ ...(c.id ? { id: c.id } : {}), label: c.label.trim() })) : [],
      })),
    };
    if (body.questions.some((q) => !q.label)) return toast.error(t('apq.needlabel', 'Every question needs a label.'));
    if (body.questions.some((q) => HAS_CHOICES(q.kind) && q.choices.length < 2)) {
      return toast.error(t('apq.need2', 'A choice question needs at least two choices.'));
    }
    // A grid with no rows is answerable by nobody, and the server refuses an answer to one with
    // `no_rows` — refusing it here names the question instead of failing at the first voter.
    if (body.questions.some((q) => q.kind === 'grid' && !q.config.rows.length)) {
      return toast.error(t('apq.grid.needrow', 'A grid needs at least one row.'));
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
      else if (x?.data?.error === 'unknown_question' || x?.data?.error === 'unknown_choice') toast.error(t('apq.unknown', 'A question in this form does not belong to this poll. Reload and try again.'));
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
              {/* Deleted OPTIONS, listed separately. Their question survives, so a count with no
                  question beside it reads as a bug rather than as the cost of removing an option. */}
              {(conflict.choices || []).map((c) => (
                <li key={c.choiceId}>
                  · {t('apq.lose.opt', 'Option “{o}” of “{q}”')
                    .replace('{o}', c.label)
                    .replace('{q}', qs.find((q) => q.id === c.questionId)?.label || c.questionId)}
                  {' — '}{t('apq.lose.n', '{n} answer(s)').replace('{n}', String(c.answers))}
                </li>
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

        <QuestionList qs={qs} setQs={setQs} t={t} />

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

/**
 * A per-question tally, as bars.
 *
 * Scaled against the biggest row in THIS tally, not against the voter count: a grid row where
 * everyone picked the same column would otherwise draw one full bar and nothing else, which is
 * true but unreadable. The number beside it is the count, so the bar is the comparison and the
 * digit is the fact.
 */
// ── Charts ────────────────────────────────────────────────────────────────────
//
// Two, and only where a shape says something a number cannot: turnout OVER TIME, and the
// SPREAD of a rating. Everything else on this screen stays a labelled bar, because a tally of
// four options is a list and drawing it as a pie would make it harder to read, not easier.
//
// Both are single-series, so neither gets a legend — the heading names it. Both carry visible
// numbers rather than relying on the mark: the brand orange measures 2.1:1 against the light
// surface, which the palette check flags as needing that relief, and a bar you cannot see the
// edge of is not carrying the value on its own.
const CHART_INK = 'var(--primary)';

/** Votes per day. A shape — "it moved for three days and stopped" — that a total cannot show. */
function Timeline({ days }) {
  const { t } = useI18n();
  if (!days || days.length < 2) return null;
  const W = 320, H = 64, PAD = 6;
  const max = Math.max(1, ...days.map((d) => d.votes));
  const x = (i) => PAD + (i * (W - PAD * 2)) / (days.length - 1);
  const y = (v) => H - PAD - (v / max) * (H - PAD * 2);
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.votes).toFixed(1)}`).join(' ');
  const area = `${line} L${x(days.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  const peak = days.reduce((a, b) => (b.votes > a.votes ? b : a), days[0]);
  return (
    <div className="mt-3">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('apoll.ch.timeline', 'Answers per day')}</span>
        <span className="text-[11px] text-[var(--muted)] tabular-nums ml-auto">
          {t('apoll.ch.peak', 'peak {n} on {d}').replace('{n}', String(peak.votes)).replace('{d}', peak.day)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" role="img"
        aria-label={t('apoll.ch.timeline.a11y', 'Answers per day, {n} days, peak {p}').replace('{n}', String(days.length)).replace('{p}', String(peak.votes))}>
        <path d={area} fill={CHART_INK} opacity="0.14" />
        {/* 2px, and the only stroked mark here — a grid would compete with it at this size. */}
        <path d={line} fill="none" stroke={CHART_INK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {days.map((d, i) => (
          // Markers are the hover targets, so they are 8px of hit area even though only the
          // peak is painted. A bare line has nothing to point at.
          <circle key={d.day} cx={x(i)} cy={y(d.votes)} r={d === peak ? 3 : 4}
            fill={d === peak ? CHART_INK : 'transparent'} stroke="none">
            <title>{`${d.day} — ${d.votes}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--faint)] tabular-nums">
        <span>{days[0].day}</span><span>{days[days.length - 1].day}</span>
      </div>
    </div>
  );
}

/**
 * How a rating was spread.
 *
 * The mean is one number and hides the shape people argue about: 1s and 5s average to the same
 * 3 as everybody answering 3, and those are opposite results. Columns, in SCALE order — sorting
 * by size would destroy the only axis this data has.
 */
function Distribution({ dist, min, max }) {
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

function QTally({ rows }) {
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

      {/* d.stats.timeline, not d.timeline — which is what I wrote first, and it rendered
          nothing at all: Timeline returns null on fewer than two points, so an undefined field
          looks exactly like a poll answered on one day. `byDay` beside it carries the same days
          split signed-in / anonymous; the split is already stated in words above, so the chart
          shows the total and stays one series. */}
      <Timeline days={d.stats?.timeline} />

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

      {/* Per-question results. The API has served these since the stats library landed and no
          screen read them — a whole feature reachable by curl and by nothing else. Rendered
          beside the legacy byOption bars rather than instead of them, because a backfilled poll
          answers both ways and the two agree. */}
      {(d.questions || []).length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--line)] space-y-3">
          {d.completion && (
            <div className="text-[12px] text-[var(--muted)]">
              {t('apoll.completion', '{c} of {s} finished every required question ({p}%).')
                .replace('{c}', String(d.completion.completed)).replace('{s}', String(d.completion.started))
                .replace('{p}', String(Math.round((d.completion.rate || 0) * 100)))}
            </div>
          )}
          {d.questions.map((q) => (
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
              {/* Average rank, best first — lower is better, so the number is labelled rather
                  than drawn as a bar, where longer would read as better and mean the opposite. */}
              {q.ranking && (
                <ol className="mt-1 space-y-0.5">
                  {q.ranking.map((r, i) => (
                    <li key={r.id} className="flex items-baseline gap-2 text-[12px]">
                      <span className="w-4 text-[var(--faint)] tabular-nums">{i + 1}</span>
                      <span className="flex-1 min-w-0 truncate">{r.label}</span>
                      <span className="tabular-nums text-[var(--muted)]">
                        {r.averageRank === null ? '—' : Math.round(r.averageRank * 100) / 100}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {/* One tally per row, never summed across rows: averaging "Speed: good, Docs: bad"
                  into one number answers a question nobody asked. */}
              {q.grid && (
                <div className="mt-1 space-y-1.5">
                  {q.grid.map((row) => (
                    <div key={row.row}>
                      <div className="text-[12px] text-[var(--muted)]">{row.label}</div>
                      <QTally rows={row.tally} />
                    </div>
                  ))}
                </div>
              )}
              {q.answered !== undefined && (
                <div className="text-[12px] text-[var(--muted)] mt-0.5">
                  {t('apoll.q.answered', '{n} answered').replace('{n}', String(q.answered))}
                  {q.earliest && ` · ${new Date(q.earliest).toLocaleDateString()} → ${new Date(q.latest).toLocaleDateString()}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
