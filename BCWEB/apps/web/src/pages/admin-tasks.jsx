// The staff task board.
//
// What the screen is FOR: an admin or a chief hands work to a named person, and that person
// can see, in one place, what is on them. So the board opens on "Mine" rather than on
// everything: a queue that shows all of the staff's work first is a queue nobody reads, and
// the whole point of assigning a task is that somebody knows it is theirs.
//
// Three house rules this file obeys, each of which has a gate behind it:
//   · surfaces are `.panel` / `.panel-quiet` / `.tint-*` / `.b-*`, never a Tailwind alpha on
//     a CSS variable: a `/40` suffix on a `var()` arbitrary value emits no rule at all in
//     Tailwind 3, so the element is drawn with no background whatsoever;
//   · the accent is a fill, not an ink: `text-[var(--accent-ink)]`, never the accent token
//     itself, which measures 2.15:1 on white;
//   · every string is `t(key, 'English')` with the French in i18n.jsx, including the ones in
//     `title=` and `aria-label=`, which are the two the checker cannot see.
import { useState } from 'react';
import { ClipboardList, Plus, Users, LayoutList, Search, UserCheck, UserMinus, CalendarClock, Filter, Lightbulb, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Textarea, Field, Badge, Modal, Dropdown, EmptyState, Spinner, Explain, useToast } from '../ui/ui.jsx';
import { useAsync } from './pages.jsx';
import { STATE_META, PRIORITY_META, stateLabel, priorityLabel, shortDate, fromLocalInput } from './admin-tasks-vocab.jsx';
import { TaskDetail } from './admin-tasks-detail.jsx';
import { AdminTaskTeams } from './admin-tasks-teams.jsx';
import { AdminTaskProposals } from './admin-tasks-proposals.jsx';

/** The sidebar icon, re-exported so adding this tab to admin.jsx costs one import, not two:
 *  admin.jsx imports no clipboard icon today, and a second import line in a file five other
 *  people are editing is a second chance at a conflict. */
export const TASKS_TAB_ICON = ClipboardList;

const emptyDraft = () => ({ title: '', body: '', priority: 'normal', teamId: '', assigneeIds: [], dueAt: '' });

/** Up to three names, then "+N": a row must stay one line on a phone. */
function namesOf(ids, people, t, max = 3) {
  const names = ids.map((id) => people[id]?.displayName || t('atask.unknown', 'Unknown account'));
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');
}

