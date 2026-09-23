// One task, opened: what it says, who has it, and everything that happened to it.
//
// The buttons are drawn from the `can` object the API sends with the task, which the API
// builds from lib/tasks.mjs. The screen never re-derives "may I reassign this" from the role
// and the team, because a rule written twice is a rule that will disagree with itself, and
// the half that disagrees here is the half that draws an enabled button over a 403.
import { useEffect, useState } from 'react';
import { History, Send, Trash2, UserCheck, UserMinus, UserPlus, Save, X, CalendarClock, AlertTriangle, Link2, Search, Check, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import Markdown from '../ui/md.jsx';
import { Modal, Button, Input, Textarea, Field, Badge, Dropdown, Spinner, Explain, useToast, useDialog } from '../ui/ui.jsx';
import { useAsync } from './pages.jsx';
import { STATE_META, PRIORITY_META, stateLabel, priorityLabel, eventLabel, linkLabel, shortDate, shortDateTime, toLocalInput, fromLocalInput } from './admin-tasks-vocab.jsx';

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

/**
 * Links to other tasks: blocks, blocked by, related. The server refuses a link that would
 * close a loop of "blocks", and a linked task this account cannot read is shown as exactly
 * that, never by its title.
 */
function Links({ task, can, onOpen, run, t }) {
  const [kind, setKind] = useState('blocked_by');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const term = q.trim();
    if (!adding || term.length < 2) { setHits([]); return undefined; }
    let alive = true;
    const id = setTimeout(() => {
      api.get(`/admin/tasks?scope=all&q=${encodeURIComponent(term)}&exclude=${encodeURIComponent(task.id)}`)
        .then((r) => { if (alive) setHits((r.tasks || []).slice(0, 8)); })
        .catch(() => { if (alive) setHits([]); });
    }, 300);
    return () => { alive = false; clearTimeout(id); };
  }, [q, adding, task.id]);

  const add = async (other) => {
    try {
      await api.post(`/admin/tasks/${task.id}/links`, { otherId: other.id, kind });
      setQ(''); setHits([]); setAdding(false);
      await run(async () => {});
    } catch (x) {
      const code = x?.data?.error;
      toast.error(code === 'link_cycle'
        ? t('atask.link.e.cycle', 'That would make a loop: the other task already waits on this one, directly or further down the chain.')
        : code === 'already_linked'
          ? t('atask.link.e.dup', 'Those two are already linked that way.')
          : t('atask.err', 'That did not go through. Refresh and try again.'));
    }
  };

  const links = task.links || [];
  if (!links.length && !can.link) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-sm font-semibold"><Link2 size={15} className="text-[var(--muted)]" />{t('atask.links', 'Linked tasks')}</div>
      {task.openBlockers > 0 && (
        <div className="tint-warning b-warning border rounded-xl p-2.5 text-xs flex items-start gap-2 mb-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-warning" />
          <span>{t('atask.link.waiting', 'Still waiting on {n} open task(s) that block this one.').replace('{n}', String(task.openBlockers))}</span>
        </div>
      )}
      {links.length > 0 && (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.id} className="panel-quiet rounded-xl border border-[var(--line)] px-2.5 py-1.5 flex items-center gap-2 text-sm">
              <Badge>{linkLabel(t, l.kind)}</Badge>
              {l.task ? (
                <button type="button" onClick={() => onOpen?.(l.task.id)} className="min-w-0 flex-1 text-start hover:underline">
                  <span className="block truncate" title={l.task.title}>{l.task.title}</span>
                </button>
              ) : (
                <span className="min-w-0 flex-1 text-[var(--muted)] inline-flex items-center gap-1"><Lock size={12} aria-hidden="true" />{t('atask.link.hidden', 'A task you cannot open')}</span>
              )}
              {l.task && <Badge tone={STATE_META[l.task.state]?.tone}>{stateLabel(t, l.task.state)}</Badge>}
              {can.link && (
                // undo: a link is two ids and a kind, both still on screen; adding it back is one
                // search below, and the history keeps both the link and the unlink.
                <button type="button" className="shrink-0 p-1 text-[var(--faint)] hover:text-error"
                  onClick={() => run(() => api.del(`/admin/tasks/${task.id}/links/${l.id}`))}
                  title={t('atask.link.rm', 'Remove this link')} aria-label={t('atask.link.rm', 'Remove this link')}>
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {can.link && (adding ? (
        <div className="mt-2 rounded-xl border border-[var(--line)] p-2.5 space-y-2" style={{ background: 'var(--surface)' }}>
          <div className="flex flex-wrap gap-2">
            <Dropdown size="sm" value={kind} onChange={setKind} options={[
              { value: 'blocked_by', label: t('atask.link.k.blocked_by', 'Blocked by') },
              { value: 'blocks', label: t('atask.link.k.blocks', 'Blocks') },
              { value: 'relates', label: t('atask.link.k.relates', 'Related to') },
            ]} />
            <div className="relative flex-1 min-w-[10rem]">
              <Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" aria-hidden="true" />
              <Input value={q} autoFocus onChange={(e) => setQ(e.target.value)} className="!ps-8" maxLength={80}
                placeholder={t('atask.link.ph', 'Search a task by its title')} aria-label={t('atask.link.ph', 'Search a task by its title')} />
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setQ(''); }}>{t('atask.cancel', 'Cancel')}</Button>
          </div>
          {hits.length > 0 && (
            <div className="rounded-lg border border-[var(--line)] divide-y divide-[var(--line)] max-h-56 overflow-y-auto" style={{ background: 'var(--bg-solid)' }}>
              {hits.map((h) => (
                <button key={h.id} type="button" onClick={() => add(h)} className="w-full text-start px-3 py-2 hover:bg-[var(--surface-2)] transition flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={h.title}>{h.title}</span>
                  <Badge tone={STATE_META[h.state]?.tone}>{stateLabel(t, h.state)}</Badge>
                  <Check size={13} className="shrink-0 text-[var(--faint)]" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Button size="sm" className="mt-2" onClick={() => setAdding(true)}><Link2 size={14} />{t('atask.link.add', 'Link a task')}</Button>
      ))}
    </div>
  );
}

export function TaskDetail({ id, me, onClose, onChanged }) {
  // The task on screen. A linked task opens in the same dialog rather than stacking another.
  const [openId, setOpenId] = useState(id);
  useEffect(() => { setOpenId(id); }, [id]);
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get(`/admin/tasks/${openId}`), [openId]);
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
    await api.patch(`/admin/tasks/${openId}`, {
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
    await run(() => api.del(`/admin/tasks/${openId}`));
    onClose();
  };

  const can = task?.can || {};
  const StateIcon = task ? (STATE_META[task.state]?.icon || null) : null;
  const on = task?.assigneeIds || [];
  // Everybody who may be offered: the people already on it (so a dispatcher can take them
  // off even if they left the team) and whoever the server says is assignable.
  const offer = task ? [...new Set([...on, ...(task.assignable || [])])] : [];
  const setPeople = (next) => run(() => api.post(`/admin/tasks/${task.id}/assign`, { userIds: next }), t('atask.assigned', 'Assignment updated.'));

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
            {on.length
              ? on.map((uid) => <Badge key={uid}><UserCheck size={11} className="me-1" />{nameOf(uid)}</Badge>)
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
                  onChange={(v) => run(() => api.post(`/admin/tasks/${openId}/state`, { state: v }), t('atask.moved', 'State updated.'))} />
              </Field>
            )}
            {/* Toggles for whoever may DISPATCH (each click sends the whole new list), and one
                button for whoever may only take themselves off, or take it from the pool. */}
            {can.assign ? (
              <Field label={t('atask.f.assign.many', 'People on it')}>
                <div className="flex flex-wrap gap-1.5">
                  {offer.map((uid) => {
                    const onIt = on.includes(uid);
                    return (
                      <button key={uid} type="button" aria-pressed={onIt} disabled={busy}
                        onClick={() => setPeople(onIt ? on.filter((x) => x !== uid) : [...on, uid])}
                        className={`badge ${onIt ? 'badge-primary' : ''}`}>
                        {onIt ? <Check size={11} className="me-1" /> : <UserPlus size={11} className="me-1" />}{nameOf(uid)}
                      </button>
                    );
                  })}
                  {!offer.length && <span className="text-xs text-[var(--faint)]">{t('atask.f.assign.nobody', 'Nobody on this task’s team yet.')}</span>}
                </div>
              </Field>
            ) : can.release && on.includes(me) ? (
              <Field label={t('atask.f.assign.many', 'People on it')}>
                <Button size="sm" disabled={busy} onClick={() => setPeople(on.filter((x) => x !== me))}>
                  <UserMinus size={14} />{t('atask.release.me', 'Take me off it')}
                </Button>
              </Field>
            ) : can.grab ? (
              <Field label={t('atask.f.assign.many', 'People on it')}>
                <Button size="sm" disabled={busy} onClick={() => setPeople([me])}>
                  <UserPlus size={14} />{t('atask.grab', 'Take it')}
                </Button>
              </Field>
            ) : null}
          </div>

          <Links task={task} can={can} onOpen={setOpenId} run={run} t={t} />

          <Explain summary={t('atask.rules.s', 'Who can change what on this task.')}>
            <p>{t('atask.rules.1b', 'The people on a task move it through the states, and each can always take themselves off it. They cannot put somebody else on it, and they cannot cancel it.')}</p>
            <p>{t('atask.rules.2b', 'The team chief hands the work out inside their own team, changes the priority and the due date, and closes or cancels. A dispatcher does all of that across every team and can move a task between teams. Deleting a task outright is for admins only.')}</p>
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
                onClick={() => run(async () => { await api.post(`/admin/tasks/${openId}/note`, { note: note.trim() }); setNote(''); })}>
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
