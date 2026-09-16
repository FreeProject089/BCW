// One task, opened: what it says, who has it, and everything that happened to it.
//
// The buttons are drawn from the `can` object the API sends with the task, which the API
// builds from lib/tasks.mjs. The screen never re-derives "may I reassign this" from the role
// and the team, because a rule written twice is a rule that will disagree with itself, and
// the half that disagrees here is the half that draws an enabled button over a 403.
import { useState } from 'react';
import { History, Send, Trash2, UserCheck, UserMinus, Save, X, CalendarClock, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import Markdown from '../ui/md.jsx';
import { Modal, Button, Input, Textarea, Field, Badge, Dropdown, Spinner, Explain, useToast, useDialog } from '../ui/ui.jsx';
import { useAsync } from './pages.jsx';
import { STATE_META, PRIORITY_META, stateLabel, priorityLabel, eventLabel, shortDate, shortDateTime, toLocalInput, fromLocalInput } from './admin-tasks-vocab.jsx';

/** The history, oldest first, as sentences. Read-only and append-only: nothing here is editable. */
function Timeline({ events, nameOf, t }) {
  if (!events.length) return null;
  return (
    <ol className="space-y-2.5">
      {events.map((e) => (
        <li key={e.id} className="panel-quiet rounded-xl border border-[var(--line)] p-2.5">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
            <span className="font-semibold">{nameOf(e.actorId)}</span>
            <span className="text-[var(--muted)]">{eventLabel(t, e, nameOf)}</span>
            <span className="text-[var(--faint)] ms-auto">{shortDateTime(e.createdAt)}</span>
          </div>
          {e.kind === 'note' && e.note
            ? <div className="mt-1.5 text-sm"><Markdown>{e.note}</Markdown></div>
            : e.note ? <div className="mt-1 text-xs text-[var(--muted)] break-words">{e.note}</div> : null}
        </li>
      ))}
    </ol>
  );
}

export function TaskDetail({ id, onClose, onChanged }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get(`/admin/tasks/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState(null);

  const task = data?.task || null;
  const people = data?.people || {};
  const nameOf = (uid) => (uid ? (people[uid]?.displayName || t('atask.unknown', 'Unknown account')) : t('atask.nobody', 'Nobody'));

  // Every mutation goes through here so the failure story is written once: the board behind
  // reloads too, because a state change that is only visible in the modal is a state change
  // the person will doubt the moment they close it.
  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      await reload(true);
      onChanged?.();
      if (okMsg) toast.success(okMsg);
    } catch {
      toast.error(t('atask.err', 'That did not go through. Refresh and try again.'));
    } finally { setBusy(false); }
  };

  const saveEdit = () => run(async () => {
    await api.patch(`/admin/tasks/${id}`, {
      title: edit.title.trim(), body: edit.body,
      priority: edit.priority, dueAt: fromLocalInput(edit.dueAt),
    });
    setEdit(null);
  }, t('atask.saved', 'Saved.'));

  const remove = async () => {
    const ok = await dialog.confirm({
      title: t('atask.del.t', 'Delete this task'),
      message: t('atask.del.m', 'This removes the task and its whole history, for everyone. Cancelling it instead keeps the record of why it stopped.'),
      danger: true,
    });
    if (!ok) return;
    await run(() => api.del(`/admin/tasks/${id}`));
    onClose();
  };

  const can = task?.can || {};
  const StateIcon = task ? (STATE_META[task.state]?.icon || null) : null;
  const assignOptions = task ? [
    { value: '', label: t('atask.pool', 'Back to the team pool') },
    ...(task.assignable || []).map((uid) => ({ value: uid, label: people[uid]?.displayName || uid })),
  ] : [];

  return (
    <Modal open onClose={onClose} title={task ? task.title : t('atask.loading', 'Opening the task')} icon={StateIcon || History} width="max-w-2xl"
      footer={<div className="flex flex-wrap items-center gap-2">
        {can.del && <Button variant="danger" size="sm" onClick={remove} disabled={busy}><Trash2 size={14} />{t('atask.delete', 'Delete')}</Button>}
        <Button size="sm" className="ms-auto" onClick={onClose}>{t('atask.close', 'Close')}</Button>
      </div>}>
      {loading || !task ? <div className="py-8 grid place-items-center"><Spinner /></div> : (
        <div className="space-y-4">
          {/* Where it stands, at a glance. Wraps rather than scrolls on a phone. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATE_META[task.state]?.tone}>{stateLabel(t, task.state)}</Badge>
            <Badge tone={PRIORITY_META[task.priority]?.tone}>{priorityLabel(t, task.priority)}</Badge>
            {task.assigneeId
              ? <Badge><UserCheck size={11} className="me-1" />{nameOf(task.assigneeId)}</Badge>
              : <Badge tone="amber"><UserMinus size={11} className="me-1" />{t('atask.unassigned', 'Unassigned')}</Badge>}
            {task.dueAt && (
              <Badge tone={task.overdue ? 'red' : ''} title={t('atask.due.title', 'Due date')}>
                <CalendarClock size={11} className="me-1" />{shortDate(task.dueAt)}
              </Badge>
            )}
          </div>

          {task.overdue && (
            <div className="tint-warning b-warning border rounded-xl p-2.5 text-xs flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-warning" />
              <span>{t('atask.overdue.msg', 'This one is past its due date and still open.')}</span>
            </div>
          )}

          {/* The body. Markdown, rendered by the site's own renderer, so a task can carry a
              checklist, a code block or a link to the thing it is about. */}
          {edit ? (
            <div className="space-y-3">
              <Field label={t('atask.f.title', 'Title')}>
                <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={160} />
              </Field>
              <Field label={t('atask.f.body', 'Details')} hint={t('atask.f.body.h', 'Markdown works here, the same as on the blog.')}>
                <Textarea rows={8} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
              </Field>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label={t('atask.f.prio', 'Priority')}>
                  <Dropdown value={edit.priority} onChange={(v) => setEdit({ ...edit, priority: v })}
                    options={Object.keys(PRIORITY_META).map((p) => ({ value: p, label: priorityLabel(t, p) }))} />
                </Field>
                <Field label={t('atask.f.due', 'Due date')}>
                  <Input type="datetime-local" value={edit.dueAt} onChange={(e) => setEdit({ ...edit, dueAt: e.target.value })} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" onClick={saveEdit} loading={busy}><Save size={14} />{t('atask.save', 'Save')}</Button>
                <Button size="sm" onClick={() => setEdit(null)}><X size={14} />{t('atask.cancel', 'Cancel')}</Button>
              </div>
            </div>
          ) : (
            <div className="panel rounded-xl border border-[var(--line)] p-3">
              {task.body
                ? <Markdown>{task.body}</Markdown>
                : <p className="text-sm text-[var(--muted)]">{t('atask.nobody.body', 'No details were written.')}</p>}
              {can.edit && (
                <Button size="sm" className="mt-3" onClick={() => setEdit({ title: task.title, body: task.body, priority: task.priority, dueAt: toLocalInput(task.dueAt) })}>
                  {t('atask.edit', 'Edit')}
                </Button>
              )}
            </div>
          )}

          {/* What I may actually do, and nothing I may not. */}
          <div className="grid sm:grid-cols-2 gap-3">
            {(task.states || []).length > 0 && (
              <Field label={t('atask.f.move', 'Move it to')}>
                <Dropdown value="" placeholder={t('atask.f.move.ph', 'Pick a state')}
                  options={(task.states || []).map((s) => ({ value: s, label: stateLabel(t, s) }))}
                  onChange={(v) => run(() => api.post(`/admin/tasks/${id}/state`, { state: v }), t('atask.moved', 'State updated.'))} />
              </Field>
            )}
            {/* A dropdown for whoever may DISPATCH, and a single button for whoever may only
                hand it back. Not one control with a trimmed option list: the release-only
                case would then render two options sharing the empty value, which is a
                duplicate React key and a menu with the same row twice. */}
            {can.assign ? (
              <Field label={t('atask.f.assign', 'Assigned to')}>
                <Dropdown value={task.assigneeId || ''} options={assignOptions}
                  onChange={(v) => run(() => api.post(`/admin/tasks/${id}/assign`, { userId: v || null }), t('atask.assigned', 'Assignment updated.'))} />
              </Field>
            ) : can.release && task.assigneeId ? (
              <Field label={t('atask.f.assign', 'Assigned to')}>
                <Button size="sm" disabled={busy}
                  onClick={() => run(() => api.post(`/admin/tasks/${id}/assign`, { userId: null }), t('atask.assigned', 'Assignment updated.'))}>
                  <UserMinus size={14} />{t('atask.pool', 'Back to the team pool')}
                </Button>
              </Field>
            ) : null}
          </div>

          <Explain summary={t('atask.rules.s', 'Who can change what on this task.')}>
            <p>{t('atask.rules.1', 'The person a task is assigned to moves it through the states and can always hand it back to the team pool. They cannot hand it to somebody else, and they cannot cancel it.')}</p>
            <p>{t('atask.rules.2', 'The team chief hands the work out inside their own team, changes the priority and the due date, and closes or cancels. An admin does all of that across every team, and is the only one who can move a task between teams or delete it outright.')}</p>
            <p>{t('atask.rules.3', 'Nothing in the history below is ever edited or removed. Cancelling keeps the record of why the work stopped; deleting does not, which is why it is an admin action.')}</p>
          </Explain>

          {/* The history. Below the controls on purpose: it is the answer to "what happened",
              which is the second question, not the first. */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-sm font-semibold"><History size={15} className="text-[var(--muted)]" />{t('atask.history', 'History')}</div>
            <Timeline events={data?.events || []} nameOf={nameOf} t={t} />
          </div>

          {can.comment && (
            <div className="flex flex-col sm:flex-row gap-2">
              <Textarea rows={2} className="flex-1" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={t('atask.note.ph', 'Add a note, markdown works')} aria-label={t('atask.note.aria', 'Write a note on this task')} />
              <Button variant="primary" size="sm" className="sm:self-end" disabled={!note.trim() || busy}
                onClick={() => run(async () => { await api.post(`/admin/tasks/${id}/note`, { note: note.trim() }); setNote(''); })}>
                <Send size={14} />{t('atask.note.send', 'Post')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default TaskDetail;