/** One task, as a row you can scan: state, title, who has it, when it is due. */
function TaskRow({ task, people, teams, onOpen, t }) {
  const StateIcon = STATE_META[task.state]?.icon || ClipboardList;
  const team = teams.find((x) => x.id === task.teamId);
  const on = task.assigneeIds || [];
  const who = on.length ? namesOf(on, people, t) : null;
  return (
    <Card hover className="p-3 cursor-pointer" onClick={onOpen}>
      <div className="flex items-start gap-3">
        <StateIcon size={17} className="shrink-0 mt-0.5 text-[var(--muted)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate" title={task.title}>{task.title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={STATE_META[task.state]?.tone}>{stateLabel(t, task.state)}</Badge>
            <Badge tone={PRIORITY_META[task.priority]?.tone}>{priorityLabel(t, task.priority)}</Badge>
            {team && <Badge title={t('atask.card.team', 'Team')}><Users size={11} className="me-1" />{team.name}</Badge>}
            {who
              ? <Badge title={t('atask.card.assignee', 'Assigned to')}><UserCheck size={11} className="me-1" />{who}</Badge>
              : <Badge tone="amber"><UserMinus size={11} className="me-1" />{t('atask.unassigned', 'Unassigned')}</Badge>}
            {task.dueAt && (
              <Badge tone={task.overdue ? 'red' : ''} title={t('atask.due.title', 'Due date')}>
                <CalendarClock size={11} className="me-1" />{shortDate(task.dueAt)}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** The create form. Small on purpose: a task you cannot file in ten seconds is one nobody files. */
function TaskComposer({ open, meta, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [d, setD] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const teams = meta?.teams || [];
  const people = meta?.people || {};
  const mine = meta?.me || {};
  // Whom this composer may offer: a dispatcher picks anybody on a team, a chief picks inside
  // the team they lead, anybody may put themselves on it. The API checks the same thing and
  // refuses the rest, so an offer here that the API would reject is a bug in the offer.
  const canDispatch = (teamId) => !!mine.dispatcher || (mine.chiefOf || []).includes(teamId);
  const assignable = d.teamId && canDispatch(d.teamId)
    ? (teams.find((x) => x.id === d.teamId)?.memberIds || [])
    : [];

  const save = async () => {
    if (d.title.trim().length < 3) return toast.error(t('atask.need.title', 'Give the task a title first.'));
    setBusy(true);
    try {
      await api.post('/admin/tasks', {
        title: d.title.trim(), body: d.body, priority: d.priority,
        teamId: d.teamId || null, assigneeIds: d.assigneeIds, dueAt: fromLocalInput(d.dueAt),
      });
      setD(emptyDraft());
      onSaved();
      onClose();
    } catch {
      toast.error(t('atask.create.failed', 'The task could not be created. You may not be allowed to file it under that team.'));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} icon={ClipboardList} title={t('atask.new', 'New task')} width="max-w-xl"
      footer={<div className="flex gap-2 justify-end"><Button size="sm" onClick={onClose}>{t('atask.cancel', 'Cancel')}</Button><Button variant="primary" size="sm" onClick={save} loading={busy}>{t('atask.create', 'Create')}</Button></div>}>
      <div className="space-y-3">
        <Field label={t('atask.f.title', 'Title')}>
          <Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} maxLength={160}
            placeholder={t('atask.f.title.ph', 'What needs doing')} />
        </Field>
        <Field label={t('atask.f.body', 'Details')} hint={t('atask.f.body.h', 'Markdown works here, the same as on the blog.')}>
          <Textarea rows={6} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })}
            placeholder={t('atask.f.body.ph', 'Context, links, a checklist')} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('atask.f.prio', 'Priority')}>
            <Dropdown value={d.priority} onChange={(v) => setD({ ...d, priority: v })}
              options={Object.keys(PRIORITY_META).map((p) => ({ value: p, label: priorityLabel(t, p) }))} />
          </Field>
          <Field label={t('atask.f.due', 'Due date')}>
            <Input type="datetime-local" value={d.dueAt} onChange={(e) => setD({ ...d, dueAt: e.target.value })} />
          </Field>
          <Field label={t('atask.f.team', 'Team')}>
            <Dropdown value={d.teamId} onChange={(v) => setD({ ...d, teamId: v, assigneeIds: [] })}
              options={[{ value: '', label: t('atask.f.team.none', 'No team') }, ...teams.map((x) => ({ value: x.id, label: x.name }))]} />
          </Field>
          <Field label={t('atask.f.assign.many', 'People on it')} hint={d.teamId ? t('atask.f.assign.many.h', 'Pick one or several members of the team, or leave it in the pool.') : t('atask.f.assign.h', 'Pick a team first, or leave it for somebody to take.')}>
            <div className="flex flex-wrap gap-1.5">
              {[...(mine.id ? [mine.id] : []), ...assignable.filter((uid) => uid !== mine.id)].map((uid) => {
                const on = d.assigneeIds.includes(uid);
                return (
                  <button key={uid} type="button" aria-pressed={on}
                    onClick={() => setD({ ...d, assigneeIds: on ? d.assigneeIds.filter((x) => x !== uid) : [...d.assigneeIds, uid] })}
                    className={`badge ${on ? 'badge-primary' : ''}`}>
                    {on && <Check size={11} className="me-1" />}
                    {uid === mine.id ? t('atask.f.assign.me', 'Me') : (people[uid]?.displayName || t('atask.unknown', 'Unknown account'))}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** The whole tab: a board, and the teams behind it. */
export function AdminTasks() {
  const { t } = useI18n();
  const [view, setView] = useState('board');
  const [scope, setScope] = useState('mine');
  const [state, setState] = useState('open');
  const [priority, setPriority] = useState('');
  const [teamId, setTeamId] = useState('');
  const [q, setQ] = useState('');
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState(null);

  const meta = useAsync(() => api.get('/admin/tasks/meta'), []);
  const qs = new URLSearchParams({ scope, ...(state ? { state } : {}), ...(priority ? { priority } : {}), ...(teamId ? { teamId } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const list = useAsync(() => api.get(`/admin/tasks?${qs.toString()}`), [scope, state, priority, teamId, q]);

  const teams = meta.data?.teams || [];
  const people = { ...(meta.data?.people || {}), ...(list.data?.people || {}) };
  const tasks = list.data?.tasks || [];
  const reloadAll = () => { meta.reload(true); list.reload(true); };

  const VIEWS = [
    { id: 'board', label: t('atask.view.board', 'Board'), icon: LayoutList },
    { id: 'teams', label: t('atask.view.teams', 'Teams'), icon: Users },
    // Only for somebody who may accept one: a tab that 403s is a tab that looks broken.
    ...(meta.data?.me?.suggestions ? [{ id: 'proposals', label: t('atask.view.proposals', 'Proposals'), icon: Lightbulb }] : []),
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        {/* The two halves of the tab. A strip rather than a second sidebar row: the teams
            exist only to explain the board, and splitting them across the admin nav would
            hide the one screen that says who a task can go to. */}
        <div className="panel-quiet inline-flex rounded-xl border border-[var(--line)] p-1 gap-1">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)}
              className={`press-sm inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === v.id ? 'panel text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
              <v.icon size={14} aria-hidden="true" />{v.label}
            </button>
          ))}
        </div>
        {view === 'board' && (
          <Button variant="primary" size="sm" className="sm:ms-auto" onClick={() => setComposing(true)}>
            <Plus size={14} />{t('atask.new', 'New task')}
          </Button>
        )}
      </div>

      {view === 'teams' ? <AdminTaskTeams onChanged={reloadAll} me={meta.data?.me?.id} />
        : view === 'proposals' ? <AdminTaskProposals meta={meta.data} onChanged={reloadAll} /> : (
        <div className="space-y-4">
          <Explain summary={t('atask.x.s2', 'Tasks are handed to one or several people, by a dispatcher or by their team chief.')}>
            <p>{t('atask.x.1', 'A task carries a title, details in markdown, a state, a priority, a due date, whoever asked for it and whoever is doing it. Everything that happens to it is appended to its history, which is never edited or removed.')}</p>
            <p>{t('atask.x.2b', 'The people on a task move it through the states, and each of them can always take themselves off it. Putting somebody else on it is the chief’s decision inside their team, and a dispatcher’s anywhere. A task can wait on another one (blocked by), block one, or simply be related to it.')}</p>
            <p>{t('atask.x.3', 'Closing a task means done or cancelled. Cancelled keeps the record of why the work stopped, which is why it is not the same as deleting, and deleting is an admin action.')}</p>
          </Explain>

          {/* Filters. They wrap on a phone rather than scrolling sideways: a filter you have
              to scroll to find is one nobody uses. */}
          <div className="panel-quiet rounded-xl border border-[var(--line)] p-2.5 flex flex-wrap items-center gap-2">
            <Filter size={14} className="text-[var(--muted)] shrink-0" aria-hidden="true" />
            <Dropdown size="sm" value={scope} onChange={setScope} options={[
              { value: 'mine', label: t('atask.scope.mine', 'Mine') },
              { value: 'team', label: t('atask.scope.team', 'My teams') },
              { value: 'all', label: t('atask.scope.all', 'Everything') },
            ]} />
            <Dropdown size="sm" value={state} onChange={setState} options={[
              { value: 'open', label: t('atask.filter.open', 'Still open') },
              ...Object.keys(STATE_META).map((s) => ({ value: s, label: stateLabel(t, s) })),
              { value: '', label: t('atask.filter.anystate', 'Any state') },
            ]} />
            <Dropdown size="sm" value={priority} onChange={setPriority} options={[
              { value: '', label: t('atask.filter.anyprio', 'Any priority') },
              ...Object.keys(PRIORITY_META).map((p) => ({ value: p, label: priorityLabel(t, p) })),
            ]} />
            <Dropdown size="sm" value={teamId} onChange={setTeamId} options={[
              { value: '', label: t('atask.filter.anyteam', 'Any team') },
              { value: 'none', label: t('atask.filter.noteam', 'Not filed under a team') },
              ...teams.map((x) => ({ value: x.id, label: x.name })),
            ]} />
            <div className="relative flex-1 min-w-[10rem]">
              <Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" aria-hidden="true" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} className="!ps-8" maxLength={80}
                placeholder={t('atask.search', 'Search tasks')} aria-label={t('atask.search', 'Search tasks')} />
            </div>
          </div>

          {list.loading ? <div className="py-10 grid place-items-center"><Spinner /></div>
            : tasks.length ? (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} people={people} teams={teams} t={t} onOpen={() => setOpenId(task.id)} />
                ))}
              </div>
            ) : (
              <EmptyState icon={ClipboardList}
                title={scope === 'mine' ? t('atask.none.mine.t', 'Nothing is on your name') : t('atask.none.t', 'No tasks match')}
                sub={scope === 'mine'
                  ? t('atask.none.mine.s', 'Work handed to you shows up here. Switch to "My teams" to see what the rest of your team is holding.')
                  : t('atask.none.s', 'Loosen a filter, or file the first one.')}
                action={{ label: t('atask.new', 'New task'), icon: Plus, onClick: () => setComposing(true) }} />
            )}
        </div>
      )}

      {composing && <TaskComposer open meta={meta.data} onClose={() => setComposing(false)} onSaved={reloadAll} />}
      {openId && <TaskDetail id={openId} me={meta.data?.me?.id} onClose={() => setOpenId(null)} onChanged={reloadAll} />}
    </div>
  );
}

export default AdminTasks;
